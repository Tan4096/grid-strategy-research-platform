from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Optional

import numpy as np
import pandas as pd


@dataclass
class GridSlot:
    lower: float
    upper: float
    is_open: bool = False
    entry_price: float = 0.0
    qty: float = 0.0
    entry_time: Optional[pd.Timestamp] = None
    entry_fee: float = 0.0


@dataclass
class TradeRecord:
    entry_time: str
    exit_time: str
    side: str
    entry_price: float
    exit_price: float
    qty: float
    pnl: float
    fee: float
    duration_hours: float
    reason: str
    slot_index: int


@dataclass
class EquityPoint:
    time: str
    equity: float
    drawdown: float
    leverage_usage: float
    margin_ratio: float


class BacktestEngine:
    def __init__(self, df: pd.DataFrame, params: Dict):
        self.df = df.copy()
        self.params = params
        self.side = params["side"]
        self.lower = float(params["lower"])
        self.upper = float(params["upper"])
        self.grids = int(params["grids"])
        self.leverage = float(params["leverage"])
        self.margin = float(params["margin"])
        self.stop_loss = float(params["stop_loss"])
        self.auto_restart = bool(params["auto_restart"])
        self.fee_rate = float(params["fee_rate"])
        self.slippage = float(params["slippage"])
        self.maintenance_margin_rate = float(params["maintenance_margin_rate"])

        self.order_value = (self.margin * self.leverage) / self.grids

        self.grid_levels = self._build_grid(self.lower, self.upper, self.grids)
        self.slots = [GridSlot(self.grid_levels[i], self.grid_levels[i + 1]) for i in range(self.grids)]

        self.realized_pnl = 0.0
        self.fees = 0.0
        self.trades: List[TradeRecord] = []
        self.equity_curve: List[EquityPoint] = []
        self.leverage_curve: List[float] = []

        self.stop_loss_count = 0
        self.liquidations = 0

        self.cycle_active = False
        self.cycle_pnl = 0.0
        self.cycle_pnls: List[float] = []

    @staticmethod
    def _build_grid(lower: float, upper: float, grids: int) -> List[float]:
        step = (upper - lower) / grids
        return [lower + step * i for i in range(grids + 1)]

    def _position_qty(self) -> float:
        return sum(slot.qty for slot in self.slots if slot.is_open)

    def _position_notional(self, price: float) -> float:
        qty = self._position_qty()
        return qty * price

    def _avg_entry(self) -> float:
        total_qty = self._position_qty()
        if total_qty == 0:
            return 0.0
        return sum(slot.qty * slot.entry_price for slot in self.slots if slot.is_open) / total_qty

    def _unrealized_pnl(self, price: float) -> float:
        pnl = 0.0
        for slot in self.slots:
            if not slot.is_open:
                continue
            if self.side == "long":
                pnl += (price - slot.entry_price) * slot.qty
            else:
                pnl += (slot.entry_price - price) * slot.qty
        return pnl

    def _liquidation_price(self) -> Optional[float]:
        total_qty = self._position_qty()
        if total_qty == 0:
            return None
        avg_entry = self._avg_entry()
        notional = total_qty * avg_entry
        maintenance_margin = self.maintenance_margin_rate * notional
        margin_buffer = max(self.margin - maintenance_margin, 0.0)
        if notional <= 0:
            return None
        if self.side == "long":
            return avg_entry * (1 - margin_buffer / notional)
        return avg_entry * (1 + margin_buffer / notional)

    def _apply_fee(self, notional: float) -> float:
        fee = notional * self.fee_rate
        self.fees += fee
        return fee

    def _open_slot(self, slot_index: int, price: float, timestamp: pd.Timestamp):
        if slot_index < 0 or slot_index >= self.grids:
            return
        slot = self.slots[slot_index]
        if slot.is_open:
            return
        exec_price = price
        if self.side == "long":
            exec_price *= (1 + self.slippage)
        else:
            exec_price *= (1 - self.slippage)
        qty = self.order_value / exec_price
        fee = self._apply_fee(qty * exec_price)
        slot.is_open = True
        slot.entry_price = exec_price
        slot.qty = qty
        slot.entry_time = timestamp
        slot.entry_fee = fee
        self.cycle_active = True

    def _close_slot(self, slot_index: int, price: float, timestamp: pd.Timestamp, reason: str):
        if slot_index < 0 or slot_index >= self.grids:
            return
        slot = self.slots[slot_index]
        if not slot.is_open:
            return
        exec_price = price
        if self.side == "long":
            exec_price *= (1 - self.slippage)
        else:
            exec_price *= (1 + self.slippage)
        notional = slot.qty * exec_price
        fee_exit = self._apply_fee(notional)
        if self.side == "long":
            pnl_gross = (exec_price - slot.entry_price) * slot.qty
        else:
            pnl_gross = (slot.entry_price - exec_price) * slot.qty
        self.realized_pnl += pnl_gross
        total_fee = slot.entry_fee + fee_exit
        pnl_net = pnl_gross - total_fee
        duration_hours = 0.0
        if slot.entry_time is not None:
            duration_hours = (timestamp - slot.entry_time).total_seconds() / 3600
        self.trades.append(
            TradeRecord(
                entry_time=slot.entry_time.isoformat() if slot.entry_time else timestamp.isoformat(),
                exit_time=timestamp.isoformat(),
                side=self.side,
                entry_price=slot.entry_price,
                exit_price=exec_price,
                qty=slot.qty,
                pnl=pnl_net,
                fee=total_fee,
                duration_hours=duration_hours,
                reason=reason,
                slot_index=slot_index,
            )
        )
        self.cycle_pnl += pnl_net
        slot.is_open = False
        slot.entry_price = 0.0
        slot.qty = 0.0
        slot.entry_time = None
        slot.entry_fee = 0.0

        if self.cycle_active and self._position_qty() == 0:
            self.cycle_pnls.append(self.cycle_pnl)
            self.cycle_active = False
            self.cycle_pnl = 0.0

    def _close_all(self, price: float, timestamp: pd.Timestamp, reason: str):
        for idx in range(self.grids):
            if self.slots[idx].is_open:
                self._close_slot(idx, price, timestamp, reason)
        if self.cycle_active:
            self.cycle_pnls.append(self.cycle_pnl)
        self.cycle_active = False
        self.cycle_pnl = 0.0

    def _price_path(self, open_p: float, high: float, low: float, close: float) -> List[float]:
        if close >= open_p:
            return [open_p, low, high, close]
        return [open_p, high, low, close]

    def _iter_crossed_levels(self, p0: float, p1: float) -> List[int]:
        if p1 == p0:
            return []
        if p1 > p0:
            levels = [i for i, lvl in enumerate(self.grid_levels) if p0 < lvl <= p1]
            return sorted(levels)
        levels = [i for i, lvl in enumerate(self.grid_levels) if p1 <= lvl < p0]
        return sorted(levels, reverse=True)

    def _handle_crossing(self, level_index: int, direction: str, price: float, timestamp: pd.Timestamp):
        if self.side == "long":
            if direction == "down":
                self._open_slot(level_index, price, timestamp)
            else:
                self._close_slot(level_index - 1, price, timestamp, "grid")
        else:
            if direction == "up":
                self._open_slot(level_index - 1, price, timestamp)
            else:
                self._close_slot(level_index, price, timestamp, "grid")

    def _update_equity_point(self, timestamp: pd.Timestamp, price: float):
        unrealized = self._unrealized_pnl(price)
        equity = self.margin + self.realized_pnl - self.fees + unrealized
        notional = self._position_notional(price)
        leverage_usage = notional / self.margin if self.margin > 0 else 0.0
        maintenance_margin = self.maintenance_margin_rate * notional
        margin_ratio = maintenance_margin / equity if equity > 0 else 0.0
        self.equity_curve.append(
            EquityPoint(
                time=timestamp.isoformat(),
                equity=float(equity),
                drawdown=0.0,
                leverage_usage=float(leverage_usage),
                margin_ratio=float(margin_ratio),
            )
        )

    def run(self) -> Dict:
        if self.df.empty:
            raise ValueError("No candle data provided")
        for _, row in self.df.iterrows():
            timestamp = row["timestamp"]
            open_p = float(row["open"])
            high = float(row["high"])
            low = float(row["low"])
            close = float(row["close"])

            liq_price = self._liquidation_price()
            if liq_price is not None:
                if self.side == "long" and low <= liq_price:
                    self._close_all(liq_price, timestamp, "liquidation")
                    self.liquidations += 1
                    self._update_equity_point(timestamp, liq_price)
                    break
                if self.side == "short" and high >= liq_price:
                    self._close_all(liq_price, timestamp, "liquidation")
                    self.liquidations += 1
                    self._update_equity_point(timestamp, liq_price)
                    break

            if self.stop_loss > 0:
                if self.side == "long" and low <= self.stop_loss:
                    self._close_all(self.stop_loss, timestamp, "stop_loss")
                    self.stop_loss_count += 1
                    self._update_equity_point(timestamp, self.stop_loss)
                    if not self.auto_restart:
                        break
                    continue
                if self.side == "short" and high >= self.stop_loss:
                    self._close_all(self.stop_loss, timestamp, "stop_loss")
                    self.stop_loss_count += 1
                    self._update_equity_point(timestamp, self.stop_loss)
                    if not self.auto_restart:
                        break
                    continue

            path = self._price_path(open_p, high, low, close)
            for i in range(len(path) - 1):
                p0, p1 = path[i], path[i + 1]
                if p0 == p1:
                    continue
                direction = "up" if p1 > p0 else "down"
                crossed = self._iter_crossed_levels(p0, p1)
                for level_index in crossed:
                    level_price = self.grid_levels[level_index]
                    self._handle_crossing(level_index, direction, level_price, timestamp)

            self._update_equity_point(timestamp, close)

        self._finalize_drawdown()
        return self._build_result()

    def _finalize_drawdown(self):
        if not self.equity_curve:
            return
        equity_values = np.array([p.equity for p in self.equity_curve])
        peaks = np.maximum.accumulate(equity_values)
        drawdowns = (equity_values - peaks) / peaks
        for idx, point in enumerate(self.equity_curve):
            point.drawdown = float(drawdowns[idx])

    def _build_result(self) -> Dict:
        trades = [trade.__dict__ for trade in self.trades]
        equity_curve = [point.__dict__ for point in self.equity_curve]

        total_profit = 0.0
        if self.equity_curve:
            total_profit = self.equity_curve[-1].equity - self.margin

        avg_cycle_profit = float(np.mean(self.cycle_pnls)) if self.cycle_pnls else 0.0
        profitable_cycles = len([p for p in self.cycle_pnls if p > 0])
        max_single_loss = min([t.pnl for t in self.trades], default=0.0)
        win_count = len([t for t in self.trades if t.pnl > 0])
        total_trades = len(self.trades)
        win_rate = win_count / total_trades if total_trades else 0.0
        avg_holding = float(np.mean([t.duration_hours for t in self.trades])) if self.trades else 0.0

        max_drawdown = min([p.drawdown for p in self.equity_curve], default=0.0)

        start_time = self.df.iloc[0]["timestamp"].isoformat()
        end_time = self.df.iloc[-1]["timestamp"].isoformat()
        duration_days = (self.df.iloc[-1]["timestamp"] - self.df.iloc[0]["timestamp"]).total_seconds() / 86400
        annualized_return = 0.0
        if duration_days > 0:
            ending_equity = self.equity_curve[-1].equity if self.equity_curve else self.margin
            annualized_return = (ending_equity / self.margin) ** (365 / duration_days) - 1

        summary = {
            "total_profit": float(total_profit),
            "annualized_return": float(annualized_return),
            "avg_cycle_profit": float(avg_cycle_profit),
            "total_fees": float(self.fees),
            "max_drawdown": float(max_drawdown),
            "max_single_loss": float(max_single_loss),
            "stop_loss_count": int(self.stop_loss_count),
            "liquidations": int(self.liquidations),
            "profitable_cycles": int(profitable_cycles),
            "win_rate": float(win_rate),
            "avg_holding_hours": float(avg_holding),
            "total_trades": int(total_trades),
            "start_time": start_time,
            "end_time": end_time,
            "duration_days": float(duration_days),
        }

        return {
            "summary": summary,
            "equity_curve": equity_curve,
            "trades": trades,
            "grid_levels": [float(x) for x in self.grid_levels],
        }


def run_backtest(df: pd.DataFrame, params: Dict) -> Dict:
    engine = BacktestEngine(df, params)
    return engine.run()
