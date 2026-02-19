from __future__ import annotations

import math
from typing import List, Optional

from app.core.optimization_schemas import OptimizationTarget
from app.core.schemas import StrategyConfig


def build_pruning_checkpoints(total_candles: int, pruning_steps: int) -> List[int]:
    if total_candles <= 0:
        return []

    steps = max(1, int(pruning_steps))
    points: set[int] = set()
    for step in range(1, steps + 1):
        ratio = step / (steps + 1)
        points.add(max(2, min(total_candles, int(total_candles * ratio))))

    points.add(total_candles)
    return sorted(points)


def should_prune_by_drawdown(
    *,
    current_drawdown_pct: float,
    best_drawdown_pct: Optional[float],
    drawdown_prune_multiplier: float,
) -> bool:
    if best_drawdown_pct is None:
        return False
    if not math.isfinite(best_drawdown_pct) or best_drawdown_pct <= 0:
        return False
    threshold = best_drawdown_pct * max(drawdown_prune_multiplier, 1.0)
    return current_drawdown_pct > threshold


def estimate_theoretical_grid_profit(
    *,
    strategy: StrategyConfig,
    reference_price: float,
) -> float:
    if strategy.grids <= 0 or reference_price <= 0:
        return 0.0

    order_notional = (strategy.margin * strategy.leverage) / strategy.grids
    grid_size = (strategy.upper - strategy.lower) / strategy.grids
    gross_per_round = order_notional * (abs(grid_size) / max(reference_price, 1e-9))
    fees_per_round = 2.0 * order_notional * strategy.fee_rate
    net_per_round = max(gross_per_round - fees_per_round, 0.0)
    return net_per_round * strategy.grids


def score_upper_bound_with_remaining(
    *,
    target: OptimizationTarget,
    current_score: float,
    current_total_return_usdt: float,
    current_drawdown_pct: float,
    best_score: Optional[float],
    max_remaining_profit: float,
) -> Optional[float]:
    if best_score is None or not math.isfinite(best_score):
        return None

    remaining_profit = max(max_remaining_profit, 0.0)
    if target == OptimizationTarget.TOTAL_RETURN:
        return current_total_return_usdt + remaining_profit
    if target == OptimizationTarget.RETURN_DRAWDOWN_RATIO:
        drawdown = max(current_drawdown_pct, 1e-6)
        return (current_total_return_usdt + remaining_profit) / drawdown
    if target == OptimizationTarget.CUSTOM:
        return current_score + remaining_profit

    return None


def should_prune_by_profit_ceiling(score_upper_bound: Optional[float], best_score: Optional[float]) -> bool:
    if score_upper_bound is None or best_score is None:
        return False
    if not (math.isfinite(score_upper_bound) and math.isfinite(best_score)):
        return False
    return score_upper_bound < best_score


def infer_liquidation_from_compact_run(
    *,
    equity_values_count: int,
    evaluated_candles_count: int,
    reopen_after_stop: bool,
) -> bool:
    if evaluated_candles_count <= 0:
        return False

    if equity_values_count >= evaluated_candles_count:
        return False

    return bool(reopen_after_stop)

