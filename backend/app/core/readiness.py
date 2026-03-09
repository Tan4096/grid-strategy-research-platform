from __future__ import annotations

from typing import Any

from app.core.redis_state import get_state_redis, state_redis_enabled
from app.core.settings import get_settings
from app.core.task_backend import (
    backtest_task_backend,
    optimization_task_backend,
    use_arq_for_backtest,
    use_arq_for_optimization,
)
from app.optimizer.job_store import probe_optimization_store_writable
from app.services.backtest_job_store import probe_backtest_store_writable

redis_module: Any
try:
    import redis as redis_module
except ModuleNotFoundError:  # pragma: no cover - optional in partial env
    redis_module = None



def _redis_dsn_for_arq() -> str:
    return get_settings().app_arq_redis_dsn.strip() or "redis://localhost:6379/0"



def _ping_redis_dsn(dsn: str) -> tuple[bool, str]:
    if redis_module is None:
        return False, "redis dependency missing"
    try:
        client = redis_module.Redis.from_url(
            dsn,
            decode_responses=True,
            socket_timeout=0.5,
            socket_connect_timeout=0.5,
            retry_on_timeout=True,
        )
        client.ping()
        return True, "ok"
    except Exception as exc:
        return False, str(exc)



def build_ready_report() -> tuple[bool, dict[str, Any], str]:
    opt_ok, opt_message = probe_optimization_store_writable()
    bt_ok, bt_message = probe_backtest_store_writable()
    sqlite_ok = opt_ok and bt_ok
    sqlite_payload = {
        "status": "ok" if sqlite_ok else "degraded",
        "optimization_store": {"ok": bool(opt_ok), "message": opt_message},
        "backtest_store": {"ok": bool(bt_ok), "message": bt_message},
    }

    state_redis_required = state_redis_enabled()
    state_client = get_state_redis()
    state_redis_ok = (state_client is not None) if state_redis_required else True
    state_redis_message = "ok" if state_redis_ok else "state redis unavailable"

    arq_required = use_arq_for_backtest() or use_arq_for_optimization()
    if arq_required:
        arq_redis_ok, arq_redis_message = _ping_redis_dsn(_redis_dsn_for_arq())
    else:
        arq_redis_ok, arq_redis_message = True, "not required for inmemory backend"

    redis_ok = state_redis_ok and arq_redis_ok
    redis_payload = {
        "status": "ok" if redis_ok else "degraded",
        "state_redis": {
            "required": state_redis_required,
            "ok": state_redis_ok,
            "message": state_redis_message,
        },
        "arq_redis": {
            "required": arq_required,
            "ok": arq_redis_ok,
            "message": arq_redis_message,
        },
    }

    task_backend_ok = not arq_required or arq_redis_ok
    task_backend_payload = {
        "status": "ok" if task_backend_ok else "degraded",
        "backtest": backtest_task_backend().value,
        "optimization": optimization_task_backend().value,
    }

    ready_ok = sqlite_ok and redis_ok and task_backend_ok
    message = "ready" if ready_ok else "one or more readiness checks failed"
    return ready_ok, {"redis": redis_payload, "sqlite": sqlite_payload, "task_backend": task_backend_payload}, message
