from __future__ import annotations

from bisect import bisect_left, bisect_right
from typing import Optional

from app.core.schemas import GridSide, StrategyConfig


def build_grid_nodes(lower: float, upper: float, grids: int) -> tuple[list[float], float]:
    grid_size = (upper - lower) / grids
    nodes = [lower + (i * grid_size) for i in range(grids + 1)]
    eps = max(abs(grid_size) * 1e-9, 1e-8)
    return nodes, eps


def derive_base_position_grid_indices(
    strategy: StrategyConfig,
    *,
    current_price: float,
    nodes: Optional[list[float]] = None,
    eps: Optional[float] = None,
) -> list[int]:
    if not strategy.use_base_position:
        return []

    if nodes is None or eps is None:
        nodes, eps = build_grid_nodes(strategy.lower, strategy.upper, strategy.grids)

    lower_split = bisect_left(nodes, current_price - eps)
    upper_split = bisect_right(nodes, current_price + eps)

    if strategy.side == GridSide.LONG:
        start = min(max(lower_split, 0), strategy.grids)
        return list(range(start, strategy.grids))

    count = min(max(upper_split - 1, 0), strategy.grids)
    return list(range(0, count))
