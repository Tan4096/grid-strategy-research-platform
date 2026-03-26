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
    BacktestJobMeta,
    BacktestJobStatus,
    BacktestRequest,
    BacktestResult,
    BacktestStartResponse,
    BacktestStatusResponse,
    Candle,
)
from app.core.task_backend import use_arq_for_backtest
from app.services.backtest_engine import run_backtest
from app.services.backtest_job_store import (
    count_active_backtest_jobs,
    is_backtest_cancel_requested,
    list_recoverable_backtest_job_snapshots,
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
_JOB_THREADS: Dict[str, threading.Thread] = {}
_FINISHED_STATUSES = {
    BacktestJobStatus.COMPLETED,
    BacktestJobStatus.FAILED,
    BacktestJobStatus.CANCELLED,
}
_JOB_TTL_SECONDS = max(60, int(os.getenv("BACKTEST_JOB_TTL_SECONDS", "86400")))
_JOB_MAX_RECORDS = max(10, int(os.getenv("BACKTEST_MAX_JOB_RECORDS", "200")))
_RECOVERY_ENABLED = (os.getenv("BACKTEST_RECOVERY_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"})
_RECOVERY_MAX_JOBS = max(0, int(os.getenv("BACKTEST_RECOVERY_MAX_JOBS", "2")))
_RECOVERY_SCAN_LIMIT = max(_RECOVERY_MAX_JOBS, int(os.getenv("BACKTEST_RECOVERY_SCAN_LIMIT", "20")))
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
    try:
        running_jobs = count_active_backtest_jobs()
    except Exception:
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
        _JOB_THREADS.pop(job_id, None)

    if len(_JOBS) <= _JOB_MAX_RECORDS:
        _refresh_queue_depth_locked()
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
        _JOB_THREADS.pop(stale_id, None)

    _refresh_queue_depth_locked()


def _persist_record_snapshot(record: _BacktestJobRecord) -> None:
    try:
        save_backtest_job_snapshot(
            job_id=record.meta.job_id,
            status=record.meta.status.value,
            created_at=record.meta.created_at.isoformat(),
            meta=record.meta.model_dump(mode="json"),
            payload=record.payload.model_dump(mode="json"),
            result=record.result.model_dump(mode="json") if record.result is not None else None,
            cancel_requested=record.cancel_requested,
        )
    except Exception:
        return


def _load_record_from_snapshot(job_id: str) -> Optional[_BacktestJobRecord]:
    snapshot = load_backtest_job_snapshot(job_id)
    if snapshot is None:
        return None

    try:
        meta = BacktestJobMeta.model_validate(snapshot["meta"])
        payload = _parse_snapshot_payload(snapshot.get("payload"))
        result_data = snapshot.get("result")
        result = BacktestResult.model_validate(result_data) if isinstance(result_data, dict) else None
    except Exception:
        return None

    if payload is None:
        return None

    return _BacktestJobRecord(
        meta=meta,
        payload=payload,
        cancel_requested=bool(snapshot.get("cancel_requested", False)),
        result=result,
    )


def _refresh_record_from_snapshot_for_remote_worker_locked(
    job_id: str,
    record: _BacktestJobRecord,
) -> _BacktestJobRecord:
    worker = _JOB_THREADS.get(job_id)
    if worker is not None and worker.is_alive():
        return record
    if record.meta.status in _FINISHED_STATUSES and record.result is not None:
        return record

    loaded = _load_record_from_snapshot(job_id)
    if loaded is None:
        return record

    current_progress = float(record.meta.progress or 0.0)
    loaded_progress = float(loaded.meta.progress or 0.0)

    should_replace = False
    if loaded.meta.status in _FINISHED_STATUSES and record.meta.status not in _FINISHED_STATUSES:
        should_replace = True
    elif loaded_progress > current_progress + 1e-6:
        should_replace = True
    elif loaded.meta.started_at and not record.meta.started_at:
        should_replace = True
    elif loaded.meta.finished_at and not record.meta.finished_at:
        should_replace = True
    elif loaded.meta.message != record.meta.message:
        should_replace = True
    elif loaded.meta.error != record.meta.error:
        should_replace = True
    elif loaded.result is not None and record.result is None:
        should_replace = True
    elif loaded.cancel_requested and not record.cancel_requested:
        should_replace = True

    if should_replace:
        _JOBS[job_id] = loaded
        return loaded
    return record


def _ensure_running_job_alive_locked(job_id: str, record: _BacktestJobRecord) -> None:
    if record.meta.status not in {BacktestJobStatus.PENDING, BacktestJobStatus.RUNNING}:
        return
    if record.meta.status == BacktestJobStatus.PENDING and record.meta.started_at is None:
        return
    worker = _JOB_THREADS.get(job_id)
    if worker is None:
        return
    if worker.is_alive():
        return
    if record.meta.status in _FINISHED_STATUSES:
        return

    record.meta.status = BacktestJobStatus.FAILED
    record.meta.finished_at = datetime.now(timezone.utc)
    record.meta.progress = 100.0
    record.meta.message = "Backtest failed: worker exited unexpectedly"
    if not record.meta.error:
        record.meta.error = "backtest worker not running"
    _persist_record_snapshot(record)


def _update_job_meta(job_id: str, **kwargs: object) -> None:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        for key, value in kwargs.items():
            setattr(record.meta, key, value)
        _persist_record_snapshot(record)
        _refresh_queue_depth_locked()


def _is_cancel_requested(job_id: str) -> bool:
    record: Optional[_BacktestJobRecord]
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        if record is not None and record.cancel_requested:
            return True
    try:
        requested = is_backtest_cancel_requested(job_id)
    except Exception:
        return False

    if requested and record is not None:
        with _JOBS_LOCK:
            latest = _JOBS.get(job_id)
            if latest is not None:
                latest.cancel_requested = True
    return requested


def _raise_if_cancelled(job_id: str) -> None:
    if _is_cancel_requested(job_id):
        raise _BacktestCancelledError("backtest cancelled by user")


def _run_backtest_pipeline(
    payload: BacktestRequest,
    *,
    on_progress,
    raise_if_cancelled,
) -> BacktestResult:
    raise_if_cancelled()
    on_progress(5.0, "Loading candles")
    candles = validate_backtest_request(payload)
    raise_if_cancelled()

    on_progress(25.0, "Loading funding rates")
    funding_rates = load_funding_rates(payload.data)
    raise_if_cancelled()

    on_progress(45.0, "Running backtest")
    result = run_backtest(candles=candles, strategy=payload.strategy, funding_rates=funding_rates)
    raise_if_cancelled()

    on_progress(80.0, "Calculating analysis/scoring")
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
    raise_if_cancelled()
    return final_result


def _run_backtest_job(job_id: str) -> None:
    started_monotonic = time.perf_counter()
    status_label = "unknown"

    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
    if record is None:
        return

    payload = record.payload
    try:
        _update_job_meta(
            job_id,
            status=BacktestJobStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
            progress=0.0,
            message="Queued",
            error=None,
        )

        def _on_progress(progress: float, message: str) -> None:
            _raise_if_cancelled(job_id)
            _update_job_meta(job_id, progress=progress, message=message, error=None)

        final_result = _run_backtest_pipeline(
            payload,
            on_progress=_on_progress,
            raise_if_cancelled=lambda: _raise_if_cancelled(job_id),
        )

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
            latest.cancel_requested = False
            _persist_record_snapshot(latest)
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
        with _JOBS_LOCK:
            current = _JOBS.get(job_id)
            if current is not None:
                status_label = current.meta.status.value
            _JOB_THREADS.pop(job_id, None)
            _refresh_queue_depth_locked()
        observe_job_duration(
            job_type="backtest",
            status=status_label,
            duration_seconds=max(0.0, time.perf_counter() - started_monotonic),
        )


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
    try:
        set_queue_depth(queue_name="backtest", depth=count_active_backtest_jobs())
    except Exception:
        return


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
        meta.status = BacktestJobStatus.RUNNING
        meta.started_at = datetime.now(timezone.utc)
        meta.progress = 0.0
        meta.message = "Queued"
        meta.error = None

        def _on_progress(progress: float, message: str) -> None:
            _raise_if_cancelled_arq()
            meta.progress = progress
            meta.message = message
            meta.error = None
            _save_arq_snapshot(meta=meta, payload=payload, result=None)

        result = _run_backtest_pipeline(
            payload,
            on_progress=_on_progress,
            raise_if_cancelled=_raise_if_cancelled_arq,
        )

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


def _start_local_backtest_worker(job_id: str) -> None:
    thread = threading.Thread(target=_run_backtest_job, args=(job_id,), daemon=True)
    with _JOBS_LOCK:
        _JOB_THREADS[job_id] = thread
        _refresh_queue_depth_locked()
    try:
        thread.start()
    except Exception:
        with _JOBS_LOCK:
            _JOB_THREADS.pop(job_id, None)
            _refresh_queue_depth_locked()
        raise


def _mark_job_recovery_failed(job_id: str, message: str) -> None:
    with _JOBS_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                return
            record = loaded
            _JOBS[job_id] = record
        record.meta.status = BacktestJobStatus.FAILED
        record.meta.finished_at = datetime.now(timezone.utc)
        record.meta.progress = 100.0
        record.meta.message = "Backtest failed"
        record.meta.error = message
        record.result = None
        _persist_record_snapshot(record)
        _refresh_queue_depth_locked()


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
        try:
            set_queue_depth(queue_name="backtest", depth=count_active_backtest_jobs())
        except Exception:
            pass
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
            try:
                set_queue_depth(queue_name="backtest", depth=count_active_backtest_jobs())
            except Exception:
                pass
            _LOGGER.exception("enqueue backtest job failed: %s", job_id)
            raise
        return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING)

    validate_backtest_request(payload)

    with _JOBS_LOCK:
        _cleanup_jobs_locked(created_at)
        record = _BacktestJobRecord(meta=meta, payload=payload)
        _JOBS[job_id] = record
        _persist_record_snapshot(record)
        _refresh_queue_depth_locked()

    _start_local_backtest_worker(job_id)
    return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING)


def restart_backtest_job(job_id: str) -> BacktestStartResponse:
    with _JOBS_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"backtest job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        if record.meta.status not in _FINISHED_STATUSES:
            raise ValueError("backtest job is not finished")
        payload = record.payload.model_copy(deep=True)

    return start_backtest_job(payload)


def recover_interrupted_backtest_jobs() -> dict[str, int]:
    if use_arq_for_backtest():
        return {"scanned": 0, "restarted": 0, "skipped": 0, "failed": 0}
    if not _RECOVERY_ENABLED or _RECOVERY_MAX_JOBS <= 0:
        return {"scanned": 0, "restarted": 0, "skipped": 0, "failed": 0}

    snapshots = list_recoverable_backtest_job_snapshots(limit=_RECOVERY_SCAN_LIMIT)
    to_start: list[str] = []
    skipped = 0
    failed = 0

    for item in snapshots:
        job_id = str(item.get("job_id") or "").strip()
        if not job_id:
            skipped += 1
            continue

        payload = _parse_snapshot_payload(item.get("payload"))
        if payload is None:
            failed += 1
            _mark_job_recovery_failed(job_id, "backtest request snapshot unavailable for recovery")
            continue

        with _JOBS_LOCK:
            active_worker = _JOB_THREADS.get(job_id)
            if active_worker is not None and active_worker.is_alive():
                skipped += 1
                continue

            record = _JOBS.get(job_id)
            if record is None:
                loaded = _load_record_from_snapshot(job_id)
                if loaded is None:
                    skipped += 1
                    continue
                record = loaded

            if record.meta.status in _FINISHED_STATUSES:
                skipped += 1
                continue

            if len(to_start) >= _RECOVERY_MAX_JOBS:
                skipped += 1
                continue

            record.payload = payload
            record.cancel_requested = False
            record.result = None
            record.meta.status = BacktestJobStatus.PENDING
            record.meta.started_at = None
            record.meta.finished_at = None
            record.meta.progress = 0.0
            record.meta.message = "Recovered after process restart; restarting backtest"
            record.meta.error = None
            _JOBS[job_id] = record
            try:
                set_backtest_cancel_requested(job_id, False)
            except Exception:
                pass
            _persist_record_snapshot(record)
            to_start.append(job_id)

    restarted = 0
    for job_id in to_start:
        _start_local_backtest_worker(job_id)
        restarted += 1

    return {"scanned": len(snapshots), "restarted": restarted, "skipped": skipped, "failed": failed}


def get_backtest_job_status(job_id: str) -> BacktestStatusResponse:
    if use_arq_for_backtest():
        meta, _, result, _ = _load_arq_snapshot_or_raise(job_id)
        return BacktestStatusResponse(job=meta, result=result)

    with _JOBS_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"backtest job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        record = _refresh_record_from_snapshot_for_remote_worker_locked(job_id, record)
        _ensure_running_job_alive_locked(job_id, record)
        if record.meta.status in _FINISHED_STATUSES and record.result is None:
            retry_loaded = _load_record_from_snapshot(job_id)
            if retry_loaded is not None and retry_loaded.result is not None:
                record.result = retry_loaded.result
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
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"backtest job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded

        if record.meta.status in _FINISHED_STATUSES:
            return record.meta.model_copy(deep=True)

        record.cancel_requested = True
        try:
            set_backtest_cancel_requested(job_id, True)
        except Exception:
            pass
        record.meta.message = "Cancellation requested"
        if record.meta.status == BacktestJobStatus.PENDING:
            record.meta.status = BacktestJobStatus.CANCELLED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.progress = 0.0
            record.meta.error = None
        _persist_record_snapshot(record)
        _refresh_queue_depth_locked()

        return record.meta.model_copy(deep=True)
