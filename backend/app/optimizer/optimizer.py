from __future__ import annotations

import math
import os
import random
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import product
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.optimization_schemas import (
    AnchorMode,
    HeatmapCell,
    OptimizationConfig,
    OptimizationJobMeta,
    OptimizationJobStatus,
    OptimizationMode,
    OptimizationProgressResponse,
    OptimizationProgressPoint,
    OptimizationTarget,
    OptimizationRequest,
    OptimizationResultRow,
    OptimizationRowsResponse,
    OptimizationStartResponse,
    OptimizationStatusResponse,
    OptimizationHeatmapResponse,
    SortOrder,
    SweepRange,
    TimeWindowInfo,
)
from app.core.schemas import BacktestResult, Candle, CurvePoint, StrategyConfig
from app.optimizer.bayesian_optimizer import (
    BayesianDependencyError,
    BayesianTrialOutcome,
)
from app.optimizer.constraints import (
    apply_constraints as _apply_constraints,
    compute_robust_score as _compute_robust_score,
    primary_score as _primary_score,
    safe_score as _safe_score,
)
from app.optimizer.csv_export import export_rows_csv as export_rows_csv_text
from app.optimizer.csv_export import iter_rows_csv as iter_rows_csv_stream
from app.optimizer.job_store import (
    count_active_job_snapshots,
    get_operation_event,
    list_operation_events_cursor,
    optimization_soft_delete_ttl_hours,
    soft_delete_all_terminal_job_snapshots_with_details,
    soft_delete_terminal_job_snapshots_with_details,
    restore_job_snapshots_with_details,
    is_job_cancel_requested,
    list_recent_job_snapshots_cursor,
    list_recoverable_job_snapshots,
    load_job_snapshot,
    save_job_snapshot,
    save_operation_event,
    set_job_cancel_requested,
)
from app.optimizer.parallel_runner import CombinationEvaluator, run_combinations_parallel
from app.optimizer.persistence import (
    PersistThrottleSettings,
    cleanup_jobs_locked as cleanup_jobs_locked_view,
    drop_persist_tracking as drop_persist_tracking_view,
    invalidate_row_caches as invalidate_row_caches_view,
    persist_record_snapshot as persist_record_snapshot_view,
)
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_score, compute_sharpe_ratio_from_values
from app.optimizer.sampling import (
    ParameterSpace as _ParameterSpace,
    build_combinations as _build_combinations,
    build_combinations_limited as _build_combinations_limited,
    build_single_combo as _build_single_combo,
    combo_signature as _combo_signature,
    derive_band_width_pct as _derive_band_width_pct,
    derive_base_position_grid_indices as _derive_base_position_grid_indices,
    derive_base_position_info as _derive_base_position_info,
    derive_stop_loss_ratio_pct as _derive_stop_loss_ratio_pct,
    estimate_initial_avg_entry_and_liquidation as _estimate_initial_avg_entry_and_liquidation,
    generate_refine_combos as _generate_refine_combos,
    grid_nodes_with_cache as _grid_nodes_with_cache,
    is_effectively_integer as _is_effectively_integer,
    limit_combinations as _limit_combinations,
    normalize_pct as _normalize_pct,
    resolve_anchor_price as _resolve_anchor_price,
    resolve_parameter_space as _resolve_parameter_space,
    sample_random_combinations as _sample_random_combinations,
    suggest_from_sweep as _suggest_from_sweep,
    total_space_combinations as _total_space_combinations,
)
from app.optimizer.storage_paths import optuna_study_storage_url
from app.optimizer.status_views import build_heatmap as build_heatmap_view
from app.optimizer.status_views import paginate_rows as paginate_rows_view
from app.optimizer.status_views import score_sort_key as score_sort_key_view
from app.core.metrics import observe_job_duration, set_queue_depth
from app.core.task_backend import use_arq_for_optimization
from app.services.backtest_engine import run_backtest, run_backtest_for_optimization
from app.services.data_loader import load_candles, load_funding_rates
from app.tasks.arq_queue import enqueue_optimization_job


@dataclass
class _JobRecord:
    meta: OptimizationJobMeta
    target: OptimizationTarget
    request_payload: Optional[Dict[str, Any]] = None
    cancel_requested: bool = False
    rows: List[OptimizationResultRow] = field(default_factory=list)
    best_row: Optional[OptimizationResultRow] = None
    best_validation_row: Optional[OptimizationResultRow] = None
    best_equity_curve: List[CurvePoint] = field(default_factory=list)
    best_score_progression: List[OptimizationProgressPoint] = field(default_factory=list)
    convergence_curve_data: List[OptimizationProgressPoint] = field(default_factory=list)
    train_window: Optional[TimeWindowInfo] = None
    validation_window: Optional[TimeWindowInfo] = None
    row_version: int = 0
    cached_sort_key: Optional[Tuple[str, str, int]] = None
    cached_sorted_rows: List[OptimizationResultRow] = field(default_factory=list)
    cached_heatmap_version: int = -1
    cached_heatmap: List[HeatmapCell] = field(default_factory=list)


_JOB_LOCK = threading.Lock()
_JOBS: Dict[str, _JobRecord] = {}
_JOB_THREADS: Dict[str, threading.Thread] = {}
_FINISHED_JOB_STATUSES = {
    OptimizationJobStatus.COMPLETED,
    OptimizationJobStatus.FAILED,
    OptimizationJobStatus.CANCELLED,
}
_JOB_RETENTION_SECONDS = max(60, int(os.getenv("OPTIMIZATION_JOB_TTL_SECONDS", "86400")))
_JOB_MAX_RECORDS = max(10, int(os.getenv("OPTIMIZATION_MAX_JOB_RECORDS", "200")))
_LAST_PERSIST_AT: Dict[str, float] = {}
_LAST_PERSIST_PROGRESS: Dict[str, float] = {}
_LAST_PERSIST_COMPLETED_STEPS: Dict[str, int] = {}
_META_PERSIST_MIN_INTERVAL_SECONDS = max(
    0.2, float(os.getenv("OPTIMIZATION_META_PERSIST_MIN_INTERVAL_SECONDS", "0.5"))
)
_META_PERSIST_MIN_PROGRESS_DELTA = max(
    0.05, float(os.getenv("OPTIMIZATION_META_PERSIST_MIN_PROGRESS_DELTA", "0.1"))
)
_META_PERSIST_MIN_STEP_DELTA = max(1, int(os.getenv("OPTIMIZATION_META_PERSIST_MIN_STEP_DELTA", "16")))
_RECOVERY_ENABLED = (os.getenv("OPTIMIZATION_RECOVERY_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"})
_RECOVERY_MAX_JOBS = max(0, int(os.getenv("OPTIMIZATION_RECOVERY_MAX_JOBS", "2")))
_RECOVERY_SCAN_LIMIT = max(_RECOVERY_MAX_JOBS, int(os.getenv("OPTIMIZATION_RECOVERY_SCAN_LIMIT", "20")))


class JobCancelledError(RuntimeError):
    pass


def _refresh_queue_depth_locked() -> None:
    if use_arq_for_optimization():
        try:
            running_jobs = count_active_job_snapshots()
        except Exception:
            running_jobs = sum(1 for record in _JOBS.values() if record.meta.status not in _FINISHED_JOB_STATUSES)
    else:
        running_jobs = sum(1 for record in _JOBS.values() if record.meta.status not in _FINISHED_JOB_STATUSES)
    set_queue_depth(queue_name="optimization", depth=running_jobs)


def _build_resume_storage(study_key: str) -> tuple[str, str]:
    return optuna_study_storage_url(study_key)


def _split_walk_forward(candles: List[Candle], train_ratio: float) -> Tuple[List[Candle], List[Candle]]:
    split_idx = int(len(candles) * train_ratio)
    split_idx = max(2, min(split_idx, len(candles) - 2))
    return candles[:split_idx], candles[split_idx:]


def _filter_funding_rates_by_candles(
    funding_rates: List[tuple[datetime, float]],
    candles: List[Candle],
) -> List[tuple[datetime, float]]:
    if not funding_rates or not candles:
        return []
    start_ts = candles[0].timestamp
    end_ts = candles[-1].timestamp
    return [(ts, rate) for ts, rate in funding_rates if start_ts <= ts <= end_ts]


def _window_info(candles: List[Candle]) -> TimeWindowInfo:
    return TimeWindowInfo(start_time=candles[0].timestamp, end_time=candles[-1].timestamp, candles=len(candles))


def _rows_by_id(rows: List[OptimizationResultRow]) -> Dict[int, OptimizationResultRow]:
    return {row.row_id: row for row in rows}


def _build_row_from_eval(combo: dict, eval_payload: dict) -> OptimizationResultRow:
    meta = combo["meta"]
    summary = eval_payload["summary"] if eval_payload.get("ok") else None

    if not summary:
        return OptimizationResultRow(
            row_id=int(combo["row_id"]),
            leverage=meta["leverage"],
            grids=meta["grids"],
            use_base_position=meta["use_base_position"],
            base_grid_count=meta["base_grid_count"],
            initial_position_size=meta["initial_position_size"],
            anchor_price=meta["anchor_price"],
            lower_price=meta["lower_price"],
            upper_price=meta["upper_price"],
            stop_price=meta["stop_price"],
            band_width_pct=meta["band_width_pct"],
            range_lower=meta["range_lower"],
            range_upper=meta["range_upper"],
            stop_loss=meta["stop_loss"],
            stop_loss_ratio_pct=meta["stop_loss_ratio_pct"],
            max_possible_loss_usdt=float(meta.get("max_possible_loss_usdt", 0.0)),
            total_return_usdt=-1e12,
            max_drawdown_pct=1e12,
            sharpe_ratio=0.0,
            win_rate=0.0,
            return_drawdown_ratio=-1e12,
            score=float("-inf"),
            total_closed_trades=0,
        )

    return OptimizationResultRow(
        row_id=int(combo["row_id"]),
        leverage=meta["leverage"],
        grids=meta["grids"],
        use_base_position=meta["use_base_position"],
        base_grid_count=meta["base_grid_count"],
        initial_position_size=meta["initial_position_size"],
        anchor_price=meta["anchor_price"],
        lower_price=meta["lower_price"],
        upper_price=meta["upper_price"],
        stop_price=meta["stop_price"],
        band_width_pct=meta["band_width_pct"],
        range_lower=meta["range_lower"],
        range_upper=meta["range_upper"],
        stop_loss=meta["stop_loss"],
        stop_loss_ratio_pct=meta["stop_loss_ratio_pct"],
        max_possible_loss_usdt=float(meta.get("max_possible_loss_usdt", 0.0)),
        total_return_usdt=float(summary["total_return_usdt"]),
        max_drawdown_pct=float(summary["max_drawdown_pct"]),
        sharpe_ratio=float(eval_payload["sharpe_ratio"]),
        win_rate=float(summary["win_rate"]),
        return_drawdown_ratio=float(eval_payload["return_drawdown_ratio"]),
        score=float(eval_payload["score"]),
        total_closed_trades=int(summary["total_closed_trades"]),
    )


def _score_sort_key(row: OptimizationResultRow, sort_by: str) -> float:
    return score_sort_key_view(row=row, sort_by=sort_by, safe_score=_safe_score)


def _paginate_rows(rows: List[OptimizationResultRow], page: int, page_size: int) -> List[OptimizationResultRow]:
    return paginate_rows_view(rows=rows, page=page, page_size=page_size)


def _build_heatmap(rows: List[OptimizationResultRow]) -> List[HeatmapCell]:
    return build_heatmap_view(rows=rows, primary_score=_primary_score)


def _export_rows_csv(rows: List[OptimizationResultRow], *, record: Optional[_JobRecord] = None) -> str:
    return export_rows_csv_text(rows=rows, record=record)


def _invalidate_row_caches(record: _JobRecord) -> None:
    invalidate_row_caches_view(record)


def _persist_record_snapshot(record: _JobRecord, include_rows: bool = False, force: bool = False) -> None:
    persist_record_snapshot_view(
        record,
        include_rows=include_rows,
        force=force,
        last_persist_at=_LAST_PERSIST_AT,
        last_persist_progress=_LAST_PERSIST_PROGRESS,
        last_persist_completed_steps=_LAST_PERSIST_COMPLETED_STEPS,
        throttle=PersistThrottleSettings(
            min_interval_seconds=_META_PERSIST_MIN_INTERVAL_SECONDS,
            min_progress_delta=_META_PERSIST_MIN_PROGRESS_DELTA,
            min_step_delta=_META_PERSIST_MIN_STEP_DELTA,
        ),
        save_snapshot=save_job_snapshot,
    )


def _load_record_from_snapshot(job_id: str) -> Optional[_JobRecord]:
    snapshot = load_job_snapshot(job_id)
    if snapshot is None:
        return None

    try:
        meta = OptimizationJobMeta.model_validate(snapshot["meta"])
        target = OptimizationTarget(snapshot["target"])
        rows = [OptimizationResultRow.model_validate(item) for item in snapshot.get("rows", [])]
        best_row = OptimizationResultRow.model_validate(snapshot["best_row"]) if snapshot.get("best_row") else None
        best_validation_row = (
            OptimizationResultRow.model_validate(snapshot["best_validation_row"])
            if snapshot.get("best_validation_row")
            else None
        )
        best_equity_curve = [CurvePoint.model_validate(item) for item in snapshot.get("best_equity_curve", [])]
        best_score_progression = [
            OptimizationProgressPoint.model_validate(item) for item in snapshot.get("best_score_progression", [])
        ]
        convergence_curve_data = [
            OptimizationProgressPoint.model_validate(item) for item in snapshot.get("convergence_curve_data", [])
        ]
        train_window = TimeWindowInfo.model_validate(snapshot["train_window"]) if snapshot.get("train_window") else None
        validation_window = (
            TimeWindowInfo.model_validate(snapshot["validation_window"]) if snapshot.get("validation_window") else None
        )
        request_payload = snapshot.get("request_payload")
        cancel_requested = bool(snapshot.get("cancel_requested", False))
    except Exception:
        return None

    record = _JobRecord(
        meta=meta,
        target=target,
        request_payload=request_payload if isinstance(request_payload, dict) else None,
        cancel_requested=cancel_requested,
        rows=rows,
        best_row=best_row,
        best_validation_row=best_validation_row,
        best_equity_curve=best_equity_curve,
        best_score_progression=best_score_progression,
        convergence_curve_data=convergence_curve_data,
        train_window=train_window,
        validation_window=validation_window,
    )
    if rows:
        _invalidate_row_caches(record)
    return record


def _refresh_record_from_snapshot_for_remote_worker_locked(job_id: str, record: _JobRecord) -> _JobRecord:
    # NOTE:
    # Even outside ARQ mode, status polling can hit a different backend process
    # (e.g. accidental multi-worker deployment). In that case local `_JOBS`
    # cache may lag behind and must be refreshed from persisted snapshot.
    worker = _JOB_THREADS.get(job_id)
    if worker is not None and worker.is_alive():
        return record
    if record.meta.status in _FINISHED_JOB_STATUSES:
        return record

    loaded = _load_record_from_snapshot(job_id)
    if loaded is None:
        return record

    current_progress = float(record.meta.progress or 0.0)
    loaded_progress = float(loaded.meta.progress or 0.0)
    current_steps = int(record.meta.completed_steps or 0)
    loaded_steps = int(loaded.meta.completed_steps or 0)

    should_replace = False
    if loaded.meta.status in _FINISHED_JOB_STATUSES and record.meta.status not in _FINISHED_JOB_STATUSES:
        should_replace = True
    elif loaded_steps > current_steps:
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

    if should_replace:
        _JOBS[job_id] = loaded
        return loaded
    return record


def _drop_job_resources(job_id: str) -> None:
    _JOB_THREADS.pop(job_id, None)
    _refresh_queue_depth_locked()
    drop_persist_tracking_view(
        job_id,
        last_persist_at=_LAST_PERSIST_AT,
        last_persist_progress=_LAST_PERSIST_PROGRESS,
        last_persist_completed_steps=_LAST_PERSIST_COMPLETED_STEPS,
    )


def _mark_job_recovery_failed(job_id: str, message: str) -> None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                return
            record = loaded
            _JOBS[job_id] = record
        record.meta.status = OptimizationJobStatus.FAILED
        record.meta.finished_at = datetime.now(timezone.utc)
        record.meta.error = message
        record.meta.message = "Optimization failed"
        _persist_record_snapshot(record, include_rows=True, force=True)
        _refresh_queue_depth_locked()


def _cleanup_jobs_locked(now: Optional[datetime] = None) -> None:
    cleanup_jobs_locked_view(
        _JOBS,
        now=now,
        ttl_seconds=_JOB_RETENTION_SECONDS,
        max_records=_JOB_MAX_RECORDS,
        finished_statuses=_FINISHED_JOB_STATUSES,
        on_drop_job=_drop_job_resources,
    )
    _refresh_queue_depth_locked()


def _is_cancel_requested(job_id: str) -> bool:
    record: Optional[_JobRecord]
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is not None and record.cancel_requested:
            return True
        if not use_arq_for_optimization():
            return False
    try:
        requested = is_job_cancel_requested(job_id)
    except Exception:
        return False
    if requested and record is not None:
        with _JOB_LOCK:
            latest = _JOBS.get(job_id)
            if latest is not None:
                latest.cancel_requested = True
    return requested


def _raise_if_cancelled(job_id: str) -> None:
    if _is_cancel_requested(job_id):
        raise JobCancelledError("optimization cancelled by user")


def _update_job_meta(job_id: str, **kwargs: object) -> None:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            return
        for key, value in kwargs.items():
            setattr(record.meta, key, value)
        force_persist = bool(
            {"status", "started_at", "finished_at", "error", "message", "total_steps"} & set(kwargs.keys())
        )
        if not force_persist:
            force_persist = bool(
                {"progress", "completed_steps", "trials_completed", "trials_pruned", "pruning_ratio"}
                & set(kwargs.keys())
            )
        _persist_record_snapshot(record, include_rows=False, force=force_persist)
        _refresh_queue_depth_locked()


def _ensure_running_job_alive_locked(job_id: str, record: _JobRecord) -> None:
    if record.meta.status not in {OptimizationJobStatus.PENDING, OptimizationJobStatus.RUNNING}:
        return
    if record.meta.status == OptimizationJobStatus.PENDING and record.meta.started_at is None:
        return
    worker = _JOB_THREADS.get(job_id)
    # NOTE:
    # Status polling can hit a different backend process than the one that started the
    # optimization thread. In that case `_JOB_THREADS` won't have this job_id locally.
    # Missing local handle must NOT be treated as worker exit.
    if worker is None:
        return
    if worker.is_alive():
        return
    if record.meta.status in _FINISHED_JOB_STATUSES:
        return
    record.meta.status = OptimizationJobStatus.FAILED
    record.meta.finished_at = datetime.now(timezone.utc)
    if not record.meta.error:
        record.meta.error = "optimization worker not running"
    record.meta.message = "Optimization failed: worker exited unexpectedly"
    _persist_record_snapshot(record, include_rows=True, force=True)


def _run_job(job_id: str, payload: OptimizationRequest) -> None:
    started_monotonic = time.perf_counter()
    try:
        _raise_if_cancelled(job_id)
        started = datetime.now(timezone.utc)
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.RUNNING,
            started_at=started,
            message=(
                "Loading candles "
                f"({payload.data.source.value}:{payload.data.symbol.upper()} {payload.data.interval.value})"
            ),
            progress=0.0,
        )

        _raise_if_cancelled(job_id)
        candles = load_candles(payload.data)
        if len(candles) < 4:
            raise ValueError("insufficient candle data for optimization")
        _update_job_meta(
            job_id,
            message=f"Candles loaded ({len(candles)}), loading funding rates",
            progress=1.0,
        )
        funding_rates = load_funding_rates(payload.data)
        _update_job_meta(
            job_id,
            message=f"Funding loaded ({len(funding_rates)}), preparing optimizer",
            progress=2.0,
        )

        train_candles = candles
        validation_candles: List[Candle] = []

        if payload.optimization.walk_forward_enabled:
            train_candles, validation_candles = _split_walk_forward(candles, payload.optimization.train_ratio)
        train_funding_rates = _filter_funding_rates_by_candles(funding_rates, train_candles)
        validation_funding_rates = _filter_funding_rates_by_candles(funding_rates, validation_candles)

        optimization = payload.optimization
        reference_price = _resolve_anchor_price(candles, payload.optimization)
        initial_price = train_candles[0].close
        max_loss_initial_price = reference_price
        progress_lock = threading.Lock()
        completed_steps = 0
        total_steps = 1
        progress_emit_step = 1
        last_progress_emit_steps = -1
        last_progress_emit_ts = 0.0

        def set_total_steps(new_total: int) -> None:
            nonlocal total_steps, completed_steps, progress_emit_step
            with progress_lock:
                total_steps = max(1, int(new_total))
                completed_steps = min(completed_steps, total_steps)
                progress = (completed_steps / total_steps) * 100.0
                # Emit roughly 0.5% step granularity for large jobs to reduce lock churn.
                progress_emit_step = max(1, total_steps // 200)
            _update_job_meta(job_id, total_steps=total_steps, completed_steps=completed_steps, progress=progress)

        def advance(step_done: int, step_total: int, stage_offset: int) -> None:
            nonlocal completed_steps, last_progress_emit_steps, last_progress_emit_ts
            _raise_if_cancelled(job_id)
            now = time.perf_counter()
            with progress_lock:
                completed_steps = min(stage_offset + step_done, total_steps)
                progress = (completed_steps / total_steps) * 100.0 if total_steps else 100.0
                should_emit = (
                    completed_steps >= total_steps
                    or step_done >= step_total
                    or completed_steps <= 0
                    or (completed_steps - last_progress_emit_steps) >= progress_emit_step
                    or (now - last_progress_emit_ts) >= 0.25
                )
                if should_emit:
                    last_progress_emit_steps = completed_steps
                    last_progress_emit_ts = now
            if should_emit:
                _update_job_meta(job_id, completed_steps=completed_steps, progress=progress)

        generated_combinations = 0
        sampled_combinations = 0
        max_loss_hint: Optional[str] = None
        row_lookup: Dict[int, OptimizationResultRow] = {}
        combo_by_id: Dict[int, dict] = {}
        best_score_progression: List[OptimizationProgressPoint] = []
        convergence_curve_data: List[OptimizationProgressPoint] = []
        trials_completed = 0
        trials_pruned = 0
        adaptive_fallback_triggered_at: Optional[int] = None

        if optimization.optimization_mode == OptimizationMode.GRID:
            _raise_if_cancelled(job_id)
            parameter_space = _resolve_parameter_space(payload.base_strategy, optimization, reference_price)
            raw_space_combinations = _total_space_combinations(parameter_space)
            # For very large cartesian spaces, avoid full materialization before limit.
            # Build only up to max_combinations directly when auto-limit is enabled.
            if optimization.auto_limit_combinations and raw_space_combinations > optimization.max_combinations:
                _update_job_meta(
                    job_id,
                    message=(
                        "Preparing optimizer "
                        f"(sampling up to {optimization.max_combinations} from space={raw_space_combinations})"
                    ),
                )
                combos, _ = _build_combinations_limited(
                    base_strategy=payload.base_strategy,
                    optimization=optimization,
                    reference_price=reference_price,
                    initial_price=initial_price,
                    max_loss_initial_price=max_loss_initial_price,
                    max_count=int(optimization.max_combinations),
                    seed=optimization.random_seed,
                )
                generated_combinations = raw_space_combinations
                sampled_combinations = len(combos)
            else:
                _update_job_meta(
                    job_id,
                    message=f"Preparing optimizer (building combinations from space={raw_space_combinations})",
                )
                combos = _build_combinations(
                    payload.base_strategy,
                    optimization,
                    reference_price,
                    initial_price,
                    max_loss_initial_price=max_loss_initial_price,
                )
                generated_combinations = len(combos)
                sampled_combinations = generated_combinations

            if not combos:
                if optimization.max_allowed_loss_usdt is not None:
                    raise ValueError(
                        "最大亏损数额约束过严，当前参数空间没有可执行组合。"
                        "请降低杠杆/保证金，或提高“最大亏损数额”后重试。"
                    )
                raise ValueError("no valid parameter combinations generated")

            if (
                optimization.max_allowed_loss_usdt is not None
                and raw_space_combinations > 0
                and len(combos) <= max(5, int(raw_space_combinations * 0.1))
            ):
                max_loss_hint = (
                    "最大亏损数额约束较紧，"
                    f"可执行组合仅 {len(combos)}/{raw_space_combinations}。"
                    "建议调整杠杆/保证金或提高亏损上限。"
                )
            if generated_combinations > optimization.max_combinations:
                if optimization.auto_limit_combinations:
                    # In sampled path, combos is already limited; for full-build path keep old limiting behavior.
                    if len(combos) > optimization.max_combinations:
                        combos = _limit_combinations(combos, optimization.max_combinations)
                    sampled_combinations = len(combos)
                else:
                    raise ValueError(
                        f"combination count {generated_combinations} exceeds max_combinations={optimization.max_combinations}"
                    )

            total_steps = len(combos) + (len(combos) if validation_candles else 0)
            eval_tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in combos]

            running_message = "Running grid optimization"
            if sampled_combinations < generated_combinations:
                running_message = (
                    f"Running grid optimization (sampled {sampled_combinations}/{generated_combinations} combinations)"
                )
            _update_job_meta(
                job_id,
                total_combinations=len(combos),
                total_steps=total_steps,
                completed_steps=0,
                progress=0.0,
                message=running_message,
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            )

            train_evals = run_combinations_parallel(
                candles=train_candles,
                tasks=eval_tasks,
                funding_rates=train_funding_rates,
                interval_value=payload.data.interval.value,
                target=optimization.target,
                custom_score_expr=optimization.custom_score_expr,
                max_workers=optimization.max_workers,
                batch_size=optimization.batch_size,
                chunk_size=optimization.chunk_size,
                progress_hook=lambda done, total: advance(done, total, 0),
            )
            _raise_if_cancelled(job_id)

            combo_by_id = {int(combo["row_id"]): combo for combo in combos}
            running_best = float("-inf")
            for idx, eval_row in enumerate(train_evals, start=1):
                combo = combo_by_id[int(eval_row["row_id"])]
                row = _build_row_from_eval(combo, eval_row)
                row_lookup[row.row_id] = row

                score = _safe_score(eval_row.get("score"))
                convergence_curve_data.append(OptimizationProgressPoint(step=idx, value=score))
                if score > running_best:
                    running_best = score
                best_score_progression.append(OptimizationProgressPoint(step=idx, value=running_best))

            trials_completed = len(combos)
            trials_pruned = 0
        elif optimization.optimization_mode == OptimizationMode.RANDOM_PRUNED:
            _raise_if_cancelled(job_id)
            parameter_space = _resolve_parameter_space(payload.base_strategy, optimization, reference_price)
            generated_combinations = _total_space_combinations(parameter_space)
            if generated_combinations <= 0:
                raise ValueError("no valid parameter space for random-pruned optimization")

            trial_budget = max(1, int(optimization.max_trials))
            target_trials = max(1, min(trial_budget, generated_combinations))
            sampled_combinations = target_trials
            worker_count = max(1, min(int(optimization.max_workers), os.cpu_count() or 1))
            configured_batch_size = max(1, int(optimization.batch_size))
            evaluation_batch_size = max(worker_count, min(configured_batch_size, worker_count * 4, 512))

            total_steps = target_trials + (target_trials if validation_candles else 0)
            _update_job_meta(
                job_id,
                total_combinations=target_trials,
                total_steps=total_steps,
                completed_steps=0,
                progress=0.0,
                message=(
                    "Running random-pruned optimization "
                    f"(space={generated_combinations}, trials={target_trials}, workers={worker_count}, "
                    f"eval_batch={evaluation_batch_size})"
                ),
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            )

            rng = random.Random(optimization.random_seed if optimization.random_seed is not None else 0xC0FFEE)
            node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}
            seen_tuples: set[Tuple[float, int, float, float, bool]] = set()
            max_attempts = max(target_trials * 25, 2_000)
            attempts = 0
            invalid_pruned = 0
            next_row_id = 1
            evaluated_count = 0
            running_best = float("-inf")
            eval_failed = 0
            eval_succeeded = 0
            combo_by_id = {}

            fallback_iter = iter(
                product(
                    parameter_space.leverage_values,
                    parameter_space.grid_values,
                    parameter_space.band_values,
                    parameter_space.stop_ratio_values,
                    parameter_space.base_position_values,
                )
            )

            def _draw_random_tuple() -> Tuple[float, int, float, float, bool]:
                return (
                    float(rng.choice(parameter_space.leverage_values)),
                    int(rng.choice(parameter_space.grid_values)),
                    float(rng.choice(parameter_space.band_values)),
                    float(rng.choice(parameter_space.stop_ratio_values)),
                    bool(rng.choice(parameter_space.base_position_values)),
                )

            with CombinationEvaluator(
                candles=train_candles,
                funding_rates=train_funding_rates,
                interval_value=payload.data.interval.value,
                target=optimization.target,
                custom_score_expr=optimization.custom_score_expr,
                max_workers=worker_count,
            ) as train_evaluator:
                _update_job_meta(
                    job_id,
                    message=(
                        "Running random-pruned optimization "
                        f"(space={generated_combinations}, trials={target_trials}, workers={worker_count}, "
                        f"engine={train_evaluator.engine}, eval_batch={evaluation_batch_size})"
                    ),
                )

                while len(combo_by_id) < target_trials and len(seen_tuples) < generated_combinations:
                    _raise_if_cancelled(job_id)
                    batch_combos: List[dict] = []

                    while len(batch_combos) < evaluation_batch_size and len(combo_by_id) < target_trials:
                        param_tuple: Optional[Tuple[float, int, float, float, bool]] = None

                        while attempts < max_attempts and len(seen_tuples) < generated_combinations:
                            attempts += 1
                            candidate = _draw_random_tuple()
                            if candidate in seen_tuples:
                                continue
                            seen_tuples.add(candidate)
                            param_tuple = candidate
                            break

                        if param_tuple is None:
                            for leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position in fallback_iter:
                                candidate = (
                                    float(leverage),
                                    int(grids),
                                    float(band_pct_raw),
                                    float(stop_ratio_raw),
                                    bool(use_base_position),
                                )
                                if candidate in seen_tuples:
                                    continue
                                seen_tuples.add(candidate)
                                param_tuple = candidate
                                break

                        if param_tuple is None:
                            break

                        leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position = param_tuple
                        combo = _build_single_combo(
                            row_id=next_row_id,
                            base_strategy=payload.base_strategy,
                            reference_price=reference_price,
                            initial_price=initial_price,
                            max_loss_initial_price=max_loss_initial_price,
                            leverage=leverage,
                            grids=grids,
                            band_pct_raw=band_pct_raw,
                            stop_ratio_raw=stop_ratio_raw,
                            use_base_position=use_base_position,
                            node_cache=node_cache,
                            max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
                        )
                        if combo is None:
                            invalid_pruned += 1
                            continue

                        batch_combos.append(combo)
                        combo_by_id[int(combo["row_id"])] = combo
                        next_row_id += 1

                    if not batch_combos:
                        break

                    batch_tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in batch_combos]
                    batch_offset = evaluated_count
                    batch_evals = train_evaluator.run(
                        batch_tasks,
                        batch_size=min(evaluation_batch_size, len(batch_tasks)),
                        chunk_size=optimization.chunk_size,
                        progress_hook=lambda done, total, offset=batch_offset: advance(offset + done, target_trials, 0),
                    )
                    evaluated_count += len(batch_tasks)
                    _raise_if_cancelled(job_id)

                    for eval_row in batch_evals:
                        combo = combo_by_id.get(int(eval_row["row_id"]))
                        if combo is None:
                            continue
                        row = _build_row_from_eval(combo, eval_row)
                        row_lookup[row.row_id] = row

                        if eval_row.get("ok"):
                            eval_succeeded += 1
                        else:
                            eval_failed += 1

                        step = len(convergence_curve_data) + 1
                        score = _safe_score(eval_row.get("score"))
                        convergence_curve_data.append(OptimizationProgressPoint(step=step, value=score))
                        if score > running_best:
                            running_best = score
                        best_score_progression.append(OptimizationProgressPoint(step=step, value=running_best))

                    running_trials_completed = eval_succeeded
                    running_trials_pruned = invalid_pruned + eval_failed
                    running_tested_total = max(running_trials_completed + running_trials_pruned, 1)
                    _update_job_meta(
                        job_id,
                        trials_completed=running_trials_completed,
                        trials_pruned=running_trials_pruned,
                        pruning_ratio=(running_trials_pruned / running_tested_total),
                    )

            sampled_combinations = len(combo_by_id)
            if sampled_combinations == 0:
                if optimization.max_allowed_loss_usdt is not None:
                    raise ValueError(
                        "最大亏损数额约束过严，当前参数空间没有可执行组合。"
                        "请降低杠杆/保证金，或提高“最大亏损数额”后重试。"
                    )
                raise ValueError("random-pruned optimization produced no valid parameter combinations")
            if (
                optimization.max_allowed_loss_usdt is not None
                and sampled_combinations <= max(5, int(target_trials * 0.2))
            ):
                max_loss_hint = (
                    "最大亏损数额约束较紧，"
                    f"有效试验仅 {sampled_combinations}/{target_trials}。"
                    "建议调整杠杆/保证金或提高亏损上限。"
                )
            if sampled_combinations != target_trials:
                set_total_steps(sampled_combinations + (sampled_combinations if validation_candles else 0))

            trials_completed = eval_succeeded
            trials_pruned = invalid_pruned + eval_failed
            tested_total = max(trials_completed + trials_pruned, 1)
            _update_job_meta(
                job_id,
                trials_completed=trials_completed,
                trials_pruned=trials_pruned,
                pruning_ratio=(trials_pruned / tested_total),
            )
        elif optimization.optimization_mode == OptimizationMode.BAYESIAN:
            _raise_if_cancelled(job_id)
            parameter_space = _resolve_parameter_space(payload.base_strategy, optimization, reference_price)
            generated_combinations = _total_space_combinations(parameter_space)
            if generated_combinations <= 0:
                raise ValueError("no valid parameter space for trial-based optimization")

            trial_budget = max(1, int(optimization.max_trials))
            sampled_combinations = trial_budget
            worker_count = max(1, min(int(optimization.max_workers), os.cpu_count() or 1))
            configured_batch_size = max(1, int(optimization.batch_size))
            # Small Bayesian ask batches reduce single-thread sampling stalls when trial count grows.
            bayesian_ask_batch_size = max(worker_count, min(configured_batch_size, worker_count * 2, 64))
            # Random fallback can use larger batches because sampling cost is trivial.
            random_fallback_batch_size = max(worker_count, min(configured_batch_size, worker_count * 4, 256))
            # Keep evaluation batches large enough to saturate worker processes.
            evaluation_batch_size = max(worker_count, min(configured_batch_size, worker_count * 4, 512))
            # Limit time spent in one ask phase so workers stay fed with tasks.
            ask_time_budget_seconds = max(0.25, min(2.0, worker_count * 0.08))

            total_steps = max(1, trial_budget)
            running_message = (
                "Running bayesian optimization "
                f"(space={generated_combinations}, trials={sampled_combinations}, workers={worker_count}, "
                f"ask_batch={bayesian_ask_batch_size}, eval_batch={evaluation_batch_size})"
            )
            _update_job_meta(
                job_id,
                total_combinations=trial_budget,
                total_steps=total_steps,
                completed_steps=0,
                progress=0.0,
                message=running_message,
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            )

            interval_value = payload.data.interval.value
            target = optimization.target
            custom_score_expr = optimization.custom_score_expr
            fallback_band_pct = _derive_band_width_pct(
                payload.base_strategy.lower,
                payload.base_strategy.upper,
                reference_price,
            )
            fallback_stop_ratio_pct = _derive_stop_loss_ratio_pct(payload.base_strategy)
            base_use_position = bool(payload.base_strategy.use_base_position)
            try:
                import optuna  # type: ignore
                from optuna.trial import TrialState  # type: ignore
            except ModuleNotFoundError as exc:
                raise BayesianDependencyError(
                    "optuna is required for optimization_mode=bayesian. Install backend dependencies to continue."
                ) from exc

            optuna.logging.set_verbosity(optuna.logging.WARNING)
            warmup_trials = int(trial_budget * max(0.0, min(optimization.warmup_ratio, 0.9)))
            sampler = optuna.samplers.TPESampler(
                seed=optimization.random_seed,
                n_startup_trials=max(0, min(warmup_trials, trial_budget)),
                # Favor lower-overhead Bayesian sampling for large trial budgets.
                multivariate=False,
                group=False,
                constant_liar=False,
                n_ei_candidates=16,
            )

            if optimization.resume_study:
                storage_key = optimization.resume_study_key or "btc-grid-default"
                storage_url, study_name = _build_resume_storage(storage_key)
                study = optuna.create_study(
                    direction="maximize",
                    sampler=sampler,
                    storage=storage_url,
                    study_name=study_name,
                    load_if_exists=True,
                )
            else:
                study = optuna.create_study(direction="maximize", sampler=sampler)

            node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}
            successful_trials: List[BayesianTrialOutcome] = []
            processed_trials = 0
            running_best = float("-inf")
            next_row_id = 1
            use_random_fallback = False
            adaptive_fallback_enabled = bool(optimization.bayesian_adaptive_fallback_enabled)
            adaptive_window_batches = max(2, int(optimization.bayesian_adaptive_window_batches))
            adaptive_slowdown_factor = float(optimization.bayesian_adaptive_slowdown_factor)
            adaptive_min_trials_after_warmup = max(1, int(optimization.bayesian_adaptive_min_trials_after_warmup))
            warmup_trial_costs: deque[float] = deque(maxlen=adaptive_window_batches)
            bayes_trial_costs: deque[float] = deque(maxlen=adaptive_window_batches)
            bayes_baseline_cost: Optional[float] = None
            random_param_rng = random.Random((optimization.random_seed if optimization.random_seed is not None else 0xC0FFEE) ^ 0xA57D)
            random_seen_tuples: set[Tuple[float, int, float, float, bool]] = set()

            def _random_param_tuple() -> Tuple[float, int, float, float, bool]:
                return (
                    float(random_param_rng.choice(parameter_space.leverage_values)),
                    int(random_param_rng.choice(parameter_space.grid_values)),
                    float(random_param_rng.choice(parameter_space.band_values)),
                    float(random_param_rng.choice(parameter_space.stop_ratio_values)),
                    bool(random_param_rng.choice(parameter_space.base_position_values)),
                )

            def _maybe_activate_adaptive_fallback(batch_elapsed_seconds: float, batch_trials_consumed: int) -> None:
                nonlocal use_random_fallback, adaptive_fallback_triggered_at, bayes_baseline_cost
                if use_random_fallback or batch_trials_consumed <= 0:
                    return

                seconds_per_trial = batch_elapsed_seconds / batch_trials_consumed
                if processed_trials <= warmup_trials:
                    warmup_trial_costs.append(seconds_per_trial)
                    return

                bayes_trial_costs.append(seconds_per_trial)
                if bayes_baseline_cost is None and len(bayes_trial_costs) >= adaptive_window_batches:
                    bayes_baseline_cost = sum(bayes_trial_costs) / len(bayes_trial_costs)

                if not adaptive_fallback_enabled:
                    return
                if processed_trials < warmup_trials + adaptive_min_trials_after_warmup:
                    return
                if len(bayes_trial_costs) < adaptive_window_batches:
                    return

                baseline_cost = (
                    (sum(warmup_trial_costs) / len(warmup_trial_costs))
                    if warmup_trial_costs
                    else bayes_baseline_cost
                )
                if baseline_cost is None or baseline_cost <= 0:
                    return

                recent_cost = sum(bayes_trial_costs) / len(bayes_trial_costs)
                slowdown = recent_cost / baseline_cost
                if slowdown < adaptive_slowdown_factor:
                    return

                use_random_fallback = True
                adaptive_fallback_triggered_at = processed_trials
                _update_job_meta(
                    job_id,
                    message=(
                        "Running bayesian optimization "
                        f"(space={generated_combinations}, trials={sampled_combinations}, workers={worker_count}, "
                        f"ask_batch={bayesian_ask_batch_size}, eval_batch={evaluation_batch_size}, "
                        f"random_batch={random_fallback_batch_size}; "
                        f"adaptive->random at {processed_trials}/{trial_budget}, "
                        f"slowdown={slowdown:.2f}x)"
                    ),
                )

            with CombinationEvaluator(
                candles=train_candles,
                funding_rates=train_funding_rates,
                interval_value=interval_value,
                target=target,
                custom_score_expr=custom_score_expr,
                max_workers=worker_count,
            ) as train_evaluator:
                _update_job_meta(
                    job_id,
                    message=(
                        "Running bayesian optimization "
                        f"(space={generated_combinations}, trials={sampled_combinations}, workers={worker_count}, "
                        f"engine={train_evaluator.engine}, ask_batch={bayesian_ask_batch_size}, "
                        f"eval_batch={evaluation_batch_size})"
                    ),
                )
                while processed_trials < trial_budget:
                    _raise_if_cancelled(job_id)
                    batch_started_at = time.perf_counter()
                    processed_before_batch = processed_trials
                    remaining_trials = trial_budget - processed_trials
                    ask_count = min(
                        random_fallback_batch_size if use_random_fallback else bayesian_ask_batch_size,
                        remaining_trials,
                    )
                    ask_phase_started = time.perf_counter()

                    batch_trials: List[Tuple[Any, dict]] = []
                    batch_tasks: List[dict] = []

                    for _ in range(ask_count):
                        trial: Optional[Any] = None
                        if use_random_fallback:
                            params: Optional[Tuple[float, int, float, float, bool]] = None
                            for _attempt in range(32):
                                candidate = _random_param_tuple()
                                if candidate in random_seen_tuples:
                                    continue
                                random_seen_tuples.add(candidate)
                                params = candidate
                                break

                            if params is None:
                                trials_pruned += 1
                                processed_trials += 1
                                advance(processed_trials, trial_budget, 0)
                                continue

                            leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position = params
                        else:
                            trial = study.ask()
                            leverage = _suggest_from_sweep(
                                trial,
                                name="leverage",
                                sweep=optimization.leverage,
                                fallback=payload.base_strategy.leverage,
                                integer_mode=False,
                            )
                            grids = int(
                                round(
                                    _suggest_from_sweep(
                                        trial,
                                        name="grids",
                                        sweep=optimization.grids,
                                        fallback=float(payload.base_strategy.grids),
                                        integer_mode=True,
                                    )
                                )
                            )
                            band_pct_raw = _suggest_from_sweep(
                                trial,
                                name="band_width_pct",
                                sweep=optimization.band_width_pct,
                                fallback=fallback_band_pct,
                                integer_mode=False,
                            )
                            stop_ratio_raw = _suggest_from_sweep(
                                trial,
                                name="stop_loss_ratio_pct",
                                sweep=optimization.stop_loss_ratio_pct,
                                fallback=fallback_stop_ratio_pct,
                                integer_mode=False,
                            )
                            if optimization.optimize_base_position:
                                use_base_position = bool(trial.suggest_categorical("use_base_position", [False, True]))
                            else:
                                use_base_position = base_use_position
                            random_seen_tuples.add(
                                (
                                    float(leverage),
                                    int(grids),
                                    float(band_pct_raw),
                                    float(stop_ratio_raw),
                                    bool(use_base_position),
                                )
                            )

                        row_id = next_row_id
                        next_row_id += 1
                        combo = _build_single_combo(
                            row_id=row_id,
                            base_strategy=payload.base_strategy,
                            reference_price=reference_price,
                            initial_price=initial_price,
                            max_loss_initial_price=max_loss_initial_price,
                            leverage=float(leverage),
                            grids=int(grids),
                            band_pct_raw=float(band_pct_raw),
                            stop_ratio_raw=float(stop_ratio_raw),
                            use_base_position=use_base_position,
                            node_cache=node_cache,
                            max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
                        )

                        if combo is None:
                            if trial is not None:
                                study.tell(trial, state=TrialState.PRUNED)
                            trials_pruned += 1
                            processed_trials += 1
                            advance(processed_trials, trial_budget, 0)
                            continue

                        batch_trials.append((trial, combo))
                        batch_tasks.append({"row_id": int(combo["row_id"]), "strategy": combo["strategy"]})
                        if (
                            not use_random_fallback
                            and len(batch_tasks) >= worker_count
                            and (time.perf_counter() - ask_phase_started) >= ask_time_budget_seconds
                        ):
                            break

                    if not batch_trials:
                        _maybe_activate_adaptive_fallback(
                            batch_elapsed_seconds=time.perf_counter() - batch_started_at,
                            batch_trials_consumed=processed_trials - processed_before_batch,
                        )
                        continue

                    batch_progress_offset = processed_trials
                    batch_evals = train_evaluator.run(
                        batch_tasks,
                        batch_size=min(evaluation_batch_size, len(batch_tasks)),
                        chunk_size=optimization.chunk_size,
                        progress_hook=lambda done, total, offset=batch_progress_offset: advance(
                            offset + done, trial_budget, 0
                        ),
                    )
                    eval_by_row_id = {int(item["row_id"]): item for item in batch_evals}

                    for trial, combo in batch_trials:
                        _raise_if_cancelled(job_id)
                        row_id = int(combo["row_id"])
                        eval_payload = eval_by_row_id.get(row_id)
                        processed_trials += 1

                        if eval_payload is None or not eval_payload.get("ok"):
                            if trial is not None:
                                study.tell(trial, state=TrialState.PRUNED)
                            trials_pruned += 1
                            continue

                        score = _safe_score(eval_payload.get("score"))
                        if not math.isfinite(score):
                            if trial is not None:
                                study.tell(trial, state=TrialState.PRUNED)
                            trials_pruned += 1
                            continue

                        if trial is not None:
                            study.tell(trial, score)
                        trials_completed += 1
                        successful_trials.append(BayesianTrialOutcome(score=score, combo=combo, eval_payload=eval_payload))

                        convergence_curve_data.append(
                            OptimizationProgressPoint(step=processed_trials, value=score)
                        )
                        if score > running_best:
                            running_best = score
                        best_score_progression.append(
                            OptimizationProgressPoint(step=processed_trials, value=running_best)
                        )

                    _maybe_activate_adaptive_fallback(
                        batch_elapsed_seconds=time.perf_counter() - batch_started_at,
                        batch_trials_consumed=processed_trials - processed_before_batch,
                    )
                    tested_total = max(trials_completed + trials_pruned, 1)
                    _update_job_meta(
                        job_id,
                        trials_completed=trials_completed,
                        trials_pruned=trials_pruned,
                        pruning_ratio=(trials_pruned / tested_total),
                    )

                _raise_if_cancelled(job_id)

                if not successful_trials:
                    if optimization.max_allowed_loss_usdt is not None:
                        raise ValueError(
                            "最大亏损数额约束过严，当前参数空间没有可执行组合。"
                            "请降低杠杆/保证金，或提高“最大亏损数额”后重试。"
                        )
                    raise ValueError("trial-based optimization produced no valid completed trials")

                if (
                    optimization.max_allowed_loss_usdt is not None
                    and trials_completed <= max(5, int(trial_budget * 0.2))
                ):
                    max_loss_hint = (
                        "最大亏损数额约束较紧，"
                        f"有效试验仅 {trials_completed}/{trial_budget}。"
                        "建议调整杠杆/保证金或提高亏损上限。"
                    )

                combo_by_id = {int(item.combo["row_id"]): item.combo for item in successful_trials if item.combo}
                for item in successful_trials:
                    if item.combo is None or item.eval_payload is None:
                        continue
                    row = _build_row_from_eval(item.combo, item.eval_payload)
                    row_lookup[row.row_id] = row

                if optimization.enable_topk_refine and successful_trials:
                    ranked_trials = sorted(successful_trials, key=lambda item: _safe_score(item.score), reverse=True)
                    top_trials = ranked_trials[: min(optimization.topk_refine_k, len(ranked_trials))]
                    existing_signatures = {_combo_signature(item.combo) for item in successful_trials if item.combo}
                    next_row = (max(combo_by_id.keys()) + 1) if combo_by_id else 1
                    refine_combos = _generate_refine_combos(
                        top_trials=top_trials,
                        base_strategy=payload.base_strategy,
                        optimization=optimization,
                        reference_price=reference_price,
                        initial_price=initial_price,
                        max_loss_initial_price=max_loss_initial_price,
                        row_id_start=next_row,
                        existing_signatures=existing_signatures,
                        parameter_space=parameter_space,
                    )
                    if refine_combos:
                        refine_start = completed_steps
                        set_total_steps(total_steps + len(refine_combos))

                        refine_combo_by_id = {int(combo["row_id"]): combo for combo in refine_combos}
                        refine_tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in refine_combos]
                        refine_evals = train_evaluator.run(
                            refine_tasks,
                            batch_size=optimization.batch_size,
                            chunk_size=optimization.chunk_size,
                            progress_hook=lambda done, total: advance(done, total, refine_start),
                        )
                        _raise_if_cancelled(job_id)

                        running_best = best_score_progression[-1].value if best_score_progression else float("-inf")
                        progression_base = len(convergence_curve_data)
                        for idx, eval_row in enumerate(refine_evals, start=1):
                            combo = refine_combo_by_id.get(int(eval_row["row_id"]))
                            if combo is None:
                                continue
                            combo_by_id[int(combo["row_id"])] = combo
                            row = _build_row_from_eval(combo, eval_row)
                            row_lookup[row.row_id] = row

                            score = _safe_score(eval_row.get("score"))
                            convergence_curve_data.append(
                                OptimizationProgressPoint(step=progression_base + idx, value=score)
                            )
                            if score > running_best:
                                running_best = score
                            best_score_progression.append(
                                OptimizationProgressPoint(step=progression_base + idx, value=running_best)
                            )

                        trials_completed += len(refine_evals)
                        sampled_combinations = trial_budget + len(refine_combos)
        else:
            raise ValueError(f"unsupported optimization mode: {optimization.optimization_mode}")

        if not row_lookup:
            raise ValueError("optimization produced no valid evaluated rows")

        if validation_candles:
            _raise_if_cancelled(job_id)
            validation_tasks = [
                {"row_id": combo["row_id"], "strategy": combo["strategy"]}
                for _, combo in sorted(combo_by_id.items(), key=lambda item: item[0])
            ]
            validation_offset = completed_steps
            set_total_steps(completed_steps + len(validation_tasks))
            _update_job_meta(
                job_id,
                message=(
                    f"Running validation phase ({len(validation_tasks)} combos, progress {completed_steps}/{total_steps})"
                ),
            )

            validation_evals = run_combinations_parallel(
                candles=validation_candles,
                tasks=validation_tasks,
                funding_rates=validation_funding_rates,
                interval_value=payload.data.interval.value,
                target=optimization.target,
                custom_score_expr=optimization.custom_score_expr,
                max_workers=optimization.max_workers,
                batch_size=optimization.batch_size,
                chunk_size=optimization.chunk_size,
                progress_hook=lambda done, total: advance(done, total, validation_offset),
            )
            _raise_if_cancelled(job_id)

            for eval_row in validation_evals:
                row_id = int(eval_row["row_id"])
                row = row_lookup.get(row_id)
                if row is None:
                    continue
                summary = eval_row["summary"] if eval_row.get("ok") else None
                if summary:
                    row.validation_total_return_usdt = float(summary["total_return_usdt"])
                    row.validation_max_drawdown_pct = float(summary["max_drawdown_pct"])
                    row.validation_sharpe_ratio = float(eval_row["sharpe_ratio"])
                    row.validation_win_rate = float(summary["win_rate"])
                    row.validation_return_drawdown_ratio = float(eval_row["return_drawdown_ratio"])
                    row.validation_score = float(eval_row["score"])
                    row.validation_total_closed_trades = int(summary["total_closed_trades"])

        rows = list(row_lookup.values())
        _raise_if_cancelled(job_id)
        for row in rows:
            robust_score, overfit_penalty = _compute_robust_score(
                train_score=row.score,
                validation_score=row.validation_score,
                validation_weight=optimization.robust_validation_weight,
                gap_penalty=optimization.robust_gap_penalty,
            )
            row.robust_score = robust_score
            row.overfit_penalty = overfit_penalty
            _apply_constraints(row, optimization)

        passed_rows = [row for row in rows if row.passes_constraints]
        passed_ranked_rows = sorted(passed_rows, key=lambda row: _primary_score(row), reverse=True)
        all_ranked_rows = sorted(rows, key=lambda row: (row.passes_constraints, _primary_score(row)), reverse=True)
        # Keep strict pass-only output when available; fallback to all rows for diagnostics when none pass.
        ranked_rows = passed_ranked_rows if passed_ranked_rows else all_ranked_rows
        best_row = passed_ranked_rows[0] if passed_ranked_rows else None
        best_validation_row = None
        if passed_ranked_rows and any(row.validation_score is not None for row in passed_ranked_rows):
            best_validation_row = max(
                passed_ranked_rows,
                key=lambda row: row.validation_score if row.validation_score is not None else float("-inf"),
            )

        best_equity_curve: List[CurvePoint] = []
        if best_row:
            _raise_if_cancelled(job_id)
            best_strategy = payload.base_strategy.model_copy(
                update={
                    "leverage": best_row.leverage,
                    "grids": best_row.grids,
                    "lower": best_row.lower_price,
                    "upper": best_row.upper_price,
                    "stop_loss": best_row.stop_price,
                    "use_base_position": best_row.use_base_position,
                }
            )
            full_result: BacktestResult = run_backtest(candles=candles, strategy=best_strategy, funding_rates=funding_rates)
            best_equity_curve = full_result.equity_curve

        tested_total = max(trials_completed + trials_pruned, 1)
        pruning_ratio = trials_pruned / tested_total

        _raise_if_cancelled(job_id)
        with _JOB_LOCK:
            record = _JOBS[job_id]
            record.rows = ranked_rows
            _invalidate_row_caches(record)
            record.best_row = best_row
            record.best_validation_row = best_validation_row
            record.best_equity_curve = best_equity_curve
            record.best_score_progression = best_score_progression
            record.convergence_curve_data = convergence_curve_data
            record.train_window = _window_info(train_candles)
            record.validation_window = _window_info(validation_candles) if validation_candles else None
            record.meta.status = OptimizationJobStatus.COMPLETED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.completed_steps = total_steps
            record.meta.progress = 100.0
            record.meta.total_combinations = sampled_combinations
            record.meta.total_steps = total_steps
            record.meta.trials_completed = trials_completed
            record.meta.trials_pruned = trials_pruned
            record.meta.pruning_ratio = pruning_ratio
            mode_label = (
                "trials"
                if optimization.optimization_mode in (OptimizationMode.BAYESIAN, OptimizationMode.RANDOM_PRUNED)
                else "combinations"
            )
            passed_count = len(passed_ranked_rows)
            shown_count = len(ranked_rows)
            if sampled_combinations < generated_combinations:
                base_message = (
                    f"Optimization completed (tested {sampled_combinations}/{generated_combinations} {mode_label}, passed={passed_count})"
                )
            else:
                base_message = f"Optimization completed (passed={passed_count})"
            if adaptive_fallback_triggered_at is not None:
                base_message = f"{base_message}; adaptive->random at trial {adaptive_fallback_triggered_at}"

            if passed_count == 0 and shown_count > 0:
                record.meta.message = f"{base_message}; no rows passed constraints, showing diagnostic rows"
            else:
                record.meta.message = base_message
            if max_loss_hint:
                record.meta.message = f"{record.meta.message}; {max_loss_hint}"
            _persist_record_snapshot(record, include_rows=True)
    except JobCancelledError as exc:
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.CANCELLED,
            finished_at=datetime.now(timezone.utc),
            error=None,
            message=str(exc),
        )
        with _JOB_LOCK:
            record = _JOBS.get(job_id)
            if record is not None:
                _persist_record_snapshot(record, include_rows=True)
    except BayesianDependencyError as exc:
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            error=str(exc),
            message="Optimization failed",
        )
        with _JOB_LOCK:
            record = _JOBS.get(job_id)
            if record is not None:
                _persist_record_snapshot(record, include_rows=True)
    except Exception as exc:
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            error=str(exc),
            message="Optimization failed",
        )
        with _JOB_LOCK:
            record = _JOBS.get(job_id)
            if record is not None:
                _persist_record_snapshot(record, include_rows=True)
    finally:
        status_label = "unknown"
        with _JOB_LOCK:
            record = _JOBS.get(job_id)
            if record is not None:
                status_label = record.meta.status.value
            _JOB_THREADS.pop(job_id, None)
            _refresh_queue_depth_locked()
        observe_job_duration(
            job_type="optimization",
            status=status_label,
            duration_seconds=max(0.0, time.perf_counter() - started_monotonic),
        )


def run_optimization_job_from_arq(job_id: str, payload_data: dict[str, Any]) -> None:
    try:
        payload = OptimizationRequest.model_validate(payload_data)
    except Exception:
        snapshot = load_job_snapshot(job_id)
        if snapshot is None:
            return
        try:
            meta = OptimizationJobMeta.model_validate(snapshot["meta"])
            target = OptimizationTarget(snapshot["target"])
        except Exception:
            return
        with _JOB_LOCK:
            record = _JOBS.get(job_id)
            if record is None:
                request_payload = snapshot.get("request_payload")
                record = _JobRecord(
                    meta=meta,
                    target=target,
                    request_payload=request_payload if isinstance(request_payload, dict) else None,
                    cancel_requested=bool(snapshot.get("cancel_requested", False)),
                )
                _JOBS[job_id] = record
            record.meta.status = OptimizationJobStatus.FAILED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.message = "Optimization failed"
            record.meta.error = "invalid optimization payload"
            _persist_record_snapshot(record, include_rows=False, force=True)
            _refresh_queue_depth_locked()
        return

    payload_json = payload.model_dump(mode="json")
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                return
            record = loaded
            _JOBS[job_id] = record

        if record.meta.status in _FINISHED_JOB_STATUSES:
            return

        record.target = payload.optimization.target
        record.request_payload = payload_json
        record.cancel_requested = bool(record.cancel_requested or is_job_cancel_requested(job_id))
        _persist_record_snapshot(record, include_rows=False, force=True)
        _refresh_queue_depth_locked()

    _run_job(job_id, payload)


def recover_interrupted_optimization_jobs() -> dict[str, int]:
    if use_arq_for_optimization():
        return {"scanned": 0, "restarted": 0, "skipped": 0, "failed": 0}
    if not _RECOVERY_ENABLED or _RECOVERY_MAX_JOBS <= 0:
        return {"scanned": 0, "restarted": 0, "skipped": 0, "failed": 0}

    snapshots = list_recoverable_job_snapshots(limit=_RECOVERY_SCAN_LIMIT)
    to_start: list[tuple[str, OptimizationRequest]] = []
    skipped = 0
    failed = 0

    for item in snapshots:
        job_id = str(item.get("job_id") or "").strip()
        if not job_id:
            skipped += 1
            continue

        payload_data = item.get("request_payload")
        if not isinstance(payload_data, dict):
            failed += 1
            _mark_job_recovery_failed(job_id, "optimization request snapshot unavailable for recovery")
            continue

        try:
            payload = OptimizationRequest.model_validate(payload_data)
        except Exception:
            failed += 1
            _mark_job_recovery_failed(job_id, "invalid optimization request payload in snapshot")
            continue

        with _JOB_LOCK:
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

            if record.meta.status in _FINISHED_JOB_STATUSES:
                skipped += 1
                continue

            if len(to_start) >= _RECOVERY_MAX_JOBS:
                skipped += 1
                continue

            record.cancel_requested = False
            record.meta.status = OptimizationJobStatus.PENDING
            record.meta.started_at = None
            record.meta.finished_at = None
            record.meta.completed_steps = 0
            record.meta.progress = 0.0
            record.meta.error = None
            record.meta.message = "Recovered after process restart; restarting optimization"
            _JOBS[job_id] = record
            _persist_record_snapshot(record, include_rows=False, force=True)
            to_start.append((job_id, payload))

    restarted = 0
    for job_id, payload in to_start:
        thread = threading.Thread(target=_run_job, args=(job_id, payload), daemon=True)
        thread.start()
        with _JOB_LOCK:
            _JOB_THREADS[job_id] = thread
            _refresh_queue_depth_locked()
        restarted += 1

    return {"scanned": len(snapshots), "restarted": restarted, "skipped": skipped, "failed": failed}


def start_optimization_job(payload: OptimizationRequest) -> OptimizationStartResponse:
    job_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc)
    payload_json = payload.model_dump(mode="json")

    meta = OptimizationJobMeta(
        job_id=job_id,
        status=OptimizationJobStatus.PENDING,
        created_at=created_at,
        total_combinations=0,
    )

    with _JOB_LOCK:
        _cleanup_jobs_locked(created_at)
        record = _JobRecord(
            meta=meta,
            target=payload.optimization.target,
            request_payload=payload_json,
        )
        _JOBS[job_id] = record
        _persist_record_snapshot(record, include_rows=False)
        _refresh_queue_depth_locked()

    if use_arq_for_optimization():
        try:
            enqueue_optimization_job(job_id=job_id, payload=payload_json)
        except Exception:
            with _JOB_LOCK:
                record = _JOBS.get(job_id)
                if record is not None:
                    record.meta.status = OptimizationJobStatus.FAILED
                    record.meta.finished_at = datetime.now(timezone.utc)
                    record.meta.error = "failed to enqueue optimization job"
                    record.meta.message = "Optimization failed"
                    _persist_record_snapshot(record, include_rows=False, force=True)
                    _refresh_queue_depth_locked()
            raise
        return OptimizationStartResponse(job_id=job_id, status=OptimizationJobStatus.PENDING, total_combinations=0)

    thread = threading.Thread(target=_run_job, args=(job_id, payload), daemon=True)
    thread.start()
    with _JOB_LOCK:
        _JOB_THREADS[job_id] = thread
        _refresh_queue_depth_locked()

    return OptimizationStartResponse(job_id=job_id, status=OptimizationJobStatus.PENDING, total_combinations=0)


def restart_optimization_job(job_id: str) -> OptimizationStartResponse:
    payload_data: Optional[Dict[str, Any]] = None
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        payload_data = record.request_payload if isinstance(record.request_payload, dict) else None

    if payload_data is None:
        raise ValueError(f"optimization request snapshot unavailable for job: {job_id}")

    payload = OptimizationRequest.model_validate(payload_data)
    return start_optimization_job(payload)


def cancel_optimization_job(job_id: str) -> OptimizationJobMeta:
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded

        if record.meta.status in _FINISHED_JOB_STATUSES:
            return record.meta.model_copy(deep=True)

        record.cancel_requested = True
        try:
            set_job_cancel_requested(job_id, True)
        except Exception:
            pass
        record.meta.message = "Cancellation requested"
        if record.meta.status == OptimizationJobStatus.PENDING:
            record.meta.status = OptimizationJobStatus.CANCELLED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.progress = 0.0
            record.meta.error = None
        _persist_record_snapshot(record, include_rows=record.meta.status in _FINISHED_JOB_STATUSES)
        _refresh_queue_depth_locked()

        return record.meta.model_copy(deep=True)


def get_optimization_status(
    job_id: str,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: SortOrder,
) -> OptimizationStatusResponse:
    sort_field = sort_by if sort_by in OptimizationResultRow.model_fields else "robust_score"
    reverse = sort_order == SortOrder.DESC
    cache_order = sort_order.value if isinstance(sort_order, SortOrder) else str(sort_order)

    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        record = _refresh_record_from_snapshot_for_remote_worker_locked(job_id, record)
        if (
            record.meta.status in _FINISHED_JOB_STATUSES
            and len(record.rows) == 0
        ):
            retry_loaded = _load_record_from_snapshot(job_id)
            if retry_loaded is not None and len(retry_loaded.rows) > 0:
                record.rows = retry_loaded.rows
                record.best_row = retry_loaded.best_row
                record.best_validation_row = retry_loaded.best_validation_row
                record.best_equity_curve = retry_loaded.best_equity_curve
                record.best_score_progression = retry_loaded.best_score_progression
                record.convergence_curve_data = retry_loaded.convergence_curve_data
                _invalidate_row_caches(record)
        _ensure_running_job_alive_locked(job_id, record)
        status_payload = _build_status_payload_locked(
            record=record,
            page=page,
            page_size=page_size,
            sort_field=sort_field,
            sort_order=sort_order,
            reverse=reverse,
            cache_order=cache_order,
        )

    return OptimizationStatusResponse(**status_payload)


def _build_status_payload_locked(
    *,
    record: _JobRecord,
    page: int,
    page_size: int,
    sort_field: str,
    sort_order: SortOrder,
    reverse: bool,
    cache_order: str,
) -> Dict[str, Any]:
    meta = record.meta.model_copy(deep=True)
    best_row = record.best_row
    best_validation_row = record.best_validation_row
    # Completed payload series are immutable after final write; reuse references
    # to avoid large list-copy overhead on frequent status polling.
    best_equity_curve = record.best_equity_curve
    best_score_progression = record.best_score_progression
    convergence_curve_data = record.convergence_curve_data
    train_window = record.train_window
    validation_window = record.validation_window
    target = record.target
    cache_key = (sort_field, cache_order, record.row_version)
    if record.cached_sort_key != cache_key:
        sorted_rows = sorted(record.rows, key=lambda row: _score_sort_key(row, sort_field), reverse=reverse)
        record.cached_sort_key = cache_key
        record.cached_sorted_rows = sorted_rows
    else:
        sorted_rows = record.cached_sorted_rows

    if record.cached_heatmap_version != record.row_version:
        record.cached_heatmap = _build_heatmap(record.rows)
        record.cached_heatmap_version = record.row_version

    total_results = len(sorted_rows)
    paged = _paginate_rows(sorted_rows, page=page, page_size=page_size)
    heatmap = record.cached_heatmap

    return {
        "job": meta,
        "target": target,
        "sort_by": sort_field,
        "sort_order": sort_order,
        "page": page,
        "page_size": page_size,
        "total_results": total_results,
        "rows": paged,
        "best_row": best_row,
        "best_validation_row": best_validation_row,
        "best_equity_curve": best_equity_curve,
        "best_score_progression": best_score_progression,
        "convergence_curve_data": convergence_curve_data,
        "heatmap": heatmap,
        "train_window": train_window,
        "validation_window": validation_window,
    }


def get_optimization_rows(
    job_id: str,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: SortOrder,
) -> OptimizationRowsResponse:
    sort_field = sort_by if sort_by in OptimizationResultRow.model_fields else "robust_score"
    reverse = sort_order == SortOrder.DESC
    cache_order = sort_order.value if isinstance(sort_order, SortOrder) else str(sort_order)

    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        record = _refresh_record_from_snapshot_for_remote_worker_locked(job_id, record)
        _ensure_running_job_alive_locked(job_id, record)
        cache_key = (sort_field, cache_order, record.row_version)
        if record.cached_sort_key != cache_key:
            sorted_rows = sorted(record.rows, key=lambda row: _score_sort_key(row, sort_field), reverse=reverse)
            record.cached_sort_key = cache_key
            record.cached_sorted_rows = sorted_rows
        else:
            sorted_rows = record.cached_sorted_rows

        total_results = len(sorted_rows)
        paged = _paginate_rows(sorted_rows, page=page, page_size=page_size)
        meta = record.meta.model_copy(deep=True)
        target = record.target
        best_row = record.best_row
        best_validation_row = record.best_validation_row

    return OptimizationRowsResponse(
        job=meta,
        target=target,
        sort_by=sort_field,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
        total_results=total_results,
        rows=paged,
        best_row=best_row,
        best_validation_row=best_validation_row,
    )


def get_optimization_heatmap(job_id: str) -> OptimizationHeatmapResponse:
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        record = _refresh_record_from_snapshot_for_remote_worker_locked(job_id, record)
        _ensure_running_job_alive_locked(job_id, record)
        if record.cached_heatmap_version != record.row_version:
            record.cached_heatmap = _build_heatmap(record.rows)
            record.cached_heatmap_version = record.row_version
        meta = record.meta.model_copy(deep=True)
        target = record.target
        heatmap = record.cached_heatmap
        best_row = record.best_row

    return OptimizationHeatmapResponse(
        job=meta,
        target=target,
        heatmap=heatmap,
        best_row=best_row,
    )


def _get_record_or_raise(job_id: str) -> _JobRecord:
    record = _JOBS.get(job_id)
    if record is None:
        loaded = _load_record_from_snapshot(job_id)
        if loaded is None:
            raise KeyError(f"optimization job not found: {job_id}")
        _JOBS[job_id] = loaded
        record = loaded
    return record


def _sorted_rows_for_export(record: _JobRecord, sort_by: str, sort_order: SortOrder) -> List[OptimizationResultRow]:
    sort_field = sort_by if sort_by in OptimizationResultRow.model_fields else "robust_score"
    reverse = sort_order == SortOrder.DESC
    rows = list(record.rows)
    rows.sort(key=lambda row: _score_sort_key(row, sort_field), reverse=reverse)
    return rows


def _csv_lines(rows: List[OptimizationResultRow], *, record: Optional[_JobRecord] = None):
    yield from iter_rows_csv_stream(rows=rows, record=record)


def stream_optimization_csv(job_id: str, sort_by: str, sort_order: SortOrder):
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _get_record_or_raise(job_id)
        if record.meta.status != OptimizationJobStatus.COMPLETED:
            raise ValueError("optimization job is not completed")
        rows = _sorted_rows_for_export(record, sort_by, sort_order)
        export_record = record
    return _csv_lines(rows, record=export_record)


def export_optimization_csv(job_id: str, sort_by: str, sort_order: SortOrder) -> str:
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _get_record_or_raise(job_id)
        if record.meta.status != OptimizationJobStatus.COMPLETED:
            raise ValueError("optimization job is not completed")
        rows = _sorted_rows_for_export(record, sort_by, sort_order)
        export_record = record

    return _export_rows_csv(rows, record=export_record)


def get_optimization_progress(job_id: str) -> OptimizationProgressResponse:
    with _JOB_LOCK:
        _cleanup_jobs_locked()
        record = _JOBS.get(job_id)
        if record is None:
            loaded = _load_record_from_snapshot(job_id)
            if loaded is None:
                raise KeyError(f"optimization job not found: {job_id}")
            _JOBS[job_id] = loaded
            record = loaded
        record = _refresh_record_from_snapshot_for_remote_worker_locked(job_id, record)
        _ensure_running_job_alive_locked(job_id, record)
        return OptimizationProgressResponse(
            job=record.meta.model_copy(deep=True),
            target=record.target,
        )


def record_optimization_operation_event(
    *,
    operation_id: str,
    action: str,
    status: str,
    requested: int,
    success: int,
    failed: int,
    skipped: int,
    job_ids: list[str],
    failed_items: list[dict[str, Any]],
    undo_until: Optional[str] = None,
    summary_text: Optional[str] = None,
    request_id: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    save_operation_event(
        operation_id=operation_id,
        action=action,
        status=status,
        requested=requested,
        success=success,
        failed=failed,
        skipped=skipped,
        job_ids=job_ids,
        failed_items=failed_items,
        undo_until=undo_until,
        summary_text=summary_text,
        request_id=request_id,
        meta=meta,
    )


def get_optimization_operation_event(operation_id: str) -> Optional[dict[str, Any]]:
    return get_operation_event(operation_id)


def list_optimization_operation_events(
    *,
    limit: int = 30,
    cursor: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    return list_operation_events_cursor(
        limit=limit,
        cursor=cursor,
        action=action,
        status=status,
    )


def list_optimization_history(
    limit: int = 30,
    cursor: Optional[str] = None,
    status: Optional[OptimizationJobStatus] = None,
) -> tuple[List[OptimizationProgressResponse], Optional[str]]:
    history_rows, next_cursor = list_recent_job_snapshots_cursor(
        limit=limit,
        cursor=cursor,
        status=status.value if status is not None else None,
    )
    result: List[OptimizationProgressResponse] = []
    for item in history_rows:
        try:
            job_id = item.get("job_id")
            meta = OptimizationJobMeta.model_validate(item["meta"])
            with _JOB_LOCK:
                if job_id and job_id in _JOBS:
                    record = _JOBS[job_id]
                    _ensure_running_job_alive_locked(job_id, record)
                    meta = record.meta.model_copy(deep=True)
            result.append(
                OptimizationProgressResponse(
                    job=meta,
                    target=OptimizationTarget(item["target"]),
                )
            )
        except Exception:
            continue
    return result, next_cursor


def clear_optimization_history() -> dict[str, Any]:
    deleted, deleted_ids, skipped_ids = soft_delete_all_terminal_job_snapshots_with_details()
    deleted_set = set(deleted_ids)
    with _JOB_LOCK:
        removable_job_ids = [
            job_id
            for job_id, record in _JOBS.items()
            if record.meta.status in _FINISHED_JOB_STATUSES and job_id in deleted_set
        ]
        for job_id in removable_job_ids:
            _JOBS.pop(job_id, None)
            _JOB_THREADS.pop(job_id, None)
            drop_persist_tracking_view(
                job_id,
                last_persist_at=_LAST_PERSIST_AT,
                last_persist_progress=_LAST_PERSIST_PROGRESS,
                last_persist_completed_steps=_LAST_PERSIST_COMPLETED_STEPS,
                )
        _refresh_queue_depth_locked()
    return {
        "requested": int(deleted + len(skipped_ids)),
        "deleted": int(deleted),
        "failed": int(len(skipped_ids)),
        "deleted_job_ids": list(deleted_ids),
        "failed_job_ids": list(skipped_ids),
        "failed_items": [
            {
                "job_id": job_id,
                "reason_code": "JOB_NOT_FINISHED",
                "reason_message": "任务仍在运行中，仅允许清理已完成/失败/已取消任务",
            }
            for job_id in skipped_ids
        ],
        "skipped": int(len(skipped_ids)),
        "skipped_job_ids": list(skipped_ids),
        "soft_delete_ttl_hours": optimization_soft_delete_ttl_hours(),
    }


def clear_selected_optimization_history(job_ids: List[str]) -> dict[str, Any]:
    selected_ids = list(
        dict.fromkeys(
            [job_id.strip() for job_id in job_ids if isinstance(job_id, str) and job_id.strip()]
        )
    )
    if not selected_ids:
        return {
            "requested": 0,
            "deleted": 0,
            "failed": 0,
            "deleted_job_ids": [],
            "failed_job_ids": [],
            "failed_items": [],
        }

    _, deleted_snapshot_ids, skipped_snapshot_ids = soft_delete_terminal_job_snapshots_with_details(selected_ids)
    deleted_set: set[str] = set(deleted_snapshot_ids)
    skipped_set: set[str] = set(skipped_snapshot_ids)

    with _JOB_LOCK:
        for job_id in deleted_snapshot_ids:
            record = _JOBS.get(job_id)
            if record is None or record.meta.status not in _FINISHED_JOB_STATUSES:
                continue
            _JOBS.pop(job_id, None)
            _JOB_THREADS.pop(job_id, None)
            drop_persist_tracking_view(
                job_id,
                last_persist_at=_LAST_PERSIST_AT,
                last_persist_progress=_LAST_PERSIST_PROGRESS,
                last_persist_completed_steps=_LAST_PERSIST_COMPLETED_STEPS,
            )
        _refresh_queue_depth_locked()

    deleted_job_ids = [job_id for job_id in selected_ids if job_id in deleted_set]
    failed_job_ids = [job_id for job_id in selected_ids if job_id not in deleted_set]
    failed_items = []
    for job_id in failed_job_ids:
        if job_id in skipped_set:
            reason_code, reason_message = (
                "JOB_NOT_FINISHED",
                "任务仍在运行中，仅允许清理已完成/失败/已取消任务",
            )
        else:
            reason_code, reason_message = (
                "NOT_FOUND_OR_ALREADY_DELETED",
                "任务不存在或已被清空",
            )
        failed_items.append(
            {
                "job_id": job_id,
                "reason_code": reason_code,
                "reason_message": reason_message,
            }
        )
    return {
        "requested": len(selected_ids),
        "deleted": len(deleted_job_ids),
        "failed": len(failed_job_ids),
        "deleted_job_ids": deleted_job_ids,
        "failed_job_ids": failed_job_ids,
        "failed_items": failed_items,
        "skipped": len(skipped_set),
        "skipped_job_ids": [job_id for job_id in selected_ids if job_id in skipped_set],
        "soft_delete_ttl_hours": optimization_soft_delete_ttl_hours(),
    }


def restore_selected_optimization_history(job_ids: List[str]) -> dict[str, Any]:
    selected_ids = list(
        dict.fromkeys(
            [job_id.strip() for job_id in job_ids if isinstance(job_id, str) and job_id.strip()]
        )
    )
    if not selected_ids:
        return {
            "requested": 0,
            "restored": 0,
            "failed": 0,
            "restored_job_ids": [],
            "failed_job_ids": [],
            "failed_items": [],
        }

    _, restored_ids = restore_job_snapshots_with_details(selected_ids)
    restored_set = set(restored_ids)
    failed_job_ids = [job_id for job_id in selected_ids if job_id not in restored_set]
    failed_items = [
        {
            "job_id": job_id,
            "reason_code": "NOT_FOUND_OR_NOT_DELETED",
            "reason_message": "任务不存在、已恢复或超出可撤销窗口",
        }
        for job_id in failed_job_ids
    ]
    return {
        "requested": len(selected_ids),
        "restored": len(restored_ids),
        "failed": len(failed_job_ids),
        "restored_job_ids": restored_ids,
        "failed_job_ids": failed_job_ids,
        "failed_items": failed_items,
    }
