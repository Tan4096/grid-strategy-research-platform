from __future__ import annotations

from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone
import pytest

from app.api import routes
from app.core.schemas import Candle, CurvePoint, LiveFill, LiveFundingEntry, LivePosition, LiveRobotListRequest, LiveRobotListResponse, LiveSnapshotRequest, LiveSnapshotResponse
from app.main import app
from app.services.data_loader import DataLoadError
from app.services.live_snapshot import (
    LiveSnapshotError,
    _build_live_pnl_curve_points,
    _build_summary,
    _okx_signed_get,
    _sanitize_error_message,
    fetch_live_snapshot,
    fetch_okx_robot_list,
)


@pytest.fixture(autouse=True)
def clear_live_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import live_snapshot as live_snapshot_module

    live_snapshot_module._CACHE_LIST.clear()
    live_snapshot_module._CACHE_SNAPSHOT.clear()


def _payload(exchange: str = "binance") -> dict:
    credentials = {
        "api_key": "demo-key",
        "api_secret": "demo-secret",
    }
    payload = {
        "exchange": exchange,
        "symbol": "BTCUSDT",
        "strategy_started_at": "2026-03-01T00:00:00+08:00",
        "credentials": credentials,
    }
    if exchange == "okx":
        credentials["passphrase"] = "demo-passphrase"
        payload["algo_id"] = "algo-123"
    return payload


def test_live_snapshot_endpoint_returns_normalized_payload() -> None:
    client = TestClient(app)

    def fake_snapshot(_payload):
        return LiveSnapshotResponse.model_validate({
            "account": {
                "exchange": "binance",
                "symbol": "BTCUSDT",
                "exchange_symbol": "BTCUSDT",
                "algo_id": "algo-123",
                "strategy_started_at": "2026-03-01T00:00:00+08:00",
                "fetched_at": "2026-03-07T12:00:00+08:00",
                "masked_api_key": "dem***ey",
            },
            "monitoring": {
                "poll_interval_sec": 15,
                "last_success_at": "2026-03-07T12:00:00+08:00",
                "freshness_sec": 0,
                "stale": False,
                "source_latency_ms": 120,
                "fills_page_count": 1,
                "fills_capped": False,
                "orders_page_count": 1,
            },
            "market_params": {
                "source": "binance",
                "symbol": "BTCUSDT",
                "maker_fee_rate": 0.0002,
                "taker_fee_rate": 0.0004,
                "funding_rate_per_8h": 0.0001,
                "funding_interval_hours": 8,
                "price_tick_size": 0.1,
                "quantity_step_size": 0.001,
                "min_notional": 5.0,
                "fetched_at": "2026-03-07T12:00:00+08:00",
                "note": None,
            },
            "robot": {
                "algo_id": "algo-123",
                "name": "测试机器人",
                "state": "running",
                "direction": "long",
                "algo_type": "contract_grid",
                "run_type": "1",
                "created_at": "2026-03-01T00:00:00+08:00",
                "updated_at": "2026-03-07T12:00:00+08:00",
                "investment_usdt": 500.0,
                "configured_leverage": 5.0,
                "actual_leverage": 4.6,
                "liquidation_price": 62000.0,
                "grid_count": 8,
                "lower_price": 68000.0,
                "upper_price": 72000.0,
                "grid_spacing": 500.0,
                "grid_profit": 12.5,
                "floating_profit": 3.0,
                "total_fee": 1.1,
                "funding_fee": 0.2,
                "total_pnl": 14.6,
                "pnl_ratio": 0.12,
                "stop_loss_price": 66000.0,
                "take_profit_price": 73000.0,
                "use_base_position": True
            },
            "summary": {
                "realized_pnl": 12.5,
                "unrealized_pnl": 3.0,
                "fees_paid": 1.1,
                "funding_paid": 0.0,
                "funding_net": 0.2,
                "total_pnl": 14.6,
                "position_notional": 500.0,
                "open_order_count": 4,
                "fill_count": 5,
            },
            "window": {
                "strategy_started_at": "2026-03-01T00:00:00+08:00",
                "fetched_at": "2026-03-07T12:00:00+08:00",
                "compared_end_at": "2026-03-07T12:00:00+08:00",
            },
            "completeness": {
                "fills_complete": True,
                "funding_complete": True,
                "bills_window_clipped": False,
                "partial_failures": [],
            },
            "ledger_summary": {
                "trading_net": 14.4,
                "fees": 1.1,
                "funding": 0.2,
                "total_pnl": 14.6,
                "realized": 12.5,
                "unrealized": 3.0,
            },
            "position": {
                "side": "long",
                "quantity": 0.02,
                "entry_price": 70000.0,
                "mark_price": 70500.0,
                "notional": 1410.0,
                "leverage": 5,
                "liquidation_price": 62000.0,
                "margin_mode": "isolated",
                "unrealized_pnl": 3.0,
                "realized_pnl": 12.5,
            },
            "open_orders": [],
            "fills": [],
            "funding_entries": [],
            "daily_breakdown": [],
            "ledger_entries": [],
            "inferred_grid": {
                "lower": 68000.0,
                "upper": 72000.0,
                "grid_count": 8,
                "grid_spacing": 500.0,
                "active_level_count": 4,
                "active_levels": [68000.0, 68500.0, 69000.0, 69500.0],
                "confidence": 0.8,
                "use_base_position": True,
                "side": "long",
                "note": "ok",
            },
            "diagnostics": [],
        })

    original = routes.fetch_live_snapshot
    routes.fetch_live_snapshot = fake_snapshot
    try:
        response = client.post("/api/v1/live/snapshot", json=_payload())
    finally:
        routes.fetch_live_snapshot = original

    assert response.status_code == 200
    body = response.json()
    assert body["account"]["exchange"] == "binance"
    assert body["account"]["algo_id"] == "algo-123"
    assert body["summary"]["total_pnl"] == 14.6
    assert body["robot"]["state"] == "running"
    assert body["robot"]["configured_leverage"] == 5.0
    assert body["inferred_grid"]["grid_count"] == 8


def test_build_live_pnl_curve_points_replays_unrealized_and_realized_components() -> None:
    tz = timezone(timedelta(hours=8))
    start = datetime(2026, 3, 1, 0, 0, tzinfo=tz)
    candles = [
        Candle(timestamp=start + timedelta(hours=1), open=100, high=101, low=99, close=100, volume=10),
        Candle(timestamp=start + timedelta(hours=2), open=100, high=106, low=99, close=105, volume=12),
        Candle(timestamp=start + timedelta(hours=3), open=105, high=109, low=104, close=108, volume=15),
    ]
    fills = [
        LiveFill(
            trade_id="t1",
            order_id="o1",
            side="buy",
            price=100,
            quantity=1,
            realized_pnl=0,
            fee=0.1,
            timestamp=start + timedelta(minutes=10),
        ),
        LiveFill(
            trade_id="t2",
            order_id="o2",
            side="sell",
            price=108,
            quantity=0.5,
            realized_pnl=4,
            fee=0.1,
            timestamp=start + timedelta(hours=2, minutes=30),
        ),
    ]
    funding_entries = [
        LiveFundingEntry(timestamp=start + timedelta(hours=2, minutes=45), amount=0.3),
    ]

    curve = _build_live_pnl_curve_points(
        candles,
        fills,
        funding_entries,
        start_at=start,
        current_timestamp=start + timedelta(hours=3, minutes=30),
        current_total_pnl=7.1,
        current_mark_price=108,
        current_unrealized_pnl=4.0,
    )

    assert curve[0].timestamp == start
    assert curve[1].value == pytest.approx(-0.1)
    assert curve[2].value == pytest.approx(4.9)
    assert curve[-2].value == pytest.approx(4.0 - 0.2 + 0.3 + (0.5 * (108 - 100)))
    assert curve[-1].value == pytest.approx(7.1)


def test_live_snapshot_requires_okx_passphrase() -> None:
    client = TestClient(app)
    payload = _payload("okx")
    payload["credentials"].pop("passphrase", None)

    response = client.post("/api/v1/live/snapshot", json=payload)

    assert response.status_code == 422


def test_live_snapshot_requires_okx_algo_id() -> None:
    client = TestClient(app)
    payload = _payload("okx")
    payload.pop("algo_id", None)

    response = client.post("/api/v1/live/snapshot", json=payload)

    assert response.status_code == 422


def test_live_snapshot_rejects_non_okx_bot_source() -> None:
    client = TestClient(app)

    response = client.post("/api/v1/live/snapshot", json=_payload("binance"))

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "LIVE_BOT_EXCHANGE_UNSUPPORTED"


def test_sanitize_error_message_masks_secrets() -> None:
    message = _sanitize_error_message("invalid api_secret and passphrase signature")
    assert "api_secret" not in message
    assert "passphrase" not in message
    assert "signature" not in message


def test_live_snapshot_endpoint_returns_api_error_payload() -> None:
    client = TestClient(app)

    def fake_snapshot(_payload):
        raise LiveSnapshotError("交易所限频，请稍后重试", status_code=429, retryable=True)

    original = routes.fetch_live_snapshot
    routes.fetch_live_snapshot = fake_snapshot
    try:
        response = client.post("/api/v1/live/snapshot", json=_payload())
    finally:
        routes.fetch_live_snapshot = original

    assert response.status_code == 429
    body = response.json()
    assert body["code"] == "LIVE_SNAPSHOT_FAILED"
    assert body["meta"]["retryable"] is True


def test_okx_signed_get_puts_sorted_query_into_request_path(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_request_json(method, url, *, headers, params=None, timeout=12):
        captured["method"] = method
        captured["url"] = url
        captured["params"] = params
        captured["headers"] = headers
        return {"code": "0", "data": []}

    monkeypatch.setattr("app.services.live_snapshot._request_json", fake_request_json)
    payload = LiveSnapshotRequest.model_validate(
        {
            "exchange": "okx",
            "symbol": "BTCUSDT",
            "strategy_started_at": "2026-03-01T00:00:00+08:00",
            "algo_id": "algo-123",
            "credentials": {
                "api_key": "demo-key",
                "api_secret": "demo-secret",
                "passphrase": "demo-passphrase",
            },
        }
    )

    result = _okx_signed_get(payload, "/api/v5/test", {"b": 2, "a": 1})

    assert result == []
    assert captured["method"] == "GET"
    assert captured["url"] == "https://www.okx.com/api/v5/test?a=1&b=2"
    assert captured["params"] is None


def test_build_summary_prefers_fill_aggregation_when_available() -> None:
    position = LivePosition(
        side="long",
        quantity=1,
        entry_price=70000,
        mark_price=70100,
        notional=1000,
        leverage=5,
        liquidation_price=65000,
        margin_mode="isolated",
        unrealized_pnl=15,
        realized_pnl=999,
    )
    fills = [
        LiveFill(
            trade_id="1",
            side="buy",
            price=70000,
            quantity=0.1,
            realized_pnl=10,
            fee=2,
            timestamp="2026-03-01T00:00:00+08:00",
        ),
        LiveFill(
            trade_id="2",
            side="sell",
            price=70100,
            quantity=0.1,
            realized_pnl=-4,
            fee=1,
            timestamp="2026-03-01T01:00:00+08:00",
        ),
    ]
    funding_entries = [
        LiveFundingEntry(timestamp="2026-03-01T08:00:00+08:00", amount=3),
        LiveFundingEntry(timestamp="2026-03-01T16:00:00+08:00", amount=-1),
    ]

    summary = _build_summary(position=position, open_orders=[], fills=fills, funding_entries=funding_entries)

    assert summary.realized_pnl == 6
    assert summary.fees_paid == 3
    assert summary.funding_net == 2
    assert summary.total_pnl == 20


def test_fetch_live_snapshot_maps_okx_bot_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        assert payload.algo_id == "algo-123"
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "runType": "1",
                    "investment": "1000",
                    "lever": "5",
                    "actualLever": "4.631189949141073",
                    "floatProfit": "12.5",
                    "pnl": "18.0",
                    "totalPnl": "190.8650209508487",
                    "pnlRatio": "0.1908650209508487",
                    "totalFee": "1.2",
                    "fundingFee": "-0.4",
                    "slTriggerPx": "75500",
                }
            ]
        if path == "/api/v5/tradingBot/grid/sub-orders" and params and params.get("type") == "live":
            return [
                {"ordId": "1", "side": "buy", "px": "68000", "sz": "0.01", "cTime": "2026-03-07T10:00:00+08:00"},
                {"ordId": "2", "side": "sell", "px": "72000", "sz": "0.01", "cTime": "2026-03-07T10:01:00+08:00"},
            ]
        if path == "/api/v5/tradingBot/grid/sub-orders" and params and params.get("type") == "filled":
            return [
                {
                    "tradeId": "t1",
                    "ordId": "1",
                    "side": "sell",
                    "fillPx": "71000",
                    "fillSz": "0.01",
                    "fillPnl": "5.0",
                    "fee": "0.6",
                    "feeCcy": "USDT",
                    "fillTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        raise LiveSnapshotError(f"unexpected path: {path}", status_code=404)

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.account.algo_id == "algo-123"
    assert snapshot.account.exchange == "okx"
    assert snapshot.account.exchange_symbol == "BTC-USDT-SWAP"
    assert snapshot.summary.fees_paid == 1.2
    assert snapshot.summary.funding_net == -0.4
    assert snapshot.robot.state == "running"
    assert snapshot.robot.investment_usdt == 1000
    assert snapshot.robot.configured_leverage == 5
    assert snapshot.robot.actual_leverage == 4.631189949141073
    assert snapshot.robot.grid_profit == 18.0
    assert snapshot.robot.floating_profit == 12.5
    assert snapshot.robot.total_fee == 1.2
    assert snapshot.robot.funding_fee == -0.4
    assert snapshot.robot.total_pnl == 190.8650209508487
    assert snapshot.robot.pnl_ratio == 0.1908650209508487
    assert snapshot.robot.stop_loss_price == 75500
    assert snapshot.robot.take_profit_price is None
    assert snapshot.inferred_grid.grid_count == 10
    assert snapshot.inferred_grid.lower == 65000
    assert snapshot.position.side == "long"
    assert len(snapshot.open_orders) == 2
    assert len(snapshot.fills) == 1


def test_fetch_live_snapshot_maps_okx_bot_price_aliases(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        assert payload.algo_id == "algo-123"
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "short",
                    "basePos": "0.25",
                    "entryPrice": "70100",
                    "lastPrice": "68900",
                    "state": "running",
                    "lever": "5",
                    "liqPx": "78159.9",
                    "stopLossPx": "73500",
                }
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.position.entry_price == 70100
    assert snapshot.position.mark_price == 68900
    assert snapshot.position.liquidation_price == 78159.9
    assert snapshot.robot.stop_loss_price == 73500


def test_fetch_live_snapshot_marks_funding_incomplete_when_bot_api_omits_it(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "long",
                    "basePos": "0.25",
                }
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.completeness.funding_complete is False
    assert snapshot.robot.actual_leverage is None
    assert snapshot.robot.funding_fee is None
    assert snapshot.robot.stop_loss_price is None
    assert any(item.code == "funding_not_available" for item in snapshot.diagnostics)


def test_fetch_live_snapshot_reads_okx_bot_history_sub_orders(monkeypatch: pytest.MonkeyPatch) -> None:
    called_paths: list[str] = []

    def fake_okx_signed_get(payload, path, params=None):
        called_paths.append(path)
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return []
        if path == "/api/v5/tradingBot/grid/sub-orders-history":
            return [
                {
                    "tradeId": "sub-order-1",
                    "ordId": "1",
                    "side": "sell",
                    "fillPx": "71000",
                    "fillSz": "0.01",
                    "fillPnl": "5.0",
                    "fee": "0.6",
                    "feeCcy": "USDT",
                    "fillTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        if path == "/api/v5/tradingBot/grid/sub-orders" and params and params.get("type") == "filled":
            raise LiveSnapshotError("fallback should not be needed", status_code=400)
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert "/api/v5/tradingBot/grid/sub-orders-history" in called_paths
    assert len(snapshot.fills) == 1
    assert not any(item.code == "fills_not_available" for item in snapshot.diagnostics)


def test_fetch_live_snapshot_backfills_okx_daily_realized_from_matched_account_bills_only(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                    "pnl": "5.0",
                    "totalFee": "0.15",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return []
        if path == "/api/v5/tradingBot/grid/sub-orders-history":
            return [
                {
                    "tradeId": "t-history",
                    "ordId": "1",
                    "side": "sell",
                    "fillPx": "71000",
                    "fillSz": "0.01",
                    "fillPnl": "0.0",
                    "fee": "0.15",
                    "feeCcy": "USDT",
                    "fillTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        if path in {"/api/v5/account/bills", "/api/v5/account/bills-archive"}:
            return [
                {
                    "billId": "bill-trade-1",
                    "type": "2",
                    "subType": "1",
                    "pnl": "1.5",
                    "fee": "0",
                    "balChg": "1.5",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-trade-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-trade-2",
                    "type": "2",
                    "subType": "1",
                    "pnl": "3.5",
                    "fee": "0",
                    "balChg": "3.5",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-trade-2",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-other-order",
                    "type": "2",
                    "subType": "1",
                    "pnl": "9999.0",
                    "fee": "0",
                    "balChg": "9999.0",
                    "ccy": "USDT",
                    "ordId": "other-order",
                    "tradeId": "other-trade",
                    "ts": "2026-03-07T10:05:00+08:00",
                },
                {
                    "billId": "bill-fee-other-order",
                    "type": "2",
                    "subType": "2",
                    "pnl": "0",
                    "fee": "888.0",
                    "balChg": "-888.0",
                    "ccy": "USDT",
                    "ordId": "other-order",
                    "tradeId": "other-trade",
                    "ts": "2026-03-07T10:05:00+08:00",
                },
                {
                    "billId": "bill-fee-1",
                    "type": "2",
                    "subType": "2",
                    "pnl": "0",
                    "fee": "0.15",
                    "balChg": "-0.15",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-fee-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.fills[0].realized_pnl == 5.0
    assert snapshot.fills[0].fee == 0.15
    assert any(item.kind == "trade" and item.pnl == 5.0 and item.order_id == "1" for item in snapshot.ledger_entries)
    assert not any(item.order_id == "other-order" for item in snapshot.ledger_entries)
    assert snapshot.daily_breakdown[0].realized_pnl == 5.0
    assert snapshot.daily_breakdown[0].fees_paid == 0.15
    assert snapshot.daily_breakdown[0].trading_net == pytest.approx(4.85)


def test_fetch_live_snapshot_uses_okx_account_bills_for_daily_breakdown_when_bot_fill_values_are_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "minPx": "65000",
                    "maxPx": "75000",
                    "gridNum": "10",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                    "pnl": "5.0",
                    "totalFee": "0.15",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return []
        if path == "/api/v5/tradingBot/grid/sub-orders-history":
            return [
                {
                    "tradeId": "t-history",
                    "ordId": "1",
                    "side": "sell",
                    "fillPx": "71000",
                    "fillSz": "0.01",
                    "fillPnl": "0.0",
                    "fee": "0.0",
                    "feeCcy": "USDT",
                    "fillTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        if path in {"/api/v5/account/bills", "/api/v5/account/bills-archive"}:
            if params and params.get("type") == 8:
                return [
                    {
                        "billId": "bill-funding-1",
                        "type": "8",
                        "subType": "174",
                        "pnl": "1.2",
                        "ccy": "USDT",
                        "ts": "2026-03-07T08:00:00+08:00",
                    }
                ]
            return [
                {
                    "billId": "bill-trade-1",
                    "type": "2",
                    "subType": "1",
                    "pnl": "1.5",
                    "fee": "0",
                    "balChg": "1.5",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-trade-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-trade-2",
                    "type": "2",
                    "subType": "1",
                    "pnl": "3.5",
                    "fee": "0",
                    "balChg": "3.5",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-trade-2",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-fee-1",
                    "type": "2",
                    "subType": "2",
                    "pnl": "0",
                    "fee": "0.15",
                    "balChg": "-0.15",
                    "ccy": "USDT",
                    "ordId": "1",
                    "tradeId": "bill-fee-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert any(item.kind == "trade" and item.pnl == 5.0 and item.order_id == "1" for item in snapshot.ledger_entries)
    assert any(item.kind == "fee" and item.fee == 0.15 and item.order_id == "1" for item in snapshot.ledger_entries)
    assert snapshot.daily_breakdown[0].realized_pnl == pytest.approx(5.0)
    assert snapshot.daily_breakdown[0].fees_paid == pytest.approx(0.15)
    assert snapshot.daily_breakdown[0].funding_net == pytest.approx(1.2)
    assert snapshot.daily_breakdown[0].trading_net == pytest.approx(4.85)
    assert snapshot.daily_breakdown[0].total_pnl == pytest.approx(6.05)


def test_fetch_live_snapshot_backfills_okx_fill_values_from_unique_bill_timestamp_when_ids_do_not_match(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return []
        if path == "/api/v5/tradingBot/grid/sub-orders-history":
            return [
                {
                    "tradeId": "sub-trade-1",
                    "ordId": "sub-order-1",
                    "side": "sell",
                    "fillPx": "71000",
                    "fillSz": "0.01",
                    "fillPnl": "0.0",
                    "fee": "0.0",
                    "feeCcy": "USDT",
                    "fillTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        if path in {"/api/v5/account/bills", "/api/v5/account/bills-archive"}:
            if params and params.get("type") == 8:
                return []
            return [
                {
                    "billId": "bill-trade-1",
                    "type": "2",
                    "subType": "1",
                    "pnl": "1.5",
                    "fee": "0",
                    "balChg": "1.5",
                    "ccy": "USDT",
                    "ordId": "account-order-1",
                    "tradeId": "account-trade-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-trade-2",
                    "type": "2",
                    "subType": "1",
                    "pnl": "3.5",
                    "fee": "0",
                    "balChg": "3.5",
                    "ccy": "USDT",
                    "ordId": "account-order-1",
                    "tradeId": "account-trade-2",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-fee-1",
                    "type": "2",
                    "subType": "2",
                    "pnl": "0",
                    "fee": "0.15",
                    "balChg": "-0.15",
                    "ccy": "USDT",
                    "ordId": "account-order-1",
                    "tradeId": "account-trade-3",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.fills[0].realized_pnl == pytest.approx(5.0)
    assert snapshot.fills[0].fee == pytest.approx(0.15)
    assert any(item.kind == "trade" and item.pnl == 5.0 and item.order_id == "sub-order-1" for item in snapshot.ledger_entries)
    assert any(item.kind == "fee" and item.fee == 0.15 and item.order_id == "sub-order-1" for item in snapshot.ledger_entries)


def test_fetch_live_snapshot_uses_okx_sub_orders_without_trade_id_and_filters_account_bills(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return []
        if path == "/api/v5/tradingBot/grid/sub-orders-history":
            raise LiveSnapshotError("Not Found", status_code=404)
        if path == "/api/v5/tradingBot/grid/orders-algo-history":
            raise LiveSnapshotError("The bot doesn’t exist or has already stopped", status_code=404)
        if path == "/api/v5/tradingBot/grid/sub-orders" and params and params.get("type") == "filled":
            return [
                {
                    "ordId": "sub-order-1",
                    "side": "sell",
                    "avgPx": "71000",
                    "px": "71000",
                    "accFillSz": "0.01",
                    "sz": "0.01",
                    "pnl": "",
                    "fee": "-0.15",
                    "feeCcy": "USDT",
                    "uTime": "2026-03-07T10:02:00+08:00",
                    "cTime": "2026-03-07T10:02:00+08:00",
                }
            ]
        if path in {"/api/v5/account/bills", "/api/v5/account/bills-archive"}:
            if params and params.get("type") == 8:
                return [
                    {
                        "billId": "bill-funding-1",
                        "type": "8",
                        "subType": "174",
                        "pnl": "1.2",
                        "ccy": "USDT",
                        "ts": "2026-03-07T08:00:00+08:00",
                    }
                ]
            return [
                {
                    "billId": "bill-trade-1",
                    "type": "2",
                    "subType": "1",
                    "pnl": "5.0",
                    "fee": "0",
                    "balChg": "5.0",
                    "ccy": "USDT",
                    "ordId": "sub-order-1",
                    "tradeId": "bill-trade-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-fee-1",
                    "type": "2",
                    "subType": "2",
                    "pnl": "0",
                    "fee": "0.15",
                    "balChg": "-0.15",
                    "ccy": "USDT",
                    "ordId": "sub-order-1",
                    "tradeId": "bill-fee-1",
                    "ts": "2026-03-07T10:02:00+08:00",
                },
                {
                    "billId": "bill-other-order",
                    "type": "2",
                    "subType": "1",
                    "pnl": "9999.0",
                    "fee": "0",
                    "balChg": "9999.0",
                    "ccy": "USDT",
                    "ordId": "other-order",
                    "tradeId": "other-trade",
                    "ts": "2026-03-07T10:05:00+08:00",
                },
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert len(snapshot.fills) == 1
    assert snapshot.fills[0].trade_id == "sub-order-1"
    assert snapshot.fills[0].order_id == "sub-order-1"
    assert snapshot.fills[0].realized_pnl == pytest.approx(5.0)
    assert snapshot.fills[0].fee == pytest.approx(0.15)
    assert any(item.kind == "trade" and item.order_id == "sub-order-1" and item.pnl == 5.0 for item in snapshot.ledger_entries)
    assert any(item.kind == "fee" and item.order_id == "sub-order-1" and item.fee == 0.15 for item in snapshot.ledger_entries)
    assert not any(item.order_id == "other-order" for item in snapshot.ledger_entries)
    assert snapshot.daily_breakdown[0].realized_pnl == pytest.approx(5.0)
    assert snapshot.daily_breakdown[0].fees_paid == pytest.approx(0.15)
    assert snapshot.daily_breakdown[0].funding_net == pytest.approx(1.2)


def test_fetch_live_snapshot_reports_pnl_curve_kline_failure_in_diagnostics(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        return []

    def fake_build_live_pnl_curve(**kwargs):
        raise DataLoadError("loaded OKX dataframe is empty after time range filtering")

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", fake_build_live_pnl_curve)
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", fake_build_live_pnl_curve)

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    assert snapshot.pnl_curve == []
    assert any(item.code == "pnl_curve_kline_unavailable" for item in snapshot.diagnostics)


def test_fetch_live_snapshot_uses_robot_created_at_as_effective_strategy_start(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    payload_dict = _payload("okx")
    payload_dict["strategy_started_at"] = "2026-03-08T11:17:51+08:00"

    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                    "cTime": "2026-02-19T21:43:00+08:00",
                }
            ]
        return []

    def fake_build_live_pnl_curve(**kwargs):
        captured.update(kwargs)
        return [CurvePoint(timestamp=datetime(2026, 3, 8, 3, 0, tzinfo=timezone.utc), value=12.0)]

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", fake_build_live_pnl_curve)

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(payload_dict))

    assert captured["strategy_started_at"] == datetime(2026, 2, 19, 13, 43, tzinfo=timezone.utc)
    assert snapshot.window.strategy_started_at == datetime(2026, 2, 19, 13, 43, tzinfo=timezone.utc)
    assert snapshot.account.strategy_started_at == datetime(2026, 2, 19, 13, 43, tzinfo=timezone.utc)


def test_fetch_live_snapshot_daily_breakdown_uses_funding_bills_for_each_day(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        if path == "/api/v5/account/bills":
            return [
                {
                    "type": "8",
                    "subType": "174",
                    "ts": "2026-03-07T08:00:00+08:00",
                    "pnl": "1.2",
                    "ccy": "USDT"
                },
                {
                    "type": "8",
                    "subType": "174",
                    "ts": "2026-03-06T08:00:00+08:00",
                    "pnl": "0.7",
                    "ccy": "USDT"
                }
            ]
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.live_snapshot._build_live_simulated_pnl_curve", lambda **kwargs: [])
    monkeypatch.setattr("app.services.live_snapshot._build_live_pnl_curve", lambda **kwargs: [])

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    by_date = {item.date: item for item in snapshot.daily_breakdown}
    assert by_date["2026-03-07"].funding_net == pytest.approx(1.2)
    assert by_date["2026-03-06"].funding_net == pytest.approx(0.7)
    assert sum(item.amount for item in snapshot.funding_entries) == pytest.approx(1.9)


def test_fetch_live_snapshot_reports_pnl_curve_fills_incomplete_in_diagnostics(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get(payload, path, params=None):
        if path == "/api/v5/tradingBot/grid/orders-algo-details":
            return [
                {
                    "algoId": "algo-123",
                    "instId": "BTC-USDT-SWAP",
                    "direction": "long",
                    "basePos": "0.25",
                    "avgPx": "70000",
                    "last": "70500",
                    "state": "running",
                    "investment": "1000",
                    "totalPnl": "12.0",
                }
            ]
        if path in {
            "/api/v5/tradingBot/grid/sub-orders-history",
            "/api/v5/tradingBot/grid/orders-algo-history",
            "/api/v5/tradingBot/grid/sub-orders",
        }:
            raise LiveSnapshotError("history unavailable", status_code=404)
        return []

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get", fake_okx_signed_get)
    monkeypatch.setattr("app.services.live_snapshot._fetch_market_params_best_effort", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "app.services.live_snapshot._build_live_simulated_pnl_curve",
        lambda **kwargs: [CurvePoint(timestamp=datetime(2026, 3, 8, 2, 0, tzinfo=timezone.utc), value=12.0)],
    )

    snapshot = fetch_live_snapshot(LiveSnapshotRequest.model_validate(_payload("okx")))

    codes = {item.code for item in snapshot.diagnostics}
    assert "fills_not_available" in codes
    assert "pnl_curve_fills_incomplete" in codes


def test_live_robot_list_endpoint_returns_items() -> None:
    client = TestClient(app)

    def fake_robot_list(_payload):
        return LiveRobotListResponse(
            scope="running",
            items=[
                {
                    "algo_id": "algo-123",
                    "name": "BTC Grid",
                    "symbol": "BTCUSDT",
                    "exchange_symbol": "BTC-USDT-SWAP",
                    "state": "running",
                    "side": "long",
                }
            ]
        )

    original = routes.fetch_okx_robot_list
    routes.fetch_okx_robot_list = fake_robot_list
    try:
        response = client.post(
            "/api/v1/live/robots",
            json={
                "exchange": "okx",
                "credentials": {
                    "api_key": "demo-key",
                    "api_secret": "demo-secret",
                    "passphrase": "demo-passphrase",
                },
            },
        )
    finally:
        routes.fetch_okx_robot_list = original

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["algo_id"] == "algo-123"
    assert body["items"][0]["symbol"] == "BTCUSDT"


def test_fetch_okx_robot_list_maps_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_okx_signed_get_robot_list(payload, path, params=None):
        assert payload.exchange.value == "okx"
        if path == "/api/v5/tradingBot/grid/orders-algo-pending":
            return [
                {
                    "algoId": "algo-123",
                    "algoClOrdId": "BTC Grid",
                    "instId": "BTC-USDT-SWAP",
                    "state": "running",
                    "direction": "long",
                    "uTime": "2026-03-07T12:00:00+08:00",
                }
            ]
        if path == "/api/v5/tradingBot/grid/orders-algo-history":
            return [
                {
                    "algoId": "algo-456",
                    "instId": "ETH-USDT-SWAP",
                    "state": "stopped",
                    "direction": "short",
                    "uTime": "2026-03-06T12:00:00+08:00",
                }
            ]
        raise AssertionError(path)

    monkeypatch.setattr("app.services.live_snapshot._okx_signed_get_robot_list", fake_okx_signed_get_robot_list)

    response = fetch_okx_robot_list(
        LiveRobotListRequest.model_validate(
            {
                "exchange": "okx",
                "scope": "recent",
                "credentials": {
                    "api_key": "demo-key",
                    "api_secret": "demo-secret",
                    "passphrase": "demo-passphrase",
                },
            }
        )
    )

    assert len(response.items) == 2
    assert response.items[0].symbol == "BTCUSDT"
    assert response.items[0].name == "BTC Grid"
    assert response.items[1].name.startswith("ETH-USDT-SWAP")
