from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Callable, Literal, Optional

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


def _unrealized_pnl(positions: dict[int, GridPosition], side: GridSide, mark_price: float) -> float:
    if side == GridSide.LONG:
        return sum((mark_price - p.entry_price) * p.quantity for p in positions.values())
    return sum((p.entry_price - mark_price) * p.quantity for p in positions.values())


def _used_notional(positions: dict[int, GridPosition], mark_price: float) -> float:
    return sum(abs(mark_price * p.quantity) for p in positions.values())


def _equity(initial_margin: float, state: EngineState, positions: dict[int, GridPosition], side: GridSide, mark_price: float) -> float:
    return initial_margin + state.realized_pnl + _unrealized_pnl(positions, side, mark_price) - state.fees_paid


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
    open_position: Callable[[int, float, datetime], None],
    emit_event: Callable[[datetime, str, float, str], None],
) -> tuple[int, float]:
    if not strategy.use_base_position:
        return 0, 0.0

    # Use the first candle close to determine how many completed grids exist.
    decision_price = first_candle.close
    # Use the first candle close as base-position execution price (market-style fill).
    base_entry_price = first_candle.close
    if len(nodes) > 1:
        grid_size = (nodes[-1] - nodes[0]) / (len(nodes) - 1)
        eps = max(abs(grid_size) * 1e-9, 1e-8)
    else:
        eps = 1e-8
    on_node = any(abs(node - decision_price) <= eps for node in nodes)
    offset = 1 if on_node else 2

    if strategy.side == GridSide.LONG:
        # Exchange-style node logic:
        # - on node: remove boundary node
        # - between nodes: remove boundary node + current unfinished grid
        k = sum(1 for node in nodes if node > decision_price + eps)
        base_grid_count = max(k - offset, 0)
        first_above_idx = next((idx for idx, node in enumerate(nodes) if node > decision_price + eps), len(nodes))
        grid_indices = list(range(first_above_idx, min(strategy.grids, first_above_idx + base_grid_count)))
    else:
        # Mirror rule for short side:
        # - on node: remove boundary node
        # - between nodes: remove boundary node + current unfinished grid
        k = sum(1 for node in nodes if node < decision_price - eps)
        base_grid_count = max(k - offset, 0)
        grid_indices = list(range(1, min(strategy.grids, 1 + base_grid_count)))

    base_grid_count = min(base_grid_count, len(grid_indices))
    initial_position_size = order_notional * base_grid_count

    for grid_index in grid_indices:
        open_position(grid_index, base_entry_price, first_candle.timestamp)

    if base_grid_count > 0:
        emit_event(
            first_candle.timestamp,
            event_type="base_position_init",
            price=base_entry_price,
            message=(
                "base_grid_count="
                f"{base_grid_count}, initial_position_size={initial_position_size:.4f}, decision_price={decision_price:.4f}"
            ),
        )

    return base_grid_count, initial_position_size


def run_backtest(candles: list[Candle], strategy: StrategyConfig) -> BacktestResult:
    if len(candles) < 2:
        raise ValueError("at least 2 candles are required for backtest")

    grid_lines = np.linspace(strategy.lower, strategy.upper, strategy.grids + 1).tolist()
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    required_margin_per_order = order_notional / strategy.leverage

    state = EngineState()
    positions: dict[int, GridPosition] = {}
    trades: list[TradeEvent] = []
    events: list[EventLog] = []
    equity_curve: list[CurvePoint] = []
    drawdown_curve: list[CurvePoint] = []
    margin_ratio_curve: list[CurvePoint] = []
    leverage_usage_curve: list[CurvePoint] = []
    liquidation_price_curve: list[CurvePoint] = []

    running_peak = strategy.margin
    min_drawdown = 0.0
    base_grid_count = 0
    initial_position_size = 0.0

    def emit_event(ts: datetime, event_type: str, price: float, message: str) -> None:
        events.append(EventLog(timestamp=ts, event_type=event_type, price=float(price), message=message))

    def can_open(mark_price: float) -> bool:
        eq = _equity(strategy.margin, state, positions, strategy.side, mark_price)
        used_margin = _used_notional(positions, mark_price) / strategy.leverage
        free_margin = eq - used_margin
        return free_margin >= required_margin_per_order and eq > 0

    def close_position(grid_index: int, raw_exit_level: float, ts: datetime, close_reason: str) -> None:
        position = positions.pop(grid_index)
        exit_price = _apply_close_slippage(strategy.side, raw_exit_level, strategy.slippage)
        close_notional = abs(exit_price * position.quantity)
        close_fee = close_notional * strategy.fee_rate

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
        )

    def open_position(grid_index: int, raw_entry_level: float, ts: datetime) -> None:
        entry_price = _apply_open_slippage(strategy.side, raw_entry_level, strategy.slippage)
        quantity = order_notional / entry_price
        entry_fee = order_notional * strategy.fee_rate

        state.fees_paid += entry_fee
        positions[grid_index] = GridPosition(
            grid_index=grid_index,
            side=strategy.side.value,
            entry_price=entry_price,
            quantity=quantity,
            entry_time=ts,
            entry_fee=entry_fee,
        )

        emit_event(ts, event_type="open", price=entry_price, message=f"grid={grid_index}, qty={quantity:.8f}")

    base_grid_count, initial_position_size = initialize_base_position(
        strategy=strategy,
        nodes=grid_lines,
        first_candle=candles[0],
        order_notional=order_notional,
        open_position=open_position,
        emit_event=emit_event,
    )

    def run_open_pass(candle: Candle) -> None:
        if strategy.side == GridSide.LONG:
            for grid_index in range(strategy.grids):
                if grid_index in positions:
                    continue
                open_level = grid_lines[grid_index]
                if _touched(open_level, candle) and can_open(candle.close):
                    open_position(grid_index, open_level, candle.timestamp)
            return

        for grid_index in range(strategy.grids):
            if grid_index in positions:
                continue
            open_level = grid_lines[grid_index + 1]
            if _touched(open_level, candle) and can_open(candle.close):
                open_position(grid_index, open_level, candle.timestamp)

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
        emit_event(candle.timestamp, event_type="stop_loss", price=stop_price, message="stop loss triggered")
        if not strategy.reopen_after_stop:
            active = False
            stop_without_reopen = True

    active = True
    stop_without_reopen = False

    for candle in candles:
        if not active:
            break

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

        if positions:
            adverse_price = candle.low if strategy.side == GridSide.LONG else candle.high
            eq_worst = _equity(strategy.margin, state, positions, strategy.side, adverse_price)
            mm_worst = _maintenance_margin(positions, adverse_price, strategy.maintenance_margin_rate)
            if eq_worst <= mm_worst:
                for grid_index in list(positions.keys()):
                    close_position(grid_index, adverse_price, candle.timestamp, "liquidation")
                state.liquidation_count += 1
                emit_event(candle.timestamp, event_type="liquidation", price=adverse_price, message="forced liquidation")
                active = False

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
        )

        if stop_without_reopen:
            break

    final_mark = candles[-1].close
    final_equity = _equity(strategy.margin, state, positions, strategy.side, final_mark)

    span_days = (candles[-1].timestamp - candles[0].timestamp).total_seconds() / 86400.0
    annualized_return_pct: Optional[float] = None
    if span_days >= 30 and strategy.margin > 0 and final_equity > 0:
        annualized_return_pct = ((final_equity / strategy.margin) ** (365.0 / span_days) - 1.0) * 100.0

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
        total_return_usdt=final_equity - strategy.margin,
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
        use_base_position=strategy.use_base_position,
        base_grid_count=base_grid_count,
        initial_position_size=initial_position_size,
    )

    return BacktestResult(
        summary=summary,
        candles=candles,
        grid_lines=grid_lines,
        equity_curve=equity_curve,
        drawdown_curve=drawdown_curve,
        margin_ratio_curve=margin_ratio_curve,
        leverage_usage_curve=leverage_usage_curve,
        liquidation_price_curve=liquidation_price_curve,
        trades=trades,
        events=events,
    )


def run_backtest_for_optimization(
    candles: list[Candle], strategy: StrategyConfig
) -> OptimizationBacktestEvaluation:
    """Run the same execution logic with compact outputs for optimization."""
    if len(candles) < 2:
        raise ValueError("at least 2 candles are required for backtest")

    grid_lines = np.linspace(strategy.lower, strategy.upper, strategy.grids + 1).tolist()
    order_notional = strategy.margin * strategy.leverage / strategy.grids
    required_margin_per_order = order_notional / strategy.leverage

    state = EngineState()
    positions: dict[int, GridPosition] = {}
    equity_values: list[float] = []
    total_position_qty = 0.0
    total_entry_notional = 0.0

    running_peak = strategy.margin
    min_drawdown = 0.0

    def emit_event(ts: datetime, event_type: str, price: float, message: str) -> None:
        return None

    def unrealized_pnl(mark_price: float) -> float:
        if strategy.side == GridSide.LONG:
            return (mark_price * total_position_qty) - total_entry_notional
        return total_entry_notional - (mark_price * total_position_qty)

    def equity_at(mark_price: float) -> float:
        return strategy.margin + state.realized_pnl + unrealized_pnl(mark_price) - state.fees_paid

    def used_notional_at(mark_price: float) -> float:
        return abs(mark_price * total_position_qty)

    def can_open(mark_price: float) -> bool:
        eq = equity_at(mark_price)
        used_margin = used_notional_at(mark_price) / strategy.leverage
        free_margin = eq - used_margin
        return free_margin >= required_margin_per_order and eq > 0

    def close_position(grid_index: int, raw_exit_level: float, ts: datetime, close_reason: str) -> None:
        nonlocal total_position_qty, total_entry_notional
        position = positions.pop(grid_index)
        exit_price = _apply_close_slippage(strategy.side, raw_exit_level, strategy.slippage)
        close_notional = abs(exit_price * position.quantity)
        close_fee = close_notional * strategy.fee_rate

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

    def open_position(grid_index: int, raw_entry_level: float, ts: datetime) -> None:
        nonlocal total_position_qty, total_entry_notional
        entry_price = _apply_open_slippage(strategy.side, raw_entry_level, strategy.slippage)
        quantity = order_notional / entry_price
        entry_fee = order_notional * strategy.fee_rate

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

    initialize_base_position(
        strategy=strategy,
        nodes=grid_lines,
        first_candle=candles[0],
        order_notional=order_notional,
        open_position=open_position,
        emit_event=emit_event,
    )

    def run_open_pass(candle: Candle) -> None:
        candle_close = candle.close
        if strategy.side == GridSide.LONG:
            for grid_index in range(strategy.grids):
                if grid_index in positions:
                    continue
                open_level = grid_lines[grid_index]
                if _touched(open_level, candle) and can_open(candle_close):
                    open_position(grid_index, open_level, candle.timestamp)
            return

        for grid_index in range(strategy.grids):
            if grid_index in positions:
                continue
            open_level = grid_lines[grid_index + 1]
            if _touched(open_level, candle) and can_open(candle_close):
                open_position(grid_index, open_level, candle.timestamp)

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
        if not strategy.reopen_after_stop:
            active = False
            stop_without_reopen = True

    active = True
    stop_without_reopen = False

    for candle in candles:
        if not active:
            break

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

        if positions:
            adverse_price = candle.low if strategy.side == GridSide.LONG else candle.high
            eq_worst = equity_at(adverse_price)
            mm_worst = used_notional_at(adverse_price) * strategy.maintenance_margin_rate
            if eq_worst <= mm_worst:
                for grid_index in list(positions.keys()):
                    close_position(grid_index, adverse_price, candle.timestamp, "liquidation")
                state.liquidation_count += 1
                active = False

        eq = equity_at(candle.close)
        equity_values.append(eq)

        running_peak = max(running_peak, eq)
        drawdown = (eq / running_peak - 1.0) if running_peak > 0 else 0.0
        min_drawdown = min(min_drawdown, drawdown)

        if stop_without_reopen:
            break

    final_mark = candles[-1].close
    final_equity = equity_at(final_mark)

    win_rate = state.winning_trades / state.total_closed_trades if state.total_closed_trades else 0.0

    summary = {
        "total_return_usdt": float(final_equity - strategy.margin),
        "max_drawdown_pct": float(abs(min_drawdown) * 100.0),
        "win_rate": float(win_rate),
        "total_closed_trades": float(state.total_closed_trades),
    }

    return OptimizationBacktestEvaluation(summary=summary, equity_values=equity_values)
