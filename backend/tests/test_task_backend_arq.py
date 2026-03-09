from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.core.optimization_schemas import OptimizationJobMeta, OptimizationJobStatus, OptimizationRequest, OptimizationTarget
from app.core.schemas import DataConfig, GridSide, StrategyConfig, default_request
from app.optimizer import optimizer
from app.services import backtest_jobs


@pytest.fixture()
def isolate_job_states():
    with backtest_jobs._JOBS_LOCK:
        backtest_backup = dict(backtest_jobs._JOBS)
        backtest_jobs._JOBS.clear()
    with optimizer._JOB_LOCK:
        optimizer_jobs_backup = dict(optimizer._JOBS)
        optimizer_threads_backup = dict(optimizer._JOB_THREADS)
        optimizer._JOBS.clear()
        optimizer._JOB_THREADS.clear()
    try:
        yield
    finally:
        with backtest_jobs._JOBS_LOCK:
            backtest_jobs._JOBS.clear()
            backtest_jobs._JOBS.update(backtest_backup)
        with optimizer._JOB_LOCK:
            optimizer._JOBS.clear()
            optimizer._JOBS.update(optimizer_jobs_backup)
            optimizer._JOB_THREADS.clear()
            optimizer._JOB_THREADS.update(optimizer_threads_backup)


def _sample_optimization_payload() -> OptimizationRequest:
    return OptimizationRequest(
        base_strategy=StrategyConfig(
            side=GridSide.LONG,
            lower=60000,
            upper=70000,
            grids=8,
            leverage=5,
            margin=1000,
            stop_loss=58000,
            use_base_position=False,
            reopen_after_stop=False,
            fee_rate=0.0004,
            slippage=0.0,
            maintenance_margin_rate=0.005,
        ),
        data=DataConfig(source="binance", symbol="BTCUSDT", interval="1h", lookback_days=14),
    )


def test_backtest_start_uses_arq_backend_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_BACKTEST_TASK_BACKEND", "arq")

    snapshots: dict[str, dict] = {}
    enqueued: list[tuple[str, dict]] = []

    def _save_snapshot(*, job_id: str, status: str, created_at: str, meta, payload=None, result=None, cancel_requested=None):
        snapshots[job_id] = {
            "job_id": job_id,
            "status": status,
            "created_at": created_at,
            "meta": meta,
            "payload": payload,
            "result": result,
            "cancel_requested": cancel_requested,
        }

    monkeypatch.setattr(backtest_jobs, "save_backtest_job_snapshot", _save_snapshot)
    monkeypatch.setattr(
        backtest_jobs,
        "count_active_backtest_jobs",
        lambda: sum(1 for item in snapshots.values() if item["status"] in {"pending", "running"}),
    )
    monkeypatch.setattr(backtest_jobs, "enqueue_backtest_job", lambda job_id, payload: enqueued.append((job_id, payload)))

    response = backtest_jobs.start_backtest_job(default_request())

    assert response.status == backtest_jobs.BacktestJobStatus.PENDING
    assert len(enqueued) == 1
    assert enqueued[0][0] == response.job_id
    assert response.job_id in snapshots
    assert snapshots[response.job_id]["status"] == "pending"


def test_optimization_start_uses_arq_backend_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "arq")
    monkeypatch.setattr(optimizer, "_persist_record_snapshot", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "count_active_job_snapshots", lambda: 1)

    enqueued: list[tuple[str, dict]] = []
    monkeypatch.setattr(optimizer, "enqueue_optimization_job", lambda job_id, payload: enqueued.append((job_id, payload)))

    payload = _sample_optimization_payload()
    response = optimizer.start_optimization_job(payload)

    assert response.status == OptimizationJobStatus.PENDING
    assert response.total_combinations == 0
    assert len(enqueued) == 1
    assert enqueued[0][0] == response.job_id
    assert optimizer._JOB_THREADS == {}


def test_cancel_optimization_job_sets_persistent_cancel_flag(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "arq")
    monkeypatch.setattr(optimizer, "_persist_record_snapshot", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "count_active_job_snapshots", lambda: 0)

    calls: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        optimizer,
        "set_job_cancel_requested",
        lambda job_id, requested=True: calls.append((job_id, requested)) or True,
    )

    job_id = f"cancel-{uuid.uuid4().hex}"
    meta = OptimizationJobMeta(
        job_id=job_id,
        status=OptimizationJobStatus.PENDING,
        created_at=datetime.now(timezone.utc),
        total_combinations=0,
    )
    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = optimizer._JobRecord(
            meta=meta,
            target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
            request_payload=_sample_optimization_payload().model_dump(mode="json"),
        )

    result = optimizer.cancel_optimization_job(job_id)

    assert result.status == OptimizationJobStatus.CANCELLED
    assert calls == [(job_id, True)]


def test_run_optimization_job_from_arq_dispatches_to_runner(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "arq")
    monkeypatch.setattr(optimizer, "_cleanup_jobs_locked", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "_persist_record_snapshot", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "_refresh_queue_depth_locked", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "is_job_cancel_requested", lambda job_id: False)

    called: list[str] = []
    monkeypatch.setattr(optimizer, "_run_job", lambda job_id, payload: called.append(job_id))

    payload = _sample_optimization_payload()
    job_id = f"arq-{uuid.uuid4().hex}"
    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = optimizer._JobRecord(
            meta=OptimizationJobMeta(
                job_id=job_id,
                status=OptimizationJobStatus.PENDING,
                created_at=datetime.now(timezone.utc),
                total_combinations=0,
            ),
            target=payload.optimization.target,
            request_payload=payload.model_dump(mode="json"),
        )
    optimizer.run_optimization_job_from_arq(job_id=job_id, payload_data=payload.model_dump(mode="json"))

    assert called == [job_id]


def test_progress_poll_refreshes_remote_snapshot_when_arq_enabled(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "arq")
    monkeypatch.setattr(optimizer, "_cleanup_jobs_locked", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "_refresh_queue_depth_locked", lambda *args, **kwargs: None)

    job_id = f"remote-{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    stale_record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            progress=1.0,
            total_steps=100,
            completed_steps=1,
            message="Candles loaded",
            error=None,
            total_combinations=0,
            trials_completed=0,
            trials_pruned=0,
            pruning_ratio=0.0,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
    )
    refreshed_record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            progress=38.0,
            total_steps=100,
            completed_steps=38,
            message="Running optimization",
            error=None,
            total_combinations=500,
            trials_completed=120,
            trials_pruned=10,
            pruning_ratio=0.0769,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
    )

    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = stale_record

    monkeypatch.setattr(
        optimizer,
        "_load_record_from_snapshot",
        lambda incoming_job_id: refreshed_record if incoming_job_id == job_id else None,
    )

    progress = optimizer.get_optimization_progress(job_id)

    assert progress.job.progress == pytest.approx(38.0)
    assert progress.job.completed_steps == 38
    with optimizer._JOB_LOCK:
        assert optimizer._JOBS[job_id].meta.progress == pytest.approx(38.0)


def test_progress_poll_refreshes_snapshot_when_local_worker_missing_even_without_arq(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "inmemory")
    monkeypatch.setattr(optimizer, "_cleanup_jobs_locked", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "_refresh_queue_depth_locked", lambda *args, **kwargs: None)

    job_id = f"remote-nonarq-{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    stale_record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            progress=1.0,
            total_steps=200,
            completed_steps=2,
            message="Candles loaded",
            error=None,
            total_combinations=0,
            trials_completed=0,
            trials_pruned=0,
            pruning_ratio=0.0,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
    )
    refreshed_record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            progress=41.5,
            total_steps=200,
            completed_steps=83,
            message="Running optimization",
            error=None,
            total_combinations=640,
            trials_completed=90,
            trials_pruned=12,
            pruning_ratio=0.1176,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
    )

    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = stale_record

    monkeypatch.setattr(
        optimizer,
        "_load_record_from_snapshot",
        lambda incoming_job_id: refreshed_record if incoming_job_id == job_id else None,
    )

    progress = optimizer.get_optimization_progress(job_id)

    assert progress.job.progress == pytest.approx(41.5)
    assert progress.job.completed_steps == 83
    with optimizer._JOB_LOCK:
        assert optimizer._JOBS[job_id].meta.progress == pytest.approx(41.5)


def test_update_job_meta_forces_progress_persist_in_arq_mode(
    monkeypatch: pytest.MonkeyPatch,
    isolate_job_states,
) -> None:
    monkeypatch.setenv("APP_OPTIMIZATION_TASK_BACKEND", "arq")
    monkeypatch.setattr(optimizer, "_cleanup_jobs_locked", lambda *args, **kwargs: None)
    monkeypatch.setattr(optimizer, "_refresh_queue_depth_locked", lambda *args, **kwargs: None)

    job_id = f"persist-{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = optimizer._JobRecord(
            meta=OptimizationJobMeta(
                job_id=job_id,
                status=OptimizationJobStatus.RUNNING,
                created_at=now,
                started_at=now,
                progress=1.0,
                total_steps=100,
                completed_steps=1,
                message="running",
                error=None,
                total_combinations=0,
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            ),
            target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
        )

    calls: list[bool] = []
    monkeypatch.setattr(
        optimizer,
        "_persist_record_snapshot",
        lambda record, include_rows=False, force=False: calls.append(bool(force)),
    )

    optimizer._update_job_meta(job_id, progress=12.0, completed_steps=12)

    assert calls == [True]
