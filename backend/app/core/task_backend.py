from __future__ import annotations

import os
from enum import Enum


class TaskBackend(str, Enum):
    INMEMORY = "inmemory"
    ARQ = "arq"


def _normalize_backend(raw: str | None) -> TaskBackend:
    value = (raw or "").strip().lower()
    if value == TaskBackend.ARQ.value:
        return TaskBackend.ARQ
    return TaskBackend.INMEMORY


def _global_backend() -> TaskBackend:
    return _normalize_backend(os.getenv("APP_TASK_BACKEND"))


def backtest_task_backend() -> TaskBackend:
    override = os.getenv("APP_BACKTEST_TASK_BACKEND")
    if override is not None and override.strip():
        return _normalize_backend(override)
    return _global_backend()


def optimization_task_backend() -> TaskBackend:
    override = os.getenv("APP_OPTIMIZATION_TASK_BACKEND")
    if override is not None and override.strip():
        return _normalize_backend(override)
    return _global_backend()


def use_arq_for_backtest() -> bool:
    return backtest_task_backend() == TaskBackend.ARQ


def use_arq_for_optimization() -> bool:
    return optimization_task_backend() == TaskBackend.ARQ


def any_inmemory_backend_enabled() -> bool:
    return (
        backtest_task_backend() == TaskBackend.INMEMORY
        or optimization_task_backend() == TaskBackend.INMEMORY
    )
