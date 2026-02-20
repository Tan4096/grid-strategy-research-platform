from __future__ import annotations

import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.core.schemas import (
    BacktestJobMeta,
    BacktestJobStatus,
    BacktestRequest,
    BacktestResult,
    BacktestStartResponse,
    BacktestStatusResponse,
)
from app.services.backtest_engine import run_backtest
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates
from app.services.strategy_analysis import analyze_strategy, build_strategy_analysis_input
from app.services.strategy_scoring import build_strategy_scoring_input, score_strategy


@dataclass
class _BacktestJobRecord:
    meta: BacktestJobMeta
    payload: BacktestRequest
    cancel_requested: bool = False
    result: Optional[BacktestResult] = None


_JOBS_LOCK = threading.Lock()
_JOBS: Dict[str, _BacktestJobRecord] = {}
_FINISHED_STATUSES = {
    BacktestJobStatus.COMPLETED,
    BacktestJobStatus.FAILED,
    BacktestJobStatus.CANCELLED,
}
_JOB_TTL_SECONDS = max(60, int(os.getenv("BACKTEST_JOB_TTL_SECONDS", "86400")))
_JOB_MAX_RECORDS = max(10, int(os.getenv("BACKTEST_MAX_JOB_RECORDS", "200")))


class _BacktestCancelledError(RuntimeError):
    pass


def _cleanup_jobs_locked(now: Optional[datetime] = None) -> None:
    current = now or datetime.now(timezone.utc)
    ttl_cutoff = current - timedelta(seconds=_JOB_TTL_SECONDS)

    expired_ids = [
        job_id
        for job_id, record in _JOBS.items()
        if record.meta.status in _FINISHED_STATUSES
        and record.meta.finished_at is not None
        and record.meta.finished_at < ttl_cutoff
    ]
    for job_id in expired_ids:
        _JOBS.pop(job_id, None)

    if len(_JOBS) <= _JOB_MAX_RECORDS:
        return

    finished_sorted = sorted(
        [
            (job_id, record.meta.finished_at or record.meta.created_at)
            for job_id, record in _JOBS.items()
            if record.meta.status in _FINISHED_STATUSES
        ],
        key=lambda item: item[1],
    )
    while len(_JOBS) > _JOB_MAX_RECORDS and finished_sorted:
        stale_id, _ = finished_sorted.pop(0)
        _JOBS.pop(stale_id, None)


def _update_job_meta(job_id: str, **kwargs: object) -> None:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        for key, value in kwargs.items():
            setattr(record.meta, key, value)


def _is_cancel_requested(job_id: str) -> bool:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        return bool(record.cancel_requested) if record else True


def _raise_if_cancelled(job_id: str) -> None:
    if _is_cancel_requested(job_id):
        raise _BacktestCancelledError("backtest cancelled by user")


def _run_backtest_job(job_id: str) -> None:
    record: Optional[_BacktestJobRecord]
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
    if record is None:
        return

    payload = record.payload
    try:
        _raise_if_cancelled(job_id)
        _update_job_meta(
            job_id,
            status=BacktestJobStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
            progress=5.0,
            message="Loading candles",
            error=None,
        )

        candles = load_candles(payload.data)
        if len(candles) < 2:
            raise ValueError("insufficient candle data for backtest")
        _raise_if_cancelled(job_id)

        _update_job_meta(job_id, progress=25.0, message="Loading funding rates")
        funding_rates = load_funding_rates(payload.data)
        _raise_if_cancelled(job_id)

        _update_job_meta(job_id, progress=45.0, message="Running backtest")
        result = run_backtest(candles=candles, strategy=payload.strategy, funding_rates=funding_rates)
        _raise_if_cancelled(job_id)

        _update_job_meta(job_id, progress=80.0, message="Calculating analysis/scoring")
        analysis_input = build_strategy_analysis_input(summary=result.summary, strategy=payload.strategy)
        analysis = analyze_strategy(analysis_input)
        scoring_input = build_strategy_scoring_input(
            summary=result.summary,
            strategy=payload.strategy,
            equity_curve=result.equity_curve,
            interval_value=payload.data.interval.value,
        )
        scoring = score_strategy(scoring_input)
        final_result = result.model_copy(update={"analysis": analysis, "scoring": scoring})
        _raise_if_cancelled(job_id)

        with _JOBS_LOCK:
            latest = _JOBS.get(job_id)
            if latest is None:
                return
            latest.result = final_result
            latest.meta.status = BacktestJobStatus.COMPLETED
            latest.meta.finished_at = datetime.now(timezone.utc)
            latest.meta.progress = 100.0
            latest.meta.message = "Backtest completed"
            latest.meta.error = None
    except _BacktestCancelledError as exc:
        _update_job_meta(
            job_id,
            status=BacktestJobStatus.CANCELLED,
            finished_at=datetime.now(timezone.utc),
            progress=0.0,
            message=str(exc),
            error=None,
        )
    except (ValueError, DataLoadError) as exc:
        _update_job_meta(
            job_id,
            status=BacktestJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            progress=100.0,
            message="Backtest failed",
            error=str(exc),
        )
    except Exception as exc:  # pragma: no cover - safeguard
        _update_job_meta(
            job_id,
            status=BacktestJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            progress=100.0,
            message="Backtest failed",
            error=str(exc),
        )


def start_backtest_job(payload: BacktestRequest) -> BacktestStartResponse:
    job_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc)
    meta = BacktestJobMeta(
        job_id=job_id,
        status=BacktestJobStatus.PENDING,
        created_at=created_at,
        progress=0.0,
        message="Queued",
    )

    with _JOBS_LOCK:
        _cleanup_jobs_locked(created_at)
        _JOBS[job_id] = _BacktestJobRecord(meta=meta, payload=payload)

    thread = threading.Thread(target=_run_backtest_job, args=(job_id,), daemon=True)
    thread.start()
    return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING)


def get_backtest_job_status(job_id: str) -> BacktestStatusResponse:
    with _JOBS_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            raise KeyError(f"backtest job not found: {job_id}")
        meta = record.meta.model_copy(deep=True)
        result = record.result.model_copy(deep=True) if record.result is not None else None
    return BacktestStatusResponse(job=meta, result=result)


def cancel_backtest_job(job_id: str) -> BacktestJobMeta:
    with _JOBS_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            raise KeyError(f"backtest job not found: {job_id}")

        if record.meta.status in _FINISHED_STATUSES:
            return record.meta.model_copy(deep=True)

        record.cancel_requested = True
        record.meta.message = "Cancellation requested"
        if record.meta.status == BacktestJobStatus.PENDING:
            record.meta.status = BacktestJobStatus.CANCELLED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.progress = 0.0
            record.meta.error = None

        return record.meta.model_copy(deep=True)
