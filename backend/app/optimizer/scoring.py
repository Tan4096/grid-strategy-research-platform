from __future__ import annotations

import ast
import math
from functools import lru_cache
from typing import Dict, List, Optional, Sequence

import numpy as np

from app.core.optimization_schemas import OptimizationTarget
from app.core.schemas import CurvePoint, Interval


INTERVALS_PER_YEAR = {
    Interval.M1.value: 365 * 24 * 60,
    Interval.M3.value: 365 * 24 * 20,
    Interval.M5.value: 365 * 24 * 12,
    Interval.M15.value: 365 * 24 * 4,
    Interval.M30.value: 365 * 24 * 2,
    Interval.H1.value: 365 * 24,
    Interval.H2.value: 365 * 12,
    Interval.H4.value: 365 * 6,
    Interval.H6.value: 365 * 4,
    Interval.H8.value: 365 * 3,
    Interval.H12.value: 365 * 2,
    Interval.D1.value: 365,
}


def _pct_returns(equity_curve: List[CurvePoint]) -> List[float]:
    returns: List[float] = []
    if len(equity_curve) < 2:
        return returns

    prev = equity_curve[0].value
    for point in equity_curve[1:]:
        if prev > 0:
            returns.append((point.value - prev) / prev)
        prev = point.value
    return returns


def compute_sharpe_ratio(equity_curve: List[CurvePoint], interval_value: str) -> float:
    return compute_sharpe_ratio_from_values([point.value for point in equity_curve], interval_value)


def compute_sharpe_ratio_from_values(equity_values: Sequence[float], interval_value: str) -> float:
    if len(equity_values) < 3:
        return 0.0

    values = np.asarray(equity_values, dtype=np.float64)
    prev = values[:-1]
    curr = values[1:]
    valid = prev > 0.0
    if not np.any(valid):
        return 0.0

    returns = (curr[valid] - prev[valid]) / prev[valid]
    if returns.size < 2:
        return 0.0

    mean_r = float(np.mean(returns))
    std_r = float(np.std(returns, ddof=1))
    if std_r < 1e-12:
        return 0.0

    annual_factor = INTERVALS_PER_YEAR.get(interval_value, 365 * 24)
    return (mean_r / std_r) * math.sqrt(annual_factor)


def compute_return_drawdown_ratio(total_return_usdt: float, max_drawdown_pct: float) -> float:
    drawdown = max(max_drawdown_pct, 1e-6)
    return total_return_usdt / drawdown


_ALLOWED_NODE_TYPES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.Mod,
    ast.USub,
    ast.UAdd,
    ast.FloorDiv,
)

_ALLOWED_FUNCTIONS = {
    "abs": abs,
    "max": max,
    "min": min,
    "pow": pow,
}


def _validate_custom_ast(node: ast.AST) -> None:
    for child in ast.walk(node):
        if not isinstance(child, _ALLOWED_NODE_TYPES):
            raise ValueError(f"unsupported syntax in custom score: {type(child).__name__}")
        if isinstance(child, ast.Call):
            if not isinstance(child.func, ast.Name) or child.func.id not in _ALLOWED_FUNCTIONS:
                raise ValueError("custom score only allows calls to abs/min/max/pow")


@lru_cache(maxsize=64)
def _compile_custom_score_expr(expr: str):
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:  # pragma: no cover
        raise ValueError(f"invalid custom score expression: {exc}") from exc

    _validate_custom_ast(tree)
    return compile(tree, filename="<custom_score>", mode="eval")


def evaluate_custom_score(expr: str, variables: Dict[str, float]) -> float:
    compiled = _compile_custom_score_expr(expr)

    result = eval(  # noqa: S307 - validated AST and restricted globals
        compiled,
        {"__builtins__": {}, **_ALLOWED_FUNCTIONS},
        variables,
    )
    return float(result)


def compute_score(target: OptimizationTarget, custom_expr: Optional[str], metrics: Dict[str, float]) -> float:
    if target == OptimizationTarget.TOTAL_RETURN:
        return metrics["total_return_usdt"]
    if target == OptimizationTarget.SHARPE:
        return metrics["sharpe_ratio"]
    if target == OptimizationTarget.MIN_DRAWDOWN:
        return -metrics["max_drawdown_pct"]
    if target == OptimizationTarget.RETURN_DRAWDOWN_RATIO:
        return metrics["return_drawdown_ratio"]
    if target == OptimizationTarget.CUSTOM:
        if not custom_expr:
            raise ValueError("custom target requires custom score expression")
        return evaluate_custom_score(custom_expr, metrics)
    raise ValueError(f"unsupported optimization target: {target}")
