from __future__ import annotations

from app.core.schemas import GridSide, StrategyConfig
from app.services.risk_limit import (
    estimate_initial_avg_entry_and_liquidation_price,
    estimate_max_possible_loss_at_stop,
    violates_stop_loss_liquidation_guard,
)


def _strategy(side: GridSide, stop_loss: float) -> StrategyConfig:
    return StrategyConfig(
        side=side,
        lower=65000,
        upper=71000,
        grids=6,
        leverage=15,
        margin=1000,
        stop_loss=stop_loss,
        use_base_position=True,
        reopen_after_stop=False,
        fee_rate=0.0,
        maker_fee_rate=0.0,
        taker_fee_rate=0.0,
        slippage=0.0,
        maintenance_margin_rate=0.005,
        funding_rate_per_8h=0.0,
        funding_interval_hours=8,
        use_mark_price_for_liquidation=False,
        price_tick_size=0.0,
        quantity_step_size=0.0,
        min_notional=0.0,
        max_allowed_loss_usdt=None,
    )


def _loss_from_avg_for_short(entries: list[float], order_notional: float, stop: float) -> float:
    quantities = [order_notional / e for e in entries]
    total_qty = sum(quantities)
    avg_entry = sum(e * q for e, q in zip(entries, quantities)) / total_qty
    return max(0.0, (stop - avg_entry) * total_qty)


def _loss_from_avg_for_long(entries: list[float], order_notional: float, stop: float) -> float:
    quantities = [order_notional / e for e in entries]
    total_qty = sum(quantities)
    avg_entry = sum(e * q for e, q in zip(entries, quantities)) / total_qty
    return max(0.0, (avg_entry - stop) * total_qty)


def test_max_possible_loss_short_matches_avg_entry_path_with_base_plus_adverse_grids() -> None:
    strategy = _strategy(GridSide.SHORT, stop_loss=72000)
    initial_price = 70200.0

    # 6 grids / short / initial=70200:
    # base=5 grids at initial close, plus one adverse open at 71000 before stop.
    entries = [initial_price, initial_price, initial_price, initial_price, initial_price, 71000.0]
    order_notional = strategy.margin * strategy.leverage / strategy.grids

    estimated = estimate_max_possible_loss_at_stop(strategy, initial_price=initial_price)
    expected = _loss_from_avg_for_short(entries, order_notional, strategy.stop_loss)
    assert abs(estimated - expected) < 1e-9


def test_max_possible_loss_long_matches_avg_entry_path_with_base_plus_adverse_grids() -> None:
    strategy = _strategy(GridSide.LONG, stop_loss=64000)
    initial_price = 65800.0

    # 6 grids / long / initial=65800:
    # base=5 grids at initial close, plus one adverse open at 65000 before stop.
    entries = [initial_price, initial_price, initial_price, initial_price, initial_price, 65000.0]
    order_notional = strategy.margin * strategy.leverage / strategy.grids

    estimated = estimate_max_possible_loss_at_stop(strategy, initial_price=initial_price)
    expected = _loss_from_avg_for_long(entries, order_notional, strategy.stop_loss)
    assert abs(estimated - expected) < 1e-9


def test_estimated_liquidation_guard_short() -> None:
    strategy = _strategy(GridSide.SHORT, stop_loss=72000)
    initial_price = 70200.0
    _, liq = estimate_initial_avg_entry_and_liquidation_price(strategy, initial_price=initial_price)
    assert liq is not None and liq > strategy.stop_loss
    violated, _, estimated = violates_stop_loss_liquidation_guard(strategy, initial_price=initial_price)
    assert not violated
    assert estimated is not None


def test_estimated_liquidation_guard_short_violation() -> None:
    strategy = _strategy(GridSide.SHORT, stop_loss=120000.0)
    initial_price = 70200.0
    violated, _, estimated = violates_stop_loss_liquidation_guard(strategy, initial_price=initial_price)
    assert violated
    assert estimated is not None and estimated < strategy.stop_loss


def test_estimated_liquidation_uses_base_plus_adverse_grid_average_for_short() -> None:
    strategy = _strategy(GridSide.SHORT, stop_loss=72000.0)
    strategy.use_base_position = True
    initial_price = 70200.0

    avg_entry, estimated_liq = estimate_initial_avg_entry_and_liquidation_price(
        strategy,
        initial_price=initial_price,
    )
    assert avg_entry is not None and estimated_liq is not None

    # base=5 grids at initial close, plus one adverse open at 71000
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    entries = [initial_price, initial_price, initial_price, initial_price, initial_price, 71000.0]
    quantities = [order_notional / e for e in entries]
    total_qty = sum(quantities)
    expected_avg = sum(e * q for e, q in zip(entries, quantities)) / total_qty
    expected_notional = expected_avg * total_qty
    expected_maintenance = strategy.maintenance_margin_rate * expected_notional
    expected_buffer = strategy.margin - expected_maintenance
    expected_liq = expected_avg * (1.0 + expected_buffer / expected_notional)

    assert abs(avg_entry - expected_avg) < 1e-9
    assert abs(estimated_liq - expected_liq) < 1e-9


def test_estimated_liquidation_without_base_includes_unused_margin_buffer() -> None:
    strategy = _strategy(GridSide.SHORT, stop_loss=72000.0)
    strategy.use_base_position = False
    initial_price = 70200.0

    avg_entry, estimated_liq = estimate_initial_avg_entry_and_liquidation_price(
        strategy,
        initial_price=initial_price,
    )
    assert avg_entry is not None and estimated_liq is not None

    # Without base position at 70200, only one adverse short grid opens at 71000.
    # Remaining unused margin must still contribute to liquidation buffer.
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    expected_avg = 71000.0
    expected_notional = order_notional
    expected_maintenance = strategy.maintenance_margin_rate * expected_notional
    expected_buffer = strategy.margin - expected_maintenance
    expected_liq = expected_avg * (1.0 + expected_buffer / expected_notional)

    assert abs(avg_entry - expected_avg) < 1e-9
    assert abs(estimated_liq - expected_liq) < 1e-9
    # The liquidation boundary should be far above stop due to large unused margin buffer.
    assert estimated_liq > strategy.stop_loss
