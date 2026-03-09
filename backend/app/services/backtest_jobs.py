from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.core.metrics import observe_job_duration, set_queue_depth
from app.core.schemas import (
    Candle,
    BacktestJobMeta,
    BacktestJobStatus,
    BacktestRequest,
    BacktestResult,
    BacktestStartResponse,
    BacktestStatusResponse,
)
from app.core.task_backend import use_arq_for_backtest
from app.services.backtest_engine import run_backtest
from app.services.backtest_job_store import (
    count_active_backtest_jobs,
    is_backtest_cancel_requested,
    load_backtest_job_snapshot,
    save_backtest_job_snapshot,
    set_backtest_cancel_requested,
)
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates
from app.services.risk_limit import violates_max_loss_limit, violates_stop_loss_liquidation_guard
from app.services.strategy_analysis import analyze_strategy, build_strategy_analysis_input
from app.services.strategy_scoring import build_strategy_scoring_input, score_strategy
from app.tasks.arq_queue import enqueue_backtest_job


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
_LOGGER = logging.getLogger("app.backtest_jobs")


class _BacktestCancelledError(RuntimeError):
    pass


def _validate_backtest_risk_constraints(payload: BacktestRequest, *, initial_price: float) -> None:
    if not payload.strategy.strict_risk_control:
        return

    violates_guard, _, estimated_liq = violates_stop_loss_liquidation_guard(
        payload.strategy,
        initial_price=initial_price,
    )
    if violates_guard:
        if payload.strategy.side.value == "short":
            rule_text = "做空止损价必须满足 UPPER < STOP_LOSS < 预估强平价"
        else:
            rule_text = "做多止损价必须满足 预估强平价 < STOP_LOSS < LOWER"
        liq_text = f"{estimated_liq:.2f}" if estimated_liq is not None else "--"
        raise ValueError(
            f"止损/强平约束不满足：{rule_text}。当前 STOP_LOSS={payload.strategy.stop_loss:.2f}，"
            f"预估强平价={liq_text}。请先调整止损价或仓位参数。"
        )

    violates_limit, max_loss = violates_max_loss_limit(payload.strategy, initial_price=initial_price)
    if violates_limit:
        cap = payload.strategy.max_allowed_loss_usdt
        raise ValueError(
            "以损定仓约束不满足："
            f"止损触发最大可能亏损 {max_loss:.2f} USDT > 允许上限 {float(cap):.2f} USDT。"
            "请降低杠杆/保证金，或调高“最大亏损数额”。"
        )


def validate_backtest_request(payload: BacktestRequest) -> list[Candle]:
    candles = load_candles(payload.data)
    if len(candles) < 2:
        raise ValueError("insufficient candle data for backtest")
    _validate_backtest_risk_constraints(payload, initial_price=candles[0].close)
    return candles


def _refresh_queue_depth_locked() -> None:
    running_jobs = sum(1 for record in _JOBS.values() if record.meta.status not in _FINISHED_STATUSES)
    set_queue_depth(queue_name="backtest", depth=running_jobs)


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
    _refresh_queue_depth_locked()


def _update_job_meta(job_id: str, **kwargs: object) -> None:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        for key, value in kwargs.items():
            setattr(record.meta, key, value)
        _refresh_queue_depth_locked()


def _is_cancel_requested(job_id: str) -> bool:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        return bool(record.cancel_requested) if record else True


def _raise_if_cancelled(job_id: str) -> None:
    if _is_cancel_requested(job_id):
        raise _BacktestCancelledError("backtest cancelled by user")


def _run_backtest_job(job_id: str) -> None:
    started_monotonic = time.perf_counter()
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

        candles = validate_backtest_request(payload)
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
    finally:
        status_label = "unknown"
        with _JOBS_LOCK:
            current = _JOBS.get(job_id)
            if current is not None:
                status_label = current.meta.status.value
            _refresh_queue_depth_locked()
        observe_job_duration(
            job_type="backtest",
            status=status_label,
            duration_seconds=max(0.0, time.perf_counter() - started_monotonic),
        )


def _refresh_arq_queue_depth() -> None:
    try:
        set_queue_depth(queue_name="backtest", depth=count_active_backtest_jobs())
    except Exception:
        return


def _parse_snapshot_payload(payload_data: Any) -> Optional[BacktestRequest]:
    if not isinstance(payload_data, dict):
        return None
    try:
        return BacktestRequest.model_validate(payload_data)
    except Exception:
        return None


def _load_arq_snapshot_or_raise(job_id: str) -> tuple[BacktestJobMeta, Optional[BacktestRequest], Optional[BacktestResult], bool]:
    snapshot = load_backtest_job_snapshot(job_id)
    if snapshot is None:
        raise KeyError(f"backtest job not found: {job_id}")
    meta = BacktestJobMeta.model_validate(snapshot["meta"])
    payload = _parse_snapshot_payload(snapshot.get("payload"))
    result_data = snapshot.get("result")
    result = BacktestResult.model_validate(result_data) if isinstance(result_data, dict) else None
    return meta, payload, result, bool(snapshot.get("cancel_requested", False))


def _save_arq_snapshot(
    *,
    meta: BacktestJobMeta,
    payload: Optional[BacktestRequest],
    result: Optional[BacktestResult],
    cancel_requested: Optional[bool] = None,
) -> None:
    save_backtest_job_snapshot(
        job_id=meta.job_id,
        status=meta.status.value,
        created_at=meta.created_at.isoformat(),
        meta=meta.model_dump(mode="json"),
        payload=payload.model_dump(mode="json") if payload is not None else None,
        result=result.model_dump(mode="json") if result is not None else None,
        cancel_requested=cancel_requested,
    )
    _refresh_arq_queue_depth()


def run_backtest_job_from_arq(job_id: str, payload_data: dict[str, Any]) -> None:
    started_monotonic = time.perf_counter()
    status_label = "unknown"

    snapshot = load_backtest_job_snapshot(job_id)
    if snapshot is None:
        return

    payload = _parse_snapshot_payload(payload_data) or _parse_snapshot_payload(snapshot.get("payload"))
    try:
        meta = BacktestJobMeta.model_validate(snapshot["meta"])
    except Exception:
        meta = BacktestJobMeta(
            job_id=job_id,
            status=BacktestJobStatus.PENDING,
            created_at=datetime.now(timezone.utc),
            progress=0.0,
            message="Queued",
        )

    if payload is None:
        meta.status = BacktestJobStatus.FAILED
        meta.finished_at = datetime.now(timezone.utc)
        meta.progress = 100.0
        meta.message = "Backtest failed"
        meta.error = "invalid backtest payload"
        _save_arq_snapshot(meta=meta, payload=None, result=None)
        observe_job_duration(
            job_type="backtest",
            status=meta.status.value,
            duration_seconds=max(0.0, time.perf_counter() - started_monotonic),
        )
        return

    result: Optional[BacktestResult] = None

    def _raise_if_cancelled_arq() -> None:
        if is_backtest_cancel_requested(job_id):
            raise _BacktestCancelledError("backtest cancelled by user")

    try:
        _raise_if_cancelled_arq()
        meta.status = BacktestJobStatus.RUNNING
        meta.started_at = datetime.now(timezone.utc)
        meta.progress = 5.0
        meta.message = "Loading candles"
        meta.error = None
        _save_arq_snapshot(meta=meta, payload=payload, result=None)

        candles = validate_backtest_request(payload)
        _raise_if_cancelled_arq()

        meta.progress = 25.0
        meta.message = "Loading funding rates"
        _save_arq_snapshot(meta=meta, payload=payload, result=None)
        funding_rates = load_funding_rates(payload.data)
        _raise_if_cancelled_arq()

        meta.progress = 45.0
        meta.message = "Running backtest"
        _save_arq_snapshot(meta=meta, payload=payload, result=None)
        raw_result = run_backtest(candles=candles, strategy=payload.strategy, funding_rates=funding_rates)
        _raise_if_cancelled_arq()

        meta.progress = 80.0
        meta.message = "Calculating analysis/scoring"
        _save_arq_snapshot(meta=meta, payload=payload, result=None)
        analysis_input = build_strategy_analysis_input(summary=raw_result.summary, strategy=payload.strategy)
        analysis = analyze_strategy(analysis_input)
        scoring_input = build_strategy_scoring_input(
            summary=raw_result.summary,
            strategy=payload.strategy,
            equity_curve=raw_result.equity_curve,
            interval_value=payload.data.interval.value,
        )
        scoring = score_strategy(scoring_input)
        result = raw_result.model_copy(update={"analysis": analysis, "scoring": scoring})
        _raise_if_cancelled_arq()

        meta.status = BacktestJobStatus.COMPLETED
        meta.finished_at = datetime.now(timezone.utc)
        meta.progress = 100.0
        meta.message = "Backtest completed"
        meta.error = None
        _save_arq_snapshot(meta=meta, payload=payload, result=result, cancel_requested=False)
    except _BacktestCancelledError as exc:
        meta.status = BacktestJobStatus.CANCELLED
        meta.finished_at = datetime.now(timezone.utc)
        meta.progress = 0.0
        meta.message = str(exc)
        meta.error = None
        _save_arq_snapshot(meta=meta, payload=payload, result=None, cancel_requested=True)
    except (ValueError, DataLoadError) as exc:
        meta.status = BacktestJobStatus.FAILED
        meta.finished_at = datetime.now(timezone.utc)
        meta.progress = 100.0
        meta.message = "Backtest failed"
        meta.error = str(exc)
        _save_arq_snapshot(meta=meta, payload=payload, result=None)
    except Exception as exc:  # pragma: no cover - safeguard
        meta.status = BacktestJobStatus.FAILED
        meta.finished_at = datetime.now(timezone.utc)
        meta.progress = 100.0
        meta.message = "Backtest failed"
        meta.error = str(exc)
        _save_arq_snapshot(meta=meta, payload=payload, result=None)
    finally:
        status_label = meta.status.value
        observe_job_duration(
            job_type="backtest",
            status=status_label,
            duration_seconds=max(0.0, time.perf_counter() - started_monotonic),
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

    if use_arq_for_backtest():
        payload_data = payload.model_dump(mode="json")
        save_backtest_job_snapshot(
            job_id=job_id,
            status=meta.status.value,
            created_at=meta.created_at.isoformat(),
            meta=meta.model_dump(mode="json"),
            payload=payload_data,
            result=None,
            cancel_requested=False,
        )
        _refresh_arq_queue_depth()
        try:
            enqueue_backtest_job(job_id=job_id, payload=payload_data)
        except Exception:
            meta.status = BacktestJobStatus.FAILED
            meta.finished_at = datetime.now(timezone.utc)
            meta.progress = 100.0
            meta.message = "Backtest failed"
            meta.error = "failed to enqueue backtest job"
            save_backtest_job_snapshot(
                job_id=job_id,
                status=meta.status.value,
                created_at=meta.created_at.isoformat(),
                meta=meta.model_dump(mode="json"),
                payload=payload_data,
                result=None,
            )
            _refresh_arq_queue_depth()
            _LOGGER.exception("enqueue backtest job failed: %s", job_id)
            raise
        return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING)

    validate_backtest_request(payload)

    with _JOBS_LOCK:
        _cleanup_jobs_locked(created_at)
        _JOBS[job_id] = _BacktestJobRecord(meta=meta, payload=payload)
        _refresh_queue_depth_locked()

    thread = threading.Thread(target=_run_backtest_job, args=(job_id,), daemon=True)
    thread.start()
    return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING)


def get_backtest_job_status(job_id: str) -> BacktestStatusResponse:
    if use_arq_for_backtest():
        meta, _, result, _ = _load_arq_snapshot_or_raise(job_id)
        return BacktestStatusResponse(job=meta, result=result)

    with _JOBS_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            raise KeyError(f"backtest job not found: {job_id}")
        meta = record.meta.model_copy(deep=True)
        result = record.result.model_copy(deep=True) if record.result is not None else None
    return BacktestStatusResponse(job=meta, result=result)


def cancel_backtest_job(job_id: str) -> BacktestJobMeta:
    if use_arq_for_backtest():
        meta, payload, result, _ = _load_arq_snapshot_or_raise(job_id)
        if meta.status in _FINISHED_STATUSES:
            return meta
        set_backtest_cancel_requested(job_id, True)
        meta.message = "Cancellation requested"
        if meta.status == BacktestJobStatus.PENDING:
            meta.status = BacktestJobStatus.CANCELLED
            meta.finished_at = datetime.now(timezone.utc)
            meta.progress = 0.0
            meta.error = None
        _save_arq_snapshot(meta=meta, payload=payload, result=result, cancel_requested=True)
        return meta

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
        _refresh_queue_depth_locked()

        return record.meta.model_copy(deep=True)
