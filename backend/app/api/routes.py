from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from app.core.schemas import BacktestRequest, BacktestResult, default_request
from app.core.optimization_schemas import (
    OptimizationRequest,
    OptimizationStartResponse,
    OptimizationStatusResponse,
    SortOrder,
)
from app.optimizer.optimizer import export_optimization_csv, get_optimization_status, start_optimization_job
from app.services.backtest_engine import run_backtest
from app.services.data_loader import DataLoadError, load_candles

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
        return run_backtest(candles=candles, strategy=payload.strategy)
    except ValueError as exc:
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


@router.get("/optimization/{job_id}/export", response_class=PlainTextResponse)
def optimization_export_api(
    job_id: str,
    sort_by: str = Query("robust_score"),
    sort_order: SortOrder = Query(SortOrder.DESC),
) -> PlainTextResponse:
    try:
        csv_content = export_optimization_csv(job_id=job_id, sort_by=sort_by, sort_order=sort_order)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return PlainTextResponse(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=optimization-{job_id}.csv"},
    )
