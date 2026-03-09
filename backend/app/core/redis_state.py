from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from app.core.task_backend import use_arq_for_backtest, use_arq_for_optimization

try:
    from redis import Redis
except ModuleNotFoundError:  # pragma: no cover - optional dependency in partial envs
    Redis = None  # type: ignore[assignment]


_LOGGER = logging.getLogger("app.redis_state")
_LOCK = threading.Lock()
_CLIENT: Optional["Redis"] = None
_UNAVAILABLE_LOGGED = False


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def state_redis_enabled() -> bool:
    explicit = os.getenv("APP_STATE_REDIS_ENABLED")
    if explicit is not None:
        return _truthy(explicit, default=False)
    return use_arq_for_backtest() or use_arq_for_optimization()


def state_redis_required_in_arq() -> bool:
    raw = os.getenv("APP_STATE_REDIS_REQUIRED_IN_ARQ")
    if raw is None:
        return True
    return _truthy(raw, default=True)


def state_redis_dsn() -> str:
    return (
        os.getenv("APP_STATE_REDIS_DSN")
        or os.getenv("APP_ARQ_REDIS_DSN")
        or "redis://localhost:6379/0"
    ).strip() or "redis://localhost:6379/0"


def get_state_redis() -> Optional["Redis"]:
    global _CLIENT, _UNAVAILABLE_LOGGED
    if not state_redis_enabled():
        return None
    if Redis is None:
        if not _UNAVAILABLE_LOGGED:
            _LOGGER.warning("state redis enabled but redis dependency is missing; falling back to local memory")
            _UNAVAILABLE_LOGGED = True
        return None

    with _LOCK:
        if _CLIENT is not None:
            return _CLIENT
        try:
            client = Redis.from_url(
                state_redis_dsn(),
                decode_responses=True,
                socket_timeout=0.35,
                socket_connect_timeout=0.35,
                retry_on_timeout=True,
            )
            client.ping()
        except Exception as exc:  # pragma: no cover - env/network dependent
            if not _UNAVAILABLE_LOGGED:
                _LOGGER.warning("state redis unavailable (%s); falling back to local memory", exc)
                _UNAVAILABLE_LOGGED = True
            return None
        _CLIENT = client
        _UNAVAILABLE_LOGGED = False
        return _CLIENT


def ensure_state_redis_ready_for_arq_or_raise() -> None:
    if not (use_arq_for_backtest() or use_arq_for_optimization()):
        return
    if not state_redis_required_in_arq():
        return
    client = get_state_redis()
    if client is None:
        raise RuntimeError(
            "检测到 APP_TASK_BACKEND=arq 但状态 Redis 不可用。"
            "请检查 APP_STATE_REDIS_DSN/APP_ARQ_REDIS_DSN，"
            "或临时设置 APP_STATE_REDIS_REQUIRED_IN_ARQ=0 放宽启动限制。"
        )
