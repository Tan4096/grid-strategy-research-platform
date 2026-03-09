from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.schemas import DataSource, GridSide, LiveDiagnostic, LiveFill, LiveFundingEntry, LiveInferredGrid, LiveLedgerEntry, LiveMonitoringInfo, LiveOpenOrder, LivePosition, LiveRobotListItem, LiveRobotListRequest, LiveRobotListResponse, LiveRobotOverview, LiveSnapshotRequest, LiveSnapshotSummary
from app.services.data_loader import DataLoadError
from app.services.live_snapshot_adapters import (
    okx_bot_get_first_available as adapter_okx_bot_get_first_available,
    okx_bot_get_sub_orders as adapter_okx_bot_get_sub_orders,
    okx_bot_list_param_variants as adapter_okx_bot_list_param_variants,
    okx_bot_param_variants as adapter_okx_bot_param_variants,
    okx_bot_sub_order_paths as adapter_okx_bot_sub_order_paths,
    okx_signed_get_robot_list as adapter_okx_signed_get_robot_list,
)
from app.services.live_snapshot_exchange_adapters import fetch_okx_bot_snapshot as exchange_fetch_okx_bot_snapshot
from app.services.live_snapshot_types import ExchangeSnapshot, LiveSnapshotError
from app.services.symbol_utils import normalize_symbol_for_source

OKX_BASE_URL = "https://www.okx.com"
OKX_BOT_ALGO_TYPE_CANDIDATES = ("contract_grid", "grid")
OKX_BOT_DETAIL_PATHS = ("/api/v5/tradingBot/grid/orders-algo-details",)
OKX_BOT_PENDING_ORDER_PATHS = (
    "/api/v5/tradingBot/grid/sub-orders",
    "/api/v5/tradingBot/grid/orders-algo-pending",
)
OKX_BOT_HISTORY_ORDER_PATHS = (
    "/api/v5/tradingBot/grid/sub-orders-history",
    "/api/v5/tradingBot/grid/orders-algo-history",
)
OKX_BOT_SUB_ORDER_PATH = "/api/v5/tradingBot/grid/sub-orders"
OKX_ROBOT_LIST_CACHE_TTL_SEC = 10.0
OKX_FILLS_PAGE_LIMIT = 100
OKX_MAX_FILLS_ITEMS = 1000
OKX_RECENT_HISTORY_DAYS = 7


def build_live_monitoring_info(*, poll_interval_sec: int, last_success_at: datetime, source_latency_ms: int, fills_page_count: int, fills_capped: bool, orders_page_count: int, stale: bool, utc_now, normalize_datetime) -> LiveMonitoringInfo:
    freshness_sec = max(0, int((utc_now() - normalize_datetime(last_success_at)).total_seconds()))
    return LiveMonitoringInfo(
        poll_interval_sec=poll_interval_sec,
        last_success_at=normalize_datetime(last_success_at),
        freshness_sec=freshness_sec,
        stale=stale,
        source_latency_ms=source_latency_ms,
        fills_page_count=fills_page_count,
        fills_capped=fills_capped,
        orders_page_count=orders_page_count,
    )



def okx_bot_list_param_variants(extra_params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    return adapter_okx_bot_list_param_variants(extra_params, algo_type_candidates=OKX_BOT_ALGO_TYPE_CANDIDATES)



def okx_signed_get_robot_list(payload: LiveRobotListRequest, path: str, params: Optional[dict[str, Any]] = None, *, query_string, request_json, iso_timestamp, sanitize_error_message) -> Any:
    return adapter_okx_signed_get_robot_list(
        payload,
        path,
        params,
        query_string=query_string,
        request_json=request_json,
        iso_timestamp=iso_timestamp,
        sanitize_error_message=sanitize_error_message,
        base_url=OKX_BASE_URL,
    )



def build_live_robot_list_item(item: dict[str, Any], *, coerce_text, first_present, normalize_position_side, optional_datetime, optional_float, optional_int) -> LiveRobotListItem | None:
    algo_id = coerce_text(first_present(item, "algoId", "ordId"))
    if not algo_id:
        return None
    exchange_symbol = coerce_text(first_present(item, "instId", "instFamily", "uly"))
    if not exchange_symbol:
        return None
    symbol = normalize_symbol_for_source(DataSource.OKX, exchange_symbol)
    name = coerce_text(first_present(item, "algoClOrdId", "name", "alias")) or f"{exchange_symbol} · {algo_id[-6:]}"
    side_raw = normalize_position_side(first_present(item, "direction", "side", "posSide"), quantity=0.0)
    side = None if side_raw == "flat" else side_raw
    return LiveRobotListItem(
        algo_id=algo_id,
        name=name,
        symbol=symbol,
        exchange_symbol=exchange_symbol,
        state=coerce_text(first_present(item, "state", "status")) or None,
        side=side,
        updated_at=optional_datetime(first_present(item, "uTime", "updatedAt", "updateTime", "cTime")),
        run_type=coerce_text(first_present(item, "runType", "run_type")) or None,
        configured_leverage=optional_float(first_present(item, "lever", "leverage")),
        investment_usdt=optional_float(first_present(item, "investment", "investAmt", "invest", "sz", "quoteSz")),
        lower_price=optional_float(first_present(item, "minPx", "lowerPx", "lower")),
        upper_price=optional_float(first_present(item, "maxPx", "upperPx", "upper")),
        grid_count=optional_int(first_present(item, "gridNum", "gridCount", "grid_count")),
    )



def fetch_okx_robot_list(
    payload: LiveRobotListRequest,
    *,
    cache_get_fresh,
    cache_set,
    cache_key_for_robot_list,
    cache_store,
    retry_live_action,
    signed_get_robot_list,
    utc_now,
    build_robot_list_item,
) -> LiveRobotListResponse:
    cache_key = cache_key_for_robot_list(payload)
    cached = cache_get_fresh(cache_store, cache_key, OKX_ROBOT_LIST_CACHE_TTL_SEC)
    if cached is not None:
        return cached

    items_by_id: dict[str, LiveRobotListItem] = {}
    recent_cutoff = utc_now() - timedelta(days=OKX_RECENT_HISTORY_DAYS)
    had_success = False
    last_error: LiveSnapshotError | None = None

    def ingest(raw_items: list[dict[str, Any]], *, include_non_running: bool) -> None:
        for raw in raw_items if isinstance(raw_items, list) else []:
            if not isinstance(raw, dict):
                continue
            built = build_robot_list_item(raw)
            if built is None:
                continue
            if not include_non_running and (built.state or "").lower() != "running":
                continue
            if include_non_running and built.updated_at and built.updated_at < recent_cutoff:
                continue
            existing = items_by_id.get(built.algo_id)
            existing_updated = existing.updated_at if existing and existing.updated_at is not None else datetime.min.replace(tzinfo=timezone.utc)
            built_updated = built.updated_at if built.updated_at is not None else datetime.min.replace(tzinfo=timezone.utc)
            if existing is None or built_updated > existing_updated:
                items_by_id[built.algo_id] = built

    def fetch_path(path_name: str, *, include_non_running: bool, extra_params: dict[str, Any] | None = None) -> None:
        nonlocal had_success, last_error
        for params in okx_bot_list_param_variants(extra_params):
            try:
                response_items = retry_live_action(lambda: signed_get_robot_list(payload, path_name, params), retries=1)
                raw_data = response_items.get("data") if isinstance(response_items, dict) else response_items
                if isinstance(raw_data, list):
                    had_success = True
                    ingest(raw_data, include_non_running=include_non_running)
                    if raw_data:
                        return
            except LiveSnapshotError as exc:
                last_error = exc
                continue

    fetch_path("/api/v5/tradingBot/grid/orders-algo-pending", include_non_running=False)
    include_recent = (payload.scope or "running") == "recent"
    if include_recent:
        fetch_path("/api/v5/tradingBot/grid/orders-algo-history", include_non_running=True)

    if not items_by_id and not had_success and last_error is not None:
        raise last_error

    items = sorted(
        items_by_id.values(),
        key=lambda item: (
            0 if (item.state or "").lower() == "running" else 1,
            -(item.updated_at.timestamp() if item.updated_at else 0.0),
            item.algo_id,
        ),
    )
    response = LiveRobotListResponse(scope=payload.scope or "running", items=items)
    cache_set(cache_store, cache_key, response)
    return response



def okx_bot_param_variants(payload: LiveSnapshotRequest, extra_params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    return adapter_okx_bot_param_variants(payload, extra_params=extra_params, algo_type_candidates=OKX_BOT_ALGO_TYPE_CANDIDATES)



def okx_bot_get_first_available(payload: LiveSnapshotRequest, paths: tuple[str, ...], *, extra_params: Optional[dict[str, Any]] = None, required: bool = False, okx_signed_get, bot_param_variants) -> tuple[list[dict[str, Any]], bool]:
    return adapter_okx_bot_get_first_available(payload, paths, extra_params=extra_params, required=required, okx_signed_get=okx_signed_get, bot_param_variants=bot_param_variants)



def okx_bot_sub_order_paths(entry_type: str) -> tuple[str, ...]:
    return adapter_okx_bot_sub_order_paths(
        entry_type,
        pending_paths=OKX_BOT_PENDING_ORDER_PATHS,
        history_paths=OKX_BOT_HISTORY_ORDER_PATHS,
        sub_order_path=OKX_BOT_SUB_ORDER_PATH,
    )



def okx_bot_get_sub_orders(payload: LiveSnapshotRequest, entry_type: str, *, limit: int, start_at: datetime | None, max_items: int, normalize_datetime, sub_order_paths, bot_param_variants, retry_live_action, okx_signed_get, first_present, optional_datetime, coerce_optional_text) -> tuple[list[dict[str, Any]], bool, int, bool]:
    return adapter_okx_bot_get_sub_orders(
        payload,
        entry_type,
        limit=limit,
        start_at=start_at,
        max_items=max_items,
        normalize_datetime=normalize_datetime,
        sub_order_paths=sub_order_paths,
        bot_param_variants=bot_param_variants,
        retry_live_action=retry_live_action,
        okx_signed_get=okx_signed_get,
        first_present=first_present,
        optional_datetime=optional_datetime,
        coerce_optional_text=coerce_optional_text,
    )



def build_okx_bot_position(detail: dict[str, Any], *, normalize_position_side, first_present, safe_float, optional_float) -> LivePosition:
    quantity = safe_float(first_present(detail, "sz", "pos", "position", "quantity"), fallback=0.0)
    return LivePosition(
        side=normalize_position_side(first_present(detail, "posSide", "side", "direction"), quantity=quantity),
        quantity=abs(quantity),
        entry_price=safe_float(first_present(detail, "avgPx", "avgPrice", "entryPrice"), fallback=0.0),
        mark_price=safe_float(first_present(detail, "markPx", "markPrice", "lastPrice", "last"), fallback=0.0),
        notional=safe_float(first_present(detail, "notionalUsd", "notional", "positionNotional"), fallback=0.0),
        leverage=optional_float(first_present(detail, "lever", "leverage")),
        liquidation_price=optional_float(first_present(detail, "liqPx", "liquidationPx")),
        margin_mode=first_present(detail, "mgnMode", "marginMode") or None,
        unrealized_pnl=safe_float(first_present(detail, "upl", "floatProfit", "unrealizedPnl"), fallback=0.0),
        realized_pnl=safe_float(first_present(detail, "realizedPnl", "gridProfit", "pnl"), fallback=0.0),
    )



def build_okx_bot_open_orders(items: list[dict[str, Any]], *, first_present, safe_float, coerce_text, normalize_order_side, sort_orders) -> list[LiveOpenOrder]:
    orders: list[LiveOpenOrder] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        price = safe_float(first_present(item, "px", "price"), fallback=0.0)
        quantity = abs(safe_float(first_present(item, "sz", "quantity", "orderSz"), fallback=0.0))
        if price <= 0 or quantity <= 0:
            continue
        orders.append(
            LiveOpenOrder(
                order_id=coerce_text(first_present(item, "ordId", "orderId")) or "",
                client_order_id=coerce_text(first_present(item, "clOrdId", "clientOrderId")) or None,
                side=normalize_order_side(first_present(item, "side", "direction")),
                price=price,
                quantity=quantity,
                filled_quantity=abs(safe_float(first_present(item, "accFillSz", "filledSz"), fallback=0.0)),
                reduce_only=bool(first_present(item, "reduceOnly")),
                status=coerce_text(first_present(item, "state", "status")) or "live",
                timestamp=coerce_text(first_present(item, "cTime", "uTime", "timestamp")) or datetime.now(timezone.utc).isoformat(),
            )
        )
    return sort_orders(orders)



def build_okx_bot_fills(items: list[dict[str, Any]], *, first_present, safe_float, coerce_text, normalize_order_side, sort_and_dedupe_fills) -> list[LiveFill]:
    fills: list[LiveFill] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        trade_id = coerce_text(first_present(item, "tradeId", "fillId", "billId"))
        if not trade_id:
            continue
        fills.append(
            LiveFill(
                trade_id=trade_id,
                order_id=coerce_text(first_present(item, "ordId", "orderId")) or None,
                side=normalize_order_side(first_present(item, "side", "direction")),
                price=safe_float(first_present(item, "fillPx", "px", "price"), fallback=0.0),
                quantity=abs(safe_float(first_present(item, "fillSz", "sz", "quantity"), fallback=0.0)),
                realized_pnl=safe_float(first_present(item, "fillPnl", "pnl", "realizedPnl"), fallback=0.0),
                fee=abs(safe_float(first_present(item, "fee", "fillFee"), fallback=0.0)),
                fee_currency=coerce_text(first_present(item, "feeCcy", "feeCurrency")) or None,
                is_maker=None,
                timestamp=coerce_text(first_present(item, "fillTime", "cTime", "timestamp")) or datetime.now(timezone.utc).isoformat(),
            )
        )
    return sort_and_dedupe_fills(fills)



def build_okx_bot_funding_entries(detail: dict[str, Any], *, first_present, safe_float, optional_datetime, sort_and_dedupe_funding) -> tuple[list[LiveFundingEntry], bool]:
    amount = safe_float(first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding"), fallback=0.0)
    if amount == 0.0:
        return [], False
    entry = LiveFundingEntry(
        timestamp=optional_datetime(first_present(detail, "uTime", "updatedAt", "cTime")) or datetime.now(timezone.utc),
        amount=amount,
        rate=None,
        position_size=None,
        currency="USDT",
    )
    return sort_and_dedupe_funding([entry]), False



def resolve_effective_strategy_started_at(payload_start: datetime, robot_created_at: datetime | None) -> datetime:
    payload_ts = payload_start
    if robot_created_at is None:
        return payload_ts
    robot_ts = robot_created_at
    return robot_ts if robot_ts <= payload_ts else payload_ts



def resolve_okx_bot_created_at_from_list(payload: LiveSnapshotRequest, *, signed_get_robot_list, retry_live_action, build_robot_list_item, normalize_datetime, utc_now, okx_bot_list_param_variants) -> datetime | None:
    payload_ts = normalize_datetime(payload.strategy_started_at)
    if (utc_now() - payload_ts) > timedelta(days=1):
        return None

    list_payload = LiveRobotListRequest(exchange=payload.exchange, scope="recent", credentials=payload.credentials)
    for path_name, extra_params in (("/api/v5/tradingBot/grid/orders-algo-pending", None), ("/api/v5/tradingBot/grid/orders-algo-history", {"limit": 50})):
        for params in okx_bot_list_param_variants(extra_params):
            try:
                raw_items = retry_live_action(lambda: signed_get_robot_list(list_payload, path_name, params), retries=1)
            except LiveSnapshotError:
                continue
            for raw in raw_items if isinstance(raw_items, list) else []:
                if not isinstance(raw, dict):
                    continue
                built = build_robot_list_item(raw)
                if built and built.algo_id == (payload.algo_id or "") and built.updated_at is not None:
                    return normalize_datetime(built.updated_at)
    return None



def build_okx_bot_summary(detail: dict[str, Any], *, position: LivePosition, open_orders: list[LiveOpenOrder], fills: list[LiveFill], funding_entries: list[LiveFundingEntry], first_present, safe_float) -> LiveSnapshotSummary:
    realized_pnl = safe_float(first_present(detail, "realizedPnl", "pnl", "gridProfit", "profit", "totalProfit"), fallback=sum(item.realized_pnl for item in fills) if fills else position.realized_pnl)
    unrealized_pnl = safe_float(first_present(detail, "upl", "floatProfit", "unrealizedPnl"), fallback=position.unrealized_pnl)
    fees_paid = abs(safe_float(first_present(detail, "fee", "totalFee", "fees", "feeAmt", "totalFeeAmt"), fallback=sum(abs(item.fee) for item in fills)))
    funding_net = safe_float(first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding"), fallback=sum(item.amount for item in funding_entries))
    total_pnl = safe_float(first_present(detail, "totalPnl", "totalProfit", "pnlTotal"), fallback=0.0)
    if total_pnl == 0.0:
        total_pnl = realized_pnl + unrealized_pnl - fees_paid + funding_net
    return LiveSnapshotSummary(
        realized_pnl=realized_pnl,
        unrealized_pnl=unrealized_pnl,
        fees_paid=fees_paid,
        funding_paid=sum(abs(item.amount) for item in funding_entries if item.amount < 0),
        funding_net=funding_net,
        total_pnl=total_pnl,
        position_notional=position.notional,
        open_order_count=len(open_orders),
        fill_count=len(fills),
    )



def build_okx_bot_inferred_grid(detail: dict[str, Any], *, position: LivePosition, open_orders: list[LiveOpenOrder], algo_id: str, first_present, safe_float, safe_int, normalize_position_side, parse_boolish, infer_grid) -> LiveInferredGrid:
    active_levels = sorted({round(order.price, 12) for order in open_orders if order.price > 0})
    lower_value = first_present(detail, "minPx", "lowerPx", "lowerLimit", "lowerPrice", "lower")
    upper_value = first_present(detail, "maxPx", "upperPx", "upperLimit", "upperPrice", "upper")
    grid_count_value = first_present(detail, "gridNum", "gridCount", "grid_count")
    lower = safe_float(lower_value, fallback=0.0) or None
    upper = safe_float(upper_value, fallback=0.0) or None
    grid_count = safe_int(grid_count_value, 0) or None
    spacing = safe_float(first_present(detail, "gridSpacing", "gridProfitPx", "spread"), fallback=0.0) or None
    if spacing is None and lower is not None and upper is not None and grid_count and grid_count > 0:
        spacing = (upper - lower) / grid_count
    position_quantity = position.quantity if position.side == "long" else -position.quantity if position.side == "short" else 0.0
    side = normalize_position_side(first_present(detail, "direction", "side", "posSide"), quantity=position_quantity)
    use_base_position = parse_boolish(first_present(detail, "useBasePosition", "basePos")) or position.quantity > 0
    if (lower is None or upper is None or grid_count is None) and len(active_levels) >= 2:
        fallback = infer_grid(position, open_orders)
        return LiveInferredGrid(
            lower=fallback.lower,
            upper=fallback.upper,
            grid_count=fallback.grid_count,
            grid_spacing=fallback.grid_spacing,
            active_level_count=fallback.active_level_count,
            active_levels=fallback.active_levels,
            confidence=max(0.65, fallback.confidence),
            use_base_position=fallback.use_base_position,
            side=fallback.side,
            note=f"OKX 机器人配置字段不完整，已基于活动子单回退推断（algoId={algo_id}）。",
        )
    return LiveInferredGrid(
        lower=lower,
        upper=upper,
        grid_count=grid_count,
        grid_spacing=spacing,
        active_level_count=len(active_levels),
        active_levels=active_levels,
        confidence=0.96 if lower is not None and upper is not None and grid_count is not None else 0.7,
        use_base_position=use_base_position,
        side=None if side == "flat" else GridSide(side),
        note=f"基于 OKX 机器人配置直接回填（algoId={algo_id}）。",
    )



def build_okx_robot_overview(detail: dict[str, Any], *, algo_id: str, position: LivePosition, summary: LiveSnapshotSummary, inferred_grid: LiveInferredGrid, first_present, coerce_text, coerce_optional_text, normalize_position_side, optional_datetime, optional_float, optional_int, parse_boolish) -> LiveRobotOverview:
    lower_price = optional_float(first_present(detail, "minPx", "lowerPx", "lowerLimit", "lowerPrice", "lower"))
    upper_price = optional_float(first_present(detail, "maxPx", "upperPx", "upperLimit", "upperPrice", "upper"))
    grid_count = optional_int(first_present(detail, "gridNum", "gridCount", "grid_count"))
    grid_spacing = optional_float(first_present(detail, "gridSpacing", "gridProfitPx", "spread"))
    if grid_spacing is None and lower_price is not None and upper_price is not None and grid_count not in {None, 0}:
        grid_spacing = (upper_price - lower_price) / grid_count
    direction_value = coerce_optional_text(first_present(detail, "direction", "side", "posSide"))
    direction = normalize_position_side(direction_value, quantity=position.quantity if position.side == "long" else -position.quantity if position.side == "short" else 0.0)
    use_base_position_raw = first_present(detail, "useBasePosition", "basePos")
    use_base_position = parse_boolish(use_base_position_raw) if use_base_position_raw is not None else inferred_grid.use_base_position
    total_fee_raw = first_present(detail, "fee", "totalFee", "feeAmt", "fees")
    total_pnl_raw = first_present(detail, "totalPnl", "totalProfit", "pnlTotal")
    display_name = coerce_text(first_present(detail, "algoClOrdId", "name", "alias"))
    if not display_name:
        inst_id = coerce_text(first_present(detail, "instId", "symbol")) or "OKX"
        display_name = f"{inst_id} · {algo_id[-6:]}"
    return LiveRobotOverview(
        algo_id=algo_id,
        name=display_name,
        state=coerce_optional_text(first_present(detail, "state", "status")),
        direction=direction,
        algo_type=coerce_optional_text(first_present(detail, "algoOrdType", "algoType")),
        run_type=coerce_optional_text(first_present(detail, "runType", "run_type")),
        created_at=optional_datetime(first_present(detail, "cTime", "createdAt", "createTime")),
        updated_at=optional_datetime(first_present(detail, "uTime", "updatedAt", "updateTime")),
        investment_usdt=optional_float(first_present(detail, "investment", "investAmt", "invest", "sz", "quoteSz")),
        configured_leverage=optional_float(first_present(detail, "lever", "leverage")),
        actual_leverage=optional_float(first_present(detail, "actualLever", "actualLeverage")),
        liquidation_price=optional_float(first_present(detail, "liqPx", "liquidationPx")),
        grid_count=grid_count,
        lower_price=lower_price,
        upper_price=upper_price,
        grid_spacing=grid_spacing,
        grid_profit=optional_float(first_present(detail, "gridProfit", "realizedPnl", "pnl", "profit")),
        floating_profit=optional_float(first_present(detail, "floatProfit", "upl", "unrealizedPnl")),
        total_fee=abs(optional_float(total_fee_raw) or 0.0) if total_fee_raw is not None else None,
        funding_fee=optional_float(first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding")),
        total_pnl=optional_float(total_pnl_raw) if total_pnl_raw is not None else summary.total_pnl,
        pnl_ratio=optional_float(first_present(detail, "pnlRatio", "profitRatio", "yieldRate")),
        stop_loss_price=optional_float(first_present(detail, "slTriggerPx", "stopLossPx", "stopPx")),
        take_profit_price=optional_float(first_present(detail, "tpTriggerPx", "takeProfitPx", "tpPx")),
        use_base_position=use_base_position,
    )



def fetch_okx_bot_snapshot(payload: LiveSnapshotRequest, **deps) -> ExchangeSnapshot:
    return exchange_fetch_okx_bot_snapshot(payload, detail_paths=OKX_BOT_DETAIL_PATHS, fills_page_limit=OKX_FILLS_PAGE_LIMIT, max_fills_items=OKX_MAX_FILLS_ITEMS, **deps)
