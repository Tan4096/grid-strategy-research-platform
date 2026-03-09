from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from app.core.schemas import (
    GridSide,
    LiveCompleteness,
    LiveDailyBreakdown,
    LiveDiagnostic,
    LiveFill,
    LiveFundingEntry,
    LiveInferredGrid,
    LiveLedgerEntry,
    LiveLedgerSummary,
    LiveOpenOrder,
    LivePosition,
    LiveSnapshotSummary,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_datetime(value) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 10**12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    raw = str(value).strip()
    if not raw:
        raise ValueError("empty datetime value")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


PARTIAL_FAILURE_CODES = {
    "market_params_unavailable",
    "funding_not_available",
    "fills_not_available",
    "fills_truncated",
    "LIVE_BOT_FILLS_CAPPED",
    "LIVE_BOT_ORDERS_UNAVAILABLE",
    "LIVE_BOT_SNAPSHOT_STALE",
    "funding_truncated",
    "funding_window_clipped",
}



def sort_and_dedupe_fills(fills: Iterable[LiveFill]) -> list[LiveFill]:
    seen: set[tuple[str, str, str]] = set()
    out: list[LiveFill] = []
    for item in sorted(fills, key=lambda fill: fill.timestamp, reverse=True):
        key = (item.trade_id, item.order_id or "", item.timestamp.isoformat())
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out



def sort_and_dedupe_funding(entries: Iterable[LiveFundingEntry]) -> list[LiveFundingEntry]:
    seen: set[tuple[str, str, str]] = set()
    out: list[LiveFundingEntry] = []
    for item in sorted(entries, key=lambda entry: entry.timestamp, reverse=True):
        key = (item.timestamp.isoformat(), f"{item.amount:.12f}", item.currency or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out



def build_summary(
    *,
    position: LivePosition,
    open_orders: list[LiveOpenOrder],
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
) -> LiveSnapshotSummary:
    realized_pnl = sum(item.realized_pnl for item in fills) if fills else position.realized_pnl
    fees_paid = sum(abs(item.fee) for item in fills)
    funding_net = sum(item.amount for item in funding_entries)
    funding_paid = sum(abs(item.amount) for item in funding_entries if item.amount < 0)
    total_pnl = realized_pnl + position.unrealized_pnl - fees_paid + funding_net
    return LiveSnapshotSummary(
        realized_pnl=realized_pnl,
        unrealized_pnl=position.unrealized_pnl,
        fees_paid=fees_paid,
        funding_paid=funding_paid,
        funding_net=funding_net,
        total_pnl=total_pnl,
        position_notional=position.notional,
        open_order_count=len(open_orders),
        fill_count=len(fills),
    )



def build_completeness(diagnostics: list[LiveDiagnostic]) -> LiveCompleteness:
    codes = {item.code for item in diagnostics}
    partial_codes = {item.code for item in diagnostics if item.code in PARTIAL_FAILURE_CODES}
    return LiveCompleteness(
        fills_complete=not bool(codes & {"fills_truncated", "fills_not_available", "LIVE_BOT_FILLS_CAPPED"}),
        funding_complete=not bool(codes & {"funding_truncated", "funding_window_clipped", "funding_not_available"}),
        bills_window_clipped="funding_window_clipped" in codes,
        partial_failures=sorted(partial_codes),
    )



def build_ledger_summary(summary: LiveSnapshotSummary) -> LiveLedgerSummary:
    trading_net = summary.total_pnl - summary.unrealized_pnl - summary.funding_net
    return LiveLedgerSummary(
        trading_net=trading_net,
        fees=summary.fees_paid,
        funding=summary.funding_net,
        total_pnl=summary.total_pnl,
        realized=summary.realized_pnl,
        unrealized=summary.unrealized_pnl,
    )



def build_ledger_entries(
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
) -> list[LiveLedgerEntry]:
    entries: list[LiveLedgerEntry] = []

    for fill in fills:
        entries.append(
            LiveLedgerEntry(
                timestamp=fill.timestamp,
                kind="trade",
                amount=fill.realized_pnl,
                pnl=fill.realized_pnl,
                fee=0.0,
                currency=fill.fee_currency,
                side=fill.side,
                order_id=fill.order_id,
                trade_id=fill.trade_id,
                is_maker=fill.is_maker,
                note="成交已实现盈亏",
            )
        )
        if abs(fill.fee) > 0:
            entries.append(
                LiveLedgerEntry(
                    timestamp=fill.timestamp,
                    kind="fee",
                    amount=-abs(fill.fee),
                    pnl=0.0,
                    fee=abs(fill.fee),
                    currency=fill.fee_currency,
                    side=fill.side,
                    order_id=fill.order_id,
                    trade_id=fill.trade_id,
                    is_maker=fill.is_maker,
                    note="成交手续费",
                )
            )

    for funding in funding_entries:
        entries.append(
            LiveLedgerEntry(
                timestamp=funding.timestamp,
                kind="funding",
                amount=funding.amount,
                pnl=0.0,
                fee=0.0,
                currency=funding.currency,
                order_id=None,
                trade_id=None,
                note="资金费",
            )
        )

    return sorted(entries, key=lambda item: item.timestamp, reverse=True)



def build_daily_breakdown(entries: list[LiveLedgerEntry]) -> list[LiveDailyBreakdown]:
    grouped: dict[str, LiveDailyBreakdown] = {}
    for entry in entries:
        day = _normalize_datetime(entry.timestamp).date().isoformat()
        current = grouped.get(day)
        if current is None:
            current = LiveDailyBreakdown(date=day)
            grouped[day] = current

        current.entry_count += 1
        current.total_pnl += entry.amount
        if entry.kind == "trade":
            current.realized_pnl += entry.pnl
            current.trading_net += entry.amount
        elif entry.kind == "fee":
            current.fees_paid += abs(entry.fee)
            current.trading_net += entry.amount
        elif entry.kind == "funding":
            current.funding_net += entry.amount

    return sorted(grouped.values(), key=lambda item: item.date, reverse=True)



def infer_grid(position: LivePosition, open_orders: list[LiveOpenOrder]) -> LiveInferredGrid:
    levels = sorted({round(order.price, 12) for order in open_orders if order.price > 0})
    active_level_count = len(levels)
    if active_level_count < 2:
        return LiveInferredGrid(
            active_level_count=active_level_count,
            active_levels=levels,
            confidence=0.0,
            side=None if position.side == "flat" else GridSide(position.side),
            use_base_position=position.side != "flat" and abs(position.quantity) > 0,
            note="当前挂单层级不足，无法稳定推断完整网格。",
        )

    diffs = [round(levels[idx + 1] - levels[idx], 12) for idx in range(active_level_count - 1)]
    positive_diffs = [item for item in diffs if item > 0]
    spacing = min(positive_diffs) if positive_diffs else None
    spacing_consistency = 0.0
    if spacing and positive_diffs:
        close_count = sum(1 for item in positive_diffs if abs(item - spacing) <= max(spacing * 0.05, 1e-9))
        spacing_consistency = close_count / len(positive_diffs)

    confidence = min(1.0, 0.45 + spacing_consistency * 0.45 + (0.1 if position.side != "flat" else 0.0))
    return LiveInferredGrid(
        lower=levels[0],
        upper=levels[-1],
        grid_count=max(1, active_level_count - 1),
        grid_spacing=spacing,
        active_level_count=active_level_count,
        active_levels=levels,
        confidence=confidence,
        use_base_position=position.side != "flat" and abs(position.quantity) > 0,
        side=None if position.side == "flat" else GridSide(position.side),
        note="根据当前活动挂单价格层推断，适合作为回填参考而非精确还原。",
    )



def sort_orders(orders: Iterable[LiveOpenOrder]) -> list[LiveOpenOrder]:
    return sorted(orders, key=lambda item: (item.price, item.timestamp or _utc_now()))
