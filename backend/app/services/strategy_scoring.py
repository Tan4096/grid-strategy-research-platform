from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.schemas import BacktestSummary, CurvePoint, GridSide, StrategyConfig, StrategyScoring
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_sharpe_ratio


@dataclass(frozen=True)
class StrategyScoringInput:
    total_return: float
    max_drawdown_pct: float
    sharpe_ratio: float
    return_drawdown_ratio: float
    train_score: Optional[float]
    validation_score: Optional[float]
    leverage: float
    grid_count: int
    use_base_position: bool
    base_position_grids: int
    stop_loss_pct: float
    interval_width_pct: float
    trade_count: int


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _stop_loss_pct(strategy: StrategyConfig) -> float:
    if strategy.side == GridSide.SHORT:
        if strategy.upper <= 0:
            return 0.0
        return max(0.0, (strategy.stop_loss - strategy.upper) / strategy.upper * 100.0)
    if strategy.lower <= 0:
        return 0.0
    return max(0.0, (strategy.lower - strategy.stop_loss) / strategy.lower * 100.0)


def _interval_width_pct(strategy: StrategyConfig) -> float:
    mid = (strategy.upper + strategy.lower) / 2.0
    if mid <= 0:
        return 0.0
    return max(0.0, (strategy.upper - strategy.lower) / mid * 100.0)


def build_strategy_scoring_input(
    *,
    summary: BacktestSummary,
    strategy: StrategyConfig,
    equity_curve: list[CurvePoint],
    interval_value: str,
    train_score: Optional[float] = None,
    validation_score: Optional[float] = None,
) -> StrategyScoringInput:
    total_return = float(summary.total_return_usdt)
    max_drawdown_pct = float(summary.max_drawdown_pct)
    sharpe_ratio = float(compute_sharpe_ratio(equity_curve, interval_value))
    return_drawdown_ratio = float(compute_return_drawdown_ratio(total_return, max_drawdown_pct))

    return StrategyScoringInput(
        total_return=total_return,
        max_drawdown_pct=max_drawdown_pct,
        sharpe_ratio=sharpe_ratio,
        return_drawdown_ratio=return_drawdown_ratio,
        train_score=train_score,
        validation_score=validation_score,
        leverage=float(strategy.leverage),
        grid_count=int(strategy.grids),
        use_base_position=bool(summary.use_base_position),
        base_position_grids=int(summary.base_grid_count),
        stop_loss_pct=_stop_loss_pct(strategy),
        interval_width_pct=_interval_width_pct(strategy),
        trade_count=int(summary.total_closed_trades),
    )


def _profit_score(data: StrategyScoringInput) -> tuple[float, list[str]]:
    rdd = data.return_drawdown_ratio
    reasons: list[str] = []
    if rdd < 1:
        score = 20.0
        reasons.append("收益回撤比 < 1（基础分 20）")
    elif rdd < 2:
        score = 40.0
        reasons.append("收益回撤比 1~2（基础分 40）")
    elif rdd < 3:
        score = 60.0
        reasons.append("收益回撤比 2~3（基础分 60）")
    elif rdd < 5:
        score = 80.0
        reasons.append("收益回撤比 3~5（基础分 80）")
    else:
        score = 95.0
        reasons.append("收益回撤比 >= 5（基础分 95）")

    sharpe = data.sharpe_ratio
    if sharpe < 0:
        score -= 30.0
        reasons.append("Sharpe < 0（-30）")
    elif sharpe > 3:
        score += 5.0
        reasons.append("Sharpe > 3（+5）")

    return _clamp(score, 0.0, 100.0), reasons


def _risk_score(data: StrategyScoringInput) -> tuple[float, list[str]]:
    dd = data.max_drawdown_pct
    reasons: list[str] = []

    if dd < 10:
        score = 90.0
        reasons.append("最大回撤 < 10%（基础分 90）")
    elif dd < 20:
        score = 70.0
        reasons.append("最大回撤 10%~20%（基础分 70）")
    elif dd < 30:
        score = 50.0
        reasons.append("最大回撤 20%~30%（基础分 50）")
    elif dd < 40:
        score = 30.0
        reasons.append("最大回撤 30%~40%（基础分 30）")
    else:
        score = 10.0
        reasons.append("最大回撤 >= 40%（基础分 10）")

    if data.leverage > 20:
        score -= 30.0
        reasons.append("杠杆 > 20（-30）")
    elif data.leverage > 15:
        score -= 15.0
        reasons.append("杠杆 > 15（-15）")

    base_ratio = (data.base_position_grids / max(data.grid_count, 1)) if data.use_base_position else 0.0
    if base_ratio > 0.8:
        score -= 15.0
        reasons.append("底仓占比 > 80%（-15）")

    return _clamp(score, 0.0, 100.0), reasons


def _stability_score(data: StrategyScoringInput) -> tuple[float, list[str]]:
    reasons: list[str] = []

    if data.train_score is None or data.validation_score is None:
        reasons.append("缺少训练/验证评分，使用中性分 60")
        return 60.0, reasons

    train = float(data.train_score)
    validation = float(data.validation_score)
    degradation = (train - validation) / max(train, 1e-6)

    if degradation < 0.10:
        score = 90.0
        reasons.append("训练-验证退化 < 10%（90）")
    elif degradation < 0.20:
        score = 70.0
        reasons.append("训练-验证退化 10%~20%（70）")
    elif degradation < 0.40:
        score = 50.0
        reasons.append("训练-验证退化 20%~40%（50）")
    else:
        score = 20.0
        reasons.append("训练-验证退化 > 40%（20）")

    if validation < 0:
        score -= 30.0
        reasons.append("验证评分 < 0（-30）")

    return _clamp(score, 0.0, 100.0), reasons


def _robustness_score(data: StrategyScoringInput) -> tuple[float, list[str]]:
    trade_count = data.trade_count
    reasons: list[str] = []
    if trade_count < 5:
        reasons.append("交易次数 < 5（20）")
        return 20.0, reasons
    if trade_count < 10:
        reasons.append("交易次数 5~10（50）")
        return 50.0, reasons
    if trade_count < 15:
        reasons.append("交易次数 10~15（70）")
        return 70.0, reasons
    reasons.append("交易次数 >= 15（85）")
    return 85.0, reasons


def _behavior_score(data: StrategyScoringInput) -> tuple[float, list[str]]:
    score = 80.0
    reasons: list[str] = []

    if data.stop_loss_pct < 0.5:
        score -= 10.0
        reasons.append("止损比例 < 0.5%（-10）")
    if data.interval_width_pct < 4:
        score -= 15.0
        reasons.append("区间宽度 < 4%（-15）")
    if data.leverage > 20:
        score -= 20.0
        reasons.append("杠杆 > 20（-20）")

    if not reasons:
        reasons.append("行为参数健康（基础分 80）")

    return _clamp(score, 0.0, 100.0), reasons


def _grade(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "E"


def score_strategy(data: StrategyScoringInput) -> StrategyScoring:
    profit_score, profit_reasons = _profit_score(data)
    risk_score, risk_reasons = _risk_score(data)
    stability_score, stability_reasons = _stability_score(data)
    robustness_score, robustness_reasons = _robustness_score(data)
    behavior_score, behavior_reasons = _behavior_score(data)

    final_score = (
        0.30 * profit_score
        + 0.25 * risk_score
        + 0.20 * stability_score
        + 0.15 * robustness_score
        + 0.10 * behavior_score
    )
    final_score = _clamp(final_score, 0.0, 100.0)

    return StrategyScoring(
        profit_score=profit_score,
        risk_score=risk_score,
        stability_score=stability_score,
        robustness_score=robustness_score,
        behavior_score=behavior_score,
        final_score=final_score,
        grade=_grade(final_score),
        profit_reasons=profit_reasons,
        risk_reasons=risk_reasons,
        stability_reasons=stability_reasons,
        robustness_reasons=robustness_reasons,
        behavior_reasons=behavior_reasons,
    )

