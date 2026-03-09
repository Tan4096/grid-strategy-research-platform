from __future__ import annotations

import math
from typing import List, Optional, Tuple

from app.core.optimization_schemas import OptimizationConfig, OptimizationResultRow


def safe_score(value: Optional[float], default: float = float("-inf")) -> float:
    if value is None:
        return default
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(numeric):
        return default
    return numeric


def primary_score(row: OptimizationResultRow) -> float:
    return safe_score(row.robust_score, safe_score(row.score))


def compute_robust_score(
    train_score: float,
    validation_score: Optional[float],
    validation_weight: float,
    gap_penalty: float,
) -> Tuple[float, Optional[float]]:
    train_value = safe_score(train_score)
    if validation_score is None:
        return train_value, None

    validation_value = safe_score(validation_score)
    if validation_value == float("-inf"):
        return train_value, None

    weight = min(max(float(validation_weight), 0.0), 1.0)
    blended = (weight * validation_value) + ((1.0 - weight) * train_value)
    overfit_penalty = abs(train_value - validation_value)
    robust = blended - (overfit_penalty * float(gap_penalty))
    return robust, overfit_penalty


def apply_constraints(row: OptimizationResultRow, optimization: OptimizationConfig) -> None:
    violations: List[str] = []

    if row.total_closed_trades < optimization.min_closed_trades:
        violations.append(f"train_trades<{optimization.min_closed_trades}")
    if (
        row.validation_total_closed_trades is not None
        and row.validation_total_closed_trades < optimization.min_closed_trades
    ):
        violations.append(f"validation_trades<{optimization.min_closed_trades}")

    if (
        optimization.max_drawdown_pct_limit is not None
        and row.max_drawdown_pct > optimization.max_drawdown_pct_limit
    ):
        violations.append(f"train_drawdown>{optimization.max_drawdown_pct_limit}")
    if (
        optimization.max_drawdown_pct_limit is not None
        and row.validation_max_drawdown_pct is not None
        and row.validation_max_drawdown_pct > optimization.max_drawdown_pct_limit
    ):
        violations.append(f"validation_drawdown>{optimization.max_drawdown_pct_limit}")

    if optimization.require_positive_return and row.total_return_usdt <= 0:
        violations.append("train_return<=0")
    if (
        optimization.require_positive_return
        and row.validation_total_return_usdt is not None
        and row.validation_total_return_usdt <= 0
    ):
        violations.append("validation_return<=0")

    if (
        optimization.max_allowed_loss_usdt is not None
        and row.max_possible_loss_usdt > optimization.max_allowed_loss_usdt
    ):
        violations.append(f"max_possible_loss>{optimization.max_allowed_loss_usdt}")

    row.constraint_violations = violations
    row.passes_constraints = len(violations) == 0
