from __future__ import annotations

import asyncio
import concurrent.futures
import os
import threading
from typing import Any


def arq_queue_name() -> str:
    return (os.getenv("APP_ARQ_QUEUE_NAME") or "crypto-grid").strip() or "crypto-grid"


def arq_max_jobs() -> int:
    return max(1, int(os.getenv("APP_ARQ_MAX_JOBS", "4")))


def arq_job_timeout_seconds() -> int:
    return max(60, int(os.getenv("APP_ARQ_JOB_TIMEOUT_SECONDS", "21600")))


def redis_dsn() -> str:
    return (os.getenv("APP_ARQ_REDIS_DSN") or "redis://localhost:6379/0").strip() or "redis://localhost:6379/0"


def _enqueue_timeout_seconds() -> float:
    try:
        return max(0.5, float(os.getenv("APP_ARQ_ENQUEUE_TIMEOUT_SECONDS", "5")))
    except ValueError:
        return 5.0


class ArqEnqueueError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        queue: str,
        backend: str = "arq",
        retryable: bool = True,
    ) -> None:
        super().__init__(message)
        self.queue = queue
        self.backend = backend
        self.retryable = bool(retryable)


def _require_arq_modules():
    try:
        from arq import create_pool  # type: ignore
        from arq.connections import RedisSettings  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Arq 依赖未安装。请安装 backend 依赖后重试，或切回 APP_TASK_BACKEND/APP_*_TASK_BACKEND=inmemory。"
        ) from exc
    return create_pool, RedisSettings


def redis_settings_from_env():
    _, RedisSettings = _require_arq_modules()
    return RedisSettings.from_dsn(redis_dsn())


_LOOP_LOCK = threading.Lock()
_LOOP_READY = threading.Event()
_LOOP_THREAD: threading.Thread | None = None
_LOOP: asyncio.AbstractEventLoop | None = None
_REDIS_POOL: Any = None
_REDIS_POOL_DSN: str | None = None


def _loop_runner() -> None:
    global _LOOP
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _LOOP = loop
    _LOOP_READY.set()
    loop.run_forever()


def _ensure_background_loop() -> asyncio.AbstractEventLoop:
    global _LOOP_THREAD, _LOOP
    with _LOOP_LOCK:
        if _LOOP is not None and _LOOP.is_running():
            return _LOOP
        _LOOP_READY.clear()
        _LOOP_THREAD = threading.Thread(target=_loop_runner, daemon=True, name="arq-enqueue-loop")
        _LOOP_THREAD.start()
    if not _LOOP_READY.wait(timeout=3):
        raise ArqEnqueueError(
            "failed to start arq enqueue loop",
            queue=arq_queue_name(),
            retryable=True,
        )
    if _LOOP is None or not _LOOP.is_running():
        raise ArqEnqueueError(
            "arq enqueue loop is not running",
            queue=arq_queue_name(),
            retryable=True,
        )
    return _LOOP


async def _get_or_create_pool() -> Any:
    global _REDIS_POOL, _REDIS_POOL_DSN
    dsn = redis_dsn()
    if _REDIS_POOL is not None and _REDIS_POOL_DSN == dsn:
        return _REDIS_POOL
    try:
        create_pool, RedisSettings = _require_arq_modules()
    except RuntimeError as exc:
        raise ArqEnqueueError(
            str(exc),
            queue=arq_queue_name(),
            retryable=False,
        ) from exc
    _REDIS_POOL = await create_pool(RedisSettings.from_dsn(dsn))
    _REDIS_POOL_DSN = dsn
    return _REDIS_POOL


async def _reset_pool() -> None:
    global _REDIS_POOL, _REDIS_POOL_DSN
    if _REDIS_POOL is not None:
        close_fn = getattr(_REDIS_POOL, "close", None)
        if callable(close_fn):
            maybe_awaitable = close_fn()
            if asyncio.iscoroutine(maybe_awaitable):
                await maybe_awaitable
    _REDIS_POOL = None
    _REDIS_POOL_DSN = None


async def _enqueue(function_name: str, job_id: str, payload: dict[str, Any]) -> None:
    queue = arq_queue_name()
    try:
        redis = await _get_or_create_pool()
    except ArqEnqueueError:
        raise
    except Exception as exc:
        raise ArqEnqueueError(
            f"failed to create arq redis pool: {exc}",
            queue=queue,
            retryable=True,
        ) from exc
    try:
        await redis.enqueue_job(
            function_name,
            job_id,
            payload,
            _job_id=f"{function_name}:{job_id}",
            _queue_name=queue,
        )
    except Exception as exc:
        await _reset_pool()
        raise ArqEnqueueError(
            f"failed to enqueue arq job: {exc}",
            queue=queue,
            retryable=True,
        ) from exc


def _run_enqueue(function_name: str, job_id: str, payload: dict[str, Any]) -> None:
    loop = _ensure_background_loop()
    future = asyncio.run_coroutine_threadsafe(
        _enqueue(function_name=function_name, job_id=job_id, payload=payload),
        loop,
    )
    try:
        future.result(timeout=_enqueue_timeout_seconds())
    except concurrent.futures.TimeoutError as exc:
        future.cancel()
        raise ArqEnqueueError(
            "arq enqueue timed out",
            queue=arq_queue_name(),
            retryable=True,
        ) from exc


def enqueue_backtest_job(job_id: str, payload: dict[str, Any]) -> None:
    _run_enqueue(function_name="arq_run_backtest_job", job_id=job_id, payload=payload)


def enqueue_optimization_job(job_id: str, payload: dict[str, Any]) -> None:
    _run_enqueue(function_name="arq_run_optimization_job", job_id=job_id, payload=payload)
