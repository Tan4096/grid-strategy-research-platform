from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

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

    assert mid.summary.base_grid_count == 1
    assert near_lower.summary.base_grid_count == 3
    assert near_upper.summary.base_grid_count == 0

    assert mid.summary.initial_position_size == 1000
    assert near_lower.summary.initial_position_size == 3000
    assert near_upper.summary.initial_position_size == 0


def test_base_position_short_node_counts() -> None:
    strategy = _base_test_strategy(GridSide.SHORT, use_base_position=True)

    mid = run_backtest(_two_candles(103), strategy)
    near_lower = run_backtest(_two_candles(91), strategy)
    near_upper = run_backtest(_two_candles(109), strategy)

    assert mid.summary.base_grid_count == 2
    assert near_lower.summary.base_grid_count == 0
    assert near_upper.summary.base_grid_count == 3

    assert mid.summary.initial_position_size == 2000
    assert near_lower.summary.initial_position_size == 0
    assert near_upper.summary.initial_position_size == 3000


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

    assert long_result.summary.base_grid_count == 7
    assert short_result.summary.base_grid_count == 4


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
    assert result.summary.base_grid_count == 5
    assert result.summary.initial_position_size == 12500


def test_pending_margin_blocks_unplaced_upper_short_grid_from_filling() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 85, 85.5, 84.5, 85),
        _mk_candle(t0 + timedelta(hours=1), 85, 100, 85, 100),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=60,
        upper=100,
        grids=4,
        leverage=1,
        margin=100,
        stop_loss=110,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.01,
        maker_fee_rate=0.01,
        taker_fee_rate=0.01,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    opened_grid_indices = [
        int(event.payload["grid_index"])
        for event in result.events
        if event.event_type == "open" and event.payload and not bool(event.payload.get("as_base_position"))
    ]
    assert opened_grid_indices == [2]
    assert all(grid_index != 3 for grid_index in opened_grid_indices)


def test_order_placed_event_records_when_pending_short_order_is_hung() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 75, 75.5, 74.5, 75),
        _mk_candle(t0 + timedelta(hours=1), 75, 85, 74, 84),
        _mk_candle(t0 + timedelta(hours=2), 84, 91, 83, 90),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=60,
        upper=90,
        grids=3,
        leverage=5,
        margin=100,
        stop_loss=100,
        use_base_position=False,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    placed_events = [event for event in result.events if event.event_type == "order_placed"]
    assert [(event.payload or {}).get("grid_index") for event in placed_events] == [1, 2]
    assert [event.price for event in placed_events] == [80.0, 90.0]
    assert all(event.timestamp == t0 for event in placed_events)

    open_events = [event for event in result.events if event.event_type == "open"]
    assert [(event.payload or {}).get("grid_index") for event in open_events] == [1, 2]


def test_unrealized_pnl_curve_tracks_open_position_mark_to_market() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 100, 100.5, 99.5, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 106, 104, 105),
    ]

    strategy = StrategyConfig(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=1,
        margin=100,
        stop_loss=80,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    assert [point.timestamp for point in result.unrealized_pnl_curve] == [t0, t0 + timedelta(hours=1)]
    assert [point.value for point in result.unrealized_pnl_curve] == pytest.approx([0.0, 2.5])


def test_short_grid_opens_upper_boundary_when_touched_even_after_adverse_floating_loss() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 70, 70.5, 69.5, 70),
        _mk_candle(t0 + timedelta(hours=1), 70, 85, 69, 85),
        _mk_candle(t0 + timedelta(hours=2), 85, 90, 84, 90),
        _mk_candle(t0 + timedelta(hours=3), 90, 90, 60, 60),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=60,
        upper=90,
        grids=3,
        leverage=3,
        margin=100,
        stop_loss=100,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)

    upper_grid_open_events = [
        event
        for event in result.events
        if event.event_type == "open" and event.payload and event.payload.get("grid_index") == 2
    ]
    assert len(upper_grid_open_events) == 1
    assert upper_grid_open_events[0].price == 90.0

    upper_grid_trades = [trade for trade in result.trades if trade.entry_price == 90.0]
    assert len(upper_grid_trades) == 1
    assert upper_grid_trades[0].exit_price == 80.0
    assert result.summary.total_closed_trades == 3


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
    assert len(seed_trades) >= 5
    seed_exits = {trade.exit_price for trade in seed_trades}
    assert {69000.0, 68000.0, 67000.0, 66000.0, 65000.0}.issubset(seed_exits)


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
    assert with_funding.summary.funding_net < 0
    assert with_funding.summary.funding_statement_amount > 0
    funding_event = next(event for event in with_funding.events if event.event_type == "funding")
    assert funding_event.payload is not None
    assert funding_event.payload["funding_pnl"] > 0
    assert with_funding.summary.total_return_usdt == pytest.approx(
        no_funding.summary.total_return_usdt - with_funding.summary.funding_statement_amount
    )
    assert with_funding.summary.total_return_usdt < no_funding.summary.total_return_usdt


def test_short_grid_receives_positive_funding_as_net_income() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 100, 110, 100, 105),
        _mk_candle(t0 + timedelta(hours=1), 105, 106, 104, 105),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=90,
        upper=110,
        grids=2,
        leverage=2,
        margin=1000,
        stop_loss=120,
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

    assert with_funding.summary.funding_paid == 0
    assert with_funding.summary.funding_net > 0
    assert with_funding.summary.funding_statement_amount < 0
    funding_event = next(event for event in with_funding.events if event.event_type == "funding")
    assert funding_event.payload is not None
    assert funding_event.payload["funding_pnl"] < 0
    assert with_funding.summary.total_return_usdt == pytest.approx(
        no_funding.summary.total_return_usdt - with_funding.summary.funding_statement_amount
    )
    assert with_funding.summary.total_return_usdt > no_funding.summary.total_return_usdt


def test_funding_event_uses_real_funding_timestamp_boundary() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    funding_ts = t0 + timedelta(milliseconds=3)
    candles = [
        _mk_candle(t0, 100, 110, 100, 105),
        _mk_candle(t0 + timedelta(minutes=15), 105, 106, 104, 105),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=90,
        upper=110,
        grids=2,
        leverage=2,
        margin=1000,
        stop_loss=120,
        use_base_position=True,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy, funding_rates=[(funding_ts, 0.01)])

    funding_event = next(event for event in result.events if event.event_type == "funding")
    assert funding_event.timestamp == funding_ts
    assert funding_event.price == 100
    assert funding_event.payload is not None
    assert funding_event.payload["funding_time"] == funding_ts.isoformat()
    assert funding_event.payload["position_notional"] == pytest.approx(952.3809523809524)


def test_funding_uses_boundary_position_snapshot_instead_of_later_candle_positions() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    funding_ts = t0 + timedelta(milliseconds=3)
    candles = [
        _mk_candle(t0, 95, 101, 94, 100),
        _mk_candle(t0 + timedelta(minutes=15), 100, 101, 99, 100),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=90,
        upper=110,
        grids=2,
        leverage=2,
        margin=1000,
        stop_loss=120,
        use_base_position=False,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    full = run_backtest(candles, strategy, funding_rates=[(funding_ts, 0.01)])
    compact = run_backtest_for_optimization(candles, strategy, funding_rates=[(funding_ts, 0.01)])

    assert full.summary.funding_net == 0
    assert full.summary.funding_statement_amount == 0
    assert [event for event in full.events if event.event_type == "funding"] == []
    assert compact.summary["total_return_usdt"] == pytest.approx(full.summary.total_return_usdt)


def test_short_grid_funding_matches_optimization_path() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 100, 110, 100, 105),
        _mk_candle(t0 + timedelta(hours=1), 105, 106, 104, 105),
    ]

    strategy = StrategyConfig(
        side=GridSide.SHORT,
        lower=90,
        upper=110,
        grids=2,
        leverage=2,
        margin=1000,
        stop_loss=120,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
    )

    funding_rates = [(t0 + timedelta(hours=1), 0.01)]
    full = run_backtest(candles, strategy, funding_rates=funding_rates)
    compact = run_backtest_for_optimization(candles, strategy, funding_rates=funding_rates)

    assert abs(compact.summary["total_return_usdt"] - full.summary.total_return_usdt) < 1e-9
    assert full.summary.funding_net > 0


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


def test_leverage_sensitivity_depends_on_quantity_step_size() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    closes = [70000, 69500, 69000, 68500, 68000, 67500, 67000, 66500, 67000, 67500, 68000]
    candles: list[Candle] = []
    for idx, close in enumerate(closes):
        ts = t0 + timedelta(hours=idx)
        open_price = closes[idx - 1] if idx > 0 else close
        candles.append(
            _mk_candle(
                ts,
                open_price,
                max(open_price, close) + 120,
                min(open_price, close) - 120,
                close,
            )
        )

    base = dict(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        margin=1000,
        stop_loss=72000,
        reopen_after_stop=False,
        fee_rate=0.0004,
        slippage=0.0,
        maintenance_margin_rate=0.005,
        price_tick_size=0.0,
        min_notional=0.0,
    )

    coarse_13 = run_backtest(candles, StrategyConfig(leverage=13, quantity_step_size=0.01, **base))
    coarse_14 = run_backtest(candles, StrategyConfig(leverage=14, quantity_step_size=0.01, **base))
    assert coarse_13.summary.total_return_usdt == coarse_14.summary.total_return_usdt

    fine_13 = run_backtest(candles, StrategyConfig(leverage=13, quantity_step_size=0.001, **base))
    fine_14 = run_backtest(candles, StrategyConfig(leverage=14, quantity_step_size=0.001, **base))
    assert fine_13.summary.total_return_usdt != fine_14.summary.total_return_usdt


def test_core_parameters_show_effect_when_market_is_active() -> None:
    t0 = datetime(2026, 2, 1, tzinfo=timezone.utc)
    closes = [
        70000,
        69500,
        69000,
        68500,
        68000,
        67500,
        67000,
        66500,
        66000,
        65500,
        65000,
        65500,
        66000,
        67000,
        68000,
        69000,
        70000,
        71000,
        72000,
        71000,
        70000,
        69000,
    ]
    candles: list[Candle] = []
    for idx, close in enumerate(closes):
        ts = t0 + timedelta(hours=idx)
        open_price = closes[idx - 1] if idx > 0 else close
        candles.append(
            _mk_candle(
                ts,
                open_price,
                max(open_price, close) + 250,
                min(open_price, close) - 250,
                close,
            )
        )

    base = dict(
        side=GridSide.SHORT,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=13,
        margin=1000,
        stop_loss=72200,
        use_base_position=True,
        reopen_after_stop=False,
        fee_rate=0.0004,
        maker_fee_rate=0.0002,
        taker_fee_rate=0.0004,
        slippage=0.0002,
        maintenance_margin_rate=0.005,
        funding_rate_per_8h=0.0001,
        funding_interval_hours=8,
        use_mark_price_for_liquidation=False,
        price_tick_size=0.1,
        quantity_step_size=0.001,
        min_notional=5.0,
    )

    baseline = run_backtest(candles, StrategyConfig(**base))
    baseline_tuple = (
        round(baseline.summary.total_return_usdt, 6),
        baseline.summary.total_closed_trades,
        baseline.summary.stop_loss_count,
        baseline.summary.liquidation_count,
        round(baseline.summary.fees_paid, 6),
    )

    variants = [
        dict(leverage=14),
        dict(margin=1100),
        dict(grids=7),
        dict(lower=64500),
        dict(upper=71500),
        dict(stop_loss=72500),
        dict(use_base_position=False),
        dict(reopen_after_stop=True),
    ]

    for override in variants:
        params = {**base, **override}
        result = run_backtest(candles, StrategyConfig(**params))
        changed_tuple = (
            round(result.summary.total_return_usdt, 6),
            result.summary.total_closed_trades,
            result.summary.stop_loss_count,
            result.summary.liquidation_count,
            round(result.summary.fees_paid, 6),
        )
        assert changed_tuple != baseline_tuple, f"override={override} produced no observable effect"


def test_transaction_cost_and_precision_parameters_show_effect() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 105, 106, 99, 100),
        _mk_candle(t0 + timedelta(hours=1), 100, 101, 89, 90),
        _mk_candle(t0 + timedelta(hours=2), 90, 111, 89, 110),
        _mk_candle(t0 + timedelta(hours=3), 110, 112, 109, 111),
    ]

    base = dict(
        side=GridSide.LONG,
        lower=90,
        upper=110,
        grids=2,
        leverage=3,
        margin=1000,
        stop_loss=80,
        reopen_after_stop=True,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
        price_tick_size=0.1,
        quantity_step_size=0.0001,
        min_notional=5.0,
    )

    baseline = run_backtest(candles, StrategyConfig(**base))
    assert baseline.summary.total_closed_trades > 0

    high_fee = run_backtest(
        candles,
        StrategyConfig(**{**base, "fee_rate": 0.001, "maker_fee_rate": 0.001, "taker_fee_rate": 0.001}),
    )
    assert high_fee.summary.total_return_usdt != baseline.summary.total_return_usdt
    assert high_fee.summary.fees_paid > baseline.summary.fees_paid

    high_slippage = run_backtest(candles, StrategyConfig(**{**base, "slippage": 0.002}))
    assert high_slippage.summary.total_return_usdt != baseline.summary.total_return_usdt

    coarse_tick = run_backtest(candles, StrategyConfig(**{**base, "price_tick_size": 7.0}))
    assert coarse_tick.summary.total_return_usdt != baseline.summary.total_return_usdt

    blocked_by_min_notional = run_backtest(candles, StrategyConfig(**{**base, "min_notional": 50_000}))
    assert blocked_by_min_notional.summary.total_closed_trades == 0
    assert blocked_by_min_notional.summary.total_return_usdt == 0


def test_summary_exposes_max_possible_loss_metric() -> None:
    t0 = datetime(2026, 2, 10, tzinfo=timezone.utc)
    candles = [
        _mk_candle(t0, 70200, 70300, 69950, 70000),
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
        slippage=0.0002,
        maintenance_margin_rate=0.005,
    )

    result = run_backtest(candles, strategy)
    assert result.summary.max_possible_loss_usdt > 0
