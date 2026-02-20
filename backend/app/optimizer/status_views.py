from __future__ import annotations

import math
from typing import Callable, Dict, List, Tuple

from app.core.optimization_schemas import HeatmapCell, OptimizationResultRow


def score_sort_key(
    row: OptimizationResultRow,
    sort_by: str,
    safe_score: Callable[[object], float],
) -> float:
    value = getattr(row, sort_by, None)
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    return safe_score(value)


def paginate_rows(rows: List[OptimizationResultRow], page: int, page_size: int) -> List[OptimizationResultRow]:
    start = (page - 1) * page_size
    end = start + page_size
    return rows[start:end]


def build_heatmap(
    rows: List[OptimizationResultRow],
    primary_score: Callable[[OptimizationResultRow], float],
) -> List[HeatmapCell]:
    matrix: Dict[Tuple[float, int], List[OptimizationResultRow]] = {}
    for row in rows:
        key = (row.leverage, row.grids)
        matrix.setdefault(key, []).append(row)

    cells: List[HeatmapCell] = []
    for (leverage, grids), grouped_rows in matrix.items():
        candidates = [item for item in grouped_rows if item.passes_constraints] or grouped_rows
        scores: List[float] = []
        for item in candidates:
            score = primary_score(item)
            if math.isfinite(score):
                scores.append(score)
        avg_score = (sum(scores) / len(scores)) if scores else float("-inf")
        best_row = max(candidates, key=primary_score)
        cells.append(
            HeatmapCell(
                leverage=leverage,
                grids=grids,
                value=avg_score,
                use_base_position=best_row.use_base_position,
                base_grid_count=best_row.base_grid_count,
                initial_position_size=best_row.initial_position_size,
                anchor_price=best_row.anchor_price,
                lower_price=best_row.lower_price,
                upper_price=best_row.upper_price,
                stop_price=best_row.stop_price,
            )
        )
    return sorted(cells, key=lambda cell: (cell.leverage, cell.grids))
