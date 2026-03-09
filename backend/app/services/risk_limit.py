from __future__ import annotations

from math import floor
from typing import List, Optional, Tuple

from app.core.schemas import GridSide, StrategyConfig
from app.services.grid_logic import build_grid_nodes, derive_base_position_grid_indices


def _round_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    scaled = round(value / step)
    return float(scaled * step)


def _floor_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    scaled = floor((value / step) + 1e-12)
    return float(scaled * step)


def _entry_fee_rate(strategy: StrategyConfig, as_base_position: bool = False) -> float:
    if as_base_position:
        return float(strategy.taker_fee_rate if strategy.taker_fee_rate is not None else strategy.fee_rate)
    return float(strategy.maker_fee_rate if strategy.maker_fee_rate is not None else strategy.fee_rate)


def _stop_close_fee_rate(strategy: StrategyConfig) -> float:
    return float(strategy.taker_fee_rate if strategy.taker_fee_rate is not None else strategy.fee_rate)


def _apply_open_slippage(side: GridSide, level: float, slippage: float) -> float:
    if side == GridSide.LONG:
        return level * (1.0 + slippage)
    return level * (1.0 - slippage)


def _apply_close_slippage(side: GridSide, level: float, slippage: float) -> float:
    if side == GridSide.LONG:
        return level * (1.0 - slippage)
    return level * (1.0 + slippage)

def _collect_worst_case_entries(
    strategy: StrategyConfig,
    current_price: float,
    nodes: List[float],
    eps: float,
) -> List[Tuple[bool, float, int]]:
    # Each tuple: (is_base_position, raw_entry_level, grid_index)
    entries: List[Tuple[bool, float, int]] = []
    seen_indices: set[int] = set()

    base_indices = derive_base_position_grid_indices(strategy, current_price=current_price, nodes=nodes, eps=eps)
    for grid_index in base_indices:
        if grid_index in seen_indices:
            continue
        seen_indices.add(grid_index)
        entries.append((True, current_price, grid_index))

    if strategy.side == GridSide.LONG:
        for grid_index in range(strategy.grids):
            if grid_index in seen_indices:
                continue
            open_level = nodes[grid_index]
            if open_level < current_price - eps:
                seen_indices.add(grid_index)
                entries.append((False, open_level, grid_index))
    else:
        for grid_index in range(strategy.grids):
            if grid_index in seen_indices:
                continue
            open_level = nodes[grid_index + 1]
            if open_level > current_price + eps:
                seen_indices.add(grid_index)
                entries.append((False, open_level, grid_index))

    return entries


def _materialize_worst_case_legs(
    strategy: StrategyConfig,
    *,
    initial_price: float,
) -> List[Tuple[float, float, float]]:
    """
    Return worst-case open legs before stop:
    (entry_price, quantity, entry_fee).
    """
    if strategy.grids <= 0 or strategy.margin <= 0 or strategy.leverage <= 0:
        return []
    if initial_price <= 0:
        return []

    order_notional = (strategy.margin * strategy.leverage) / strategy.grids
    if order_notional <= 0:
        return []
    if order_notional < strategy.min_notional:
        return []

    grid_size = (strategy.upper - strategy.lower) / strategy.grids
    if grid_size <= 0:
        return []
    nodes, eps = build_grid_nodes(strategy.lower, strategy.upper, strategy.grids)

    raw_entries = _collect_worst_case_entries(strategy, current_price=initial_price, nodes=nodes, eps=eps)
    if not raw_entries:
        return []

    legs: List[Tuple[float, float, float]] = []
    for is_base, raw_entry_level, _ in raw_entries:
        entry_price = _apply_open_slippage(strategy.side, raw_entry_level, strategy.slippage)
        entry_price = _round_to_step(entry_price, strategy.price_tick_size)
        if entry_price <= 0:
            continue

        quantity = order_notional / entry_price
        quantity = _floor_to_step(quantity, strategy.quantity_step_size)
        if quantity <= 0:
            continue

        entry_notional = abs(entry_price * quantity)
        if entry_notional < strategy.min_notional:
            continue

        entry_fee = entry_notional * _entry_fee_rate(strategy, as_base_position=is_base)
        legs.append((entry_price, quantity, entry_fee))

    return legs


def estimate_initial_avg_entry_and_liquidation_price(
    strategy: StrategyConfig,
    *,
    initial_price: float,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Estimate average entry and liquidation boundary based on base-position +
    adverse pre-stop opened grids at initialization anchor.
    """
    legs = _materialize_worst_case_legs(strategy, initial_price=initial_price)
    if not legs:
        return None, None

    total_qty = sum(quantity for _, quantity, _ in legs)
    if total_qty <= 0:
        return None, None

    avg_entry = sum(entry_price * quantity for entry_price, quantity, _ in legs) / total_qty
    if avg_entry <= 0:
        return None, None

    total_notional = total_qty * avg_entry
    if total_notional <= 0:
        return avg_entry, None

    total_entry_fees = sum(entry_fee for _, _, entry_fee in legs)
    effective_margin = max(strategy.margin - total_entry_fees, 0.0)
    maintenance_margin = strategy.maintenance_margin_rate * total_notional
    margin_buffer = max(effective_margin - maintenance_margin, 0.0)

    if strategy.side == GridSide.LONG:
        liquidation_price = avg_entry * (1.0 - (margin_buffer / total_notional))
    else:
        liquidation_price = avg_entry * (1.0 + (margin_buffer / total_notional))

    if liquidation_price <= 0:
        return avg_entry, None
    return avg_entry, liquidation_price


def violates_stop_loss_liquidation_guard(
    strategy: StrategyConfig,
    *,
    initial_price: float,
) -> tuple[bool, Optional[float], Optional[float]]:
    avg_entry, estimated_liq = estimate_initial_avg_entry_and_liquidation_price(
        strategy,
        initial_price=initial_price,
    )
    if estimated_liq is None:
        return False, avg_entry, estimated_liq

    if strategy.side == GridSide.SHORT:
        violated = not (strategy.upper < strategy.stop_loss < estimated_liq)
    else:
        violated = not (estimated_liq < strategy.stop_loss < strategy.lower)

    return violated, avg_entry, estimated_liq


def estimate_max_possible_loss_at_stop(
    strategy: StrategyConfig,
    *,
    initial_price: float,
) -> float:
    """
    Estimate worst-case realized loss if price moves adversely from initial_price
    and strategy exits all open positions at stop_loss.

    This is a deterministic "risk cap" estimator and does not alter execution logic.
    """
    legs = _materialize_worst_case_legs(strategy, initial_price=initial_price)
    if not legs:
        return 0.0

    stop_exit_price = _apply_close_slippage(strategy.side, strategy.stop_loss, strategy.slippage)
    stop_exit_price = _round_to_step(stop_exit_price, strategy.price_tick_size)
    if stop_exit_price <= 0:
        stop_exit_price = max(strategy.stop_loss, 1e-9)

    close_fee_rate = _stop_close_fee_rate(strategy)
    total_net_pnl = 0.0

    for entry_price, quantity, entry_fee in legs:
        close_notional = abs(stop_exit_price * quantity)
        close_fee = close_notional * close_fee_rate

        if strategy.side == GridSide.LONG:
            gross = (stop_exit_price - entry_price) * quantity
        else:
            gross = (entry_price - stop_exit_price) * quantity

        total_net_pnl += gross - entry_fee - close_fee

    return float(max(0.0, -total_net_pnl))


def violates_max_loss_limit(strategy: StrategyConfig, *, initial_price: float) -> tuple[bool, float]:
    max_loss = estimate_max_possible_loss_at_stop(strategy, initial_price=initial_price)
    cap = strategy.max_allowed_loss_usdt
    if cap is None:
        return False, max_loss
    return max_loss > (cap + 1e-9), max_loss
