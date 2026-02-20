from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.schemas import Candle, GridSide, StrategyConfig
from app.optimizer.parallel_runner import _init_worker, _run_single_combination


def _sample_candles() -> list[Candle]:
    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    candles: list[Candle] = []
    price = 70000.0
    for i in range(24):
        close = 70000.0 + (i - 12) * 20.0
        candles.append(
            Candle(
                timestamp=start + timedelta(hours=i),
                open=price,
                high=max(price, close) + 80.0,
                low=min(price, close) - 80.0,
                close=close,
                volume=1000.0 + i,
            )
        )
        price = close
    return candles


def test_parallel_runner_worker_supports_extended_strategy_fields() -> None:
    candles = _sample_candles()
    _init_worker(
        candles_payload=[
            {
                "timestamp": candle.timestamp.isoformat(),
                "open": candle.open,
                "high": candle.high,
                "low": candle.low,
                "close": candle.close,
                "volume": candle.volume,
            }
            for candle in candles
        ],
        funding_payload=[],
        interval_value="1h",
        target_value="return_drawdown_ratio",
        custom_expr=None,
    )

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=10,
        margin=1000,
        stop_loss=72000,
        use_base_position=True,
        reopen_after_stop=False,
        fee_rate=0.0004,
        maker_fee_rate=0.0002,
        taker_fee_rate=0.0004,
        slippage=0.0002,
        maintenance_margin_rate=0.005,
        funding_rate_per_8h=0.0001,
        funding_interval_hours=8,
        use_mark_price_for_liquidation=False,
        price_tick_size=0.1,
        quantity_step_size=0.0001,
        min_notional=5.0,
    )

    result = _run_single_combination({"row_id": 1, "strategy": strategy.model_dump()})

    assert result["ok"] is True
    assert result["summary"] is not None
    assert float(result["score"]) != float("-inf")
