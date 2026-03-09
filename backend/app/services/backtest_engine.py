from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import datetime
from math import floor, isfinite
from typing import Any, Callable, Literal, Optional

import numpy as np

from app.core.schemas import (
    BacktestResult,
    BacktestSummary,
    Candle,
    CurvePoint,
    EventLog,
    GridSide,
    StrategyConfig,
    TradeEvent,
)
from app.services.grid_logic import derive_base_position_grid_indices
from app.services.risk_limit import estimate_max_possible_loss_at_stop


@dataclass
class GridPosition:
    grid_index: int
    side: Literal["long", "short"]
    entry_price: float
    quantity: float
    entry_time: datetime
    entry_fee: float


@dataclass
class EngineState:
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    funding_paid: float = 0.0
    funding_net: float = 0.0
    stop_loss_count: int = 0
    liquidation_count: int = 0
    full_grid_profit_count: int = 0
    winning_trades: int = 0
    total_closed_trades: int = 0
    total_holding_hours: float = 0.0
    max_single_loss: float = 0.0


@dataclass
class OptimizationBacktestEvaluation:
    summary: dict[str, float]
    equity_values: list[float]


def _touched(level: float, candle: Candle) -> bool:
    return candle.low <= level <= candle.high


def _apply_open_slippage(side: GridSide, level: float, slippage: float) -> float:
    if side == GridSide.LONG:
        return level * (1.0 + slippage)
    return level * (1.0 - slippage)


def _apply_close_slippage(side: GridSide, level: float, slippage: float) -> float:
    if side == GridSide.LONG:
        return level * (1.0 - slippage)
    return level * (1.0 + slippage)


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
    # Grid limits are modeled as maker fills; base-position init behaves like market fill.
    if as_base_position:
        return float(strategy.taker_fee_rate if strategy.taker_fee_rate is not None else strategy.fee_rate)
    return float(strategy.maker_fee_rate if strategy.maker_fee_rate is not None else strategy.fee_rate)


def _exit_fee_rate(strategy: StrategyConfig, close_reason: str) -> float:
    if close_reason == "grid_take_profit":
        return float(strategy.maker_fee_rate if strategy.maker_fee_rate is not None else strategy.fee_rate)
    return float(strategy.taker_fee_rate if strategy.taker_fee_rate is not None else strategy.fee_rate)


def _unrealized_pnl(positions: dict[int, GridPosition], side: GridSide, mark_price: float) -> float:
    if side == GridSide.LONG:
        return sum((mark_price - p.entry_price) * p.quantity for p in positions.values())
    return sum((p.entry_price - mark_price) * p.quantity for p in positions.values())


def _position_market_value(mark_price: float, quantity: float) -> float:
    return abs(mark_price * quantity)


def _total_market_value(positions: dict[int, GridPosition], mark_price: float) -> float:
    return sum(_position_market_value(mark_price, p.quantity) for p in positions.values())


def _candle_window_end(candles: list[Candle], index: int) -> datetime:
    if index + 1 < len(candles):
        return candles[index + 1].timestamp
    if index > 0:
        delta = candles[index].timestamp - candles[index - 1].timestamp
        if delta.total_seconds() > 0:
            return candles[index].timestamp + delta
    return candles[index].timestamp


def _funding_statement_amount(funding_net: float) -> float:
    return -funding_net


def _total_return_usdt(
    state: EngineState,
    positions: dict[int, GridPosition],
    side: GridSide,
    mark_price: float,
) -> float:
    trading_pnl_excluding_funding = state.realized_pnl - state.funding_net
    funding_statement_amount = _funding_statement_amount(state.funding_net)
    return trading_pnl_excluding_funding + _unrealized_pnl(positions, side, mark_price) - state.fees_paid - funding_statement_amount


def _used_notional(positions: dict[int, GridPosition], mark_price: float) -> float:
    return _total_market_value(positions, mark_price)


def _equity(initial_margin: float, state: EngineState, positions: dict[int, GridPosition], side: GridSide, mark_price: float) -> float:
    return initial_margin + _total_return_usdt(state, positions, side, mark_price)


def _maintenance_margin(positions: dict[int, GridPosition], mark_price: float, mmr: float) -> float:
    return _used_notional(positions, mark_price) * mmr


def _average_entry_price(positions: dict[int, GridPosition]) -> float:
    total_qty = sum(p.quantity for p in positions.values())
    if total_qty <= 0:
        return 0.0
    return sum(p.entry_price * p.quantity for p in positions.values()) / total_qty


def _estimate_liquidation_price(
    initial_margin: float,
    state: EngineState,
    positions: dict[int, GridPosition],
    side: GridSide,
    mmr: float,
    current_price: float,
) -> Optional[float]:
    if not positions:
        return None

    def margin_gap(price: float) -> float:
        eq = _equity(initial_margin, state, positions, side, price)
        mm = _maintenance_margin(positions, price, mmr)
        return eq - mm

    if side == GridSide.LONG:
        low = 0.0
        high = max(current_price, 1.0)
        if margin_gap(low) >= 0:
            return None
        while margin_gap(high) <= 0 and high < 1_000_000_000:
            high *= 2.0
        for _ in range(80):
            mid = (low + high) / 2.0
            if margin_gap(mid) > 0:
                high = mid
            else:
                low = mid
        return high

    low = max(current_price, 1.0)
    high = low
    if margin_gap(low) <= 0:
        return low
    while margin_gap(high) > 0 and high < 1_000_000_000:
        high *= 2.0
    for _ in range(80):
        mid = (low + high) / 2.0
        if margin_gap(mid) > 0:
            low = mid
        else:
            high = mid
    return high


def initialize_base_position(
    strategy: StrategyConfig,
    nodes: list[float],
    first_candle: Candle,
    order_notional: float,
    open_position: Callable[[int, float, datetime, bool], bool],
    emit_event: Callable[[datetime, str, float, str, Optional[dict[str, Any]]], None],
) -> tuple[int, float]:
    if not strategy.use_base_position:
        return 0, 0.0

    decision_price = first_candle.close
    base_entry_price = first_candle.close
    grid_indices = derive_base_position_grid_indices(strategy, current_price=decision_price, nodes=nodes)
    opened_count = 0

    for grid_index in grid_indices:
        opened = open_position(grid_index, base_entry_price, first_candle.timestamp, True)
        if not opened:
            break
        opened_count += 1

    base_grid_count = opened_count
    initial_position_size = order_notional * base_grid_count

    if base_grid_count > 0:
        emit_event(
            first_candle.timestamp,
            event_type="base_position_init",
            price=base_entry_price,
            message=(
                "base_grid_count="
                f"{base_grid_count}, initial_position_size={initial_position_size:.4f}, decision_price={decision_price:.4f}"
            ),
            payload={
                "base_grid_count": base_grid_count,
                "initial_position_size": float(initial_position_size),
                "decision_price": float(decision_price),
            },
        )

    return base_grid_count, initial_position_size


def run_backtest(
    candles: list[Candle],
    strategy: StrategyConfig,
    funding_rates: Optional[list[tuple[datetime, float]]] = None,
) -> BacktestResult:
    if len(candles) < 2:
        raise ValueError("at least 2 candles are required for backtest")

    grid_lines = np.linspace(strategy.lower, strategy.upper, strategy.grids + 1).tolist()
    max_possible_loss_usdt = estimate_max_possible_loss_at_stop(strategy, initial_price=candles[0].close)
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    required_margin_per_order = order_notional / strategy.leverage

    state = EngineState()
    positions: dict[int, GridPosition] = {}
    trades: list[TradeEvent] = []
    events: list[EventLog] = []
    equity_curve: list[CurvePoint] = []
    drawdown_curve: list[CurvePoint] = []
    unrealized_pnl_curve: list[CurvePoint] = []
    margin_ratio_curve: list[CurvePoint] = []
    leverage_usage_curve: list[CurvePoint] = []
    liquidation_price_curve: list[CurvePoint] = []

    running_peak = strategy.margin
    min_drawdown = 0.0
    base_grid_count = 0
    initial_position_size = 0.0

    def emit_event(
        ts: datetime,
        event_type: str,
        price: float,
        message: str,
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        events.append(
            EventLog(
                timestamp=ts,
                event_type=event_type,
                price=float(price),
                message=message,
                payload=payload,
            )
        )

    def close_position(grid_index: int, raw_exit_level: float, ts: datetime, close_reason: str) -> None:
        position = positions.pop(grid_index)
        exit_price = _apply_close_slippage(strategy.side, raw_exit_level, strategy.slippage)
        exit_price = _round_to_step(exit_price, strategy.price_tick_size)
        if exit_price <= 0:
            exit_price = max(raw_exit_level, 1e-9)
        close_notional = abs(exit_price * position.quantity)
        close_fee = close_notional * _exit_fee_rate(strategy, close_reason)

        if strategy.side == GridSide.LONG:
            gross = (exit_price - position.entry_price) * position.quantity
        else:
            gross = (position.entry_price - exit_price) * position.quantity

        state.realized_pnl += gross
        state.fees_paid += close_fee

        total_fee = position.entry_fee + close_fee
        net = gross - total_fee
        if net > 0:
            state.winning_trades += 1
        if close_reason == "grid_take_profit" and net > 0:
            state.full_grid_profit_count += 1

        state.max_single_loss = min(state.max_single_loss, net)
        state.total_closed_trades += 1

        holding_hours = (ts - position.entry_time).total_seconds() / 3600.0
        state.total_holding_hours += max(0.0, holding_hours)

        trades.append(
            TradeEvent(
                open_time=position.entry_time,
                close_time=ts,
                side=position.side,
                entry_price=position.entry_price,
                exit_price=exit_price,
                quantity=position.quantity,
                gross_pnl=gross,
                net_pnl=net,
                fee_paid=total_fee,
                holding_hours=holding_hours,
                close_reason=close_reason,
            )
        )

        emit_event(
            ts,
            event_type="close",
            price=exit_price,
            message=f"grid={grid_index}, reason={close_reason}, net_pnl={net:.4f}",
            payload={
                "grid_index": int(grid_index),
                "close_reason": close_reason,
                "fee_paid": float(close_fee),
                "net_pnl": float(net),
            },
        )

    def open_position(grid_index: int, raw_entry_level: float, ts: datetime, as_base_position: bool = False) -> bool:
        if order_notional < strategy.min_notional:
            return False
        entry_price = _apply_open_slippage(strategy.side, raw_entry_level, strategy.slippage)
        entry_price = _round_to_step(entry_price, strategy.price_tick_size)
        if entry_price <= 0:
            return False

        quantity = order_notional / entry_price
        quantity = _floor_to_step(quantity, strategy.quantity_step_size)
        if quantity <= 0:
            return False

        entry_notional = abs(entry_price * quantity)
        if entry_notional < strategy.min_notional:
            return False

        entry_fee = entry_notional * _entry_fee_rate(strategy, as_base_position=as_base_position)

        state.fees_paid += entry_fee
        positions[grid_index] = GridPosition(
            grid_index=grid_index,
            side=strategy.side.value,
            entry_price=entry_price,
            quantity=quantity,
            entry_time=ts,
            entry_fee=entry_fee,
        )

        emit_event(
            ts,
            event_type="open",
            price=entry_price,
            message=f"grid={grid_index}, qty={quantity:.8f}",
            payload={
                "grid_index": int(grid_index),
                "fee_paid": float(entry_fee),
                "quantity": float(quantity),
                "as_base_position": bool(as_base_position),
            },
        )
        return True

    base_grid_count, initial_position_size = initialize_base_position(
        strategy=strategy,
        nodes=grid_lines,
        first_candle=candles[0],
        order_notional=order_notional,
        open_position=open_position,
        emit_event=emit_event,
    )

    if len(grid_lines) > 1:
        grid_step = (grid_lines[-1] - grid_lines[0]) / (len(grid_lines) - 1)
        grid_eps = max(abs(grid_step) * 1e-9, 1e-8)
    else:
        grid_eps = 1e-8
    pending_orders: set[int] = set()

    def entry_level_for_grid(grid_index: int) -> float:
        if strategy.side == GridSide.LONG:
            return grid_lines[grid_index]
        return grid_lines[grid_index + 1]

    def entry_is_adverse(grid_index: int, mark_price: float) -> bool:
        entry_level = entry_level_for_grid(grid_index)
        if strategy.side == GridSide.LONG:
            return entry_level <= mark_price + grid_eps
        return entry_level >= mark_price - grid_eps

    def available_pending_margin(mark_price: float) -> float:
        eq = _equity(strategy.margin, state, positions, strategy.side, mark_price)
        used_margin = _used_notional(positions, mark_price) / strategy.leverage
        reserved_margin = len(pending_orders) * required_margin_per_order
        return eq - used_margin - reserved_margin

    def refresh_pending_orders(ts: datetime, mark_price: float) -> None:
        for grid_index in list(pending_orders):
            if grid_index in positions or not entry_is_adverse(grid_index, mark_price):
                pending_orders.discard(grid_index)

        if strategy.side == GridSide.LONG:
            candidate_indices = range(strategy.grids - 1, -1, -1)
        else:
            candidate_indices = range(strategy.grids)

        for grid_index in candidate_indices:
            if grid_index in positions or grid_index in pending_orders:
                continue
            if not entry_is_adverse(grid_index, mark_price):
                continue
            if available_pending_margin(mark_price) + 1e-12 < required_margin_per_order:
                break
            pending_orders.add(grid_index)
            order_level = entry_level_for_grid(grid_index)
            emit_event(
                ts,
                event_type="order_placed",
                price=order_level,
                message=f"grid={grid_index}, order_level={order_level:.8f}",
                payload={
                    "grid_index": int(grid_index),
                    "order_level": float(order_level),
                },
            )

    refresh_pending_orders(candles[0].timestamp, candles[0].close)

    def run_open_pass(candle: Candle) -> None:
        if strategy.side == GridSide.LONG:
            for grid_index in range(strategy.grids):
                if grid_index in positions or grid_index not in pending_orders:
                    continue
                open_level = grid_lines[grid_index]
                if _touched(open_level, candle):
                    pending_orders.discard(grid_index)
                    open_position(grid_index, open_level, candle.timestamp, False)
            return

        for grid_index in range(strategy.grids):
            if grid_index in positions or grid_index not in pending_orders:
                continue
            open_level = grid_lines[grid_index + 1]
            if _touched(open_level, candle):
                pending_orders.discard(grid_index)
                open_position(grid_index, open_level, candle.timestamp, False)

    def run_close_pass(candle: Candle) -> None:
        active_indices = sorted(positions.keys())
        if strategy.side == GridSide.LONG:
            for grid_index in active_indices:
                close_level = grid_lines[grid_index + 1]
                if _touched(close_level, candle) and grid_index in positions:
                    close_position(grid_index, close_level, candle.timestamp, "grid_take_profit")
            return

        for grid_index in active_indices:
            close_level = grid_lines[grid_index]
            if _touched(close_level, candle) and grid_index in positions:
                close_position(grid_index, close_level, candle.timestamp, "grid_take_profit")

    def is_stop_touched(candle: Candle) -> bool:
        return (
            strategy.side == GridSide.LONG
            and candle.low <= strategy.stop_loss
            or strategy.side == GridSide.SHORT
            and candle.high >= strategy.stop_loss
        )

    def execute_stop_loss(candle: Candle) -> None:
        nonlocal active, stop_without_reopen
        if not is_stop_touched(candle) or not positions:
            return

        stop_price = strategy.stop_loss
        for grid_index in list(positions.keys()):
            close_position(grid_index, stop_price, candle.timestamp, "stop_loss")

        state.stop_loss_count += 1
        emit_event(
            candle.timestamp,
            event_type="stop_loss",
            price=stop_price,
            message="stop loss triggered",
            payload={"stop_price": float(stop_price)},
        )
        if not strategy.reopen_after_stop:
            active = False
            stop_without_reopen = True

    active = True
    stop_without_reopen = False
    prev_candle_ts = candles[0].timestamp
    funding_schedule = sorted(funding_rates or [], key=lambda item: item[0])
    funding_cursor = 0

    def apply_scheduled_funding(candle: Candle, window_end: datetime) -> None:
        nonlocal funding_cursor

        while funding_cursor < len(funding_schedule):
            funding_ts, funding_rate = funding_schedule[funding_cursor]
            if funding_ts < candle.timestamp:
                funding_cursor += 1
                continue
            if funding_ts >= window_end:
                break
            funding_cursor += 1
            if not positions or funding_rate == 0:
                continue

            funding_price = candle.open
            notional = _total_market_value(positions, funding_price)
            side_sign = 1.0 if strategy.side == GridSide.LONG else -1.0
            funding_pnl = -side_sign * funding_rate * notional
            funding_statement_amount = _funding_statement_amount(funding_pnl)
            state.realized_pnl += funding_pnl
            state.funding_net += funding_pnl
            if funding_pnl < 0:
                state.funding_paid += abs(funding_pnl)
            emit_event(
                funding_ts,
                event_type="funding",
                price=funding_price,
                message=(
                    f"funding_pnl={funding_statement_amount:.6f}, rate={funding_rate:.8f}, "
                    f"position_notional={notional:.6f}, "
                    f"funding_time={funding_ts.isoformat()}"
                ),
                payload={
                    "funding_pnl": float(funding_statement_amount),
                    "funding_statement_amount": float(funding_statement_amount),
                    "funding_net": float(funding_pnl),
                    "rate": float(funding_rate),
                    "position_notional": float(notional),
                    "funding_time": funding_ts.isoformat(),
                },
            )

    def apply_funding(candle: Candle) -> None:
        nonlocal prev_candle_ts, funding_cursor

        if funding_schedule:
            prev_candle_ts = candle.timestamp
            return

        if not positions:
            prev_candle_ts = candle.timestamp
            return

        delta_hours = max((candle.timestamp - prev_candle_ts).total_seconds() / 3600.0, 0.0)
        prev_candle_ts = candle.timestamp
        if delta_hours <= 0:
            return

        if strategy.funding_rate_per_8h == 0:
            return

        interval_hours = max(float(strategy.funding_interval_hours), 1.0)
        effective_rate = strategy.funding_rate_per_8h * (delta_hours / interval_hours)
        if effective_rate == 0:
            return

        notional = _total_market_value(positions, candle.close)
        side_sign = 1.0 if strategy.side == GridSide.LONG else -1.0
        funding_pnl = -side_sign * effective_rate * notional
        funding_statement_amount = _funding_statement_amount(funding_pnl)
        state.realized_pnl += funding_pnl
        state.funding_net += funding_pnl
        if funding_pnl < 0:
            state.funding_paid += abs(funding_pnl)
        emit_event(
            candle.timestamp,
            event_type="funding",
            price=candle.close,
            message=f"funding_pnl={funding_statement_amount:.6f}, rate={effective_rate:.8f}, position_notional={notional:.6f}",
            payload={
                "funding_pnl": float(funding_statement_amount),
                "funding_statement_amount": float(funding_statement_amount),
                "funding_net": float(funding_pnl),
                "rate": float(effective_rate),
                "position_notional": float(notional),
            },
        )

    for index, candle in enumerate(candles):
        if not active:
            break

        if funding_schedule:
            apply_scheduled_funding(candle, _candle_window_end(candles, index))

        # Stop-loss pass 1: apply to positions carried into this candle.
        execute_stop_loss(candle)

        if active:
            if strategy.side == GridSide.LONG:
                bullish = candle.close >= candle.open
                if bullish:
                    run_open_pass(candle)
                    run_close_pass(candle)
                else:
                    run_close_pass(candle)
                    run_open_pass(candle)
            else:
                bearish = candle.close <= candle.open
                if bearish:
                    run_open_pass(candle)
                    run_close_pass(candle)
                else:
                    run_close_pass(candle)
                    run_open_pass(candle)

        # Stop-loss pass 2: also apply to positions opened intrabar in this candle.
        if active:
            execute_stop_loss(candle)

        apply_funding(candle)

        if positions:
            adverse_price = candle.low if strategy.side == GridSide.LONG else candle.high
            liquidation_price = candle.close if strategy.use_mark_price_for_liquidation else adverse_price
            eq_worst = _equity(strategy.margin, state, positions, strategy.side, liquidation_price)
            mm_worst = _maintenance_margin(positions, liquidation_price, strategy.maintenance_margin_rate)
            if eq_worst <= mm_worst:
                for grid_index in list(positions.keys()):
                    close_position(grid_index, liquidation_price, candle.timestamp, "liquidation")
                state.liquidation_count += 1
                emit_event(
                    candle.timestamp,
                    event_type="liquidation",
                    price=liquidation_price,
                    message="forced liquidation",
                    payload={"liquidation_price": float(liquidation_price)},
                )
                active = False

        if active:
            refresh_pending_orders(candle.timestamp, candle.close)
        else:
            pending_orders.clear()

        mark_price = candle.close
        eq = _equity(strategy.margin, state, positions, strategy.side, mark_price)
        avg_entry = _average_entry_price(positions)

        running_peak = max(running_peak, eq)
        drawdown = (eq / running_peak - 1.0) if running_peak > 0 else 0.0
        min_drawdown = min(min_drawdown, drawdown)

        maintenance_margin = _maintenance_margin(positions, mark_price, strategy.maintenance_margin_rate)
        margin_ratio = maintenance_margin / eq if eq > 0 else float("inf")
        used_notional = _used_notional(positions, mark_price)
        leverage_usage = used_notional / eq if eq > 0 else float("inf")
        unrealized = _unrealized_pnl(positions, strategy.side, mark_price)

        liq = _estimate_liquidation_price(
            initial_margin=strategy.margin,
            state=state,
            positions=positions,
            side=strategy.side,
            mmr=strategy.maintenance_margin_rate,
            current_price=mark_price,
        )

        equity_curve.append(CurvePoint(timestamp=candle.timestamp, value=eq))
        drawdown_curve.append(CurvePoint(timestamp=candle.timestamp, value=drawdown * 100.0))
        unrealized_pnl_curve.append(CurvePoint(timestamp=candle.timestamp, value=unrealized))
        margin_ratio_curve.append(
            CurvePoint(timestamp=candle.timestamp, value=margin_ratio if isfinite(margin_ratio) else 0.0)
        )
        leverage_usage_curve.append(
            CurvePoint(timestamp=candle.timestamp, value=leverage_usage if isfinite(leverage_usage) else 0.0)
        )
        liquidation_price_curve.append(CurvePoint(timestamp=candle.timestamp, value=liq if liq else 0.0))
        emit_event(
            candle.timestamp,
            event_type="snapshot",
            price=mark_price,
            message=f"equity={eq:.4f}, avg_entry={avg_entry:.4f}, open_positions={len(positions)}",
            payload={
                "equity": float(eq),
                "avg_entry": float(avg_entry),
                "open_positions": int(len(positions)),
            },
        )

        if stop_without_reopen:
            break

    final_mark = candles[-1].close
    final_equity = _equity(strategy.margin, state, positions, strategy.side, final_mark)
    total_return_usdt = _total_return_usdt(state, positions, strategy.side, final_mark)
    funding_statement_amount = _funding_statement_amount(state.funding_net)

    annualized_return_pct: Optional[float] = None

    average_round_profit = (
        sum(trade.net_pnl for trade in trades) / state.total_closed_trades if state.total_closed_trades else 0.0
    )
    win_rate = state.winning_trades / state.total_closed_trades if state.total_closed_trades else 0.0
    avg_holding_hours = (
        state.total_holding_hours / state.total_closed_trades if state.total_closed_trades else 0.0
    )

    if state.liquidation_count > 0:
        status = "liquidated"
    elif stop_without_reopen:
        status = "stopped_by_stop_loss"
    else:
        status = "completed"

    summary = BacktestSummary(
        initial_margin=strategy.margin,
        final_equity=final_equity,
        total_return_usdt=total_return_usdt,
        total_return_pct=((final_equity / strategy.margin - 1.0) * 100.0) if strategy.margin > 0 else 0.0,
        annualized_return_pct=annualized_return_pct,
        average_round_profit=average_round_profit,
        max_drawdown_pct=abs(min_drawdown) * 100.0,
        max_single_loss=state.max_single_loss,
        stop_loss_count=state.stop_loss_count,
        liquidation_count=state.liquidation_count,
        full_grid_profit_count=state.full_grid_profit_count,
        win_rate=win_rate,
        average_holding_hours=avg_holding_hours,
        total_closed_trades=state.total_closed_trades,
        status=status,
        fees_paid=state.fees_paid,
        funding_paid=state.funding_paid,
        funding_net=state.funding_net,
        funding_statement_amount=funding_statement_amount,
        use_base_position=strategy.use_base_position,
        base_grid_count=base_grid_count,
        initial_position_size=initial_position_size,
        max_possible_loss_usdt=max_possible_loss_usdt,
    )

    return BacktestResult(
        summary=summary,
        candles=candles,
        grid_lines=grid_lines,
        equity_curve=equity_curve,
        drawdown_curve=drawdown_curve,
        unrealized_pnl_curve=unrealized_pnl_curve,
        margin_ratio_curve=margin_ratio_curve,
        leverage_usage_curve=leverage_usage_curve,
        liquidation_price_curve=liquidation_price_curve,
        trades=trades,
        events=events,
    )


def run_backtest_for_optimization(
    candles: list[Candle],
    strategy: StrategyConfig,
    funding_rates: Optional[list[tuple[datetime, float]]] = None,
) -> OptimizationBacktestEvaluation:
    """Run the same execution logic with compact outputs for optimization."""
    if len(candles) < 2:
        raise ValueError("at least 2 candles are required for backtest")

    grid_lines = np.linspace(strategy.lower, strategy.upper, strategy.grids + 1).tolist()
    max_possible_loss_usdt = estimate_max_possible_loss_at_stop(strategy, initial_price=candles[0].close)
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    required_margin_per_order = order_notional / strategy.leverage

    state = EngineState()
    positions: dict[int, GridPosition] = {}
    equity_values: list[float] = []
    total_position_qty = 0.0
    total_entry_notional = 0.0

    running_peak = strategy.margin
    min_drawdown = 0.0

    def emit_event(
        ts: datetime,
        event_type: str,
        price: float,
        message: str,
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        return None

    def unrealized_pnl(mark_price: float) -> float:
        if strategy.side == GridSide.LONG:
            return (mark_price * total_position_qty) - total_entry_notional
        return total_entry_notional - (mark_price * total_position_qty)

    def equity_at(mark_price: float) -> float:
        return strategy.margin + state.realized_pnl + unrealized_pnl(mark_price) - state.fees_paid

    def used_notional_at(mark_price: float) -> float:
        return _position_market_value(mark_price, total_position_qty)

    def close_position(grid_index: int, raw_exit_level: float, ts: datetime, close_reason: str) -> None:
        nonlocal total_position_qty, total_entry_notional
        position = positions.pop(grid_index)
        exit_price = _apply_close_slippage(strategy.side, raw_exit_level, strategy.slippage)
        exit_price = _round_to_step(exit_price, strategy.price_tick_size)
        if exit_price <= 0:
            exit_price = max(raw_exit_level, 1e-9)
        close_notional = abs(exit_price * position.quantity)
        close_fee = close_notional * _exit_fee_rate(strategy, close_reason)

        if strategy.side == GridSide.LONG:
            gross = (exit_price - position.entry_price) * position.quantity
        else:
            gross = (position.entry_price - exit_price) * position.quantity

        state.realized_pnl += gross
        state.fees_paid += close_fee

        total_fee = position.entry_fee + close_fee
        net = gross - total_fee

        if net > 0:
            state.winning_trades += 1
        if close_reason == "grid_take_profit" and net > 0:
            state.full_grid_profit_count += 1

        state.max_single_loss = min(state.max_single_loss, net)
        state.total_closed_trades += 1

        holding_hours = (ts - position.entry_time).total_seconds() / 3600.0
        state.total_holding_hours += max(0.0, holding_hours)
        total_position_qty -= position.quantity
        total_entry_notional -= position.entry_price * position.quantity

    def open_position(grid_index: int, raw_entry_level: float, ts: datetime, as_base_position: bool = False) -> bool:
        nonlocal total_position_qty, total_entry_notional
        if order_notional < strategy.min_notional:
            return False
        entry_price = _apply_open_slippage(strategy.side, raw_entry_level, strategy.slippage)
        entry_price = _round_to_step(entry_price, strategy.price_tick_size)
        if entry_price <= 0:
            return False
        quantity = order_notional / entry_price
        quantity = _floor_to_step(quantity, strategy.quantity_step_size)
        if quantity <= 0:
            return False
        entry_notional = abs(entry_price * quantity)
        if entry_notional < strategy.min_notional:
            return False
        entry_fee = entry_notional * _entry_fee_rate(strategy, as_base_position=as_base_position)

        state.fees_paid += entry_fee
        positions[grid_index] = GridPosition(
            grid_index=grid_index,
            side=strategy.side.value,
            entry_price=entry_price,
            quantity=quantity,
            entry_time=ts,
            entry_fee=entry_fee,
        )
        total_position_qty += quantity
        total_entry_notional += entry_price * quantity
        return True

    initialize_base_position(
        strategy=strategy,
        nodes=grid_lines,
        first_candle=candles[0],
        order_notional=order_notional,
        open_position=open_position,
        emit_event=emit_event,
    )

    if len(grid_lines) > 1:
        grid_step = (grid_lines[-1] - grid_lines[0]) / (len(grid_lines) - 1)
        grid_eps = max(abs(grid_step) * 1e-9, 1e-8)
    else:
        grid_eps = 1e-8
    pending_orders: set[int] = set()

    def entry_level_for_grid(grid_index: int) -> float:
        if strategy.side == GridSide.LONG:
            return grid_lines[grid_index]
        return grid_lines[grid_index + 1]

    def entry_is_adverse(grid_index: int, mark_price: float) -> bool:
        entry_level = entry_level_for_grid(grid_index)
        if strategy.side == GridSide.LONG:
            return entry_level <= mark_price + grid_eps
        return entry_level >= mark_price - grid_eps

    def available_pending_margin(mark_price: float) -> float:
        eq = equity_at(mark_price)
        used_margin = used_notional_at(mark_price) / strategy.leverage
        reserved_margin = len(pending_orders) * required_margin_per_order
        return eq - used_margin - reserved_margin

    def refresh_pending_orders(ts: datetime, mark_price: float) -> None:
        for grid_index in list(pending_orders):
            if grid_index in positions or not entry_is_adverse(grid_index, mark_price):
                pending_orders.discard(grid_index)

        if strategy.side == GridSide.LONG:
            candidate_indices = range(strategy.grids - 1, -1, -1)
        else:
            candidate_indices = range(strategy.grids)

        for grid_index in candidate_indices:
            if grid_index in positions or grid_index in pending_orders:
                continue
            if not entry_is_adverse(grid_index, mark_price):
                continue
            if available_pending_margin(mark_price) + 1e-12 < required_margin_per_order:
                break
            pending_orders.add(grid_index)

    refresh_pending_orders(candles[0].timestamp, candles[0].close)

    def touched_line_range(candle: Candle) -> Optional[tuple[int, int]]:
        left = bisect_left(grid_lines, candle.low)
        right = bisect_right(grid_lines, candle.high) - 1
        if left > right:
            return None
        if right < 0 or left > strategy.grids:
            return None
        return max(0, left), min(strategy.grids, right)

    def run_open_pass(candle: Candle) -> None:
        touched_range = touched_line_range(candle)
        if touched_range is None:
            return
        line_start, line_end = touched_range
        if strategy.side == GridSide.LONG:
            start_idx = max(0, line_start)
            end_idx = min(strategy.grids - 1, line_end)
            for grid_index in range(start_idx, end_idx + 1):
                if grid_index in positions or grid_index not in pending_orders:
                    continue
                open_level = grid_lines[grid_index]
                pending_orders.discard(grid_index)
                open_position(grid_index, open_level, candle.timestamp, False)
            return

        start_idx = max(0, line_start - 1)
        end_idx = min(strategy.grids - 1, line_end - 1)
        for grid_index in range(start_idx, end_idx + 1):
            if grid_index in positions or grid_index not in pending_orders:
                continue
            open_level = grid_lines[grid_index + 1]
            pending_orders.discard(grid_index)
            open_position(grid_index, open_level, candle.timestamp, False)

    def run_close_pass(candle: Candle) -> None:
        touched_range = touched_line_range(candle)
        if touched_range is None:
            return
        line_start, line_end = touched_range
        active_indices = sorted(positions.keys())
        if strategy.side == GridSide.LONG:
            for grid_index in active_indices:
                line_index = grid_index + 1
                if line_start <= line_index <= line_end and grid_index in positions:
                    close_level = grid_lines[line_index]
                    close_position(grid_index, close_level, candle.timestamp, "grid_take_profit")
            return

        for grid_index in active_indices:
            if line_start <= grid_index <= line_end and grid_index in positions:
                close_level = grid_lines[grid_index]
                close_position(grid_index, close_level, candle.timestamp, "grid_take_profit")

    def is_stop_touched(candle: Candle) -> bool:
        return (
            strategy.side == GridSide.LONG
            and candle.low <= strategy.stop_loss
            or strategy.side == GridSide.SHORT
            and candle.high >= strategy.stop_loss
        )

    def execute_stop_loss(candle: Candle) -> None:
        nonlocal active, stop_without_reopen
        if not is_stop_touched(candle) or not positions:
            return

        stop_price = strategy.stop_loss
        for grid_index in list(positions.keys()):
            close_position(grid_index, stop_price, candle.timestamp, "stop_loss")

        state.stop_loss_count += 1
        if not strategy.reopen_after_stop:
            active = False
            stop_without_reopen = True

    active = True
    stop_without_reopen = False
    prev_candle_ts = candles[0].timestamp
    funding_schedule = sorted(funding_rates or [], key=lambda item: item[0])
    funding_cursor = 0

    def apply_scheduled_funding(candle: Candle, window_end: datetime) -> None:
        nonlocal funding_cursor
        while funding_cursor < len(funding_schedule):
            funding_ts, funding_rate = funding_schedule[funding_cursor]
            if funding_ts < candle.timestamp:
                funding_cursor += 1
                continue
            if funding_ts >= window_end:
                break
            funding_cursor += 1
            if not positions or funding_rate == 0:
                continue

            funding_price = candle.open
            notional = _position_market_value(funding_price, total_position_qty)
            side_sign = 1.0 if strategy.side == GridSide.LONG else -1.0
            funding_pnl = -side_sign * funding_rate * notional
            state.realized_pnl += funding_pnl
            state.funding_net += funding_pnl
            if funding_pnl < 0:
                state.funding_paid += abs(funding_pnl)

    def apply_funding(candle: Candle) -> None:
        nonlocal prev_candle_ts, funding_cursor
        if funding_schedule:
            prev_candle_ts = candle.timestamp
            return

        if not positions:
            prev_candle_ts = candle.timestamp
            return

        delta_hours = max((candle.timestamp - prev_candle_ts).total_seconds() / 3600.0, 0.0)
        prev_candle_ts = candle.timestamp
        if delta_hours <= 0:
            return
        if strategy.funding_rate_per_8h == 0:
            return

        interval_hours = max(float(strategy.funding_interval_hours), 1.0)
        effective_rate = strategy.funding_rate_per_8h * (delta_hours / interval_hours)
        if effective_rate == 0:
            return

        notional = _position_market_value(candle.close, total_position_qty)
        side_sign = 1.0 if strategy.side == GridSide.LONG else -1.0
        funding_pnl = -side_sign * effective_rate * notional
        state.realized_pnl += funding_pnl
        state.funding_net += funding_pnl
        if funding_pnl < 0:
            state.funding_paid += abs(funding_pnl)

    for index, candle in enumerate(candles):
        if not active:
            break

        if funding_schedule:
            apply_scheduled_funding(candle, _candle_window_end(candles, index))

        execute_stop_loss(candle)

        if active:
            if strategy.side == GridSide.LONG:
                bullish = candle.close >= candle.open
                if bullish:
                    run_open_pass(candle)
                    run_close_pass(candle)
                else:
                    run_close_pass(candle)
                    run_open_pass(candle)
            else:
                bearish = candle.close <= candle.open
                if bearish:
                    run_open_pass(candle)
                    run_close_pass(candle)
                else:
                    run_close_pass(candle)
                    run_open_pass(candle)

        if active:
            execute_stop_loss(candle)

        apply_funding(candle)

        if positions:
            adverse_price = candle.low if strategy.side == GridSide.LONG else candle.high
            liquidation_price = candle.close if strategy.use_mark_price_for_liquidation else adverse_price
            eq_worst = equity_at(liquidation_price)
            mm_worst = used_notional_at(liquidation_price) * strategy.maintenance_margin_rate
            if eq_worst <= mm_worst:
                for grid_index in list(positions.keys()):
                    close_position(grid_index, liquidation_price, candle.timestamp, "liquidation")
                state.liquidation_count += 1
                active = False

        if active:
            refresh_pending_orders(candle.timestamp, candle.close)
        else:
            pending_orders.clear()

        eq = equity_at(candle.close)
        equity_values.append(eq)

        running_peak = max(running_peak, eq)
        drawdown = (eq / running_peak - 1.0) if running_peak > 0 else 0.0
        min_drawdown = min(min_drawdown, drawdown)

        if stop_without_reopen:
            break

    final_mark = candles[-1].close
    final_equity = equity_at(final_mark)
    funding_statement_amount = _funding_statement_amount(state.funding_net)
    trading_pnl_excluding_funding = state.realized_pnl - state.funding_net
    total_return_usdt = trading_pnl_excluding_funding + unrealized_pnl(final_mark) - state.fees_paid - funding_statement_amount

    win_rate = state.winning_trades / state.total_closed_trades if state.total_closed_trades else 0.0

    summary = {
        "total_return_usdt": float(total_return_usdt),
        "max_drawdown_pct": float(abs(min_drawdown) * 100.0),
        "win_rate": float(win_rate),
        "total_closed_trades": float(state.total_closed_trades),
        "max_possible_loss_usdt": float(max_possible_loss_usdt),
    }

    return OptimizationBacktestEvaluation(summary=summary, equity_values=equity_values)
