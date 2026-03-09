from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient
import pytest

from app.core.optimization_schemas import (
    OptimizationJobMeta,
    OptimizationJobStatus,
    OptimizationProgressResponse,
    OptimizationResultRow,
    OptimizationStartResponse,
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


def test_optimization_history_endpoint_returns_cursor_page(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    now = datetime.now(timezone.utc)
    sample_item = OptimizationProgressResponse(
        job=OptimizationJobMeta(
            job_id="job-history-page",
            status=OptimizationJobStatus.COMPLETED,
            created_at=now,
            started_at=now,
            finished_at=now,
            progress=100.0,
            total_steps=1,
            completed_steps=1,
            message="done",
            error=None,
            total_combinations=1,
            trials_completed=1,
            trials_pruned=0,
            pruning_ratio=0.0,
        ),
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
    )
    monkeypatch.setattr(
        "app.api.routes.list_optimization_history",
        lambda limit, cursor, status: ([sample_item], "next-cursor-token"),
    )

    response = client.get(
        "/api/v1/optimization-history",
        params={"limit": 10, "cursor": "prev-cursor-token", "status": "completed"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["next_cursor"] == "next-cursor-token"
    assert len(payload["items"]) == 1
    assert payload["items"][0]["job"]["job_id"] == "job-history-page"


def test_optimization_history_clear_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    monkeypatch.setenv("APP_PUBLIC_MODE", "0")
    monkeypatch.setattr(
        "app.api.routes.clear_optimization_history",
        lambda: {
            "requested": 5,
            "deleted": 4,
            "failed": 1,
            "deleted_job_ids": ["a", "b", "c", "d"],
            "failed_job_ids": ["e"],
            "failed_items": [
                {
                    "job_id": "e",
                    "reason_code": "JOB_NOT_FINISHED",
                    "reason_message": "running",
                }
            ],
            "skipped": 1,
            "skipped_job_ids": ["e"],
            "soft_delete_ttl_hours": 48,
        },
    )

    response = client.delete(
        "/api/v1/optimization-history",
        headers={"X-Confirm-Action": "CLEAR_ALL_OPTIMIZATION_HISTORY"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requested"] == 5
    assert payload["deleted"] == 4
    assert payload["failed"] == 1
    assert payload["deleted_job_ids"] == ["a", "b", "c", "d"]
    assert payload["failed_job_ids"] == ["e"]
    assert payload["failed_items"] == [
        {
            "job_id": "e",
            "reason_code": "JOB_NOT_FINISHED",
            "reason_message": "running",
        }
    ]
    assert payload["skipped"] == 1
    assert payload["skipped_job_ids"] == ["e"]
    assert payload["soft_delete_ttl_hours"] == 48
    assert isinstance(payload.get("operation_id"), str) and payload["operation_id"]
    assert isinstance(payload.get("undo_until"), str) and payload["undo_until"]
    assert isinstance(payload.get("summary_text"), str) and payload["summary_text"]
    assert isinstance(payload.get("request_id"), str) and payload["request_id"]
    assert payload.get("meta") == {"retryable": True}


def test_optimization_history_clear_selected_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    monkeypatch.setenv("APP_PUBLIC_MODE", "0")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": 1,
            "failed": max(0, len(ids) - 1),
            "deleted_job_ids": ids[:1],
            "failed_job_ids": ids[1:],
            "failed_items": [
                {
                    "job_id": item,
                    "reason_code": "MOCK_FAILED",
                    "reason_message": "mock failure",
                }
                for item in ids[1:]
            ],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )

    response = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "a"), ("job_id", "b")],
        headers={
            "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
            "X-Confirm-Count": "2",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requested"] == 2
    assert payload["deleted"] == 1
    assert payload["failed"] == 1
    assert payload["deleted_job_ids"] == ["a"]
    assert payload["failed_job_ids"] == ["b"]
    assert payload["failed_items"] == [
        {
            "job_id": "b",
            "reason_code": "MOCK_FAILED",
            "reason_message": "mock failure",
        }
    ]
    assert payload["skipped"] == 0
    assert payload["skipped_job_ids"] == []
    assert payload["soft_delete_ttl_hours"] == 48
    assert payload["summary_text"] == "清空完成：请求 2 条，成功 1 条，失败 1 条。"
    assert isinstance(payload["operation_id"], str) and payload["operation_id"]
    assert isinstance(payload["undo_until"], str) and payload["undo_until"]
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["meta"] == {"retryable": True}


def test_optimization_history_restore_selected_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    monkeypatch.setattr(
        "app.api.routes.restore_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "restored": 1,
            "failed": max(0, len(ids) - 1),
            "restored_job_ids": ids[:1],
            "failed_job_ids": ids[1:],
            "failed_items": [
                {
                    "job_id": item,
                    "reason_code": "NOT_FOUND_OR_NOT_DELETED",
                    "reason_message": "mock not deleted",
                }
                for item in ids[1:]
            ],
        },
    )

    response = client.post(
        "/api/v1/optimization-history/restore-selected",
        params=[("job_id", "a"), ("job_id", "b")],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requested"] == 2
    assert payload["restored"] == 1
    assert payload["failed"] == 1
    assert payload["restored_job_ids"] == ["a"]
    assert payload["failed_job_ids"] == ["b"]
    assert payload["failed_items"] == [
        {
            "job_id": "b",
            "reason_code": "NOT_FOUND_OR_NOT_DELETED",
            "reason_message": "mock not deleted",
        }
    ]
    assert payload["summary_text"] == "恢复完成：请求 2 条，成功 1 条，失败 1 条。"
    assert isinstance(payload["operation_id"], str) and payload["operation_id"]
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["meta"] == {"retryable": True}


def test_optimization_operations_detail_and_list_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    monkeypatch.setenv("APP_PUBLIC_MODE", "0")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": len(ids),
            "failed": 0,
            "deleted_job_ids": ids,
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )

    clear_response = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-ops-a"), ("job_id", "job-ops-b")],
        headers={
            "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
            "X-Confirm-Count": "2",
        },
    )
    assert clear_response.status_code == 200
    operation_id = clear_response.json()["operation_id"]

    detail_response = client.get(f"/api/v1/operations/{operation_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["operation_id"] == operation_id
    assert detail["action"] == "clear_selected"
    assert detail["status"] == "success"
    assert detail["requested"] == 2
    assert detail["success"] == 2
    assert detail["failed"] == 0
    assert detail["meta"] == {"retryable": False}

    list_response = client.get(
        "/api/v1/operations",
        params={"limit": 20, "action": "clear_selected", "status": "success"},
    )
    assert list_response.status_code == 200
    page = list_response.json()
    assert isinstance(page.get("items"), list)
    assert any(item.get("operation_id") == operation_id for item in page["items"])


def test_optimization_operations_list_supports_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    monkeypatch.setenv("APP_PUBLIC_MODE", "0")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": len(ids),
            "failed": 0,
            "deleted_job_ids": ids,
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )

    first_clear = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-cursor-a")],
        headers={
            "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
            "X-Confirm-Count": "1",
        },
    )
    assert first_clear.status_code == 200
    first_operation_id = first_clear.json()["operation_id"]

    second_clear = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-cursor-b")],
        headers={
            "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
            "X-Confirm-Count": "1",
        },
    )
    assert second_clear.status_code == 200

    page1 = client.get("/api/v1/operations", params={"limit": 1, "action": "clear_selected"})
    assert page1.status_code == 200
    payload1 = page1.json()
    assert len(payload1["items"]) == 1
    assert isinstance(payload1["next_cursor"], str) and payload1["next_cursor"]

    page2 = client.get(
        "/api/v1/operations",
        params={
            "limit": 10,
            "action": "clear_selected",
            "cursor": payload1["next_cursor"],
        },
    )
    assert page2.status_code == 200
    payload2 = page2.json()
    assert isinstance(payload2["items"], list)
    assert all(item.get("operation_id") != payload1["items"][0]["operation_id"] for item in payload2["items"])
    assert any(
        item.get("operation_id") == first_operation_id or item.get("operation_id") == second_clear.json()["operation_id"]
        for item in payload2["items"]
    )


def test_optimization_operation_detail_returns_404_for_missing_id() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/operations/not-found-operation-id")
    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "OPERATION_NOT_FOUND"
    assert payload["meta"]["retryable"] is False


def test_optimization_start_honors_idempotency_key(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    calls = {"count": 0}

    def fake_start(_payload):
        calls["count"] += 1
        return OptimizationStartResponse(
            job_id=f"opt-job-{calls['count']}",
            status=OptimizationJobStatus.PENDING,
            total_combinations=0,
            idempotency_reused=False,
        )

    monkeypatch.setattr("app.api.routes.start_optimization_job", fake_start)

    payload = {
        "base_strategy": {
            "side": "short",
            "lower": 65000,
            "upper": 71000,
            "grids": 6,
            "leverage": 8,
            "margin": 1000,
            "stop_loss": 72000,
            "use_base_position": False,
            "strict_risk_control": True,
            "reopen_after_stop": True,
            "fee_rate": 0.0004,
            "maker_fee_rate": 0.0002,
            "taker_fee_rate": 0.0004,
            "slippage": 0.0002,
            "maintenance_margin_rate": 0.005,
            "funding_rate_per_8h": 0.0,
            "funding_interval_hours": 8,
            "price_tick_size": 0.1,
            "quantity_step_size": 0.0001,
            "min_notional": 5.0,
        },
        "data": {
            "source": "binance",
            "symbol": "BTCUSDT",
            "interval": "1h",
            "lookback_days": 14,
        },
        "optimization": {"optimization_mode": "random_pruned"},
    }

    headers = {"Idempotency-Key": "same-key-opt"}
    first = client.post("/api/v1/optimization/start", json=payload, headers=headers)
    second = client.post("/api/v1/optimization/start", json=payload, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["job_id"] == second.json()["job_id"]
    assert calls["count"] == 1


def test_metrics_endpoint_returns_prometheus_payload() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/metrics")

    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    assert "# HELP app_http_requests_total" in response.text
