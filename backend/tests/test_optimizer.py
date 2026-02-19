from __future__ import annotations

from datetime import datetime, timezone

from app.core.optimization_schemas import (
    AnchorMode,
    OptimizationConfig,
    OptimizationMode,
    OptimizationResultRow,
    OptimizationTarget,
)
from app.core.schemas import Candle, CurvePoint, GridSide, StrategyConfig
from app.optimizer.optimizer import (
    _apply_constraints,
    _build_combinations,
    _compute_robust_score,
    _derive_base_position_info,
    _limit_combinations,
    _resolve_anchor_price,
)
from app.optimizer.scoring import compute_score, compute_sharpe_ratio, compute_sharpe_ratio_from_values


def test_build_combinations_count() -> None:
    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=10,
        margin=1000,
        stop_loss=71200,
        reopen_after_stop=False,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )
    cfg = OptimizationConfig(
        leverage={"enabled": True, "start": 5, "end": 6, "step": 1},
        grids={"enabled": True, "start": 4, "end": 5, "step": 1},
        band_width_pct={"enabled": True, "values": [5, 10]},
        stop_loss_ratio_pct={"enabled": True, "values": [0.5]},
        target=OptimizationTarget.TOTAL_RETURN,
        walk_forward_enabled=False,
    )

    combos = _build_combinations(strategy, cfg, reference_price=68000, initial_price=68000)
    assert len(combos) == 2 * 2 * 2 * 1


def test_score_custom_expression() -> None:
    metrics = {
        "total_return_usdt": 150.0,
        "max_drawdown_pct": 5.0,
        "sharpe_ratio": 1.2,
        "win_rate": 0.55,
        "return_drawdown_ratio": 30.0,
        "total_closed_trades": 42.0,
    }

    score = compute_score(OptimizationTarget.CUSTOM, "total_return_usdt / max(max_drawdown_pct, 1)", metrics)
    assert score == 30.0


def test_optimization_config_allows_large_combination_limit() -> None:
    cfg = OptimizationConfig(
        max_combinations=20_000,
        max_workers=8,
        batch_size=600,
        chunk_size=128,
    )
    assert cfg.max_combinations == 20_000
    assert cfg.max_trials == 20_000
    assert cfg.batch_size == 600
    assert cfg.chunk_size == 128


def test_optimization_config_defaults_to_random_pruned_mode() -> None:
    cfg = OptimizationConfig()
    assert cfg.optimization_mode == OptimizationMode.RANDOM_PRUNED
    assert cfg.max_trials == 2_000


def test_sharpe_ratio_positive_on_monotonic_growth() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    curve = [
        CurvePoint(timestamp=t0, value=1000),
        CurvePoint(timestamp=t0, value=1010),
        CurvePoint(timestamp=t0, value=1022),
        CurvePoint(timestamp=t0, value=1035),
    ]
    sharpe = compute_sharpe_ratio(curve, "1h")
    assert sharpe > 0


def test_sharpe_ratio_from_values_matches_curve_input() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    curve = [
        CurvePoint(timestamp=t0, value=1000),
        CurvePoint(timestamp=t0, value=1010),
        CurvePoint(timestamp=t0, value=1022),
        CurvePoint(timestamp=t0, value=1035),
    ]
    from_curve = compute_sharpe_ratio(curve, "1h")
    from_values = compute_sharpe_ratio_from_values([point.value for point in curve], "1h")
    assert abs(from_curve - from_values) < 1e-12


def _sample_candles() -> list[Candle]:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        Candle(timestamp=t0, open=99.0, high=101.0, low=98.0, close=100.0, volume=1.0),
        Candle(timestamp=t0, open=109.0, high=111.0, low=108.0, close=110.0, volume=1.0),
        Candle(timestamp=t0, open=119.0, high=121.0, low=118.0, close=120.0, volume=1.0),
    ]


def _base_strategy(side: GridSide) -> StrategyConfig:
    stop_loss = 71200 if side == GridSide.SHORT else 62000
    return StrategyConfig(
        side=side,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=10,
        margin=1000,
        stop_loss=stop_loss,
        reopen_after_stop=False,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )


def test_resolve_anchor_price_modes() -> None:
    candles = _sample_candles()

    cfg_start = OptimizationConfig(anchor_mode=AnchorMode.BACKTEST_START_PRICE)
    assert _resolve_anchor_price(candles, cfg_start) == 100.0

    cfg_avg = OptimizationConfig(anchor_mode=AnchorMode.BACKTEST_AVG_PRICE)
    assert _resolve_anchor_price(candles, cfg_avg) == 110.0

    cfg_current = OptimizationConfig(anchor_mode=AnchorMode.CURRENT_PRICE)
    assert _resolve_anchor_price(candles, cfg_current) == 120.0

    cfg_custom = OptimizationConfig(anchor_mode=AnchorMode.CUSTOM_PRICE, custom_anchor_price=12345.6789)
    assert _resolve_anchor_price(candles, cfg_custom) == 12345.68


def test_short_price_generation_with_two_decimals() -> None:
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [5]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [2]},
        walk_forward_enabled=False,
    )
    combos = _build_combinations(_base_strategy(GridSide.SHORT), cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 1

    meta = combos[0]["meta"]
    assert meta["anchor_price"] == 100.0
    assert meta["lower_price"] == 90.0
    assert meta["upper_price"] == 110.0
    assert meta["stop_price"] == 112.2
    assert meta["range_lower"] == meta["lower_price"]
    assert meta["range_upper"] == meta["upper_price"]
    assert meta["stop_loss"] == meta["stop_price"]


def test_long_price_generation_with_two_decimals() -> None:
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [5]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [2]},
        walk_forward_enabled=False,
    )
    combos = _build_combinations(_base_strategy(GridSide.LONG), cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 1

    meta = combos[0]["meta"]
    assert meta["anchor_price"] == 100.0
    assert meta["lower_price"] == 90.0
    assert meta["upper_price"] == 110.0
    assert meta["stop_price"] == 88.2


def test_optimize_base_position_doubles_combination_count() -> None:
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [5]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [2]},
        optimize_base_position=True,
        walk_forward_enabled=False,
    )
    combos = _build_combinations(_base_strategy(GridSide.LONG), cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 2
    assert {bool(c["meta"]["use_base_position"]) for c in combos} == {False, True}


def test_base_position_count_formula_case_65000_71000_12grids_67200() -> None:
    long_base = _base_strategy(GridSide.LONG).model_copy(
        update={"lower": 65000, "upper": 71000, "grids": 12, "use_base_position": True}
    )
    short_base = _base_strategy(GridSide.SHORT).model_copy(
        update={"lower": 65000, "upper": 71000, "grids": 12, "use_base_position": True}
    )

    long_count, _ = _derive_base_position_info(long_base, current_price=67200)
    short_count, _ = _derive_base_position_info(short_base, current_price=67200)

    assert long_count == 6
    assert short_count == 3


def test_build_combinations_uses_initial_close_price_for_base_position_meta() -> None:
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [5]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": False},
        stop_loss_ratio_pct={"enabled": False},
        optimize_base_position=False,
        walk_forward_enabled=False,
    )

    short_base = _base_strategy(GridSide.SHORT).model_copy(
        update={"lower": 65000, "upper": 71000, "grids": 6, "use_base_position": True}
    )

    combos = _build_combinations(short_base, cfg, reference_price=68000, initial_price=70000)
    assert combos[0]["meta"]["base_grid_count"] == 4
    assert abs(combos[0]["meta"]["initial_position_size"] - 3333.3333333333335) < 1e-9


def test_compute_robust_score_uses_validation_weight_and_gap_penalty() -> None:
    robust_score, overfit_penalty = _compute_robust_score(
        train_score=100.0,
        validation_score=80.0,
        validation_weight=0.7,
        gap_penalty=0.2,
    )

    assert robust_score == 82.0
    assert overfit_penalty == 20.0


def test_apply_constraints_marks_row_as_failed() -> None:
    row = OptimizationResultRow(
        row_id=1,
        leverage=8.0,
        grids=6,
        use_base_position=True,
        base_grid_count=4,
        initial_position_size=10000.0,
        anchor_price=70000.0,
        lower_price=65000.0,
        upper_price=71000.0,
        stop_price=71200.0,
        band_width_pct=7.0,
        range_lower=65000.0,
        range_upper=71000.0,
        stop_loss=71200.0,
        stop_loss_ratio_pct=1.0,
        total_return_usdt=-12.0,
        max_drawdown_pct=18.0,
        sharpe_ratio=-0.5,
        win_rate=0.4,
        return_drawdown_ratio=-0.6,
        score=-0.6,
        validation_total_return_usdt=-5.0,
        validation_max_drawdown_pct=12.0,
        validation_sharpe_ratio=-0.2,
        validation_win_rate=0.3,
        validation_return_drawdown_ratio=-0.4,
        validation_score=-0.4,
        validation_total_closed_trades=1,
        total_closed_trades=2,
    )
    cfg = OptimizationConfig(
        min_closed_trades=3,
        max_drawdown_pct_limit=10.0,
        require_positive_return=True,
    )

    _apply_constraints(row, cfg)

    assert row.passes_constraints is False
    assert "train_trades<3" in row.constraint_violations
    assert "validation_trades<3" in row.constraint_violations
    assert "train_drawdown>10.0" in row.constraint_violations
    assert "validation_drawdown>10.0" in row.constraint_violations
    assert "train_return<=0" in row.constraint_violations
    assert "validation_return<=0" in row.constraint_violations


def test_limit_combinations_samples_and_renumbers() -> None:
    strategy = _base_strategy(GridSide.SHORT)
    cfg = OptimizationConfig(
        leverage={"enabled": True, "start": 5, "end": 12, "step": 1},
        grids={"enabled": True, "start": 4, "end": 12, "step": 1},
        band_width_pct={"enabled": True, "start": 5, "end": 10, "step": 1},
        stop_loss_ratio_pct={"enabled": True, "start": 0.5, "end": 2.0, "step": 0.5},
    )
    combos = _build_combinations(strategy, cfg, reference_price=68000, initial_price=68000)
    assert len(combos) > 500

    sampled = _limit_combinations(combos, max_count=500)
    assert len(sampled) == 500
    assert sampled[0]["row_id"] == 1
    assert sampled[-1]["row_id"] == 500


def test_stop_loss_violating_liquidation_boundary_is_rejected_for_short() -> None:
    short_strategy = _base_strategy(GridSide.SHORT).model_copy(
        update={
            "lower": 90.0,
            "upper": 110.0,
            "grids": 6,
            "leverage": 25.0,
            "margin": 1000.0,
            "fee_rate": 0.0004,
            "slippage": 0.0,
            "maintenance_margin_rate": 0.005,
            "use_base_position": False,
        }
    )
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [25]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [5]},
        walk_forward_enabled=False,
    )

    combos = _build_combinations(short_strategy, cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 0


def test_stop_loss_within_liquidation_boundary_is_kept_for_short() -> None:
    short_strategy = _base_strategy(GridSide.SHORT).model_copy(
        update={
            "lower": 90.0,
            "upper": 110.0,
            "grids": 6,
            "leverage": 25.0,
            "margin": 1000.0,
            "fee_rate": 0.0004,
            "slippage": 0.0,
            "maintenance_margin_rate": 0.005,
            "use_base_position": False,
        }
    )
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [25]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [4]},
        walk_forward_enabled=False,
    )

    combos = _build_combinations(short_strategy, cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 1
    meta = combos[0]["meta"]
    assert meta["upper_price"] == 110.0
    assert meta["stop_price"] == 114.4


def test_stop_loss_violating_liquidation_boundary_is_rejected_for_long() -> None:
    long_strategy = _base_strategy(GridSide.LONG).model_copy(
        update={
            "lower": 90.0,
            "upper": 110.0,
            "grids": 6,
            "leverage": 25.0,
            "margin": 1000.0,
            "fee_rate": 0.0004,
            "slippage": 0.0,
            "maintenance_margin_rate": 0.005,
            "use_base_position": False,
        }
    )
    cfg = OptimizationConfig(
        leverage={"enabled": True, "values": [25]},
        grids={"enabled": True, "values": [6]},
        band_width_pct={"enabled": True, "values": [10]},
        stop_loss_ratio_pct={"enabled": True, "values": [6]},
        walk_forward_enabled=False,
    )

    combos = _build_combinations(long_strategy, cfg, reference_price=100.0, initial_price=100.0)
    assert len(combos) == 0
