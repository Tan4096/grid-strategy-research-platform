from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services import backtest_jobs


def _build_csv(hours: int = 24) -> str:
    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    rows = ["timestamp,open,high,low,close,volume"]
    price = 70000.0
    for i in range(hours):
        ts = start + timedelta(hours=i)
        close = price + (30.0 if i % 2 == 0 else -20.0)
        high = max(price, close) + 60.0
        low = min(price, close) - 60.0
        rows.append(f"{ts.isoformat()},{price:.2f},{high:.2f},{low:.2f},{close:.2f},{1000 + i}")
        price = close
    return "\n".join(rows)


def _payload() -> dict:
    csv_content = _build_csv(48)
    return {
        "strategy": {
            "side": "short",
            "lower": 65000,
            "upper": 71000,
            "grids": 6,
            "leverage": 8,
            "margin": 1000,
            "stop_loss": 72000,
            "use_base_position": False,
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
            "source": "csv",
            "symbol": "BTCUSDT",
            "interval": "1h",
            "lookback_days": 14,
            "start_time": "2026-02-01T00:00:00+00:00",
            "end_time": "2026-02-04T00:00:00+00:00",
            "csv_content": csv_content,
        },
    }


@pytest.fixture(autouse=True)
def isolate_backtest_jobs_state():
    with backtest_jobs._JOBS_LOCK:
        backup = dict(backtest_jobs._JOBS)
        backtest_jobs._JOBS.clear()
    try:
        yield
    finally:
        with backtest_jobs._JOBS_LOCK:
            backtest_jobs._JOBS.clear()
            backtest_jobs._JOBS.update(backup)


def test_backtest_async_start_and_status_completed() -> None:
    client = TestClient(app)
    response = client.post("/api/v1/backtest/start", json=_payload())
    assert response.status_code == 200
    job_id = response.json()["job_id"]

    deadline = time.time() + 6.0
    terminal_payload = None
    while time.time() < deadline:
        status = client.get(f"/api/v1/backtest/{job_id}")
        assert status.status_code == 200
        payload = status.json()
        if payload["job"]["status"] in {"completed", "failed", "cancelled"}:
            terminal_payload = payload
            break
        time.sleep(0.05)

    assert terminal_payload is not None
    assert terminal_payload["job"]["status"] == "completed"
    assert terminal_payload["result"] is not None
    assert "summary" in terminal_payload["result"]


def test_backtest_async_cancel_endpoint() -> None:
    client = TestClient(app)
    original = backtest_jobs.run_backtest

    def slow_run_backtest(*args, **kwargs):
        time.sleep(0.25)
        return original(*args, **kwargs)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(backtest_jobs, "run_backtest", slow_run_backtest)
        start_resp = client.post("/api/v1/backtest/start", json=_payload())
        assert start_resp.status_code == 200
        job_id = start_resp.json()["job_id"]

        cancel_resp = client.post(f"/api/v1/backtest/{job_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["job_id"] == job_id

        deadline = time.time() + 6.0
        final_status = None
        while time.time() < deadline:
            status_resp = client.get(f"/api/v1/backtest/{job_id}")
            assert status_resp.status_code == 200
            status = status_resp.json()["job"]["status"]
            if status in {"completed", "failed", "cancelled"}:
                final_status = status
                break
            time.sleep(0.05)

        assert final_status in {"cancelled", "completed"}


def test_backtest_async_status_404_for_unknown_job() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/backtest/missing-job-id")
    assert response.status_code == 404
