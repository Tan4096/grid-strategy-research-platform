from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient
import pytest

from app.core.optimization_schemas import (
    OptimizationJobMeta,
    OptimizationJobStatus,
    OptimizationResultRow,
    OptimizationTarget,
)
from app.main import app
from app.optimizer import optimizer


@pytest.fixture(autouse=True)
def isolate_jobs_state():
    with optimizer._JOB_LOCK:
        jobs_backup = dict(optimizer._JOBS)
        persist_backup = dict(optimizer._LAST_PERSIST_AT)
        optimizer._JOBS.clear()
        optimizer._LAST_PERSIST_AT.clear()
    try:
        yield
    finally:
        with optimizer._JOB_LOCK:
            optimizer._JOBS.clear()
            optimizer._JOBS.update(jobs_backup)
            optimizer._LAST_PERSIST_AT.clear()
            optimizer._LAST_PERSIST_AT.update(persist_backup)


def _sample_row(
    *,
    row_id: int,
    leverage: float,
    grids: int,
    robust_score: float,
    total_return: float,
) -> OptimizationResultRow:
    return OptimizationResultRow(
        row_id=row_id,
        leverage=leverage,
        grids=grids,
        use_base_position=False,
        base_grid_count=0,
        initial_position_size=0.0,
        anchor_price=70000.0,
        lower_price=65000.0,
        upper_price=71000.0,
        stop_price=71200.0,
        band_width_pct=5.0,
        range_lower=65000.0,
        range_upper=71000.0,
        stop_loss=71200.0,
        stop_loss_ratio_pct=1.0,
        total_return_usdt=total_return,
        max_drawdown_pct=8.0,
        sharpe_ratio=1.2,
        win_rate=0.6,
        return_drawdown_ratio=4.0,
        score=4.0,
        validation_total_return_usdt=total_return * 0.7,
        validation_max_drawdown_pct=7.0,
        validation_sharpe_ratio=1.0,
        validation_win_rate=0.55,
        validation_return_drawdown_ratio=3.5,
        validation_score=3.5,
        validation_total_closed_trades=6,
        robust_score=robust_score,
        overfit_penalty=0.2,
        passes_constraints=True,
        constraint_violations=[],
        total_closed_trades=8,
    )


def _seed_completed_job(job_id: str = "job-api-test") -> None:
    now = datetime.now(timezone.utc)
    rows = [
        _sample_row(row_id=1, leverage=8.0, grids=6, robust_score=2.1, total_return=120.0),
        _sample_row(row_id=2, leverage=12.0, grids=8, robust_score=3.4, total_return=180.0),
    ]

    record = optimizer._JobRecord(
        meta=OptimizationJobMeta(
            job_id=job_id,
            status=OptimizationJobStatus.COMPLETED,
            created_at=now,
            started_at=now,
            finished_at=now,
            progress=100.0,
            total_steps=2,
            completed_steps=2,
            message="completed",
            error=None,
            total_combinations=2,
            trials_completed=2,
            trials_pruned=0,
            pruning_ratio=0.0,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
        request_payload={
            "base_strategy": {"side": "short"},
            "optimization": {"optimization_mode": "grid"},
            "data": {"source": "binance", "symbol": "BTCUSDT"},
        },
        rows=rows,
        best_row=rows[1],
        row_version=len(rows),
    )

    with optimizer._JOB_LOCK:
        optimizer._JOBS[job_id] = record


def test_optimization_rows_endpoint_returns_paginated_sorted_rows() -> None:
    job_id = "job-rows"
    _seed_completed_job(job_id)
    client = TestClient(app)

    response = client.get(
        f"/api/v1/optimization/{job_id}/rows",
        params={"page": 1, "page_size": 1, "sort_by": "robust_score", "sort_order": "desc"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["job"]["status"] == "completed"
    assert payload["total_results"] == 2
    assert len(payload["rows"]) == 1
    assert payload["rows"][0]["row_id"] == 2
    assert payload["best_row"]["row_id"] == 2


def test_optimization_heatmap_endpoint_returns_cells() -> None:
    job_id = "job-heatmap"
    _seed_completed_job(job_id)
    client = TestClient(app)

    response = client.get(f"/api/v1/optimization/{job_id}/heatmap")
    assert response.status_code == 200
    payload = response.json()
    assert payload["job"]["status"] == "completed"
    assert len(payload["heatmap"]) == 2
    assert payload["best_row"]["row_id"] == 2
    first_cell = payload["heatmap"][0]
    assert "lower_price" in first_cell and "upper_price" in first_cell and "stop_price" in first_cell


def test_optimization_export_endpoint_streams_csv() -> None:
    job_id = "job-export"
    _seed_completed_job(job_id)
    client = TestClient(app)

    response = client.get(
        f"/api/v1/optimization/{job_id}/export",
        params={"sort_by": "robust_score", "sort_order": "desc"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert f"job_meta,job_id,{job_id}" in response.text
    assert "row_id,leverage,grids,use_base_position" in response.text


def test_optimization_rows_endpoint_returns_404_for_unknown_job() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/optimization/missing-job/rows")
    assert response.status_code == 404
