from __future__ import annotations

import asyncio
import json
import time
from enum import Enum
from typing import Any, Callable

from fastapi import Request

from app.core.job_events import job_event_channel
from app.core.redis_state import get_state_redis
from app.optimizer.optimizer import get_optimization_progress
from app.services.backtest_jobs import get_backtest_job_status

_TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}
_EVENT_FALLBACK_POLL_SECONDS = 3.0
_LEGACY_POLL_SECONDS = 0.8


class JobStreamType(str, Enum):
    AUTO = "auto"
    BACKTEST = "backtest"
    OPTIMIZATION = "optimization"


def _status_to_value(status: Any) -> str:
    raw = getattr(status, "value", status)
    return str(raw).strip().lower()


def _build_backtest_stream_update(job_id: str) -> dict[str, Any]:
    payload = get_backtest_job_status(job_id)
    status = _status_to_value(payload.job.status)
    return {
        "job_id": job_id,
        "job_type": JobStreamType.BACKTEST.value,
        "status": status,
        "progress": float(payload.job.progress),
        "terminal": status in _TERMINAL_JOB_STATUSES,
        "payload": payload.model_dump(mode="json"),
    }


def _build_optimization_stream_update(job_id: str) -> dict[str, Any]:
    payload = get_optimization_progress(job_id)
    status = _status_to_value(payload.job.status)
    return {
        "job_id": job_id,
        "job_type": JobStreamType.OPTIMIZATION.value,
        "status": status,
        "progress": float(payload.job.progress),
        "terminal": status in _TERMINAL_JOB_STATUSES,
        "payload": payload.model_dump(mode="json"),
    }


def resolve_stream_reader(job_id: str, job_type: JobStreamType) -> Callable[[str], dict[str, Any]]:
    if job_type == JobStreamType.BACKTEST:
        _build_backtest_stream_update(job_id)
        return _build_backtest_stream_update
    if job_type == JobStreamType.OPTIMIZATION:
        _build_optimization_stream_update(job_id)
        return _build_optimization_stream_update
    try:
        _build_backtest_stream_update(job_id)
        return _build_backtest_stream_update
    except KeyError:
        _build_optimization_stream_update(job_id)
        return _build_optimization_stream_update


def _format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)
    return f"event: {event}\\ndata: {payload}\\n\\n"


async def job_stream_generator(request: Request, job_id: str, read_update: Callable[[str], dict[str, Any]]):
    last_payload = ""
    heartbeat_tick = 0
    next_poll_at = 0.0
    pubsub: Any = None

    async def _try_open_pubsub(stream_job_type: str) -> Any:
        redis_client = get_state_redis()
        if redis_client is None:
            return None
        channel = job_event_channel(stream_job_type, job_id)
        try:
            next_pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
            await asyncio.to_thread(next_pubsub.subscribe, channel)
            return next_pubsub
        except Exception:
            return None

    async def _close_pubsub() -> None:
        nonlocal pubsub
        if pubsub is None:
            return
        try:
            await asyncio.to_thread(pubsub.close)
        except Exception:
            pass
        pubsub = None

    try:
        while True:
            if await request.is_disconnected():
                break

            now = time.monotonic()
            should_poll = False

            if pubsub is None:
                should_poll = now >= next_poll_at
                if not should_poll:
                    await asyncio.sleep(min(0.25, max(0.02, next_poll_at - now)))
                    continue
            else:
                try:
                    # 优先消费 Redis 事件，空闲时低频轮询补偿。
                    message = await asyncio.to_thread(pubsub.get_message, True, 0.8)
                except Exception:
                    await _close_pubsub()
                    next_poll_at = 0.0
                    continue
                now = time.monotonic()
                if message is not None or now >= next_poll_at:
                    should_poll = True
                else:
                    heartbeat_tick += 1
                    if heartbeat_tick >= 15:
                        heartbeat_tick = 0
                        yield ": keepalive\\n\\n"
                    continue

            if not should_poll:
                continue

            try:
                payload = read_update(job_id)
            except KeyError:
                yield _format_sse(
                    "error",
                    {
                        "job_id": job_id,
                        "code": "JOB_NOT_FOUND",
                        "message": f"job not found: {job_id}",
                    },
                )
                break

            stream_job_type = str(payload.get("job_type") or "").strip().lower()
            if pubsub is None and stream_job_type in {JobStreamType.BACKTEST.value, JobStreamType.OPTIMIZATION.value}:
                pubsub = await _try_open_pubsub(stream_job_type)

            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
            if encoded != last_payload:
                last_payload = encoded
                yield _format_sse("update", payload)
            if bool(payload.get("terminal")):
                break

            heartbeat_tick += 1
            if heartbeat_tick >= 15:
                heartbeat_tick = 0
                yield ": keepalive\\n\\n"
            next_poll_at = time.monotonic() + (_EVENT_FALLBACK_POLL_SECONDS if pubsub is not None else _LEGACY_POLL_SECONDS)
    finally:
        await _close_pubsub()
