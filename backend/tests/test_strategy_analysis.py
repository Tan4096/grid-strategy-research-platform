from __future__ import annotations

from app.services.strategy_analysis import StrategyAnalysisInput, analyze_strategy


def test_risk_level_high_by_leverage() -> None:
    result = analyze_strategy(
        StrategyAnalysisInput(
            total_return=100,
            max_drawdown_pct=10,
            win_rate=0.6,
            train_score=None,
            validation_score=None,
            leverage=20,
            grids=10,
            use_base_position=False,
            base_position_grids=0,
            stop_loss_pct=1.5,
            interval_width_pct=8,
            trade_count=10,
        )
    )
    assert result.risk_level == "high"
    assert result.ai_explanation is None


def test_structure_range_dependency() -> None:
    result = analyze_strategy(
        StrategyAnalysisInput(
            total_return=100,
            max_drawdown_pct=8,
            win_rate=0.62,
            train_score=None,
            validation_score=None,
            leverage=6,
            grids=12,
            use_base_position=False,
            base_position_grids=0,
            stop_loss_pct=1.2,
            interval_width_pct=5.5,
            trade_count=26,
        )
    )
    assert result.structure_dependency == "range"
    assert "range_dependent" in result.diagnosis_tags


def test_overfitting_and_validation_degradation() -> None:
    result = analyze_strategy(
        StrategyAnalysisInput(
            total_return=100,
            max_drawdown_pct=14,
            win_rate=0.5,
            train_score=10.0,
            validation_score=6.0,
            leverage=8,
            grids=8,
            use_base_position=True,
            base_position_grids=4,
            stop_loss_pct=0.5,
            interval_width_pct=10.0,
            trade_count=18,
        )
    )
    assert result.overfitting_flag is True
    assert result.structure_dependency == "trend_sensitive"
    assert abs(result.validation_degradation_pct - 40.0) < 1e-9
    assert "validation_drop" in result.diagnosis_tags
    assert "tight_stop_loss" in result.diagnosis_tags


def test_liquidation_risk_high_for_heavy_base_position() -> None:
    result = analyze_strategy(
        StrategyAnalysisInput(
            total_return=-50,
            max_drawdown_pct=22,
            win_rate=0.4,
            train_score=8.0,
            validation_score=8.0,
            leverage=15,
            grids=6,
            use_base_position=True,
            base_position_grids=4,
            stop_loss_pct=1.5,
            interval_width_pct=9,
            trade_count=20,
        )
    )
    assert result.liquidation_risk == "high"
    assert "high_liquidation_risk" in result.diagnosis_tags
    assert "base_position_heavy" in result.diagnosis_tags
    assert "negative_return" in result.diagnosis_tags

