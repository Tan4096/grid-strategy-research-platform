from __future__ import annotations

import math
import os
import time
from datetime import datetime, timedelta, timezone

from app.core.optimization_schemas import OptimizationConfig, OptimizationTarget
from app.core.schemas import Candle, GridSide, StrategyConfig
from app.optimizer.optimizer import _build_combinations
from app.optimizer.parallel_runner import run_combinations_parallel


def _build_synthetic_candles(days: int = 14) -> list[Candle]:
    start = datetime(2026, 2, 1, tzinfo=timezone.utc)
    candles: list[Candle] = []
    price = 98000.0
    for i in range(24 * days):
        ts = start + timedelta(hours=i)
        wave = 1800.0 * math.sin(i / 11.0) + 900.0 * math.cos(i / 17.0)
        drift = (i - 24 * 7) * 3.0
        close = 98000.0 + wave + drift
        open_price = price
        high = max(open_price, close) + 220.0 + (i % 5) * 10.0
        low = min(open_price, close) - 220.0 - (i % 7) * 9.0
        candles.append(Candle(timestamp=ts, open=open_price, high=high, low=low, close=close, volume=1000.0 + i))
        price = close
    return candles


def main() -> None:
    candles = _build_synthetic_candles(days=14)
    base_strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=94000,
        upper=102000,
        grids=8,
        leverage=6,
        margin=2000,
        stop_loss=103000,
        use_base_position=False,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0002,
        maintenance_margin_rate=0.005,
    )
    cfg = OptimizationConfig(
        leverage={"enabled": True, "start": 2, "end": 12, "step": 1},
        grids={"enabled": True, "start": 4, "end": 15, "step": 1},
        band_width_pct={"enabled": True, "values": [4, 6, 8, 10]},
        stop_loss_ratio_pct={"enabled": True, "values": [0.5, 1.0, 1.5, 2.0]},
        optimize_base_position=True,
        target=OptimizationTarget.RETURN_DRAWDOWN_RATIO,
        walk_forward_enabled=False,
        max_workers=min(16, os.cpu_count() or 4),
        batch_size=300,
        chunk_size=64,
    )

    combos = _build_combinations(
        base_strategy,
        cfg,
        reference_price=candles[0].close,
        initial_price=candles[0].close,
    )
    tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in combos]

    t0 = time.perf_counter()
    results = run_combinations_parallel(
        candles=candles,
        tasks=tasks,
        funding_rates=None,
        interval_value="1h",
        target=cfg.target,
        custom_score_expr=cfg.custom_score_expr,
        max_workers=cfg.max_workers,
        batch_size=cfg.batch_size,
        chunk_size=cfg.chunk_size,
    )
    elapsed_seconds = time.perf_counter() - t0
    ok_count = sum(1 for row in results if row.get("ok"))

    print(f"combos={len(combos)}")
    print(f"elapsed_seconds={elapsed_seconds:.4f}")
    print(f"ok={ok_count}")


if __name__ == "__main__":
    main()
