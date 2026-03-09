from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.optimization_schemas import OptimizationJobMeta, OptimizationJobStatus, OptimizationTarget
from app.optimizer import optimizer


@pytest.fixture()
def isolate_optimizer_state():
    with optimizer._JOB_LOCK:
        jobs_backup = dict(optimizer._JOBS)
        threads_backup = dict(optimizer._JOB_THREADS)
        optimizer._JOBS.clear()
        optimizer._JOB_THREADS.clear()
    try:
        yield
    finally:
        with optimizer._JOB_LOCK:
            optimizer._JOBS.clear()
            optimizer._JOBS.update(jobs_backup)
            optimizer._JOB_THREADS.clear()
            optimizer._JOB_THREADS.update(threads_backup)


class _ImmediateThread:
    def __init__(self, *, target, args=(), daemon=False):
        self._target = target
        self._args = args
        self._alive = False
        self.daemon = daemon

    def start(self):
        self._alive = True
        try:
            self._target(*self._args)
        finally:
            self._alive = False

    def is_alive(self):
        return self._alive


def test_recover_interrupted_optimization_jobs_restarts_pending_jobs(
    monkeypatch: pytest.MonkeyPatch,
    isolate_optimizer_state,
) -> None:
    job_id = "recover-job-1"
    now = datetime.now(timezone.utc)
    record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            finished_at=None,
            progress=60.0,
            total_steps=100,
            completed_steps=60,
            message="running",
            error=None,
            total_combinations=100,
            trials_completed=60,
            trials_pruned=0,
            pruning_ratio=0.0,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
        request_payload={
            "base_strategy": {
                "side": "long",
                "lower": 60000,
                "upper": 70000,
                "grids": 10,
                "leverage": 5,
                "margin": 1000,
                "stop_loss": 58000,
                "use_base_position": False,
                "strict_risk_control": True,
                "reopen_after_stop": True,
                "fee_rate": 0.0004,
                "slippage": 0.0,
                "maintenance_margin_rate": 0.005,
            },
            "data": {
                "source": "binance",
                "symbol": "BTCUSDT",
                "interval": "1h",
                "lookback_days": 14,
            },
            "optimization": {
                "optimization_mode": "grid",
                "leverage": {"enabled": False},
                "grids": {"enabled": False},
                "band_width_pct": {"enabled": False},
                "stop_loss_ratio_pct": {"enabled": False},
                "optimize_base_position": False,
                "anchor_mode": "BACKTEST_START_PRICE",
                "target": "return_drawdown_ratio",
                "max_combinations": 1,
                "max_trials": 1,
                "max_workers": 1,
                "batch_size": 50,
                "chunk_size": 1,
                "walk_forward_enabled": False,
                "train_ratio": 0.5,
            },
        },
    )
    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = record

    monkeypatch.setattr(optimizer, "_RECOVERY_ENABLED", True)
    monkeypatch.setattr(optimizer, "_RECOVERY_MAX_JOBS", 1)
    monkeypatch.setattr(optimizer, "_RECOVERY_SCAN_LIMIT", 5)
    monkeypatch.setattr(
        optimizer,
        "list_recoverable_job_snapshots",
        lambda limit: [{"job_id": job_id, "request_payload": record.request_payload}],
    )
    monkeypatch.setattr(optimizer, "_persist_record_snapshot", lambda *args, **kwargs: None)

    called: list[str] = []
    monkeypatch.setattr(optimizer, "_run_job", lambda incoming_job_id, payload: called.append(incoming_job_id))
    monkeypatch.setattr(optimizer.threading, "Thread", _ImmediateThread)

    summary = optimizer.recover_interrupted_optimization_jobs()

    assert summary["scanned"] == 1
    assert summary["restarted"] == 1
    assert called == [job_id]
