from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _build_csv_payload() -> tuple[str, str, str]:
    start = datetime(2026, 2, 1, 0, 0, tzinfo=timezone.utc)
    rows = ["timestamp,open,high,low,close,volume"]
    base_price = 69_000.0

    for idx in range(96):
        ts = start + timedelta(hours=idx)
        wave = ((idx % 8) - 4) * 140.0
        drift = (idx // 16) * 30.0
        open_price = base_price + wave + drift
        close_price = open_price + (110.0 if idx % 2 == 0 else -95.0)
        high_price = max(open_price, close_price) + 180.0
        low_price = min(open_price, close_price) - 180.0
        volume = 100.0 + idx
        rows.append(
            f"{ts.isoformat()},{open_price:.2f},{high_price:.2f},{low_price:.2f},{close_price:.2f},{volume:.2f}"
        )

    end = start + timedelta(hours=95)
    return "\n".join(rows), start.isoformat(), (end + timedelta(hours=1)).isoformat()


def _base_backtest_payload(csv_content: str, start_time: str, end_time: str) -> dict:
    return {
        "strategy": {
            "side": "short",
            "lower": 65000,
            "upper": 71000,
            "grids": 6,
            "leverage": 8,
            "margin": 1000,
            "stop_loss": 72000,
            "use_base_position": True,
            "reopen_after_stop": False,
            "fee_rate": 0.0004,
            "slippage": 0.0002,
            "maintenance_margin_rate": 0.005,
        },
        "data": {
            "source": "csv",
            "symbol": "BTCUSDT",
            "interval": "1h",
            "lookback_days": 14,
            "start_time": start_time,
            "end_time": end_time,
            "csv_content": csv_content,
        },
    }


def _wait_for_optimization_completion(job_id: str, timeout_seconds: float = 25.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_payload: dict | None = None

    while time.time() < deadline:
        response = client.get(f"/api/v1/optimization/{job_id}/progress")
        assert response.status_code == 200, response.text
        payload = response.json()
        last_payload = payload
        status = payload["job"]["status"]
        if status in {"completed", "failed", "cancelled"}:
            return payload
        time.sleep(0.1)

    raise AssertionError(f"optimization job timeout: {job_id}, last_payload={last_payload}")


def test_e2e_smoke_backtest_optimize_export_and_apply_flow() -> None:
    csv_content, start_time, end_time = _build_csv_payload()
    backtest_payload = _base_backtest_payload(csv_content=csv_content, start_time=start_time, end_time=end_time)

    backtest_response = client.post("/api/v1/backtest/run", json=backtest_payload)
    assert backtest_response.status_code == 200, backtest_response.text
    backtest_result = backtest_response.json()
    assert backtest_result["summary"]["status"] in {"completed", "stopped_by_stop_loss", "liquidated"}
    assert len(backtest_result["equity_curve"]) > 0

    optimization_payload = {
        "base_strategy": backtest_payload["strategy"],
        "data": backtest_payload["data"],
        "optimization": {
            "optimization_mode": "grid",
            "leverage": {"enabled": True, "values": [6, 8]},
            "grids": {"enabled": True, "values": [6]},
            "band_width_pct": {"enabled": False},
            "stop_loss_ratio_pct": {"enabled": False},
            "optimize_base_position": True,
            "max_combinations": 32,
            "auto_limit_combinations": True,
            "max_workers": 1,
            "batch_size": 64,
            "chunk_size": 8,
            "walk_forward_enabled": False,
            "require_positive_return": False,
        },
    }
    optimization_start = client.post("/api/v1/optimization/start", json=optimization_payload)
    assert optimization_start.status_code == 200, optimization_start.text
    job_id = optimization_start.json()["job_id"]

    final_progress = _wait_for_optimization_completion(job_id=job_id)
    assert final_progress["job"]["status"] == "completed", final_progress

    status_response = client.get(
        f"/api/v1/optimization/{job_id}",
        params={"page": 1, "page_size": 20, "sort_by": "robust_score", "sort_order": "desc"},
    )
    assert status_response.status_code == 200, status_response.text
    status_payload = status_response.json()
    assert status_payload["total_results"] >= 1
    assert len(status_payload["rows"]) >= 1

    export_response = client.get(f"/api/v1/optimization/{job_id}/export")
    assert export_response.status_code == 200, export_response.text
    assert "text/csv" in export_response.headers.get("content-type", "")
    export_text = export_response.text
    assert "row_id,leverage,grids,use_base_position" in export_text
    assert "lower_price,upper_price,stop_price" in export_text

    best_row = status_payload["rows"][0]
    applied_payload = {
        "strategy": {
            **backtest_payload["strategy"],
            "lower": best_row["lower_price"],
            "upper": best_row["upper_price"],
            "stop_loss": best_row["stop_price"],
            "leverage": best_row["leverage"],
            "grids": best_row["grids"],
            "use_base_position": best_row["use_base_position"],
        },
        "data": backtest_payload["data"],
    }

    applied_backtest = client.post("/api/v1/backtest/run", json=applied_payload)
    assert applied_backtest.status_code == 200, applied_backtest.text
    applied_result = applied_backtest.json()
    assert applied_result["summary"]["status"] in {"completed", "stopped_by_stop_loss", "liquidated"}
    assert len(applied_result["trades"]) >= 0
    assert len(applied_result["equity_curve"]) > 0


def test_random_pruned_with_large_trial_budget_completes() -> None:
    csv_content, start_time, end_time = _build_csv_payload()
    backtest_payload = _base_backtest_payload(csv_content=csv_content, start_time=start_time, end_time=end_time)

    optimization_payload = {
        "base_strategy": backtest_payload["strategy"],
        "data": backtest_payload["data"],
        "optimization": {
            "optimization_mode": "random_pruned",
            "leverage": {"enabled": True, "values": [6, 8]},
            "grids": {"enabled": True, "values": [6]},
            "band_width_pct": {"enabled": True, "values": [8]},
            "stop_loss_ratio_pct": {"enabled": True, "values": [1]},
            "optimize_base_position": False,
            "max_trials": 10_000,
            "max_workers": 1,
            "batch_size": 64,
            "chunk_size": 8,
            "walk_forward_enabled": False,
            "require_positive_return": False,
            "min_closed_trades": 0,
        },
    }

    optimization_start = client.post("/api/v1/optimization/start", json=optimization_payload)
    assert optimization_start.status_code == 200, optimization_start.text
    job_id = optimization_start.json()["job_id"]

    final_progress = _wait_for_optimization_completion(job_id=job_id)
    assert final_progress["job"]["status"] == "completed", final_progress
    assert final_progress["job"]["trials_completed"] + final_progress["job"]["trials_pruned"] >= 1

    status_response = client.get(
        f"/api/v1/optimization/{job_id}",
        params={"page": 1, "page_size": 20, "sort_by": "robust_score", "sort_order": "desc"},
    )
    assert status_response.status_code == 200, status_response.text
    status_payload = status_response.json()
    assert status_payload["total_results"] >= 1
