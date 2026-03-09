from __future__ import annotations

from enum import Enum

from app.core.settings import get_settings


class TaskBackend(str, Enum):
    INMEMORY = "inmemory"
    ARQ = "arq"



def _normalize_backend(raw: str | None) -> TaskBackend:
    value = (raw or "").strip().lower()
    if value == TaskBackend.ARQ.value:
        return TaskBackend.ARQ
    return TaskBackend.INMEMORY



def _global_backend() -> TaskBackend:
    return _normalize_backend(get_settings().app_task_backend)



def backtest_task_backend() -> TaskBackend:
    override = get_settings().app_backtest_task_backend
    if override.strip():
        return _normalize_backend(override)
    return _global_backend()



def optimization_task_backend() -> TaskBackend:
    override = get_settings().app_optimization_task_backend
    if override.strip():
        return _normalize_backend(override)
    return _global_backend()



def use_arq_for_backtest() -> bool:
    return backtest_task_backend() == TaskBackend.ARQ



def use_arq_for_optimization() -> bool:
    return optimization_task_backend() == TaskBackend.ARQ



def any_inmemory_backend_enabled() -> bool:
    return backtest_task_backend() == TaskBackend.INMEMORY or optimization_task_backend() == TaskBackend.INMEMORY
