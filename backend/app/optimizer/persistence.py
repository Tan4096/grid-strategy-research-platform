from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional, Set


@dataclass(frozen=True)
class PersistThrottleSettings:
    min_interval_seconds: float
    min_progress_delta: float
    min_step_delta: int


def invalidate_row_caches(record: Any) -> None:
    record.row_version += 1
    record.cached_sort_key = None
    record.cached_sorted_rows = []
    record.cached_heatmap_version = -1
    record.cached_heatmap = []


def persist_record_snapshot(
    record: Any,
    *,
    include_rows: bool,
    force: bool,
    last_persist_at: Dict[str, float],
    last_persist_progress: Dict[str, float],
    last_persist_completed_steps: Dict[str, int],
    throttle: PersistThrottleSettings,
    save_snapshot: Callable[..., None],
) -> None:
    job_id = record.meta.job_id
    now = time.monotonic()
    last = last_persist_at.get(job_id, 0.0)
    if not include_rows and not force:
        if (now - last) < throttle.min_interval_seconds:
            return
        last_progress = last_persist_progress.get(job_id)
        last_completed = last_persist_completed_steps.get(job_id)
        if last_progress is not None and last_completed is not None:
            progress_delta = abs(float(record.meta.progress) - float(last_progress))
            step_delta = abs(int(record.meta.completed_steps) - int(last_completed))
            if progress_delta < throttle.min_progress_delta and step_delta < throttle.min_step_delta:
                return
    try:
        save_snapshot(
            job_id=job_id,
            target=record.target.value if hasattr(record.target, "value") else str(record.target),
            status=record.meta.status.value if hasattr(record.meta.status, "value") else str(record.meta.status),
            request_payload=record.request_payload,
            meta=record.meta.model_dump(mode="json"),
            rows=[row.model_dump(mode="json") for row in record.rows],
            best_row=record.best_row.model_dump(mode="json") if record.best_row else None,
            best_validation_row=record.best_validation_row.model_dump(mode="json") if record.best_validation_row else None,
            best_equity_curve=[point.model_dump(mode="json") for point in record.best_equity_curve],
            best_score_progression=[point.model_dump(mode="json") for point in record.best_score_progression],
            convergence_curve_data=[point.model_dump(mode="json") for point in record.convergence_curve_data],
            train_window=record.train_window.model_dump(mode="json") if record.train_window else None,
            validation_window=record.validation_window.model_dump(mode="json") if record.validation_window else None,
            include_rows=include_rows,
            cancel_requested=bool(getattr(record, "cancel_requested", False)),
        )
        last_persist_at[job_id] = now
        last_persist_progress[job_id] = float(record.meta.progress)
        last_persist_completed_steps[job_id] = int(record.meta.completed_steps)
    except Exception:
        # Persistence is best-effort and should not break optimization flow.
        return


def drop_persist_tracking(
    job_id: str,
    *,
    last_persist_at: Dict[str, float],
    last_persist_progress: Dict[str, float],
    last_persist_completed_steps: Dict[str, int],
) -> None:
    last_persist_at.pop(job_id, None)
    last_persist_progress.pop(job_id, None)
    last_persist_completed_steps.pop(job_id, None)


def cleanup_jobs_locked(
    jobs: Dict[str, Any],
    *,
    now: Optional[datetime],
    ttl_seconds: int,
    max_records: int,
    finished_statuses: Set[Any],
    on_drop_job: Callable[[str], None],
) -> None:
    current = now or datetime.now(timezone.utc)
    ttl_cutoff = current - timedelta(seconds=ttl_seconds)

    expired_ids = [
        job_id
        for job_id, record in jobs.items()
        if record.meta.status in finished_statuses
        and record.meta.finished_at is not None
        and record.meta.finished_at < ttl_cutoff
    ]
    for job_id in expired_ids:
        jobs.pop(job_id, None)
        on_drop_job(job_id)

    if len(jobs) <= max_records:
        return

    finished_ids_sorted = sorted(
        [
            (job_id, record.meta.finished_at or record.meta.created_at)
            for job_id, record in jobs.items()
            if record.meta.status in finished_statuses
        ],
        key=lambda item: item[1],
    )
    while len(jobs) > max_records and finished_ids_sorted:
        stale_id, _ = finished_ids_sorted.pop(0)
        jobs.pop(stale_id, None)
        on_drop_job(stale_id)

    if len(jobs) <= max_records:
        return

    all_ids_sorted = sorted(
        [(job_id, record.meta.created_at) for job_id, record in jobs.items()],
        key=lambda item: item[1],
    )
    while len(jobs) > max_records and all_ids_sorted:
        stale_id, _ = all_ids_sorted.pop(0)
        record = jobs.get(stale_id)
        if record and record.meta.status not in finished_statuses:
            continue
        jobs.pop(stale_id, None)
        on_drop_job(stale_id)
