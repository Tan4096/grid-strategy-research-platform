from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from app.core.schemas import BacktestJobMeta, BacktestJobStatus, BacktestStatusResponse
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


def test_backtest_anchor_price_uses_first_candle_close() -> None:
    client = TestClient(app)
    payload = _payload()
    response = client.post("/api/v1/backtest/anchor-price", json=payload["data"])
    assert response.status_code == 200
    body = response.json()
    assert body["anchor_source"] == "first_candle_close"
    assert body["anchor_price"] == pytest.approx(70030.0, abs=1e-6)
    assert body["candle_count"] >= 1


def test_backtest_anchor_price_supports_all_anchor_modes() -> None:
    client = TestClient(app)
    payload = _payload()

    start_resp = client.post("/api/v1/backtest/anchor-price", json=payload["data"])
    avg_resp = client.post(
        "/api/v1/backtest/anchor-price",
        params={"anchor_mode": "BACKTEST_AVG_PRICE"},
        json=payload["data"],
    )
    current_resp = client.post(
        "/api/v1/backtest/anchor-price",
        params={"anchor_mode": "CURRENT_PRICE"},
        json=payload["data"],
    )
    custom_resp = client.post(
        "/api/v1/backtest/anchor-price",
        params={"anchor_mode": "CUSTOM_PRICE", "custom_anchor_price": 12345.6789},
        json=payload["data"],
    )

    assert start_resp.status_code == 200
    assert avg_resp.status_code == 200
    assert current_resp.status_code == 200
    assert custom_resp.status_code == 200

    start_body = start_resp.json()
    avg_body = avg_resp.json()
    current_body = current_resp.json()
    custom_body = custom_resp.json()

    assert start_body["anchor_source"] == "first_candle_close"
    assert avg_body["anchor_source"] == "avg_candle_close"
    assert current_body["anchor_source"] == "last_candle_close"
    assert custom_body["anchor_source"] == "custom_price"
    assert custom_body["anchor_price"] == pytest.approx(12345.68, abs=1e-6)


def test_backtest_anchor_price_custom_mode_requires_custom_anchor_price() -> None:
    client = TestClient(app)
    payload = _payload()
    response = client.post(
        "/api/v1/backtest/anchor-price",
        params={"anchor_mode": "CUSTOM_PRICE"},
        json=payload["data"],
    )
    assert response.status_code == 400
    assert "custom_anchor_price" in response.json()["detail"]


def test_backtest_sync_rejects_when_max_loss_limit_too_small() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["max_allowed_loss_usdt"] = 10.0

    response = client.post("/api/v1/backtest/run", json=payload)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "以损定仓约束不满足" in detail


def test_backtest_sync_rejects_when_stop_loss_exceeds_estimated_liquidation() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["stop_loss"] = 200000.0

    response = client.post("/api/v1/backtest/run", json=payload)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "止损/强平约束不满足" in detail


def test_backtest_start_rejects_when_max_loss_limit_too_small() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["max_allowed_loss_usdt"] = 10.0

    start_resp = client.post("/api/v1/backtest/start", json=payload)
    assert start_resp.status_code == 400
    assert "以损定仓约束不满足" in start_resp.json()["detail"]


def test_backtest_start_rejects_when_stop_loss_exceeds_estimated_liquidation() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["stop_loss"] = 200000.0

    start_resp = client.post("/api/v1/backtest/start", json=payload)
    assert start_resp.status_code == 400
    assert "止损/强平约束不满足" in start_resp.json()["detail"]


def test_backtest_run_allows_violations_when_strict_risk_control_disabled() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["strict_risk_control"] = False
    payload["strategy"]["max_allowed_loss_usdt"] = 10.0
    payload["strategy"]["stop_loss"] = 200000.0

    response = client.post("/api/v1/backtest/run", json=payload)
    assert response.status_code == 200
    assert "summary" in response.json()


def test_backtest_start_allows_violations_when_strict_risk_control_disabled() -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["strict_risk_control"] = False
    payload["strategy"]["max_allowed_loss_usdt"] = 10.0
    payload["strategy"]["stop_loss"] = 200000.0

    response = client.post("/api/v1/backtest/start", json=payload)
    assert response.status_code == 200
    assert "job_id" in response.json()


def test_backtest_start_honors_idempotency_key(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    payload = _payload()
    payload["strategy"]["strict_risk_control"] = False

    calls = {"count": 0}
    original_start = backtest_jobs.start_backtest_job

    def counting_start(request_payload):
        calls["count"] += 1
        return original_start(request_payload)

    monkeypatch.setattr("app.api.routes.start_backtest_job", counting_start)

    headers = {"Idempotency-Key": "same-key-backtest"}
    first = client.post("/api/v1/backtest/start", json=payload, headers=headers)
    second = client.post("/api/v1/backtest/start", json=payload, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["job_id"] == second.json()["job_id"]
    assert calls["count"] == 1


def test_job_stream_endpoint_emits_backtest_update(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    now = datetime.now(timezone.utc)
    payload = BacktestStatusResponse(
        job=BacktestJobMeta(
            job_id="job-stream-backtest",
            status=BacktestJobStatus.COMPLETED,
            created_at=now,
            started_at=now,
            finished_at=now,
            progress=100.0,
            message="done",
            error=None,
        ),
        result=None,
    )

    monkeypatch.setattr("app.api.job_stream.get_backtest_job_status", lambda _job_id: payload)

    with client.stream(
        "GET",
        "/api/v1/jobs/job-stream-backtest/stream",
        params={"job_type": "backtest"},
    ) as response:
        assert response.status_code == 200
        stream_text = "".join(response.iter_text())

    assert "event: update" in stream_text
    assert "\"job_type\":\"backtest\"" in stream_text
    assert "\"status\":\"completed\"" in stream_text
