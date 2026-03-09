from __future__ import annotations

from datetime import datetime, timezone

from app.core.schemas import LiveSnapshotRequest, LiveSnapshotResponse
from app.services.live_snapshot_aggregate import fetch_live_snapshot_aggregate
from app.services.live_snapshot_types import LiveSnapshotError


def test_fetch_live_snapshot_aggregate_returns_stale_cached_snapshot_on_failure() -> None:
    payload = LiveSnapshotRequest.model_validate(
        {
            "exchange": "okx",
            "symbol": "BTCUSDT",
            "strategy_started_at": "2026-03-01T00:00:00+08:00",
            "algo_id": "algo-1",
            "credentials": {
                "api_key": "demo-key",
                "api_secret": "demo-secret",
                "passphrase": "demo-passphrase",
            },
        }
    )
    cached = LiveSnapshotResponse.model_validate(
        {
            "account": {
                "exchange": "okx",
                "symbol": "BTCUSDT",
                "exchange_symbol": "BTC-USDT-SWAP",
                "algo_id": "algo-1",
                "strategy_started_at": "2026-03-01T00:00:00+08:00",
                "fetched_at": "2026-03-07T12:00:00+08:00",
                "masked_api_key": "dem***ey",
            },
            "robot": {
                "algo_id": "algo-1",
                "name": "BTC Grid",
                "state": "running",
                "direction": "long",
                "liquidation_price": None,
                "grid_count": 4,
                "lower_price": 90,
                "upper_price": 110,
                "grid_spacing": 5,
                "total_pnl": 2.9,
                "use_base_position": False
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
            "market_params": None,
            "summary": {
                "realized_pnl": 1,
                "unrealized_pnl": 2,
                "fees_paid": 0.1,
                "funding_paid": 0,
                "funding_net": 0,
                "total_pnl": 2.9,
                "position_notional": 100,
                "open_order_count": 0,
                "fill_count": 0,
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
                "trading_net": 1,
                "fees": 0.1,
                "funding": 0,
                "total_pnl": 0.9,
                "realized": 1,
                "unrealized": 2,
            },
            "position": {
                "side": "long",
                "quantity": 1,
                "entry_price": 100,
                "mark_price": 102,
                "notional": 100,
                "leverage": 2,
                "liquidation_price": None,
                "margin_mode": None,
                "unrealized_pnl": 2,
                "realized_pnl": 1,
            },
            "open_orders": [],
            "fills": [],
            "funding_entries": [],
            "pnl_curve": [],
            "daily_breakdown": [],
            "ledger_entries": [],
            "inferred_grid": {
                "lower": 90,
                "upper": 110,
                "grid_count": 4,
                "grid_spacing": 5,
                "active_level_count": 0,
                "active_levels": [],
                "confidence": 0.8,
                "use_base_position": False,
                "side": "long",
                "note": None,
            },
            "diagnostics": [],
        }
    )

    stale = fetch_live_snapshot_aggregate(
        payload,
        cache_key="cache-key",
        cache_snapshot_store={},
        cache_get_fresh=lambda *args, **kwargs: None,
        cache_get_any=lambda *args, **kwargs: cached,
        cache_set=lambda *args, **kwargs: None,
        snapshot_cache_ttl_sec=3.0,
        retry_live_action=lambda fn, retries: (_ for _ in ()).throw(LiveSnapshotError("boom", status_code=500)),
        fetch_okx_bot_snapshot=lambda payload: None,
        fetch_market_params_best_effort=lambda *args, **kwargs: None,
        infer_grid=lambda *args, **kwargs: None,
        utc_now=lambda: datetime(2026, 3, 7, 4, 0, tzinfo=timezone.utc),
        floor_to_minute=lambda value: value,
        resolve_effective_strategy_started_at=lambda start, created: start,
        build_summary=lambda **kwargs: None,
        build_ledger_entries=lambda *args, **kwargs: [],
        build_daily_breakdown=lambda entries: [],
        build_ledger_summary=lambda summary: cached.ledger_summary,
        build_completeness=lambda diagnostics: cached.completeness,
        build_monitoring_info=lambda **kwargs: cached.monitoring.model_copy(update={"stale": kwargs.get("stale", False)}),
        normalize_datetime=lambda value: value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00")),
        normalize_diagnostics=lambda diagnostics: diagnostics,
        mask_api_key=lambda value: value,
        build_live_simulated_pnl_curve=lambda **kwargs: [],
        build_live_pnl_curve=lambda **kwargs: [],
        diag=lambda level, code, message: type("Diag", (), {"level": level, "code": code, "message": message})(),
        sanitize_error_message=str,
        pick_positive_value=lambda *values: 0.0,
    )

    assert stale.monitoring.stale is True
    assert any(getattr(item, "code", None) == "LIVE_BOT_SNAPSHOT_STALE" for item in stale.diagnostics)
