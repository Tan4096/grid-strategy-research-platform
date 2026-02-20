from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.schemas import (
    BacktestRequest,
    BacktestResult,
    BacktestStartResponse,
    BacktestStatusResponse,
    DataSource,
    MarketParamsResponse,
    default_request,
)
from app.core.optimization_schemas import (
    OptimizationHeatmapResponse,
    OptimizationProgressResponse,
    OptimizationRequest,
    OptimizationRowsResponse,
    OptimizationStartResponse,
    OptimizationStatusResponse,
    SortOrder,
)
from app.optimizer.optimizer import (
    cancel_optimization_job,
    get_optimization_heatmap,
    get_optimization_rows,
    get_optimization_progress,
    get_optimization_status,
    list_optimization_history,
    restart_optimization_job,
    stream_optimization_csv,
    start_optimization_job,
)
from app.services.backtest_engine import run_backtest
from app.services.backtest_jobs import cancel_backtest_job, get_backtest_job_status, start_backtest_job
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates
from app.services.market_params import fetch_market_params
from app.services.strategy_analysis import analyze_strategy, build_strategy_analysis_input
from app.services.strategy_scoring import build_strategy_scoring_input, score_strategy

router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/backtest/defaults", response_model=BacktestRequest)
def get_defaults() -> BacktestRequest:
    return default_request()


@router.post("/backtest/run", response_model=BacktestResult)
def run_backtest_api(payload: BacktestRequest) -> BacktestResult:
    try:
        candles = load_candles(payload.data)
    except DataLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if len(candles) < 2:
        raise HTTPException(status_code=400, detail="insufficient candle data for backtest")

    try:
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/backtest/start", response_model=BacktestStartResponse)
def start_backtest_api(payload: BacktestRequest) -> BacktestStartResponse:
    try:
        return start_backtest_job(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/backtest/{job_id}", response_model=BacktestStatusResponse)
def backtest_status_api(job_id: str) -> BacktestStatusResponse:
    try:
        return get_backtest_job_status(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/backtest/{job_id}/cancel")
def backtest_cancel_api(job_id: str) -> dict[str, str]:
    try:
        meta = cancel_backtest_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"job_id": meta.job_id, "status": meta.status.value}


@router.get("/market/params", response_model=MarketParamsResponse)
def market_params_api(
    source: DataSource = Query(DataSource.BINANCE),
    symbol: str = Query("BTCUSDT"),
) -> MarketParamsResponse:
    try:
        return fetch_market_params(source=source, symbol=symbol)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/optimization/start", response_model=OptimizationStartResponse)
def start_optimization_api(payload: OptimizationRequest) -> OptimizationStartResponse:
    try:
        return start_optimization_job(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/optimization/{job_id}", response_model=OptimizationStatusResponse)
def optimization_status_api(
    job_id: str,
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
def optimization_heatmap_api(job_id: str) -> OptimizationHeatmapResponse:
    try:
        return get_optimization_heatmap(job_id=job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/progress", response_model=OptimizationProgressResponse)
def optimization_progress_api(job_id: str) -> OptimizationProgressResponse:
    try:
        return get_optimization_progress(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/optimization-history", response_model=list[OptimizationProgressResponse])
def optimization_history_api(limit: int = Query(30, ge=1, le=200)) -> list[OptimizationProgressResponse]:
    return list_optimization_history(limit=limit)


@router.post("/optimization/{job_id}/cancel")
def optimization_cancel_api(job_id: str) -> dict[str, str]:
    try:
        meta = cancel_optimization_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"job_id": meta.job_id, "status": meta.status.value}


@router.post("/optimization/{job_id}/restart", response_model=OptimizationStartResponse)
def optimization_restart_api(job_id: str) -> OptimizationStartResponse:
    try:
        return restart_optimization_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/optimization/{job_id}/export", response_class=StreamingResponse)
def optimization_export_api(
    job_id: str,
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
