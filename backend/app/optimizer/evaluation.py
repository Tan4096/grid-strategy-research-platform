from __future__ import annotations

from typing import Optional

from app.core.optimization_schemas import OptimizationTarget
from app.core.schemas import Candle, StrategyConfig
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_score, compute_sharpe_ratio_from_values
from app.services.backtest_engine import run_backtest_for_optimization


def evaluate_strategy_compact(
    *,
    candles: list[Candle],
    strategy: StrategyConfig,
    interval_value: str,
    target: OptimizationTarget,
    custom_score_expr: Optional[str],
    skip_sharpe: bool = False,
) -> dict:
    try:
        result = run_backtest_for_optimization(candles=candles, strategy=strategy)
        need_sharpe = (not skip_sharpe) or target in (OptimizationTarget.SHARPE, OptimizationTarget.CUSTOM)
        sharpe = compute_sharpe_ratio_from_values(result.equity_values, interval_value) if need_sharpe else 0.0
        total_return = float(result.summary["total_return_usdt"])
        max_drawdown = float(result.summary["max_drawdown_pct"])
        win_rate = float(result.summary["win_rate"])
        total_closed_trades = float(result.summary["total_closed_trades"])
        return_drawdown_ratio = compute_return_drawdown_ratio(total_return, max_drawdown)

        metrics = {
            "total_return_usdt": total_return,
            "max_drawdown_pct": max_drawdown,
            "sharpe_ratio": sharpe,
            "win_rate": win_rate,
            "return_drawdown_ratio": return_drawdown_ratio,
            "total_closed_trades": total_closed_trades,
        }
        score = compute_score(target, custom_score_expr, metrics)

        return {
            "ok": True,
            "summary": {
                "total_return_usdt": total_return,
                "max_drawdown_pct": max_drawdown,
                "win_rate": win_rate,
                "total_closed_trades": total_closed_trades,
            },
            "sharpe_ratio": sharpe,
            "return_drawdown_ratio": return_drawdown_ratio,
            "score": score,
            "equity_values_count": len(result.equity_values),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "summary": None,
            "sharpe_ratio": 0.0,
            "return_drawdown_ratio": 0.0,
            "score": float("-inf"),
            "equity_values_count": 0,
        }


def evaluate_combo_compact(
    *,
    candles: list[Candle],
    combo: dict,
    interval_value: str,
    target: OptimizationTarget,
    custom_score_expr: Optional[str],
    skip_sharpe: bool = False,
) -> dict:
    strategy = StrategyConfig.model_validate(combo["strategy"])
    payload = evaluate_strategy_compact(
        candles=candles,
        strategy=strategy,
        interval_value=interval_value,
        target=target,
        custom_score_expr=custom_score_expr,
        skip_sharpe=skip_sharpe,
    )
    payload["row_id"] = int(combo["row_id"])
    return payload
