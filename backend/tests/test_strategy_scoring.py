from __future__ import annotations

from app.services.strategy_scoring import StrategyScoringInput, score_strategy


def _base_input() -> StrategyScoringInput:
    return StrategyScoringInput(
        total_return=500.0,
        max_drawdown_pct=8.0,
        sharpe_ratio=2.2,
        return_drawdown_ratio=4.0,
        train_score=10.0,
        validation_score=9.2,
        leverage=8.0,
        grid_count=10,
        use_base_position=False,
        base_position_grids=0,
        stop_loss_pct=1.2,
        interval_width_pct=8.0,
        trade_count=20,
    )


def test_scoring_grade_a_path() -> None:
    data = _base_input()
    result = score_strategy(data)

    assert result.profit_score == 80.0
    assert result.risk_score == 90.0
    assert result.stability_score == 90.0
    assert result.robustness_score == 85.0
    assert result.behavior_score == 80.0
    assert result.grade == "A"
    assert result.final_score >= 85.0


def test_risk_penalties_for_leverage_and_base_ratio() -> None:
    data = _base_input()
    data = StrategyScoringInput(
        **{**data.__dict__, "max_drawdown_pct": 25.0, "leverage": 16.0, "use_base_position": True, "base_position_grids": 9}
    )
    result = score_strategy(data)

    # drawdown 25 -> 50, leverage > 15 -> -15, base ratio 0.9 -> -15
    assert result.risk_score == 20.0
    assert any("杠杆 > 15" in reason for reason in result.risk_reasons)
    assert any("底仓占比 > 80%" in reason for reason in result.risk_reasons)


def test_behavior_penalties_stack() -> None:
    data = _base_input()
    data = StrategyScoringInput(
        **{**data.__dict__, "leverage": 25.0, "stop_loss_pct": 0.3, "interval_width_pct": 3.0}
    )
    result = score_strategy(data)

    # base 80 - 10 - 15 - 20
    assert result.behavior_score == 35.0
    assert len(result.behavior_reasons) == 3


def test_stability_negative_validation_clamped() -> None:
    data = _base_input()
    data = StrategyScoringInput(**{**data.__dict__, "train_score": 10.0, "validation_score": -1.0})
    result = score_strategy(data)

    # degradation > 40% => 20, validation < 0 => -30 => clamp to 0
    assert result.stability_score == 0.0
    assert any("验证评分 < 0" in reason for reason in result.stability_reasons)

