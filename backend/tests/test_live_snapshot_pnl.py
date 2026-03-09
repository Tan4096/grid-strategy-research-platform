from __future__ import annotations

from datetime import datetime, timezone

from app.core.schemas import Candle, LiveFill
from app.services.live_snapshot_pnl import build_live_pnl_curve_points


def test_build_live_pnl_curve_points_replays_fill_into_curve() -> None:
    curve = build_live_pnl_curve_points(
        candles=[
            Candle(timestamp=datetime(2026, 3, 7, 0, 0, tzinfo=timezone.utc), open=100, high=101, low=99, close=100, volume=1),
            Candle(timestamp=datetime(2026, 3, 7, 1, 0, tzinfo=timezone.utc), open=100, high=112, low=99, close=110, volume=1),
        ],
        fills=[
            LiveFill(
                trade_id="t1",
                order_id="o1",
                side="buy",
                price=100,
                quantity=1,
                realized_pnl=0,
                fee=0,
                fee_currency="USDT",
                is_maker=True,
                timestamp=datetime(2026, 3, 7, 0, 0, tzinfo=timezone.utc),
            )
        ],
        funding_entries=[],
        start_at=datetime(2026, 3, 7, 0, 0, tzinfo=timezone.utc),
        current_timestamp=datetime(2026, 3, 7, 1, 0, tzinfo=timezone.utc),
        current_total_pnl=10,
        current_mark_price=110,
        current_unrealized_pnl=10,
    )

    assert curve[0].value == 0
    assert curve[-1].value == 10
