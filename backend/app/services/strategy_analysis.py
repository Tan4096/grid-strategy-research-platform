from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.schemas import BacktestSummary, GridSide, StrategyAnalysis, StrategyConfig


@dataclass(frozen=True)
class StrategyAnalysisInput:
    total_return: float
    max_drawdown_pct: float
    win_rate: float
    train_score: Optional[float]
    validation_score: Optional[float]
    leverage: float
    grids: int
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


def build_strategy_analysis_input(
    *,
    summary: BacktestSummary,
    strategy: StrategyConfig,
    train_score: Optional[float] = None,
    validation_score: Optional[float] = None,
) -> StrategyAnalysisInput:
    return StrategyAnalysisInput(
        total_return=float(summary.total_return_usdt),
        max_drawdown_pct=float(summary.max_drawdown_pct),
        win_rate=float(summary.win_rate),
        train_score=train_score,
        validation_score=validation_score,
        leverage=float(strategy.leverage),
        grids=int(strategy.grids),
        use_base_position=bool(summary.use_base_position),
        base_position_grids=int(summary.base_grid_count),
        stop_loss_pct=_stop_loss_pct(strategy),
        interval_width_pct=_interval_width_pct(strategy),
        trade_count=int(summary.total_closed_trades),
    )


def _risk_level(data: StrategyAnalysisInput) -> str:
    if data.leverage >= 20 or data.max_drawdown_pct > 35:
        return "high"
    if data.leverage >= 12 or data.max_drawdown_pct > 20:
        return "medium"
    return "low"


def _overfitting_metrics(data: StrategyAnalysisInput) -> tuple[bool, float]:
    if data.train_score is None or data.validation_score is None:
        return False, 0.0

    train_score = float(data.train_score)
    validation_score = float(data.validation_score)
    baseline = max(abs(train_score), 1e-6)
    degradation_pct = max(0.0, (train_score - validation_score) / baseline * 100.0)
    overfitting = validation_score < (train_score * 0.8)
    return overfitting, degradation_pct


def _structure_dependency(data: StrategyAnalysisInput, overfitting: bool) -> str:
    if overfitting:
        return "trend_sensitive"
    if data.interval_width_pct < 6 and data.trade_count > 20:
        return "range"
    return "mixed"


def _liquidation_risk(data: StrategyAnalysisInput) -> str:
    base_ratio = (data.base_position_grids / max(data.grids, 1)) if data.use_base_position else 0.0

    if (
        data.leverage >= 20
        or data.max_drawdown_pct > 35
        or (data.leverage >= 15 and base_ratio >= 0.5)
        or (data.max_drawdown_pct > 25 and base_ratio >= 0.4)
    ):
        return "high"

    if data.leverage >= 12 or data.max_drawdown_pct > 20 or base_ratio >= 0.35:
        return "medium"

    return "low"


def _stability_score(data: StrategyAnalysisInput) -> float:
    if data.train_score is None or data.validation_score is None:
        return 0.5
    score = 1.0 - abs(float(data.train_score) - float(data.validation_score)) / max(abs(float(data.train_score)), 1e-6)
    return _clamp(score, 0.0, 1.0)


def analyze_strategy(data: StrategyAnalysisInput) -> StrategyAnalysis:
    overfitting_flag, validation_degradation_pct = _overfitting_metrics(data)
    risk_level = _risk_level(data)
    structure_dependency = _structure_dependency(data, overfitting_flag)
    liquidation_risk = _liquidation_risk(data)
    stability_score = _stability_score(data)
    base_ratio = (data.base_position_grids / max(data.grids, 1)) if data.use_base_position else 0.0

    diagnosis_tags: list[str] = []
    if data.leverage >= 12:
        diagnosis_tags.append("high_leverage")
    if structure_dependency == "range":
        diagnosis_tags.append("range_dependent")
    if structure_dependency == "trend_sensitive":
        diagnosis_tags.append("trend_sensitive")
    if overfitting_flag:
        diagnosis_tags.append("validation_drop")
    if data.max_drawdown_pct > 20:
        diagnosis_tags.append("high_drawdown")
    if liquidation_risk == "high":
        diagnosis_tags.append("high_liquidation_risk")
    if data.use_base_position and base_ratio >= 0.5:
        diagnosis_tags.append("base_position_heavy")
    if data.stop_loss_pct < 0.8:
        diagnosis_tags.append("tight_stop_loss")
    if data.total_return < 0:
        diagnosis_tags.append("negative_return")

    return StrategyAnalysis(
        risk_level=risk_level,
        structure_dependency=structure_dependency,
        overfitting_flag=overfitting_flag,
        validation_degradation_pct=validation_degradation_pct,
        liquidation_risk=liquidation_risk,
        stability_score=stability_score,
        diagnosis_tags=diagnosis_tags,
        ai_explanation=None,
    )

