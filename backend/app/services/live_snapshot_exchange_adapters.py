from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from app.core.schemas import (
    LiveDiagnostic,
    LiveFill,
    LiveFundingEntry,
    LiveOpenOrder,
    LivePosition,
    LiveLedgerEntry,
    LiveSnapshotRequest,
)
from app.services.live_snapshot_types import ExchangeSnapshot, LiveSnapshotError


SafeFloat = Callable[[Any, float], float]
NormalizeDatetime = Callable[[Any], datetime]
DiagBuilder = Callable[[str, str, str], LiveDiagnostic]


def _backfill_okx_bot_fill_realized_pnl(
    fills: list[LiveFill],
    ledger_entries: list[LiveLedgerEntry],
) -> list[LiveFill]:
    if not fills or not ledger_entries:
        return fills

    def _normalize_key(value: str | None) -> str:
        raw = (value or "").strip()
        return raw if raw and raw != "0" else ""

    def _timestamp_key(value: datetime) -> str:
        return value.replace(microsecond=0).isoformat()

    trade_pnl_by_trade_id: dict[str, float] = {}
    trade_pnl_by_order_id: dict[str, float] = {}
    fee_by_trade_id: dict[str, float] = {}
    fee_by_order_id: dict[str, float] = {}
    trade_entries_by_timestamp: dict[str, list[LiveLedgerEntry]] = {}
    fee_entries_by_timestamp: dict[str, list[LiveLedgerEntry]] = {}
    fill_counts_by_timestamp: dict[str, int] = {}

    for fill in fills:
        ts_key = _timestamp_key(fill.timestamp)
        fill_counts_by_timestamp[ts_key] = fill_counts_by_timestamp.get(ts_key, 0) + 1

    for entry in ledger_entries:
        trade_id = _normalize_key(entry.trade_id)
        order_id = _normalize_key(entry.order_id)
        ts_key = _timestamp_key(entry.timestamp)
        if entry.kind == "trade" and abs(entry.pnl) > 1e-9:
            trade_entries_by_timestamp.setdefault(ts_key, []).append(entry)
            if trade_id:
                trade_pnl_by_trade_id[trade_id] = trade_pnl_by_trade_id.get(trade_id, 0.0) + entry.pnl
            if order_id:
                trade_pnl_by_order_id[order_id] = trade_pnl_by_order_id.get(order_id, 0.0) + entry.pnl
        elif entry.kind == "fee" and abs(entry.fee) > 1e-9:
            fee_entries_by_timestamp.setdefault(ts_key, []).append(entry)
            if trade_id:
                fee_by_trade_id[trade_id] = fee_by_trade_id.get(trade_id, 0.0) + entry.fee
            if order_id:
                fee_by_order_id[order_id] = fee_by_order_id.get(order_id, 0.0) + entry.fee

    if not trade_pnl_by_trade_id and not trade_pnl_by_order_id and not fee_by_trade_id and not fee_by_order_id:
        return fills

    def _sum_unambiguous(entries: list[LiveLedgerEntry], attr: str) -> float | None:
        if not entries:
            return None
        order_ids = {_normalize_key(entry.order_id) for entry in entries if _normalize_key(entry.order_id)}
        if len(order_ids) > 1:
            return None
        return sum(float(getattr(entry, attr)) for entry in entries)

    backfilled: list[LiveFill] = []
    for fill in fills:
        realized_pnl = fill.realized_pnl
        fee = fill.fee
        trade_id = _normalize_key(fill.trade_id)
        order_id = _normalize_key(fill.order_id)
        matched_by_id = False
        if trade_id and trade_id in trade_pnl_by_trade_id:
            realized_pnl = trade_pnl_by_trade_id[trade_id]
            matched_by_id = True
        elif order_id and order_id in trade_pnl_by_order_id:
            realized_pnl = trade_pnl_by_order_id[order_id]
            matched_by_id = True

        if trade_id and trade_id in fee_by_trade_id:
            fee = fee_by_trade_id[trade_id]
            matched_by_id = True
        elif order_id and order_id in fee_by_order_id:
            fee = fee_by_order_id[order_id]
            matched_by_id = True

        if not matched_by_id and abs(realized_pnl) <= 1e-9 and abs(fee) <= 1e-9:
            ts_key = _timestamp_key(fill.timestamp)
            if fill_counts_by_timestamp.get(ts_key, 0) == 1:
                fallback_realized = _sum_unambiguous(trade_entries_by_timestamp.get(ts_key, []), "pnl")
                fallback_fee = _sum_unambiguous(fee_entries_by_timestamp.get(ts_key, []), "fee")
                if fallback_realized is not None:
                    realized_pnl = fallback_realized
                if fallback_fee is not None:
                    fee = fallback_fee

        backfilled.append(fill.model_copy(update={"realized_pnl": realized_pnl, "fee": fee}))
    return backfilled


def fetch_binance_snapshot(
    payload: LiveSnapshotRequest,
    *,
    normalize_symbol: Callable[[str], str],
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any]], Any],
    collect_records: Callable[..., tuple[list[dict[str, Any]], bool]],
    ms: Callable[[datetime], int],
    safe_float: SafeFloat,
    normalize_datetime: NormalizeDatetime,
    sort_orders: Callable[[list[LiveOpenOrder]], list[LiveOpenOrder]],
    sort_and_dedupe_fills: Callable[[list[LiveFill]], list[LiveFill]],
    sort_and_dedupe_funding: Callable[[list[LiveFundingEntry]], list[LiveFundingEntry]],
    diag: DiagBuilder,
) -> ExchangeSnapshot:
    symbol = normalize_symbol(payload.symbol)
    diagnostics: list[LiveDiagnostic] = []

    position_payload = signed_get(payload, "/fapi/v2/positionRisk", {"symbol": symbol})
    orders_payload = signed_get(payload, "/fapi/v1/openOrders", {"symbol": symbol})
    try:
        trades_payload, trades_truncated = collect_records(
            payload,
            "/fapi/v1/userTrades",
            {"symbol": symbol, "startTime": ms(payload.strategy_started_at)},
            time_field="time",
        )
    except LiveSnapshotError as exc:
        trades_payload, trades_truncated = [], False
        diagnostics.append(diag("warning", "fills_not_available", f"Binance 成交明细暂不可用：{str(exc)}"))
    try:
        income_payload, income_truncated = collect_records(
            payload,
            "/fapi/v1/income",
            {"symbol": symbol, "incomeType": "FUNDING_FEE", "startTime": ms(payload.strategy_started_at)},
            time_field="time",
        )
    except LiveSnapshotError as exc:
        income_payload, income_truncated = [], False
        diagnostics.append(diag("warning", "funding_not_available", f"Binance 资金费账单暂不可用：{str(exc)}"))

    positions = position_payload if isinstance(position_payload, list) else []
    position_info = next((item for item in positions if str(item.get("symbol", "")).upper() == symbol), {})
    position_amt = safe_float(position_info.get("positionAmt"), 0.0)
    position_side = "flat"
    if position_amt > 0:
        position_side = "long"
    elif position_amt < 0:
        position_side = "short"
    position = LivePosition(
        side=position_side,
        quantity=abs(position_amt),
        entry_price=safe_float(position_info.get("entryPrice"), 0.0),
        mark_price=safe_float(position_info.get("markPrice"), 0.0),
        notional=abs(safe_float(position_info.get("notional"), 0.0)),
        leverage=safe_float(position_info.get("leverage"), fallback=0.0) or None,
        liquidation_price=safe_float(position_info.get("liquidationPrice"), fallback=0.0) or None,
        margin_mode=str(position_info.get("marginType") or "").lower() or None,
        unrealized_pnl=safe_float(position_info.get("unRealizedProfit"), 0.0),
    )

    open_orders = sort_orders(
        [
            LiveOpenOrder(
                order_id=str(item.get("orderId") or item.get("clientOrderId") or "unknown"),
                client_order_id=str(item.get("clientOrderId") or "") or None,
                side="buy" if str(item.get("side", "")).upper() == "BUY" else "sell",
                price=safe_float(item.get("price"), 0.0),
                quantity=safe_float(item.get("origQty"), 0.0),
                filled_quantity=safe_float(item.get("executedQty"), 0.0),
                reduce_only=bool(item.get("reduceOnly", False)),
                status=str(item.get("status") or "open"),
                timestamp=normalize_datetime(item.get("time")) if item.get("time") is not None else None,
            )
            for item in (orders_payload if isinstance(orders_payload, list) else [])
        ]
    )

    fills = sort_and_dedupe_fills(
        [
            LiveFill(
                trade_id=str(item.get("id") or item.get("tradeId") or item.get("orderId") or "unknown"),
                order_id=str(item.get("orderId") or "") or None,
                side="buy" if str(item.get("side", "")).upper() == "BUY" else "sell",
                price=safe_float(item.get("price"), 0.0),
                quantity=safe_float(item.get("qty"), 0.0),
                realized_pnl=safe_float(item.get("realizedPnl"), 0.0),
                fee=abs(safe_float(item.get("commission"), 0.0)),
                fee_currency=str(item.get("commissionAsset") or "") or None,
                is_maker=bool(item.get("maker")) if item.get("maker") is not None else None,
                timestamp=normalize_datetime(item.get("time")),
            )
            for item in (trades_payload if isinstance(trades_payload, list) else [])
        ]
    )

    funding_entries = sort_and_dedupe_funding(
        [
            LiveFundingEntry(
                timestamp=normalize_datetime(item.get("time")),
                amount=safe_float(item.get("income"), 0.0),
                currency=str(item.get("asset") or "") or None,
            )
            for item in (income_payload if isinstance(income_payload, list) else [])
        ]
    )

    if trades_truncated:
        diagnostics.append(LiveDiagnostic(level="warning", code="fills_truncated", message="成交明细可能已被截断，请缩小收益统计起点。"))
    if income_truncated:
        diagnostics.append(LiveDiagnostic(level="warning", code="funding_truncated", message="资金费明细可能已被截断，请缩小收益统计起点。"))

    return ExchangeSnapshot(
        exchange_symbol=symbol,
        position=position,
        open_orders=open_orders,
        fills=fills,
        funding_entries=funding_entries,
        diagnostics=diagnostics,
    )



def fetch_bybit_snapshot(
    payload: LiveSnapshotRequest,
    *,
    normalize_symbol: Callable[[str], str],
    utc_now: Callable[[], datetime],
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any]], Any],
    collect_execution_history: Callable[..., tuple[list[dict[str, Any]], bool]],
    collect_transaction_logs: Callable[..., tuple[list[dict[str, Any]], bool, str | None]],
    build_funding_entries: Callable[[list[dict[str, Any]]], list[LiveFundingEntry]],
    safe_float: SafeFloat,
    normalize_datetime: NormalizeDatetime,
    sort_orders: Callable[[list[LiveOpenOrder]], list[LiveOpenOrder]],
    sort_and_dedupe_fills: Callable[[list[LiveFill]], list[LiveFill]],
    diag: DiagBuilder,
) -> ExchangeSnapshot:
    symbol = normalize_symbol(payload.symbol)
    diagnostics: list[LiveDiagnostic] = []
    now = utc_now()

    position_payload = signed_get(payload, "/v5/position/list", {"category": "linear", "symbol": symbol})
    orders_payload = signed_get(payload, "/v5/order/realtime", {"category": "linear", "symbol": symbol, "openOnly": 0})
    try:
        executions, executions_truncated = collect_execution_history(
            payload,
            symbol,
            start_at=payload.strategy_started_at,
            end_at=now,
        )
    except LiveSnapshotError as exc:
        executions, executions_truncated = [], False
        diagnostics.append(diag("warning", "fills_not_available", f"Bybit 成交明细暂不可用：{str(exc)}"))
    try:
        transaction_logs, transaction_truncated, transaction_meta = collect_transaction_logs(
            payload,
            symbol,
            start_at=payload.strategy_started_at,
            end_at=now,
        )
    except LiveSnapshotError as exc:
        transaction_logs, transaction_truncated, transaction_meta = [], False, str(exc)
        diagnostics.append(diag("warning", "funding_not_available", f"Bybit 资金费账单暂不可用：{str(exc)}"))

    positions = position_payload.get("list", []) if isinstance(position_payload, dict) else []
    position_info = positions[0] if isinstance(positions, list) and positions else {}
    side_raw = str(position_info.get("side") or "").lower()
    if side_raw == "buy":
        position_side = "long"
    elif side_raw == "sell":
        position_side = "short"
    else:
        position_side = "flat"
    position = LivePosition(
        side=position_side,
        quantity=abs(safe_float(position_info.get("size"), 0.0)),
        entry_price=safe_float(position_info.get("avgPrice"), 0.0),
        mark_price=safe_float(position_info.get("markPrice"), 0.0),
        notional=abs(safe_float(position_info.get("positionValue"), 0.0)),
        leverage=safe_float(position_info.get("leverage"), fallback=0.0) or None,
        liquidation_price=safe_float(position_info.get("liqPrice"), fallback=0.0) or None,
        margin_mode=str(position_info.get("tradeMode") or "") or None,
        unrealized_pnl=safe_float(position_info.get("unrealisedPnl"), 0.0),
        realized_pnl=safe_float(position_info.get("cumRealisedPnl"), 0.0),
    )

    orders = orders_payload.get("list", []) if isinstance(orders_payload, dict) else []
    open_orders = sort_orders(
        [
            LiveOpenOrder(
                order_id=str(item.get("orderId") or item.get("orderLinkId") or "unknown"),
                client_order_id=str(item.get("orderLinkId") or "") or None,
                side="buy" if str(item.get("side", "")).lower() == "buy" else "sell",
                price=safe_float(item.get("price"), 0.0),
                quantity=safe_float(item.get("qty"), 0.0),
                filled_quantity=safe_float(item.get("cumExecQty"), 0.0),
                reduce_only=bool(item.get("reduceOnly", False)),
                status=str(item.get("orderStatus") or "open"),
                timestamp=normalize_datetime(item.get("createdTime")) if item.get("createdTime") is not None else None,
            )
            for item in (orders if isinstance(orders, list) else [])
        ]
    )

    fills = sort_and_dedupe_fills(
        [
            LiveFill(
                trade_id=str(item.get("execId") or item.get("orderId") or "unknown"),
                order_id=str(item.get("orderId") or "") or None,
                side="buy" if str(item.get("side", "")).lower() == "buy" else "sell",
                price=safe_float(item.get("execPrice"), 0.0),
                quantity=safe_float(item.get("execQty"), 0.0),
                realized_pnl=safe_float(item.get("execPnl") or item.get("closedPnl"), 0.0),
                fee=abs(safe_float(item.get("execFee"), 0.0)),
                fee_currency=str(item.get("feeCurrency") or "") or None,
                is_maker=(str(item.get("isMaker", "")).lower() == "true") if item.get("isMaker") is not None else None,
                timestamp=normalize_datetime(item.get("execTime")),
            )
            for item in (executions if isinstance(executions, list) else [])
        ]
    )

    funding_entries = build_funding_entries(transaction_logs)
    if transaction_meta and transaction_meta in {"UNIFIED", "CONTRACT"}:
        diagnostics.append(
            LiveDiagnostic(
                level="info",
                code="funding_source",
                message=f"Bybit 资金费账单来自 {transaction_meta} 账户交易日志。",
            )
        )
    elif transaction_meta:
        diagnostics.append(
            LiveDiagnostic(
                level="warning",
                code="funding_not_available",
                message=f"Bybit 资金费账单暂不可用：{transaction_meta}",
            )
        )

    if executions_truncated:
        diagnostics.append(LiveDiagnostic(level="warning", code="fills_truncated", message="成交明细可能已被截断，请缩小收益统计起点。"))
    if transaction_truncated:
        diagnostics.append(LiveDiagnostic(level="warning", code="funding_truncated", message="资金费账单可能已被截断，请缩小收益统计起点。"))
    if not funding_entries:
        diagnostics.append(
            LiveDiagnostic(
                level="warning",
                code="funding_empty",
                message="当前统计区间内未拿到 Bybit 资金费账单，可能是区间内无资金费或账户类型不支持。",
            )
        )

    return ExchangeSnapshot(
        exchange_symbol=symbol,
        position=position,
        open_orders=open_orders,
        fills=fills,
        funding_entries=funding_entries,
        diagnostics=diagnostics,
    )



def fetch_okx_bot_snapshot(
    payload: LiveSnapshotRequest,
    *,
    perf_counter: Callable[[], float],
    bot_get_first_available: Callable[..., tuple[list[dict[str, Any]], bool]],
    detail_paths: tuple[str, ...],
    optional_datetime: Callable[[Any], datetime | None],
    first_present: Callable[..., Any],
    resolve_effective_strategy_started_at: Callable[[datetime, datetime | None], datetime],
    resolve_created_at_from_list: Callable[[LiveSnapshotRequest], datetime | None],
    bot_get_sub_orders: Callable[..., tuple[list[dict[str, Any]], bool, int, bool]],
    diag: DiagBuilder,
    build_position: Callable[[dict[str, Any]], LivePosition],
    build_open_orders: Callable[[list[dict[str, Any]]], list[LiveOpenOrder]],
    build_fills: Callable[[list[dict[str, Any]]], list[LiveFill]],
    build_funding_entries: Callable[[dict[str, Any]], tuple[list[LiveFundingEntry], bool]],
    collect_funding_entries: Callable[..., tuple[list[LiveFundingEntry], bool, bool]],
    collect_ledger_entries: Callable[..., tuple[list[LiveLedgerEntry], bool, bool]],
    coerce_text: Callable[[Any], str],
    normalize_symbol: Callable[[str], str],
    build_inferred_grid: Callable[..., Any],
    build_summary: Callable[..., Any],
    build_robot_overview: Callable[..., Any],
    fills_page_limit: int,
    max_fills_items: int,
) -> ExchangeSnapshot:
    diagnostics: list[LiveDiagnostic] = []
    started_at = perf_counter()
    detail_payload, _ = bot_get_first_available(payload, detail_paths, required=True)
    detail = next((item for item in detail_payload if isinstance(item, dict)), None)
    if detail is None:
        raise LiveSnapshotError(
            "未找到对应的 OKX 机器人实例，请检查 algoId。",
            status_code=400,
            code="LIVE_BOT_NOT_FOUND",
            retryable=False,
        )

    robot_created_at = optional_datetime(first_present(detail, "cTime", "createdAt", "createTime"))
    if robot_created_at is None:
        robot_created_at = resolve_created_at_from_list(payload)
    effective_strategy_started_at = resolve_effective_strategy_started_at(payload.strategy_started_at, robot_created_at)

    pending_payload, pending_available, orders_page_count, _ = bot_get_sub_orders(payload, "live", limit=100, max_items=200)
    history_payload, history_available, fills_page_count, fills_capped = bot_get_sub_orders(
        payload,
        "filled",
        limit=fills_page_limit,
        start_at=effective_strategy_started_at,
        max_items=max_fills_items,
    )
    if not pending_available:
        diagnostics.append(diag("warning", "LIVE_BOT_ORDERS_UNAVAILABLE", "OKX 机器人活动子单暂不可用。"))
    if not history_available:
        diagnostics.append(diag("warning", "fills_not_available", "OKX 机器人子单成交暂不可用。"))
    if fills_capped:
        diagnostics.append(diag("warning", "LIVE_BOT_FILLS_CAPPED", f"OKX 机器人子单成交已达到 {max_fills_items} 条上限，较早记录未纳入统计。"))

    position = build_position(detail)
    open_orders = build_open_orders([item for item in pending_payload if isinstance(item, dict)])
    fills = build_fills([item for item in history_payload if isinstance(item, dict)])
    symbol = normalize_symbol(payload.symbol)
    funding_entries: list[LiveFundingEntry] = []
    funding_complete = False
    try:
        funding_entries, funding_truncated, funding_clipped = collect_funding_entries(
            payload,
            symbol,
            start_at=effective_strategy_started_at,
            end_at=datetime.now(timezone.utc),
        )
        funding_complete = bool(funding_entries) and not funding_truncated and not funding_clipped
        if funding_truncated:
            diagnostics.append(diag("warning", "funding_truncated", "OKX 资金费账单可能已被截断，请缩小收益统计起点。"))
        if funding_clipped:
            diagnostics.append(diag("warning", "funding_window_clipped", "OKX 账单接口最多回溯近 3 个月，较早资金费未纳入统计。"))
    except LiveSnapshotError:
        funding_entries = []

    if not funding_entries:
        funding_entries, funding_complete = build_funding_entries(detail)
    ledger_entries: list[LiveLedgerEntry] = []
    try:
        ledger_entries, _, _ = collect_ledger_entries(
            payload,
            symbol,
            start_at=effective_strategy_started_at,
            end_at=datetime.now(timezone.utc),
        )
    except LiveSnapshotError:
        ledger_entries = []
    fills = _backfill_okx_bot_fill_realized_pnl(fills, ledger_entries)
    if funding_entries:
        seen_funding_keys = {
            (entry.timestamp.isoformat(), round(entry.amount, 12), entry.currency or "")
            for entry in ledger_entries
            if entry.kind == "funding"
        }
        for funding in funding_entries:
            key = (funding.timestamp.isoformat(), round(funding.amount, 12), funding.currency or "")
            if key in seen_funding_keys:
                continue
            ledger_entries.append(
                LiveLedgerEntry(
                    timestamp=funding.timestamp,
                    kind="funding",
                    amount=funding.amount,
                    pnl=0.0,
                    fee=0.0,
                    currency=funding.currency,
                    note="资金费",
                )
            )
            seen_funding_keys.add(key)
        ledger_entries = sorted(ledger_entries, key=lambda item: item.timestamp, reverse=True)

    if funding_complete:
        diagnostics.append(diag("info", "funding_source", "OKX 机器人资金费已按账单明细逐笔同步。"))
    else:
        diagnostics.append(diag("warning", "funding_not_available", "OKX 机器人接口未返回资金费明细，资金费统计暂不可用。"))

    exchange_symbol = coerce_text(first_present(detail, "instId", "symbol") or normalize_symbol(payload.symbol))
    inferred_grid = build_inferred_grid(detail, position=position, open_orders=open_orders, algo_id=payload.algo_id or "")
    summary = build_summary(detail, position=position, open_orders=open_orders, fills=fills, funding_entries=funding_entries)
    robot = build_robot_overview(detail, algo_id=payload.algo_id or "", position=position, summary=summary, inferred_grid=inferred_grid)
    return ExchangeSnapshot(
        exchange_symbol=exchange_symbol,
        symbol=payload.symbol,
        position=position,
        open_orders=open_orders,
        fills=fills,
        funding_entries=funding_entries,
        diagnostics=diagnostics,
        inferred_grid=inferred_grid,
        summary=summary,
        robot=robot,
        source_latency_ms=int((perf_counter() - started_at) * 1000),
        orders_page_count=orders_page_count,
        fills_page_count=fills_page_count,
        fills_capped=fills_capped,
    )



def fetch_okx_snapshot(
    payload: LiveSnapshotRequest,
    *,
    normalize_symbol: Callable[[str], str],
    utc_now: Callable[[], datetime],
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any] | None], Any],
    ms: Callable[[datetime], int],
    safe_float: SafeFloat,
    normalize_datetime: NormalizeDatetime,
    collect_funding_entries: Callable[..., tuple[list[LiveFundingEntry], bool, bool]],
    sort_orders: Callable[[list[LiveOpenOrder]], list[LiveOpenOrder]],
    sort_and_dedupe_fills: Callable[[list[LiveFill]], list[LiveFill]],
    diag: DiagBuilder,
) -> ExchangeSnapshot:
    symbol = normalize_symbol(payload.symbol)
    diagnostics: list[LiveDiagnostic] = []
    now = utc_now()

    position_payload = signed_get(payload, "/api/v5/account/positions", {"instId": symbol})
    orders_payload = signed_get(payload, "/api/v5/trade/orders-pending", {"instId": symbol})
    try:
        fills_payload = signed_get(
            payload,
            "/api/v5/trade/fills-history",
            {"instType": "SWAP", "instId": symbol, "begin": ms(payload.strategy_started_at), "limit": 100},
        )
    except LiveSnapshotError as exc:
        fills_payload = []
        diagnostics.append(diag("warning", "fills_not_available", f"OKX 成交明细暂不可用：{str(exc)}"))

    position_info = position_payload[0] if isinstance(position_payload, list) and position_payload else {}
    pos = safe_float(position_info.get("pos"), 0.0)
    side_raw = str(position_info.get("posSide") or "").lower()
    if side_raw == "long" or pos > 0:
        position_side = "long"
    elif side_raw == "short" or pos < 0:
        position_side = "short"
    else:
        position_side = "flat"
    position = LivePosition(
        side=position_side,
        quantity=abs(pos),
        entry_price=safe_float(position_info.get("avgPx"), 0.0),
        mark_price=safe_float(position_info.get("markPx"), 0.0),
        notional=abs(safe_float(position_info.get("notionalUsd") or position_info.get("notionalCcy"), 0.0)),
        leverage=safe_float(position_info.get("lever"), fallback=0.0) or None,
        liquidation_price=safe_float(position_info.get("liqPx"), fallback=0.0) or None,
        margin_mode=str(position_info.get("mgnMode") or "") or None,
        unrealized_pnl=safe_float(position_info.get("upl"), 0.0),
        realized_pnl=safe_float(position_info.get("realizedPnl"), 0.0),
    )

    open_orders = sort_orders(
        [
            LiveOpenOrder(
                order_id=str(item.get("ordId") or item.get("clOrdId") or "unknown"),
                client_order_id=str(item.get("clOrdId") or "") or None,
                side="buy" if str(item.get("side", "")).lower() == "buy" else "sell",
                price=safe_float(item.get("px"), 0.0),
                quantity=safe_float(item.get("sz"), 0.0),
                filled_quantity=safe_float(item.get("accFillSz"), 0.0),
                reduce_only=bool(item.get("reduceOnly", False)),
                status=str(item.get("state") or "open"),
                timestamp=normalize_datetime(item.get("cTime")) if item.get("cTime") is not None else None,
            )
            for item in (orders_payload if isinstance(orders_payload, list) else [])
        ]
    )

    fills = sort_and_dedupe_fills(
        [
            LiveFill(
                trade_id=str(item.get("tradeId") or item.get("billId") or item.get("ordId") or "unknown"),
                order_id=str(item.get("ordId") or "") or None,
                side="buy" if str(item.get("side", "")).lower() == "buy" else "sell",
                price=safe_float(item.get("fillPx"), 0.0),
                quantity=safe_float(item.get("fillSz"), 0.0),
                realized_pnl=safe_float(item.get("fillPnl"), 0.0),
                fee=abs(safe_float(item.get("fee"), 0.0)),
                fee_currency=str(item.get("feeCcy") or "") or None,
                is_maker=(str(item.get("execType", "")).lower() == "m") if item.get("execType") is not None else None,
                timestamp=normalize_datetime(item.get("ts")),
            )
            for item in (fills_payload if isinstance(fills_payload, list) else [])
        ]
    )

    try:
        funding_entries, funding_truncated, funding_clipped = collect_funding_entries(
            payload,
            symbol,
            start_at=payload.strategy_started_at,
            end_at=now,
        )
        diagnostics.append(
            LiveDiagnostic(
                level="info",
                code="funding_source",
                message="OKX 资金费账单已按近 7 天账单和归档账单拼接归一化。",
            )
        )
        if funding_truncated:
            diagnostics.append(LiveDiagnostic(level="warning", code="funding_truncated", message="OKX 资金费账单可能已被截断，请缩小收益统计起点。"))
        if funding_clipped:
            diagnostics.append(LiveDiagnostic(level="warning", code="funding_window_clipped", message="OKX 账单接口最多回溯近 3 个月，较早的资金费未纳入统计。"))
        if not funding_entries:
            diagnostics.append(LiveDiagnostic(level="warning", code="funding_empty", message="当前统计区间内未拿到 OKX 资金费账单，可能是区间内无资金费。"))
    except LiveSnapshotError:
        funding_entries = []
        diagnostics.append(
            LiveDiagnostic(
                level="warning",
                code="funding_not_available",
                message="OKX 首版未能稳定获取资金费账单，资金费统计暂按 0 处理。",
            )
        )

    if len(fills_payload) >= 100:
        diagnostics.append(LiveDiagnostic(level="warning", code="fills_truncated", message="成交明细可能已被截断，请缩小收益统计起点。"))

    return ExchangeSnapshot(
        exchange_symbol=symbol,
        position=position,
        open_orders=open_orders,
        fills=fills,
        funding_entries=funding_entries,
        diagnostics=diagnostics,
    )
