from __future__ import annotations

from app.services.live_snapshot_collectors import build_live_robot_list_item, build_okx_bot_position


def test_build_live_robot_list_item_maps_okx_robot_payload() -> None:
    item = build_live_robot_list_item(
        {
            "algoId": "algo-1",
            "algoClOrdId": "BTC Grid",
            "instId": "BTC-USDT-SWAP",
            "state": "running",
            "direction": "long",
            "uTime": "2026-03-07T12:00:00+08:00",
        },
        coerce_text=lambda value: str(value).strip() if value is not None else "",
        first_present=lambda payload, *keys: next((payload[key] for key in keys if key in payload), None),
        normalize_position_side=lambda value, quantity=0.0: "long",
        optional_datetime=lambda value: value,
        optional_float=lambda value: value,
        optional_int=lambda value: value,
    )

    assert item is not None
    assert item.algo_id == "algo-1"
    assert item.exchange_symbol == "BTC-USDT-SWAP"
    assert item.symbol == "BTCUSDT"


def test_build_okx_bot_position_derives_notional_and_quantity_from_actual_leverage() -> None:
    position = build_okx_bot_position(
        {
            "direction": "short",
            "runPx": "65916",
            "actualLever": "6.6",
            "investment": "1000",
            "liqPx": "77929.7",
            "floatProfit": "-209.95",
            "gridProfit": "304.25",
            "sz": "1000"
        },
        normalize_position_side=lambda value, quantity=0.0: "short",
        first_present=lambda payload, *keys: next((payload[key] for key in keys if key in payload), None),
        safe_float=lambda value, fallback=0.0: float(value) if value not in (None, "") else fallback,
        optional_float=lambda value: float(value) if value not in (None, "") else None,
    )

    assert position.mark_price == 65916
    assert position.notional == 6600
    assert position.quantity == 6600 / 65916


def test_build_okx_bot_position_accepts_last_price_alias() -> None:
    position = build_okx_bot_position(
        {
            "direction": "short",
            "entryPrice": "70100",
            "lastPrice": "68900",
            "lever": "5",
            "liqPx": "78159.9",
        },
        normalize_position_side=lambda value, quantity=0.0: "short",
        first_present=lambda payload, *keys: next((payload[key] for key in keys if key in payload), None),
        safe_float=lambda value, fallback=0.0: float(value) if value is not None else fallback,
        optional_float=lambda value: float(value) if value is not None else None,
    )

    assert position.entry_price == 70100
    assert position.mark_price == 68900
