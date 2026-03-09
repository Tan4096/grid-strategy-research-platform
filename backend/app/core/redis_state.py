from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from app.core.settings import get_settings
from app.core.task_backend import use_arq_for_backtest, use_arq_for_optimization

redis_module: Any
try:
    import redis as redis_module
except ModuleNotFoundError:  # pragma: no cover - optional dependency in partial envs
    redis_module = None


_LOGGER = logging.getLogger("app.redis_state")
_LOCK = threading.Lock()
_CLIENT: Optional[Any] = None
_UNAVAILABLE_LOGGED = False


def state_redis_enabled() -> bool:
    explicit = get_settings().app_state_redis_enabled
    if explicit is not None:
        return explicit
    return use_arq_for_backtest() or use_arq_for_optimization()


def state_redis_required_in_arq() -> bool:
    explicit = get_settings().app_state_redis_required_in_arq
    if explicit is None:
        return True
    return explicit


def state_redis_dsn() -> str:
    settings = get_settings()
    return (settings.app_state_redis_dsn or settings.app_arq_redis_dsn or "redis://localhost:6379/0").strip() or "redis://localhost:6379/0"


def get_state_redis() -> Optional[Any]:
    global _CLIENT, _UNAVAILABLE_LOGGED
    if not state_redis_enabled():
        return None
    if redis_module is None:
        if not _UNAVAILABLE_LOGGED:
            _LOGGER.warning("state redis enabled but redis dependency is missing; falling back to local memory")
            _UNAVAILABLE_LOGGED = True
        return None

    with _LOCK:
        if _CLIENT is not None:
            return _CLIENT
        try:
            client = redis_module.Redis.from_url(
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
    if get_state_redis() is None:
        raise RuntimeError(
            "检测到 APP_TASK_BACKEND=arq 但状态 Redis 不可用。"
            "请检查 APP_STATE_REDIS_DSN/APP_ARQ_REDIS_DSN，"
            "或临时设置 APP_STATE_REDIS_REQUIRED_IN_ARQ=0 放宽启动限制。"
        )
