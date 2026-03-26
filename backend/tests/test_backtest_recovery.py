from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.schemas import BacktestJobMeta, BacktestJobStatus, default_request
from app.services import backtest_jobs


@pytest.fixture()
def isolate_backtest_state():
    with backtest_jobs._JOBS_LOCK:
        jobs_backup = dict(backtest_jobs._JOBS)
        threads_backup = dict(backtest_jobs._JOB_THREADS)
        backtest_jobs._JOBS.clear()
        backtest_jobs._JOB_THREADS.clear()
    try:
        yield
    finally:
        with backtest_jobs._JOBS_LOCK:
            backtest_jobs._JOBS.clear()
            backtest_jobs._JOBS.update(jobs_backup)
            backtest_jobs._JOB_THREADS.clear()
            backtest_jobs._JOB_THREADS.update(threads_backup)


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


def test_recover_interrupted_backtest_jobs_restarts_pending_jobs(
    monkeypatch: pytest.MonkeyPatch,
    isolate_backtest_state,
) -> None:
    job_id = "recover-backtest-1"
    now = datetime.now(timezone.utc)
    payload = default_request()
    record = backtest_jobs._BacktestJobRecord(
        meta=BacktestJobMeta(
            job_id=job_id,
            status=BacktestJobStatus.RUNNING,
            created_at=now,
            started_at=now,
            finished_at=None,
            progress=55.0,
            message="running",
            error=None,
        ),
        payload=payload,
    )
    with backtest_jobs._JOBS_LOCK:
        backtest_jobs._JOBS[job_id] = record

    monkeypatch.setattr(backtest_jobs, "_RECOVERY_ENABLED", True)
    monkeypatch.setattr(backtest_jobs, "_RECOVERY_MAX_JOBS", 1)
    monkeypatch.setattr(backtest_jobs, "_RECOVERY_SCAN_LIMIT", 5)
    monkeypatch.setattr(
        backtest_jobs,
        "list_recoverable_backtest_job_snapshots",
        lambda limit: [{"job_id": job_id, "payload": payload.model_dump(mode="json")}],
    )
    monkeypatch.setattr(backtest_jobs, "_persist_record_snapshot", lambda *args, **kwargs: None)
    monkeypatch.setattr(backtest_jobs, "set_backtest_cancel_requested", lambda *args, **kwargs: True)

    called: list[str] = []
    monkeypatch.setattr(backtest_jobs, "_run_backtest_job", lambda incoming_job_id: called.append(incoming_job_id))
    monkeypatch.setattr(backtest_jobs.threading, "Thread", _ImmediateThread)

    summary = backtest_jobs.recover_interrupted_backtest_jobs()

    assert summary["scanned"] == 1
    assert summary["restarted"] == 1
    assert called == [job_id]
