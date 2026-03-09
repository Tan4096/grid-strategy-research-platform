from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal, Optional, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from app.api.job_stream import JobStreamType, job_stream_generator, resolve_stream_reader
from app.api.optimization_history_policy import selected_clear_limit
from app.core.audit import audit_action
from app.core.api_errors import ApiError
from app.core.idempotency import (
    get_or_create_idempotent_value,
    invalidate_idempotent_value,
    normalize_idempotency_key,
)
from app.core.metrics import render_prometheus
from app.core.readiness import build_ready_report
from app.core.schemas import (
    BacktestAnchorPriceResponse,
    BacktestJobStatus,
    BacktestRequest,
    BacktestResult,
    BacktestStartResponse,
    BacktestStatusResponse,
    DataConfig,
    DataSource,
    LiveRobotListRequest,
    LiveRobotListResponse,
    LiveSnapshotRequest,
    LiveSnapshotResponse,
    MarketParamsResponse,
    default_request,
)
from app.core.security import AuthPrincipal, Role, public_mode_enabled, require_min_role
from app.core.optimization_schemas import (
    AnchorMode,
    OptimizationHeatmapResponse,
    OptimizationHistoryPageResponse,
    OptimizationJobStatus,
    OptimizationProgressResponse,
    OptimizationRequest,
    OptimizationRowsResponse,
    OptimizationStartResponse,
    OptimizationStatusResponse,
    SortOrder,
)
from app.optimizer.optimizer import (
    cancel_optimization_job,
    clear_optimization_history,
    clear_selected_optimization_history,
    get_optimization_operation_event,
    get_optimization_heatmap,
    get_optimization_rows,
    get_optimization_progress,
    get_optimization_status,
    list_optimization_history,
    list_optimization_operation_events,
    record_optimization_operation_event,
    restart_optimization_job,
    restore_selected_optimization_history,
    stream_optimization_csv,
    start_optimization_job,
)
from app.services.backtest_engine import run_backtest
from app.services.backtest_jobs import (
    cancel_backtest_job,
    get_backtest_job_status,
    start_backtest_job,
    validate_backtest_request,
)
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates
from app.services.market_params import fetch_market_params
from app.services.live_snapshot import LiveSnapshotError, fetch_live_snapshot, fetch_okx_robot_list
from app.services.strategy_analysis import analyze_strategy, build_strategy_analysis_input
from app.services.strategy_scoring import build_strategy_scoring_input, score_strategy
from app.tasks.arq_queue import ArqEnqueueError

router = APIRouter(prefix="/api/v1")

ViewerPrincipal = Annotated[AuthPrincipal, Depends(require_min_role(Role.VIEWER))]
OperatorPrincipal = Annotated[AuthPrincipal, Depends(require_min_role(Role.OPERATOR))]
AdminPrincipal = Annotated[AuthPrincipal, Depends(require_min_role(Role.ADMIN))]

CONFIRM_CLEAR_ALL = "CLEAR_ALL_OPTIMIZATION_HISTORY"
CONFIRM_CLEAR_SELECTED = "CLEAR_SELECTED_OPTIMIZATION_HISTORY"


def _build_operation_summary(*, requested: int, success: int, failed: int, skipped: int = 0, verb: str = "处理") -> str:
    if skipped > 0:
        return f"{verb}完成：请求 {requested} 条，成功 {success} 条，失败 {failed} 条，跳过 {skipped} 条。"
    return f"{verb}完成：请求 {requested} 条，成功 {success} 条，失败 {failed} 条。"


def _operation_status(*, success: int, failed: int, skipped: int = 0) -> str:
    if failed <= 0 and skipped <= 0:
        return "success"
    if success <= 0:
        return "failed"
    return "partial_failed"


def _request_id(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def health_ready() -> Any:
    ready_ok, checks, message = build_ready_report()
    payload = {
        "status": "ok" if ready_ok else "degraded",
        "checks": checks,
        "message": message,
    }
    if ready_ok:
        return payload
    return JSONResponse(status_code=503, content=payload)


@router.get("/metrics", response_class=PlainTextResponse)
def metrics_api(_principal: AdminPrincipal) -> PlainTextResponse:
    return PlainTextResponse(content=render_prometheus(), media_type="text/plain; version=0.0.4; charset=utf-8")


@router.get("/backtest/defaults", response_model=BacktestRequest)
def get_defaults(_principal: ViewerPrincipal) -> BacktestRequest:
    return default_request()


@router.post("/backtest/run", response_model=BacktestResult)
def run_backtest_api(payload: BacktestRequest, _principal: OperatorPrincipal) -> BacktestResult:
    try:
        candles = validate_backtest_request(payload)
        funding_rates = load_funding_rates(payload.data)
        result = run_backtest(candles=candles, strategy=payload.strategy, funding_rates=funding_rates)
        analysis_input = build_strategy_analysis_input(summary=result.summary, strategy=payload.strategy)
        analysis = analyze_strategy(analysis_input)
        scoring_input = build_strategy_scoring_input(
            summary=result.summary,
            strategy=payload.strategy,
            equity_curve=result.equity_curve,
            interval_value=payload.data.interval.value,
        )
        scoring = score_strategy(scoring_input)
        return result.model_copy(update={"analysis": analysis, "scoring": scoring})
    except DataLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/backtest/start", response_model=BacktestStartResponse)
def start_backtest_api(
    payload: BacktestRequest,
    principal: OperatorPrincipal,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> BacktestStartResponse:
    try:
        normalized_idempotency_key = normalize_idempotency_key(idempotency_key)
        if not normalized_idempotency_key:
            return start_backtest_job(payload)

        scoped_key = f"{principal.subject}:{normalized_idempotency_key}"

        def _create_job_id() -> str:
            return start_backtest_job(payload).job_id

        job_id, reused = get_or_create_idempotent_value(
            namespace="backtest_start",
            scoped_key=scoped_key,
            create=_create_job_id,
        )
        if reused:
            try:
                status = get_backtest_job_status(job_id).job.status
            except KeyError:
                invalidate_idempotent_value(namespace="backtest_start", scoped_key=scoped_key)
                return start_backtest_api(payload=payload, principal=principal, idempotency_key=idempotency_key)
            return BacktestStartResponse(job_id=job_id, status=status, idempotency_reused=True)
        return BacktestStartResponse(job_id=job_id, status=BacktestJobStatus.PENDING, idempotency_reused=False)
    except DataLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ArqEnqueueError as exc:
        raise ApiError(
            status_code=503,
            code="TASK_ENQUEUE_FAILED",
            message="回测任务入队失败，请稍后重试",
            meta={
                "queue": exc.queue,
                "backend": exc.backend,
                "retryable": exc.retryable,
            },
        ) from exc


@router.post("/backtest/anchor-price", response_model=BacktestAnchorPriceResponse)
def backtest_anchor_price_api(
    payload: DataConfig,
    _principal: OperatorPrincipal,
    anchor_mode: AnchorMode = Query(AnchorMode.BACKTEST_START_PRICE),
    custom_anchor_price: Optional[float] = Query(None, gt=0),
) -> BacktestAnchorPriceResponse:
    try:
        candles = load_candles(payload)
    except DataLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not candles:
        raise HTTPException(status_code=400, detail="insufficient candle data for anchor price")

    first = candles[0]
    last = candles[-1]
    if anchor_mode == AnchorMode.BACKTEST_START_PRICE:
        anchor_raw = float(first.close)
        anchor_time = first.timestamp
        anchor_source = "first_candle_close"
    elif anchor_mode == AnchorMode.BACKTEST_AVG_PRICE:
        anchor_raw = float(sum(candle.close for candle in candles) / len(candles))
        anchor_time = first.timestamp
        anchor_source = "avg_candle_close"
    elif anchor_mode == AnchorMode.CURRENT_PRICE:
        anchor_raw = float(last.close)
        anchor_time = last.timestamp
        anchor_source = "last_candle_close"
    else:
        if custom_anchor_price is None:
            raise HTTPException(status_code=400, detail="custom_anchor_price is required when anchor_mode=CUSTOM_PRICE")
        anchor_raw = float(custom_anchor_price)
        anchor_time = first.timestamp
        anchor_source = "custom_price"

    return BacktestAnchorPriceResponse(
        anchor_price=float(f"{anchor_raw:.2f}"),
        anchor_time=anchor_time,
        anchor_source=cast(Literal["first_candle_close", "avg_candle_close", "last_candle_close", "custom_price"], anchor_source),
        candle_count=len(candles),
    )


@router.get("/backtest/{job_id}", response_model=BacktestStatusResponse)
def backtest_status_api(job_id: str, _principal: ViewerPrincipal) -> BacktestStatusResponse:
    try:
        return get_backtest_job_status(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/stream", response_class=StreamingResponse)
async def job_stream_api(
    request: Request,
    job_id: str,
    _principal: ViewerPrincipal,
    job_type: JobStreamType = Query(JobStreamType.AUTO),
) -> StreamingResponse:
    try:
        reader = resolve_stream_reader(job_id, job_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StreamingResponse(
        job_stream_generator(request, job_id, reader),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/backtest/{job_id}/cancel")
def backtest_cancel_api(job_id: str, _principal: OperatorPrincipal) -> dict[str, str]:
    try:
        meta = cancel_backtest_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"job_id": meta.job_id, "status": meta.status.value}


@router.get("/market/params", response_model=MarketParamsResponse)
def market_params_api(
    _principal: ViewerPrincipal,
    source: DataSource = Query(DataSource.BINANCE),
    symbol: str = Query("BTCUSDT"),
) -> MarketParamsResponse:
    try:
        return fetch_market_params(source=source, symbol=symbol)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/live/robots", response_model=LiveRobotListResponse)
def live_robot_list_api(
    request: Request,
    payload: LiveRobotListRequest,
    principal: OperatorPrincipal,
) -> LiveRobotListResponse:
    try:
        result = fetch_okx_robot_list(payload)
        audit_action(
            request,
            principal=principal,
            action="live_robot_list_fetch",
            outcome="success",
            details={
                "exchange": payload.exchange.value,
                "scope": payload.scope,
                "count": len(result.items),
            },
        )
        return result
    except LiveSnapshotError as exc:
        audit_action(
            request,
            principal=principal,
            action="live_robot_list_fetch",
            outcome="failed",
            details={"exchange": payload.exchange.value, "scope": payload.scope, "code": exc.code},
        )
        raise ApiError(
            status_code=exc.status_code,
            code=exc.code,
            message=str(exc),
            meta={"retryable": exc.retryable, "exchange": payload.exchange.value},
        ) from exc
    except ValueError as exc:
        audit_action(
            request,
            principal=principal,
            action="live_robot_list_fetch",
            outcome="failed",
            details={"exchange": payload.exchange.value, "scope": payload.scope, "code": "LIVE_ROBOT_LIST_INVALID"},
        )
        raise ApiError(
            status_code=400,
            code="LIVE_ROBOT_LIST_INVALID",
            message=str(exc),
            meta={"retryable": False, "exchange": payload.exchange.value},
        ) from exc


@router.post("/live/snapshot", response_model=LiveSnapshotResponse)
def live_snapshot_api(
    request: Request,
    payload: LiveSnapshotRequest,
    principal: OperatorPrincipal,
) -> LiveSnapshotResponse:
    try:
        result = fetch_live_snapshot(payload)
        audit_action(
            request,
            principal=principal,
            action="live_snapshot_fetch",
            outcome="success",
            details={
                "exchange": payload.exchange.value,
                "symbol": payload.symbol,
                "algo_id": payload.algo_id,
                "robot_state": result.robot.state,
                "open_order_count": result.summary.open_order_count,
                "fill_count": result.summary.fill_count,
                "fills_capped": result.monitoring.fills_capped,
                "freshness_sec": result.monitoring.freshness_sec,
            },
        )
        return result
    except LiveSnapshotError as exc:
        audit_action(
            request,
            principal=principal,
            action="live_snapshot_fetch",
            outcome="failed",
            details={
                "exchange": payload.exchange.value,
                "symbol": payload.symbol,
                "algo_id": payload.algo_id,
                "code": exc.code,
            },
        )
        raise ApiError(
            status_code=exc.status_code,
            code=exc.code,
            message=str(exc),
            meta={"retryable": exc.retryable, "exchange": payload.exchange.value, "symbol": payload.symbol},
        ) from exc
    except ValueError as exc:
        audit_action(
            request,
            principal=principal,
            action="live_snapshot_fetch",
            outcome="failed",
            details={
                "exchange": payload.exchange.value,
                "symbol": payload.symbol,
                "algo_id": payload.algo_id,
                "code": "LIVE_SNAPSHOT_INVALID",
            },
        )
        raise ApiError(
            status_code=400,
            code="LIVE_SNAPSHOT_INVALID",
            message=str(exc),
            meta={"retryable": False, "exchange": payload.exchange.value, "symbol": payload.symbol},
        ) from exc


@router.post("/optimization/start", response_model=OptimizationStartResponse)
def start_optimization_api(
    payload: OptimizationRequest,
    principal: OperatorPrincipal,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> OptimizationStartResponse:
    try:
        normalized_idempotency_key = normalize_idempotency_key(idempotency_key)
        if not normalized_idempotency_key:
            return start_optimization_job(payload)

        scoped_key = f"{principal.subject}:{normalized_idempotency_key}"

        def _create_job_id() -> str:
            return start_optimization_job(payload).job_id

        job_id, reused = get_or_create_idempotent_value(
            namespace="optimization_start",
            scoped_key=scoped_key,
            create=_create_job_id,
        )
        if reused:
            try:
                status = get_optimization_progress(job_id).job
                return OptimizationStartResponse(
                    job_id=job_id,
                    status=status.status,
                    total_combinations=status.total_combinations,
                    idempotency_reused=True,
                )
            except KeyError:
                return OptimizationStartResponse(
                    job_id=job_id,
                    status=OptimizationJobStatus.PENDING,
                    total_combinations=0,
                    idempotency_reused=True,
                )

        return OptimizationStartResponse(
            job_id=job_id,
            status=OptimizationJobStatus.PENDING,
            total_combinations=0,
            idempotency_reused=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ArqEnqueueError as exc:
        raise ApiError(
            status_code=503,
            code="TASK_ENQUEUE_FAILED",
            message="优化任务入队失败，请稍后重试",
            meta={
                "queue": exc.queue,
                "backend": exc.backend,
                "retryable": exc.retryable,
            },
        ) from exc


@router.get("/optimization/{job_id}", response_model=OptimizationStatusResponse)
def optimization_status_api(
    job_id: str,
    _principal: ViewerPrincipal,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    sort_by: str = Query("robust_score"),
    sort_order: SortOrder = Query(SortOrder.DESC),
) -> OptimizationStatusResponse:
    try:
        return get_optimization_status(
            job_id=job_id,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/rows", response_model=OptimizationRowsResponse)
def optimization_rows_api(
    job_id: str,
    _principal: ViewerPrincipal,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    sort_by: str = Query("robust_score"),
    sort_order: SortOrder = Query(SortOrder.DESC),
) -> OptimizationRowsResponse:
    try:
        return get_optimization_rows(
            job_id=job_id,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/heatmap", response_model=OptimizationHeatmapResponse)
def optimization_heatmap_api(job_id: str, _principal: ViewerPrincipal) -> OptimizationHeatmapResponse:
    try:
        return get_optimization_heatmap(job_id=job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/progress", response_model=OptimizationProgressResponse)
def optimization_progress_api(job_id: str, _principal: ViewerPrincipal) -> OptimizationProgressResponse:
    try:
        return get_optimization_progress(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/optimization-history", response_model=OptimizationHistoryPageResponse)
def optimization_history_api(
    _principal: ViewerPrincipal,
    limit: int = Query(30, ge=1, le=200),
    cursor: Optional[str] = Query(None),
    status: Optional[OptimizationJobStatus] = Query(None),
) -> OptimizationHistoryPageResponse:
    items, next_cursor = list_optimization_history(limit=limit, cursor=cursor, status=status)
    return OptimizationHistoryPageResponse(items=items, next_cursor=next_cursor)


@router.delete("/optimization-history")
def optimization_history_clear_api(
    request: Request,
    principal: AdminPrincipal,
    confirm_action: Optional[str] = Header(default=None, alias="X-Confirm-Action"),
) -> dict[str, Any]:
    if public_mode_enabled():
        audit_action(
            request,
            principal=principal,
            action="optimization_history_clear_all",
            outcome="denied",
            details={"reason": "public_mode_blocked"},
        )
        raise HTTPException(
            status_code=403,
            detail="匿名公网模式下禁用全量清空，请改用按选中清空。",
        )
    if confirm_action != CONFIRM_CLEAR_ALL:
        audit_action(
            request,
            principal=principal,
            action="optimization_history_clear_all",
            outcome="denied",
            details={"reason": "missing_confirmation", "expected": CONFIRM_CLEAR_ALL},
        )
        raise HTTPException(
            status_code=400,
            detail=f"需要二次确认头: X-Confirm-Action={CONFIRM_CLEAR_ALL}",
        )
    clear_payload = clear_optimization_history()
    requested = int(clear_payload.get("requested", 0))
    deleted = int(clear_payload.get("deleted", 0))
    failed = int(clear_payload.get("failed", 0))
    skipped = int(clear_payload.get("skipped", 0))
    ttl_hours = int(clear_payload.get("soft_delete_ttl_hours", 48))
    operation_id = uuid4().hex
    undo_until = (datetime.now(timezone.utc) + timedelta(hours=max(1, ttl_hours))).isoformat()
    summary_text = _build_operation_summary(
        requested=requested,
        success=deleted,
        failed=failed,
        skipped=skipped,
        verb="全量清空",
    )
    request_id = _request_id(request)
    operation_meta = {"retryable": bool(failed > 0 or skipped > 0)}
    record_optimization_operation_event(
        operation_id=operation_id,
        action="clear_all",
        status=_operation_status(success=deleted, failed=failed, skipped=skipped),
        requested=requested,
        success=deleted,
        failed=failed,
        skipped=skipped,
        job_ids=list(clear_payload.get("deleted_job_ids") or []),
        failed_items=list(clear_payload.get("failed_items") or []),
        undo_until=undo_until,
        summary_text=summary_text,
        request_id=request_id,
        meta=operation_meta,
    )
    audit_action(
        request,
        principal=principal,
        action="optimization_history_clear_all",
        outcome="success",
        details={
            "operation_id": operation_id,
            "requested": requested,
            "deleted": deleted,
            "failed": failed,
            "skipped": skipped,
            "failed_job_ids_preview": (clear_payload.get("failed_job_ids") or [])[:10],
            "job_id_preview": (clear_payload.get("deleted_job_ids") or [])[:10],
        },
    )
    return {
        "requested": requested,
        "deleted": deleted,
        "failed": failed,
        "deleted_job_ids": list(clear_payload.get("deleted_job_ids") or []),
        "failed_job_ids": list(clear_payload.get("failed_job_ids") or []),
        "failed_items": list(clear_payload.get("failed_items") or []),
        "skipped": skipped,
        "skipped_job_ids": list(clear_payload.get("skipped_job_ids") or []),
        "soft_delete_ttl_hours": ttl_hours,
        "operation_id": operation_id,
        "undo_until": undo_until,
        "summary_text": summary_text,
        "request_id": request_id,
        "meta": operation_meta,
    }


@router.delete("/optimization-history/selected")
def optimization_history_selected_clear_api(
    request: Request,
    principal: OperatorPrincipal,
    job_id: list[str] = Query(..., min_length=1),
    confirm_action: Optional[str] = Header(default=None, alias="X-Confirm-Action"),
    confirm_count: Optional[int] = Header(default=None, alias="X-Confirm-Count"),
) -> dict[str, Any]:
    if confirm_action != CONFIRM_CLEAR_SELECTED:
        audit_action(
            request,
            principal=principal,
            action="optimization_history_clear_selected",
            outcome="denied",
            details={"reason": "missing_confirmation", "expected": CONFIRM_CLEAR_SELECTED},
        )
        raise HTTPException(
            status_code=400,
            detail=f"需要二次确认头: X-Confirm-Action={CONFIRM_CLEAR_SELECTED}",
        )
    requested_count = len(job_id)
    if confirm_count is None or confirm_count != requested_count:
        audit_action(
            request,
            principal=principal,
            action="optimization_history_clear_selected",
            outcome="denied",
            details={
                "reason": "confirm_count_mismatch",
                "confirm_count": confirm_count,
                "requested_count": requested_count,
            },
        )
        raise HTTPException(
            status_code=400,
            detail=f"需要确认数量头: X-Confirm-Count={requested_count}",
        )

    is_public = public_mode_enabled()
    clear_limit = selected_clear_limit(is_public)
    if requested_count > clear_limit:
        reason_code = 403 if is_public else 400
        raise HTTPException(
            status_code=reason_code,
            detail=f"一次最多允许清空 {clear_limit} 条历史任务",
        )
    clear_payload = clear_selected_optimization_history(job_id)
    requested = int(clear_payload.get("requested", len(job_id)))
    deleted = int(clear_payload.get("deleted", 0))
    failed = int(clear_payload.get("failed", 0))
    skipped = int(clear_payload.get("skipped", 0))
    ttl_hours = int(clear_payload.get("soft_delete_ttl_hours", 48))
    operation_id = uuid4().hex
    undo_until = (datetime.now(timezone.utc) + timedelta(hours=max(1, ttl_hours))).isoformat()
    summary_text = _build_operation_summary(
        requested=requested,
        success=deleted,
        failed=failed,
        skipped=skipped,
        verb="清空",
    )
    request_id = _request_id(request)
    operation_meta = {"retryable": bool(failed > 0 or skipped > 0)}
    record_optimization_operation_event(
        operation_id=operation_id,
        action="clear_selected",
        status=_operation_status(success=deleted, failed=failed, skipped=skipped),
        requested=requested,
        success=deleted,
        failed=failed,
        skipped=skipped,
        job_ids=list(clear_payload.get("deleted_job_ids") or []),
        failed_items=list(clear_payload.get("failed_items") or []),
        undo_until=undo_until,
        summary_text=summary_text,
        request_id=request_id,
        meta=operation_meta,
    )
    audit_action(
        request,
        principal=principal,
        action="optimization_history_clear_selected",
        outcome="success",
        details={
            "operation_id": operation_id,
            "requested": requested,
            "deleted": deleted,
            "failed": failed,
            "skipped": skipped,
            "failed_job_ids_preview": (clear_payload.get("failed_job_ids") or [])[:10],
            "failed_items_preview": (clear_payload.get("failed_items") or [])[:5],
            "job_id_preview": job_id[:10],
        },
    )
    return {
        "requested": requested,
        "deleted": deleted,
        "failed": failed,
        "deleted_job_ids": list(clear_payload.get("deleted_job_ids") or []),
        "failed_job_ids": list(clear_payload.get("failed_job_ids") or []),
        "failed_items": list(clear_payload.get("failed_items") or []),
        "skipped": skipped,
        "skipped_job_ids": list(clear_payload.get("skipped_job_ids") or []),
        "soft_delete_ttl_hours": ttl_hours,
        "operation_id": operation_id,
        "undo_until": undo_until,
        "summary_text": summary_text,
        "request_id": request_id,
        "meta": operation_meta,
    }


@router.post("/optimization-history/restore-selected")
def optimization_history_selected_restore_api(
    request: Request,
    principal: OperatorPrincipal,
    job_id: list[str] = Query(..., min_length=1),
) -> dict[str, Any]:
    if len(job_id) > 500:
        raise HTTPException(status_code=400, detail="一次最多允许恢复 500 条历史任务")
    restore_payload = restore_selected_optimization_history(job_id)
    requested = int(restore_payload.get("requested", len(job_id)))
    restored = int(restore_payload.get("restored", 0))
    failed = int(restore_payload.get("failed", 0))
    operation_id = uuid4().hex
    summary_text = _build_operation_summary(
        requested=requested,
        success=restored,
        failed=failed,
        skipped=0,
        verb="恢复",
    )
    request_id = _request_id(request)
    operation_meta = {"retryable": bool(failed > 0)}
    record_optimization_operation_event(
        operation_id=operation_id,
        action="restore_selected",
        status=_operation_status(success=restored, failed=failed, skipped=0),
        requested=requested,
        success=restored,
        failed=failed,
        skipped=0,
        job_ids=list(restore_payload.get("restored_job_ids") or []),
        failed_items=list(restore_payload.get("failed_items") or []),
        undo_until=None,
        summary_text=summary_text,
        request_id=request_id,
        meta=operation_meta,
    )
    audit_action(
        request,
        principal=principal,
        action="optimization_history_restore_selected",
        outcome="success",
        details={
            "operation_id": operation_id,
            "requested": requested,
            "restored": restored,
            "failed": failed,
            "restored_job_ids_preview": (restore_payload.get("restored_job_ids") or [])[:10],
            "failed_items_preview": (restore_payload.get("failed_items") or [])[:5],
            "job_id_preview": job_id[:10],
        },
    )
    return {
        "requested": requested,
        "restored": restored,
        "failed": failed,
        "restored_job_ids": list(restore_payload.get("restored_job_ids") or []),
        "failed_job_ids": list(restore_payload.get("failed_job_ids") or []),
        "failed_items": list(restore_payload.get("failed_items") or []),
        "operation_id": operation_id,
        "summary_text": summary_text,
        "request_id": request_id,
        "meta": operation_meta,
    }


@router.get("/operations/{operation_id}")
def optimization_operation_detail_api(
    operation_id: str,
    _principal: ViewerPrincipal,
) -> dict[str, Any]:
    operation = get_optimization_operation_event(operation_id)
    if operation is None:
        raise ApiError(
            status_code=404,
            code="OPERATION_NOT_FOUND",
            message="操作记录不存在",
            meta={"retryable": False},
        )
    return operation


@router.get("/operations")
def optimization_operations_api(
    _principal: ViewerPrincipal,
    limit: int = Query(30, ge=1, le=200),
    cursor: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
) -> dict[str, Any]:
    items, next_cursor = list_optimization_operation_events(
        limit=limit,
        cursor=cursor,
        action=action,
        status=status,
    )
    return {
        "items": items,
        "next_cursor": next_cursor,
    }


@router.post("/optimization/{job_id}/cancel")
def optimization_cancel_api(job_id: str, _principal: OperatorPrincipal) -> dict[str, str]:
    try:
        meta = cancel_optimization_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"job_id": meta.job_id, "status": meta.status.value}


@router.post("/optimization/{job_id}/restart", response_model=OptimizationStartResponse)
def optimization_restart_api(job_id: str, _principal: OperatorPrincipal) -> OptimizationStartResponse:
    try:
        return restart_optimization_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/export", response_class=StreamingResponse)
def optimization_export_api(
    job_id: str,
    _principal: ViewerPrincipal,
    sort_by: str = Query("robust_score"),
    sort_order: SortOrder = Query(SortOrder.DESC),
) -> StreamingResponse:
    try:
        stream = stream_optimization_csv(job_id=job_id, sort_by=sort_by, sort_order=sort_order)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return StreamingResponse(
        content=stream,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=optimization-{job_id}.csv"},
    )
