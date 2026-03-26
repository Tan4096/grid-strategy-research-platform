from __future__ import annotations

from dataclasses import dataclass

from app.core.settings import get_settings
from app.core.task_backend import TaskBackend, backtest_task_backend, optimization_task_backend


@dataclass(frozen=True)
class JobRuntimePolicy:
    worker_count: int
    backtest_backend: TaskBackend
    optimization_backend: TaskBackend
    persistent_backend_required: bool
    shared_runtime_reasons: tuple[str, ...]


def current_job_runtime_policy() -> JobRuntimePolicy:
    settings = get_settings()
    worker_count = settings.configured_worker_count()
    reasons: list[str] = []
    if worker_count > 1:
        reasons.append(f"workers={worker_count}")
    if settings.app_public_mode is True:
        reasons.append("APP_PUBLIC_MODE=1")
    return JobRuntimePolicy(
        worker_count=worker_count,
        backtest_backend=backtest_task_backend(),
        optimization_backend=optimization_task_backend(),
        persistent_backend_required=bool(reasons),
        shared_runtime_reasons=tuple(reasons),
    )


def persistent_backend_violations(policy: JobRuntimePolicy | None = None) -> tuple[str, ...]:
    current = policy or current_job_runtime_policy()
    if not current.persistent_backend_required:
        return ()

    violations: list[str] = []
    if current.backtest_backend != TaskBackend.ARQ:
        violations.append("backtest")
    if current.optimization_backend != TaskBackend.ARQ:
        violations.append("optimization")
    return tuple(violations)


def ensure_persistent_job_backend_for_shared_runtime() -> JobRuntimePolicy:
    policy = current_job_runtime_policy()
    violations = persistent_backend_violations(policy)
    if not violations:
        return policy

    reason_text = " / ".join(policy.shared_runtime_reasons) or "shared runtime"
    runtime_text = ", ".join(violations)
    raise RuntimeError(
        "检测到共享部署模式，但以下任务运行时仍为内存模式："
        f"{runtime_text}。当前触发条件：{reason_text}。"
        "请改用 APP_TASK_BACKEND=arq（或分别将 APP_BACKTEST_TASK_BACKEND / "
        "APP_OPTIMIZATION_TASK_BACKEND 设为 arq），并确保 Redis 可用。"
    )
