from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.schemas import Candle, GridSide, StrategyConfig
from app.services.backtest_engine import run_backtest, run_backtest_for_optimization


def _mk_candle(ts: datetime, o: float, h: float, l: float, c: float) -> Candle:
    return Candle(timestamp=ts, open=o, high=h, low=l, close=c, volume=100)


def test_long_grid_generates_profitable_rounds() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 105, 106, 99, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 101, 89, 90),
        _mk_candle(t0 + timedelta(hours=2), 90, 111, 89, 110),
        _mk_candle(t0 + timedelta(hours=3), 110, 112, 109, 111),
    ]

    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=3,
        margin=1000,
        stop_loss=80,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    assert result.summary.total_closed_trades >= 2
    assert result.summary.full_grid_profit_count >= 1
    assert result.summary.total_return_usdt > 0
    assert result.summary.status == "completed"


def test_stop_loss_terminates_when_reopen_disabled() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 105, 106, 99, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 101, 89, 90),
        _mk_candle(t0 + timedelta(hours=2), 90, 95, 82, 84),
        _mk_candle(t0 + timedelta(hours=3), 84, 120, 84, 119),
    ]

    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=3,
        margin=1000,
        stop_loss=85,
        reopen_after_stop=False,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    assert result.summary.stop_loss_count == 1
    assert result.summary.status == "stopped_by_stop_loss"
    assert any(trade.close_reason == "stop_loss" for trade in result.trades)


def test_short_position_opened_intrabar_can_stop_out_same_candle() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 700, 730, 695, 705),
        _mk_candle(t0 + timedelta(hours=1), 705, 706, 700, 701),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=650,
        upper=710,
        grids=6,
        leverage=5,
        margin=1000,
        stop_loss=712,
        reopen_after_stop=False,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    assert result.summary.stop_loss_count == 1
    assert result.summary.status == "stopped_by_stop_loss"
    assert result.summary.total_closed_trades > 0
    assert all(trade.close_reason == "stop_loss" for trade in result.trades)
    assert all(trade.open_time == candles[0].timestamp for trade in result.trades)
    assert all(trade.close_time == candles[0].timestamp for trade in result.trades)


def _base_test_strategy(side: GridSide, use_base_position: bool) -> StrategyConfig:
    stop_loss = 80 if side == GridSide.LONG else 120
    return StrategyConfig(
        side=side,
        lower=90,
        upper=110,
        grids=4,
        leverage=4,
        margin=1000,
        stop_loss=stop_loss,
        use_base_position=use_base_position,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )


def _two_candles(first_close: float) -> list[Candle]:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        _mk_candle(t0, first_close, first_close + 0.5, first_close - 0.5, first_close),
        _mk_candle(t0 + timedelta(hours=1), first_close, first_close + 0.5, first_close - 0.5, first_close),
    ]


def test_base_position_long_node_counts() -> None:
    strategy = _base_test_strategy(GridSide.LONG, use_base_position=True)

    mid = run_backtest(_two_candles(103), strategy)
    near_lower = run_backtest(_two_candles(91), strategy)
    near_upper = run_backtest(_two_candles(109), strategy)

    assert mid.summary.base_grid_count == 0
    assert near_lower.summary.base_grid_count == 2
    assert near_upper.summary.base_grid_count == 0

    assert mid.summary.initial_position_size == 0
    assert near_lower.summary.initial_position_size == 2000
    assert near_upper.summary.initial_position_size == 0


def test_base_position_short_node_counts() -> None:
    strategy = _base_test_strategy(GridSide.SHORT, use_base_position=True)

    mid = run_backtest(_two_candles(103), strategy)
    near_lower = run_backtest(_two_candles(91), strategy)
    near_upper = run_backtest(_two_candles(109), strategy)

    assert mid.summary.base_grid_count == 1
    assert near_lower.summary.base_grid_count == 0
    assert near_upper.summary.base_grid_count == 2

    assert mid.summary.initial_position_size == 1000
    assert near_lower.summary.initial_position_size == 0
    assert near_upper.summary.initial_position_size == 2000


def test_base_position_enabled_vs_disabled_changes_result() -> None:
    candles = _two_candles(91)
    with_base = run_backtest(candles, _base_test_strategy(GridSide.LONG, use_base_position=True))
    without_base = run_backtest(candles, _base_test_strategy(GridSide.LONG, use_base_position=False))

    assert with_base.summary.use_base_position is True
    assert without_base.summary.use_base_position is False
    assert with_base.summary.base_grid_count > 0
    assert without_base.summary.base_grid_count == 0
    assert with_base.summary.initial_position_size > 0
    assert without_base.summary.initial_position_size == 0
    assert with_base.summary.fees_paid > without_base.summary.fees_paid


def test_base_position_case_65000_71000_12grids_67200() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 67200, 67220, 67180, 67200),
        _mk_candle(t0 + timedelta(hours=1), 67200, 67220, 67180, 67200),
    ]

    long_strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=65000,
        upper=71000,
        grids=12,
        leverage=5,
        margin=1000,
        stop_loss=64000,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )
    short_strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=12,
        leverage=5,
        margin=1000,
        stop_loss=72000,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    long_result = run_backtest(candles, long_strategy)
    short_result = run_backtest(candles, short_strategy)

    assert long_result.summary.base_grid_count == 6
    assert short_result.summary.base_grid_count == 3


def test_base_position_uses_first_candle_close_price_for_grid_count() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 70200, 70300, 69950, 70000),  # open=70200, close=70000
        _mk_candle(t0 + timedelta(hours=1), 70000, 70020, 69980, 70000),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=15,
        margin=1000,
        stop_loss=72000,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)
    assert result.summary.base_grid_count == 4
    assert result.summary.initial_position_size == 10000


def test_base_position_entries_use_first_candle_close_price() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 70200, 70300, 69950, 70000),  # open=70200, close=70000
        _mk_candle(t0 + timedelta(hours=1), 70000, 70050, 65000, 65500),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=15,
        margin=1000,
        stop_loss=72000,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)
    seed_trades = [trade for trade in result.trades if trade.open_time == t0 and trade.entry_price == 70000.0]
    assert len(seed_trades) >= 4
    seed_exits = {trade.exit_price for trade in seed_trades}
    assert {69000.0, 68000.0, 67000.0, 66000.0}.issubset(seed_exits)


def test_optimization_eval_matches_full_backtest_summary() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 70200, 70300, 69950, 70000),
        _mk_candle(t0 + timedelta(hours=1), 70000, 70050, 65000, 65500),
        _mk_candle(t0 + timedelta(hours=2), 65500, 69800, 65400, 69400),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=15,
        margin=1000,
        stop_loss=72000,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    full = run_backtest(candles, strategy)
    compact = run_backtest_for_optimization(candles, strategy)

    assert abs(compact.summary["total_return_usdt"] - full.summary.total_return_usdt) < 1e-9
    assert abs(compact.summary["max_drawdown_pct"] - full.summary.max_drawdown_pct) < 1e-9
    assert abs(compact.summary["win_rate"] - full.summary.win_rate) < 1e-9
    assert int(compact.summary["total_closed_trades"]) == full.summary.total_closed_trades
    assert len(compact.equity_values) == len(full.equity_curve)
    assert all(abs(compact.equity_values[i] - full.equity_curve[i].value) < 1e-9 for i in range(len(compact.equity_values)))


def test_optimization_eval_matches_full_backtest_summary_long_side() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 105, 106, 99, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 101, 89, 90),
        _mk_candle(t0 + timedelta(hours=2), 90, 111, 89, 110),
        _mk_candle(t0 + timedelta(hours=3), 110, 112, 109, 111),
    ]
    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=3,
        margin=1000,
        stop_loss=80,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    full = run_backtest(candles, strategy)
    compact = run_backtest_for_optimization(candles, strategy)

    assert abs(compact.summary["total_return_usdt"] - full.summary.total_return_usdt) < 1e-9
    assert abs(compact.summary["max_drawdown_pct"] - full.summary.max_drawdown_pct) < 1e-9
    assert abs(compact.summary["win_rate"] - full.summary.win_rate) < 1e-9
    assert int(compact.summary["total_closed_trades"]) == full.summary.total_closed_trades
    assert len(compact.equity_values) == len(full.equity_curve)
    assert all(abs(compact.equity_values[i] - full.equity_curve[i].value) < 1e-9 for i in range(len(compact.equity_values)))


def test_dynamic_funding_rates_are_applied_to_total_return() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 100, 100, 90, 95),
        _mk_candle(t0 + timedelta(hours=1), 95, 96, 94, 95),
    ]

    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=2,
        margin=1000,
        stop_loss=80,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    no_funding = run_backtest(candles, strategy)
    with_funding = run_backtest(
        candles,
        strategy,
        funding_rates=[(t0 + timedelta(hours=1), 0.01)],
    )

    assert with_funding.summary.funding_paid > 0
    assert with_funding.summary.total_return_usdt < no_funding.summary.total_return_usdt


def test_annualized_return_is_disabled_for_consistency() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 105, 106, 99, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 101, 89, 90),
        _mk_candle(t0 + timedelta(hours=2), 90, 111, 89, 110),
        _mk_candle(t0 + timedelta(hours=3), 110, 112, 109, 111),
    ]
    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=3,
        margin=1000,
        stop_loss=80,
        reopen_after_stop=True,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)
    assert result.summary.annualized_return_pct is None
