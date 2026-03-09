from __future__ import annotations

import base64
import hashlib
import hmac
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from app.core.schemas import (
    Candle,
    CurvePoint,
    DataSource,
    DataConfig,
    GridSide,
    Interval,
    StrategyConfig,
    LiveAccountInfo,
    LiveCompleteness,
    LiveDailyBreakdown,
    LiveDiagnostic,
    LiveLedgerEntry,
    LiveLedgerSummary,
    LiveExchange,
    LiveMonitoringInfo,
    LiveFill,
    LiveFundingEntry,
    LiveInferredGrid,
    LiveOpenOrder,
    LivePosition,
    LiveRobotListItem,
    LiveRobotListRequest,
    LiveRobotListResponse,
    LiveRobotOverview,
    LiveSnapshotRequest,
    LiveSnapshotResponse,
    LiveSnapshotSummary,
    LiveWindowInfo,
    MarketParamsResponse,
)
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates, load_mark_price_candles
from app.services.market_params import fetch_market_params
from app.services.backtest_engine import run_backtest
from app.services.symbol_utils import normalize_symbol_for_source
from app.services.live_snapshot_cache import (
    cache_get_any as _cache_get_any,
    cache_get_fresh as _cache_get_fresh,
    cache_set as _cache_set,
    hash_api_key as _hash_api_key,
)
from app.services.live_snapshot_diagnostics import (
    action_hint_for_code as _action_hint_for_code,
    build_diag as _diag,
    normalize_diagnostics as _normalize_diagnostics,
    sanitize_error_message as _sanitize_error_message,
)
from app.services.live_snapshot_http import query_string as _query_string, request_json as _request_json
from app.services.live_snapshot_types import ExchangeSnapshot as _ExchangeSnapshot, LiveSnapshotError
from app.services.live_snapshot_adapters import (
    binance_collect_records as _adapter_binance_collect_records,
    binance_signed_get as _adapter_binance_signed_get,
    bybit_build_funding_entries as _adapter_bybit_build_funding_entries,
    bybit_collect_execution_history as _adapter_bybit_collect_execution_history,
    bybit_collect_transaction_logs as _adapter_bybit_collect_transaction_logs,
    bybit_signed_get as _adapter_bybit_signed_get,
    okx_bot_get_first_available as _adapter_okx_bot_get_first_available,
    okx_bot_get_sub_orders as _adapter_okx_bot_get_sub_orders,
    okx_bot_list_param_variants as _adapter_okx_bot_list_param_variants,
    okx_bot_param_variants as _adapter_okx_bot_param_variants,
    okx_bot_sub_order_paths as _adapter_okx_bot_sub_order_paths,
    okx_collect_funding_entries as _adapter_okx_collect_funding_entries,
    okx_collect_ledger_entries as _adapter_okx_collect_ledger_entries,
    okx_iso_timestamp as _adapter_okx_iso_timestamp,
    okx_signed_get as _adapter_okx_signed_get,
    okx_signed_get_robot_list as _adapter_okx_signed_get_robot_list,
    okx_split_billing_windows as _adapter_okx_split_billing_windows,
)
from app.services.live_snapshot_normalize import (
    build_completeness as _build_completeness,
    build_daily_breakdown as _build_daily_breakdown,
    build_ledger_entries as _build_ledger_entries,
    build_ledger_summary as _build_ledger_summary,
    build_summary as _build_summary,
    infer_grid as _infer_grid,
    sort_and_dedupe_fills as _sort_and_dedupe_fills,
    sort_and_dedupe_funding as _sort_and_dedupe_funding,
    sort_orders as _sort_orders,
)
from app.services.live_snapshot_exchange_adapters import (
    fetch_binance_snapshot as _exchange_fetch_binance_snapshot,
    fetch_bybit_snapshot as _exchange_fetch_bybit_snapshot,
    fetch_okx_bot_snapshot as _exchange_fetch_okx_bot_snapshot,
    fetch_okx_snapshot as _exchange_fetch_okx_snapshot,
)

BINANCE_FUTURES_BASE_URL = "https://fapi.binance.com"
BYBIT_BASE_URL = "https://api.bybit.com"
OKX_BASE_URL = "https://www.okx.com"
BINANCE_MAX_PAGE_LIMIT = 1000
BINANCE_MAX_PAGES = 8
BYBIT_EXECUTION_PAGE_LIMIT = 100
BYBIT_EXECUTION_MAX_PAGES = 10
BYBIT_TRANSACTION_PAGE_LIMIT = 50
BYBIT_TRANSACTION_MAX_PAGES = 12
BYBIT_MAX_WINDOW_DAYS = 7
OKX_BILLS_RECENT_WINDOW_DAYS = 7
OKX_BILLS_ARCHIVE_WINDOW_DAYS = 90
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
OKX_SNAPSHOT_CACHE_TTL_SEC = 3.0
OKX_FILLS_PAGE_LIMIT = 100
OKX_MAX_FILLS_ITEMS = 1000
OKX_RECENT_HISTORY_DAYS = 7
LIVE_PNL_CURVE_TARGET_POINTS = 480
LIVE_PNL_CURVE_MAX_POINTS = 480
LIVE_PNL_CURVE_INTERVAL_SECONDS: tuple[tuple[Interval, int], ...] = (
    (Interval.M15, 15 * 60),
    (Interval.M30, 30 * 60),
    (Interval.H1, 60 * 60),
    (Interval.H2, 2 * 60 * 60),
    (Interval.H4, 4 * 60 * 60),
    (Interval.H6, 6 * 60 * 60),
    (Interval.H12, 12 * 60 * 60),
    (Interval.D1, 24 * 60 * 60),
)
LIVE_PNL_CURVE_EPSILON = 1e-9

_CACHE_LIST: dict[str, tuple[float, object]] = {}
_CACHE_SNAPSHOT: dict[str, tuple[float, object]] = {}


@dataclass
class _LivePnlReplayState:
    signed_qty: float = 0.0
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    funding_net: float = 0.0


def _retry_live_action(fn, retries: int):
    last_error = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except LiveSnapshotError as exc:
            last_error = exc
            if attempt >= retries or not exc.retryable:
                raise
            time.sleep(0.2 * (2 ** attempt))
    if last_error is not None:
        raise last_error
    raise LiveSnapshotError("监测请求失败", status_code=500, retryable=True)


def _cache_key_for_robot_list(payload: LiveRobotListRequest) -> str:
    return f"{_hash_api_key(payload.credentials.api_key)}|{payload.scope}"


def _cache_key_for_snapshot(payload: LiveSnapshotRequest) -> str:
    return "|".join([
        _hash_api_key(payload.credentials.api_key),
        payload.algo_id or "",
        payload.symbol.strip().upper(),
        _normalize_datetime(payload.strategy_started_at).isoformat(),
        payload.monitoring_scope,
    ])


def _mask_api_key(value: str) -> str:
    raw = (value or "").strip()
    if len(raw) <= 5:
        return "*" * len(raw)
    return f"{raw[:3]}{'*' * max(1, len(raw) - 5)}{raw[-2:]}"


def _to_data_source(exchange: LiveExchange) -> DataSource:
    return DataSource(exchange.value)


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if math.isnan(result) or math.isinf(result):
        return float(fallback)
    return result


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _coerce_optional_text(value: Any) -> str | None:
    text = _coerce_text(value)
    return text or None


def _first_present(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key not in payload:
            continue
        value = payload.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _parse_boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return float(value) != 0.0
    raw = _coerce_text(value).lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    try:
        return float(raw) != 0.0
    except (TypeError, ValueError):
        return False


def _normalize_position_side(value: Any, *, quantity: float = 0.0) -> str:
    raw = _coerce_text(value).lower()
    if raw in {"long", "buy", "net_long"}:
        return "long"
    if raw in {"short", "sell", "net_short"}:
        return "short"
    if quantity > 0:
        return "long"
    if quantity < 0:
        return "short"
    return "flat"


def _normalize_order_side(value: Any) -> str:
    raw = _coerce_text(value).lower()
    if raw in {"sell", "short"}:
        return "sell"
    return "buy"


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return _safe_float(value, fallback=0.0)


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return _safe_int(value, fallback=0)


def _optional_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return _normalize_datetime(value)


def _normalize_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        seconds = float(value)
        if abs(seconds) > 1_000_000_000_000:
            seconds = seconds / 1000.0
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if raw.isdigit():
            return _normalize_datetime(int(raw))
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise LiveSnapshotError(f"无法解析时间字段：{raw}") from exc
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    raise LiveSnapshotError("时间字段格式不正确")


def _ms(value: datetime) -> int:
    return int(_normalize_datetime(value).timestamp() * 1000)


def _time_chunks(start_at: datetime, end_at: datetime, *, chunk_days: int) -> list[tuple[datetime, datetime]]:
    start = _normalize_datetime(start_at)
    end = _normalize_datetime(end_at)
    if end <= start:
        return [(start, start)]

    chunks: list[tuple[datetime, datetime]] = []
    cursor = start
    delta = timedelta(days=max(1, chunk_days))
    while cursor < end:
        chunk_end = min(cursor + delta, end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end
    return chunks


def _floor_to_minute(value: datetime) -> datetime:
    normalized = _normalize_datetime(value)
    return normalized.replace(second=0, microsecond=0)


def _choose_live_pnl_curve_interval(start_at: datetime, end_at: datetime) -> Interval:
    duration_seconds = max((end_at - start_at).total_seconds(), 1.0)
    for interval, step_seconds in LIVE_PNL_CURVE_INTERVAL_SECONDS:
        if duration_seconds / step_seconds <= LIVE_PNL_CURVE_TARGET_POINTS:
            return interval
    return Interval.D1


def _downsample_curve_points(points: list[CurvePoint], max_points: int = LIVE_PNL_CURVE_MAX_POINTS) -> list[CurvePoint]:
    if len(points) <= max_points:
        return points
    if max_points <= 2:
        return [points[0], points[-1]]

    kept_indexes = {0, len(points) - 1}
    interior_needed = max_points - 2
    for step in range(1, interior_needed + 1):
        ratio = step / (interior_needed + 1)
        kept_indexes.add(round((len(points) - 1) * ratio))
    return [points[index] for index in sorted(kept_indexes)]


def _append_curve_point(points: list[CurvePoint], timestamp: datetime, value: float) -> None:
    normalized_ts = _normalize_datetime(timestamp)
    if points and points[-1].timestamp == normalized_ts:
        points[-1] = CurvePoint(timestamp=normalized_ts, value=float(value))
        return
    points.append(CurvePoint(timestamp=normalized_ts, value=float(value)))


def _apply_live_pnl_fill(state: _LivePnlReplayState, fill: LiveFill) -> None:
    state.realized_pnl += fill.realized_pnl
    state.fees_paid += abs(fill.fee)
    quantity = abs(fill.quantity)
    if quantity <= LIVE_PNL_CURVE_EPSILON or fill.price <= 0:
        return

    delta = quantity if fill.side == "buy" else -quantity
    if abs(state.signed_qty) <= LIVE_PNL_CURVE_EPSILON:
        state.signed_qty = delta
        state.avg_entry_price = fill.price
        return

    if state.signed_qty * delta > 0:
        total_quantity = abs(state.signed_qty) + abs(delta)
        weighted_cost = state.avg_entry_price * abs(state.signed_qty) + fill.price * abs(delta)
        state.signed_qty += delta
        state.avg_entry_price = weighted_cost / total_quantity if total_quantity > LIVE_PNL_CURVE_EPSILON else 0.0
        return

    next_qty = state.signed_qty + delta
    if abs(next_qty) <= LIVE_PNL_CURVE_EPSILON:
        state.signed_qty = 0.0
        state.avg_entry_price = 0.0
        return

    if state.signed_qty * next_qty > 0:
        state.signed_qty = next_qty
        return

    state.signed_qty = next_qty
    state.avg_entry_price = fill.price


def _apply_live_pnl_funding(state: _LivePnlReplayState, funding: LiveFundingEntry) -> None:
    state.funding_net += funding.amount


def _live_unrealized_pnl(state: _LivePnlReplayState, mark_price: float, quantity_scale: float = 1.0) -> float:
    if (
        abs(state.signed_qty) <= LIVE_PNL_CURVE_EPSILON
        or state.avg_entry_price <= 0
        or mark_price <= 0
    ):
        return 0.0
    return state.signed_qty * (mark_price - state.avg_entry_price) * quantity_scale


def _estimate_live_unrealized_quantity_scale(
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    *,
    end_at: datetime,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> float:
    if current_mark_price <= 0:
        return 1.0

    events: list[tuple[datetime, int, LiveFill | LiveFundingEntry]] = []
    for fill in fills:
        events.append((_normalize_datetime(fill.timestamp), 0, fill))
    for funding in funding_entries:
        events.append((_normalize_datetime(funding.timestamp), 1, funding))
    events.sort(key=lambda item: (item[0], item[1]))

    state = _LivePnlReplayState()
    end_ts = _normalize_datetime(end_at)
    for timestamp, _, payload in events:
        if timestamp > end_ts:
            continue
        if isinstance(payload, LiveFill):
            _apply_live_pnl_fill(state, payload)
        else:
            _apply_live_pnl_funding(state, payload)

    denominator = state.signed_qty * (current_mark_price - state.avg_entry_price)
    if abs(denominator) <= LIVE_PNL_CURVE_EPSILON:
        return 1.0
    scale = current_unrealized_pnl / denominator
    return scale if math.isfinite(scale) and abs(scale) > LIVE_PNL_CURVE_EPSILON else 1.0


def _build_live_pnl_curve_points(
    candles: list[Candle],
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    *,
    start_at: datetime,
    current_timestamp: datetime,
    current_total_pnl: float,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> list[CurvePoint]:
    start_ts = _normalize_datetime(start_at)
    end_ts = _normalize_datetime(current_timestamp)
    if not candles:
        if start_ts == end_ts:
            return [CurvePoint(timestamp=end_ts, value=float(current_total_pnl))]
        return [
            CurvePoint(timestamp=start_ts, value=0.0),
            CurvePoint(timestamp=end_ts, value=float(current_total_pnl)),
        ]

    events: list[tuple[datetime, int, LiveFill | LiveFundingEntry]] = []
    for fill in fills:
        events.append((_normalize_datetime(fill.timestamp), 0, fill))
    for funding in funding_entries:
        events.append((_normalize_datetime(funding.timestamp), 1, funding))
    events.sort(key=lambda item: (item[0], item[1]))

    unrealized_quantity_scale = _estimate_live_unrealized_quantity_scale(
        fills,
        funding_entries,
        end_at=end_ts,
        current_mark_price=current_mark_price,
        current_unrealized_pnl=current_unrealized_pnl,
    )

    state = _LivePnlReplayState()
    curve: list[CurvePoint] = [CurvePoint(timestamp=start_ts, value=0.0)]
    event_index = 0
    for candle in candles:
        candle_ts = _normalize_datetime(candle.timestamp)
        while event_index < len(events) and events[event_index][0] <= candle_ts:
            _, _, payload = events[event_index]
            if isinstance(payload, LiveFill):
                _apply_live_pnl_fill(state, payload)
            else:
                _apply_live_pnl_funding(state, payload)
            event_index += 1
        total_pnl = (
            state.realized_pnl
            - state.fees_paid
            + state.funding_net
            + _live_unrealized_pnl(state, candle.close, unrealized_quantity_scale)
        )
        _append_curve_point(curve, candle_ts, total_pnl)

    while event_index < len(events) and events[event_index][0] <= end_ts:
        _, _, payload = events[event_index]
        if isinstance(payload, LiveFill):
            _apply_live_pnl_fill(state, payload)
        else:
            _apply_live_pnl_funding(state, payload)
        event_index += 1

    _append_curve_point(curve, end_ts, current_total_pnl)
    return _downsample_curve_points(curve)


def _build_live_pnl_curve(
    *,
    symbol: str,
    strategy_started_at: datetime,
    fetched_at: datetime,
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    total_pnl: float,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> list[CurvePoint]:
    start_ts = _normalize_datetime(strategy_started_at)
    end_ts = _normalize_datetime(fetched_at)
    if end_ts <= start_ts:
        return [CurvePoint(timestamp=end_ts, value=float(total_pnl))]

    interval = _choose_live_pnl_curve_interval(start_ts, end_ts)
    lookback_days = max(1, math.ceil((end_ts - start_ts).total_seconds() / 86400.0))
    candles = load_mark_price_candles(
        DataConfig(
            source=DataSource.OKX,
            symbol=symbol,
            interval=interval,
            lookback_days=lookback_days,
            start_time=start_ts,
            end_time=end_ts,
        )
    )
    return _build_live_pnl_curve_points(
        candles,
        fills,
        funding_entries,
        start_at=start_ts,
        current_timestamp=end_ts,
        current_total_pnl=total_pnl,
        current_mark_price=current_mark_price,
        current_unrealized_pnl=current_unrealized_pnl,
    )


def _normalize_binance_symbol(symbol: str) -> str:
    return normalize_symbol_for_source(DataSource.BINANCE, symbol)


def _normalize_bybit_symbol(symbol: str) -> str:
    return normalize_symbol_for_source(DataSource.BYBIT, symbol)


def pick_positive_value(*values: float | None) -> float:
    for value in values:
        if value is not None and math.isfinite(value) and value > 0:
            return float(value)
    return 0.0


def _normalize_okx_symbol(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    compact = normalize_symbol_for_source(DataSource.OKX, raw)
    if raw.endswith("-SWAP"):
        return raw
    if compact.endswith("USDT"):
        return f"{compact[:-4]}-USDT-SWAP"
    return raw


def _fetch_market_params_best_effort(exchange: LiveExchange, symbol: str, diagnostics: list[LiveDiagnostic]) -> Optional[MarketParamsResponse]:
    try:
        return fetch_market_params(_to_data_source(exchange), symbol)
    except Exception as exc:
        diagnostics.append(
            LiveDiagnostic(
                level="warning",
                code="market_params_unavailable",
                message=f"交易环境参数同步失败：{_sanitize_error_message(str(exc))}",
            )
        )
        return None


def _binance_signed_get(payload: LiveSnapshotRequest, path: str, params: dict[str, Any]) -> Any:
    return _adapter_binance_signed_get(
        payload,
        path,
        params,
        utc_now=_utc_now,
        query_string=_query_string,
        request_json=_request_json,
        base_url=BINANCE_FUTURES_BASE_URL,
    )


def _binance_collect_records(
    payload: LiveSnapshotRequest,
    path: str,
    base_params: dict[str, Any],
    *,
    time_field: str,
    limit: int = BINANCE_MAX_PAGE_LIMIT,
    max_pages: int = BINANCE_MAX_PAGES,
) -> tuple[list[dict[str, Any]], bool]:
    return _adapter_binance_collect_records(
        payload,
        path,
        base_params,
        time_field=time_field,
        signed_get=_binance_signed_get,
        safe_int=_safe_int,
        limit=limit,
        max_pages=max_pages,
    )

def _fetch_binance_snapshot(payload: LiveSnapshotRequest) -> _ExchangeSnapshot:
    return _exchange_fetch_binance_snapshot(
        payload,
        normalize_symbol=_normalize_binance_symbol,
        signed_get=_binance_signed_get,
        collect_records=_binance_collect_records,
        ms=_ms,
        safe_float=_safe_float,
        normalize_datetime=_normalize_datetime,
        sort_orders=_sort_orders,
        sort_and_dedupe_fills=_sort_and_dedupe_fills,
        sort_and_dedupe_funding=_sort_and_dedupe_funding,
        diag=_diag,
    )

def _bybit_signed_get(payload: LiveSnapshotRequest, path: str, params: dict[str, Any]) -> Any:
    return _adapter_bybit_signed_get(
        payload,
        path,
        params,
        utc_now=_utc_now,
        query_string=_query_string,
        request_json=_request_json,
        safe_int=_safe_int,
        sanitize_error_message=_sanitize_error_message,
        base_url=BYBIT_BASE_URL,
    )


def _bybit_collect_execution_history(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
) -> tuple[list[dict[str, Any]], bool]:
    return _adapter_bybit_collect_execution_history(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        time_chunks=_time_chunks,
        ms=_ms,
        signed_get=_bybit_signed_get,
        execution_page_limit=BYBIT_EXECUTION_PAGE_LIMIT,
        execution_max_pages=BYBIT_EXECUTION_MAX_PAGES,
        max_window_days=BYBIT_MAX_WINDOW_DAYS,
        coerce_text=_coerce_text,
    )


def _bybit_collect_transaction_logs(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
) -> tuple[list[dict[str, Any]], bool, Optional[str]]:
    return _adapter_bybit_collect_transaction_logs(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        time_chunks=_time_chunks,
        ms=_ms,
        signed_get=_bybit_signed_get,
        transaction_page_limit=BYBIT_TRANSACTION_PAGE_LIMIT,
        transaction_max_pages=BYBIT_TRANSACTION_MAX_PAGES,
        max_window_days=BYBIT_MAX_WINDOW_DAYS,
        coerce_text=_coerce_text,
    )


def _bybit_build_funding_entries(logs: Iterable[dict[str, Any]]) -> list[LiveFundingEntry]:
    return _adapter_bybit_build_funding_entries(
        logs,
        safe_float=_safe_float,
        coerce_text=_coerce_text,
        normalize_datetime=_normalize_datetime,
        sort_and_dedupe_funding=_sort_and_dedupe_funding,
    )

def _fetch_bybit_snapshot(payload: LiveSnapshotRequest) -> _ExchangeSnapshot:
    return _exchange_fetch_bybit_snapshot(
        payload,
        normalize_symbol=_normalize_bybit_symbol,
        utc_now=_utc_now,
        signed_get=_bybit_signed_get,
        collect_execution_history=_bybit_collect_execution_history,
        collect_transaction_logs=_bybit_collect_transaction_logs,
        build_funding_entries=_bybit_build_funding_entries,
        safe_float=_safe_float,
        normalize_datetime=_normalize_datetime,
        sort_orders=_sort_orders,
        sort_and_dedupe_fills=_sort_and_dedupe_fills,
        diag=_diag,
    )

def _okx_iso_timestamp() -> str:
    return _adapter_okx_iso_timestamp(utc_now=_utc_now)


def _okx_signed_get(payload: LiveSnapshotRequest, path: str, params: Optional[dict[str, Any]] = None) -> Any:
    return _adapter_okx_signed_get(
        payload,
        path,
        params,
        query_string=_query_string,
        request_json=_request_json,
        iso_timestamp=_okx_iso_timestamp,
        sanitize_error_message=_sanitize_error_message,
        base_url=OKX_BASE_URL,
    )


def _okx_split_billing_windows(start_at: datetime, end_at: datetime) -> tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]], bool]:
    return _adapter_okx_split_billing_windows(
        start_at,
        end_at,
        normalize_datetime=_normalize_datetime,
        time_chunks=_time_chunks,
        recent_window_days=OKX_BILLS_RECENT_WINDOW_DAYS,
        archive_window_days=OKX_BILLS_ARCHIVE_WINDOW_DAYS,
    )


def _okx_collect_funding_entries(payload: LiveSnapshotRequest, symbol: str, *, start_at: datetime, end_at: datetime) -> tuple[list[LiveFundingEntry], bool, bool]:
    return _adapter_okx_collect_funding_entries(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        split_billing_windows=_okx_split_billing_windows,
        signed_get=_okx_signed_get,
        ms=_ms,
        coerce_text=_coerce_text,
        safe_float=_safe_float,
        normalize_datetime=_normalize_datetime,
        sort_and_dedupe_funding=_sort_and_dedupe_funding,
    )


def _okx_collect_ledger_entries(payload: LiveSnapshotRequest, symbol: str, *, start_at: datetime, end_at: datetime) -> tuple[list[LiveLedgerEntry], bool, bool]:
    return _adapter_okx_collect_ledger_entries(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        split_billing_windows=_okx_split_billing_windows,
        signed_get=_okx_signed_get,
        ms=_ms,
        coerce_text=_coerce_text,
        safe_float=_safe_float,
        normalize_datetime=_normalize_datetime,
    )


def _okx_bot_list_param_variants(extra_params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    return _adapter_okx_bot_list_param_variants(
        extra_params,
        algo_type_candidates=OKX_BOT_ALGO_TYPE_CANDIDATES,
    )


def _okx_signed_get_robot_list(payload: LiveRobotListRequest, path: str, params: Optional[dict[str, Any]] = None) -> Any:
    return _adapter_okx_signed_get_robot_list(
        payload,
        path,
        params,
        query_string=_query_string,
        request_json=_request_json,
        iso_timestamp=_okx_iso_timestamp,
        sanitize_error_message=_sanitize_error_message,
        base_url=OKX_BASE_URL,
    )

def _build_live_robot_list_item(item: dict[str, Any]) -> LiveRobotListItem | None:
    algo_id = _coerce_text(_first_present(item, "algoId", "ordId"))
    if not algo_id:
        return None
    exchange_symbol = _coerce_text(_first_present(item, "instId", "instFamily", "uly"))
    if not exchange_symbol:
        return None
    symbol = normalize_symbol_for_source(DataSource.OKX, exchange_symbol)
    name = _coerce_text(_first_present(item, "algoClOrdId", "name", "alias")) or f"{exchange_symbol} · {algo_id[-6:]}"
    side_raw = _normalize_position_side(_first_present(item, "direction", "side", "posSide"), quantity=0.0)
    side = None if side_raw == "flat" else side_raw
    return LiveRobotListItem(
        algo_id=algo_id,
        name=name,
        symbol=symbol,
        exchange_symbol=exchange_symbol,
        state=_coerce_optional_text(_first_present(item, "state", "status")),
        side=side,
        updated_at=_optional_datetime(_first_present(item, "uTime", "updatedAt", "updateTime", "cTime")),
        run_type=_coerce_optional_text(_first_present(item, "runType", "run_type")),
        configured_leverage=_optional_float(_first_present(item, "lever", "leverage")),
        investment_usdt=_optional_float(_first_present(item, "investment", "investAmt", "invest", "sz", "quoteSz")),
        lower_price=_optional_float(_first_present(item, "minPx", "lowerPx", "lower")),
        upper_price=_optional_float(_first_present(item, "maxPx", "upperPx", "upper")),
        grid_count=_optional_int(_first_present(item, "gridNum", "gridCount", "grid_count")),
    )


def _build_live_monitoring_info(
    *,
    poll_interval_sec: int,
    last_success_at: datetime,
    source_latency_ms: int,
    fills_page_count: int,
    fills_capped: bool,
    orders_page_count: int,
    stale: bool,
) -> LiveMonitoringInfo:
    freshness_sec = max(0, int((_utc_now() - _normalize_datetime(last_success_at)).total_seconds()))
    return LiveMonitoringInfo(
        poll_interval_sec=poll_interval_sec,
        last_success_at=_normalize_datetime(last_success_at),
        freshness_sec=freshness_sec,
        stale=stale,
        source_latency_ms=source_latency_ms,
        fills_page_count=fills_page_count,
        fills_capped=fills_capped,
        orders_page_count=orders_page_count,
    )


def fetch_okx_robot_list(payload: LiveRobotListRequest) -> LiveRobotListResponse:
    if payload.exchange != LiveExchange.OKX:
        raise LiveSnapshotError(
            "机器人列表目前仅支持 OKX。",
            status_code=400,
            code="LIVE_BOT_LIST_EXCHANGE_UNSUPPORTED",
            retryable=False,
        )

    cache_key = _cache_key_for_robot_list(payload)
    cached = _cache_get_fresh(_CACHE_LIST, cache_key, OKX_ROBOT_LIST_CACHE_TTL_SEC)
    if cached is not None:
        return cached

    items_by_id: dict[str, LiveRobotListItem] = {}
    recent_cutoff = _utc_now() - timedelta(days=OKX_RECENT_HISTORY_DAYS)
    had_success = False
    last_error: LiveSnapshotError | None = None

    def ingest(raw_items: list[dict[str, Any]], *, include_non_running: bool) -> None:
        for raw in raw_items if isinstance(raw_items, list) else []:
            if not isinstance(raw, dict):
                continue
            built = _build_live_robot_list_item(raw)
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
        for params in _okx_bot_list_param_variants(extra_params):
            try:
                response_items = _retry_live_action(
                    lambda: _okx_signed_get_robot_list(payload, path_name, params),
                    retries=2,
                )
                had_success = True
            except LiveSnapshotError as exc:
                last_error = exc
                continue
            ingest(response_items if isinstance(response_items, list) else [], include_non_running=include_non_running)

    fetch_path("/api/v5/tradingBot/grid/orders-algo-pending", include_non_running=False)
    if payload.scope == "recent":
        fetch_path("/api/v5/tradingBot/grid/orders-algo-history", include_non_running=True, extra_params={"limit": 50})

    if not had_success and last_error is not None:
        raise last_error

    items = sorted(
        items_by_id.values(),
        key=lambda item: (
            0 if (item.state or "").lower() == "running" else 1,
            -(item.updated_at.timestamp() if item.updated_at else 0),
            item.symbol,
            item.name,
            item.algo_id,
        ),
    )
    if not items:
        raise LiveSnapshotError(
            "当前未找到符合条件的监测对象。",
            status_code=404,
            code="LIVE_BOT_LIST_EMPTY",
            retryable=False,
        )

    response = LiveRobotListResponse(scope=payload.scope, items=items)
    _cache_set(_CACHE_LIST, cache_key, response)
    return response


def _okx_bot_param_variants(payload: LiveSnapshotRequest, extra_params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    return _adapter_okx_bot_param_variants(
        payload,
        extra_params,
        algo_type_candidates=OKX_BOT_ALGO_TYPE_CANDIDATES,
    )


def _okx_bot_get_first_available(
    payload: LiveSnapshotRequest,
    paths: tuple[str, ...],
    *,
    extra_params: Optional[dict[str, Any]] = None,
    required: bool = False,
) -> tuple[list[dict[str, Any]], bool]:
    return _adapter_okx_bot_get_first_available(
        payload,
        paths,
        extra_params=extra_params,
        required=required,
        okx_signed_get=_okx_signed_get,
        bot_param_variants=_okx_bot_param_variants,
    )


def _okx_bot_sub_order_paths(entry_type: str) -> tuple[str, ...]:
    return _adapter_okx_bot_sub_order_paths(
        entry_type,
        pending_paths=OKX_BOT_PENDING_ORDER_PATHS,
        history_paths=OKX_BOT_HISTORY_ORDER_PATHS,
        sub_order_path=OKX_BOT_SUB_ORDER_PATH,
    )


def _okx_bot_get_sub_orders(
    payload: LiveSnapshotRequest,
    entry_type: str,
    *,
    limit: int = OKX_FILLS_PAGE_LIMIT,
    start_at: datetime | None = None,
    max_items: int = OKX_MAX_FILLS_ITEMS,
) -> tuple[list[dict[str, Any]], bool, int, bool]:
    return _adapter_okx_bot_get_sub_orders(
        payload,
        entry_type,
        limit=limit,
        start_at=start_at,
        max_items=max_items,
        normalize_datetime=_normalize_datetime,
        sub_order_paths=_okx_bot_sub_order_paths,
        bot_param_variants=_okx_bot_param_variants,
        retry_live_action=_retry_live_action,
        okx_signed_get=_okx_signed_get,
        first_present=_first_present,
        optional_datetime=_optional_datetime,
        coerce_optional_text=_coerce_optional_text,
    )

def _build_okx_bot_position(detail: dict[str, Any]) -> LivePosition:
    quantity_signed = _safe_float(_first_present(detail, "basePos", "baseSz", "pos", "positionSize"), fallback=0.0)
    side = _normalize_position_side(_first_present(detail, "direction", "side", "posSide"), quantity=quantity_signed)
    quantity = abs(quantity_signed)
    entry_price = _safe_float(
        _first_present(detail, "avgPx", "entryPx", "entryPrice", "openAvgPx", "avgOpenPx", "positionAvgPx"),
        fallback=0.0,
    )
    mark_price = _safe_float(
        _first_present(
            detail,
            "markPx",
            "markPrice",
            "last",
            "lastPx",
            "lastPrice",
            "curPx",
            "curPrice",
            "currentPx",
            "currentPrice",
            "idxPx",
            "indexPx",
            "indexPrice",
            "bidPx",
            "askPx",
        ),
        fallback=0.0,
    )
    notional = _safe_float(_first_present(detail, "notionalUsd", "notional", "investAmt", "investment", "invest"), fallback=0.0)
    if not notional and quantity > 0:
        reference_price = mark_price or entry_price
        if reference_price > 0:
            notional = abs(quantity * reference_price)
    return LivePosition(
        side=side,
        quantity=quantity,
        entry_price=entry_price,
        mark_price=mark_price,
        notional=abs(notional),
        leverage=_safe_float(_first_present(detail, "lever", "leverage"), fallback=0.0) or None,
        liquidation_price=_safe_float(_first_present(detail, "liqPx", "liquidationPx"), fallback=0.0) or None,
        margin_mode=_coerce_optional_text(_first_present(detail, "mgnMode", "tdMode")),
        unrealized_pnl=_safe_float(_first_present(detail, "upl", "floatProfit", "unrealizedPnl"), fallback=0.0),
        realized_pnl=_safe_float(_first_present(detail, "realizedPnl", "pnl", "gridProfit", "profit"), fallback=0.0),
    )


def _build_okx_bot_open_orders(items: list[dict[str, Any]]) -> list[LiveOpenOrder]:
    orders: list[LiveOpenOrder] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        price = _safe_float(_first_present(item, "px", "ordPx", "triggerPx"), fallback=0.0)
        quantity = _safe_float(_first_present(item, "sz", "qty", "orderSize"), fallback=0.0)
        if price <= 0 or quantity <= 0:
            continue
        timestamp_value = _first_present(item, "cTime", "uTime", "ts")
        orders.append(
            LiveOpenOrder(
                order_id=_coerce_text(_first_present(item, "ordId", "subOrdId", "algoId") or "unknown"),
                client_order_id=_coerce_optional_text(_first_present(item, "clOrdId", "algoClOrdId")),
                side=_normalize_order_side(_first_present(item, "side", "direction")),
                price=price,
                quantity=quantity,
                filled_quantity=_safe_float(_first_present(item, "accFillSz", "fillSz", "filledQty"), fallback=0.0),
                reduce_only=_parse_boolish(_first_present(item, "reduceOnly", "closeOrderAlgo")),
                status=_coerce_text(_first_present(item, "state", "ordState") or "open") or "open",
                timestamp=_normalize_datetime(timestamp_value) if timestamp_value is not None else None,
            )
        )
    return _sort_orders(orders)


def _build_okx_bot_fills(items: list[dict[str, Any]]) -> list[LiveFill]:
    fills: list[LiveFill] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        quantity = _safe_float(_first_present(item, "fillSz", "accFillSz", "sz", "qty"), fallback=0.0)
        price = _safe_float(_first_present(item, "fillPx", "avgPx", "px", "ordPx"), fallback=0.0)
        timestamp_value = _first_present(item, "fillTime", "uTime", "cTime", "ts")
        if quantity <= 0 or price <= 0 or timestamp_value is None:
            continue
        maker_value = _first_present(item, "isMaker", "maker")
        exec_type = _coerce_text(_first_present(item, "execType")).lower()
        is_maker = _parse_boolish(maker_value) if maker_value is not None else (True if exec_type == "m" else False if exec_type else None)
        fills.append(
            LiveFill(
                trade_id=_coerce_text(_first_present(item, "tradeId", "fillId", "subOrdId", "ordId") or "unknown"),
                order_id=_coerce_optional_text(_first_present(item, "ordId", "subOrdId")),
                side=_normalize_order_side(_first_present(item, "side", "direction")),
                price=price,
                quantity=quantity,
                realized_pnl=_safe_float(_first_present(item, "fillPnl", "realizedPnl", "pnl", "profit"), fallback=0.0),
                fee=abs(_safe_float(_first_present(item, "fee", "feeAmt"), fallback=0.0)),
                fee_currency=_coerce_optional_text(_first_present(item, "feeCcy", "ccy")),
                is_maker=is_maker,
                timestamp=_normalize_datetime(timestamp_value),
            )
        )
    return _sort_and_dedupe_fills(fills)


def _build_okx_bot_funding_entries(detail: dict[str, Any]) -> tuple[list[LiveFundingEntry], bool]:
    funding_value = _first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding")
    if funding_value is None:
        return [], False
    timestamp_value = _first_present(detail, "uTime", "cTime", "ts") or _utc_now()
    return (
        [
            LiveFundingEntry(
                timestamp=_normalize_datetime(timestamp_value),
                amount=_safe_float(funding_value, fallback=0.0),
                currency=_coerce_optional_text(_first_present(detail, "ccy", "quoteCcy", "feeCcy")),
            )
        ],
        True,
    )


def _resolve_effective_strategy_started_at(payload_start: datetime, robot_created_at: datetime | None) -> datetime:
    payload_ts = _normalize_datetime(payload_start)
    if robot_created_at is None:
        return payload_ts
    robot_ts = _normalize_datetime(robot_created_at)
    return robot_ts if robot_ts <= payload_ts else payload_ts


def _resolve_okx_bot_created_at_from_list(payload: LiveSnapshotRequest) -> datetime | None:
    payload_ts = _normalize_datetime(payload.strategy_started_at)
    if (_utc_now() - payload_ts) > timedelta(days=1):
        return None

    list_payload = LiveRobotListRequest(
        exchange=payload.exchange,
        scope="recent",
        credentials=payload.credentials,
    )
    for path_name, extra_params in (
        ("/api/v5/tradingBot/grid/orders-algo-pending", None),
        ("/api/v5/tradingBot/grid/orders-algo-history", {"limit": 50}),
    ):
        for params in _okx_bot_list_param_variants(extra_params):
            try:
                raw_items = _retry_live_action(
                    lambda: _okx_signed_get_robot_list(list_payload, path_name, params),
                    retries=1,
                )
            except LiveSnapshotError:
                continue
            for raw in raw_items if isinstance(raw_items, list) else []:
                if not isinstance(raw, dict):
                    continue
                algo_id = _coerce_text(_first_present(raw, "algoId", "ordId"))
                if algo_id != (payload.algo_id or ""):
                    continue
                created_at = _optional_datetime(_first_present(raw, "cTime", "createdAt", "createTime"))
                if created_at is not None:
                    return created_at
    return None


def _pick_live_strategy_side(
    *,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
) -> GridSide:
    candidates = [
        inferred_grid.side.value if inferred_grid and inferred_grid.side is not None else None,
        robot.direction if robot is not None else None,
        position.side,
    ]
    for candidate in candidates:
        if candidate == "long":
            return GridSide.LONG
        if candidate == "short":
            return GridSide.SHORT
    raise DataLoadError("缺少可用的网格方向，无法逐 K 模拟收益曲线")



def _pick_live_stop_loss(side: GridSide, lower: float, upper: float, robot: LiveRobotOverview | None) -> float:
    raw = robot.stop_loss_price if robot is not None else None
    if raw is not None and raw > 0:
        if side == GridSide.LONG and raw < lower:
            return raw
        if side == GridSide.SHORT and raw > upper:
            return raw
    return lower * 0.95 if side == GridSide.LONG else upper * 1.05



def _build_live_simulation_strategy(
    *,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
    market_params: MarketParamsResponse | None,
) -> StrategyConfig:
    side = _pick_live_strategy_side(position=position, robot=robot, inferred_grid=inferred_grid)
    lower = (
        (robot.lower_price if robot and robot.lower_price and robot.lower_price > 0 else None)
        or (inferred_grid.lower if inferred_grid and inferred_grid.lower and inferred_grid.lower > 0 else None)
    )
    upper = (
        (robot.upper_price if robot and robot.upper_price and robot.upper_price > 0 else None)
        or (inferred_grid.upper if inferred_grid and inferred_grid.upper and inferred_grid.upper > 0 else None)
    )
    grids = (
        (robot.grid_count if robot and robot.grid_count and robot.grid_count >= 2 else None)
        or (inferred_grid.grid_count if inferred_grid and inferred_grid.grid_count and inferred_grid.grid_count >= 2 else None)
    )
    leverage = (
        (robot.configured_leverage if robot and robot.configured_leverage and robot.configured_leverage > 0 else None)
        or (position.leverage if position.leverage and position.leverage > 0 else None)
        or 1.0
    )
    margin = (
        (robot.investment_usdt if robot and robot.investment_usdt and robot.investment_usdt > 0 else None)
        or (position.notional / leverage if position.notional > 0 and leverage > 0 else None)
    )
    if lower is None or upper is None or upper <= lower:
        raise DataLoadError("缺少有效网格区间，无法逐 K 模拟收益曲线")
    if grids is None:
        raise DataLoadError("缺少有效网格数量，无法逐 K 模拟收益曲线")
    if margin is None or margin <= 0:
        raise DataLoadError("缺少有效投入本金，无法逐 K 模拟收益曲线")

    maker_fee = market_params.maker_fee_rate if market_params is not None else 0.0002
    taker_fee = market_params.taker_fee_rate if market_params is not None else 0.0005
    funding_rate = market_params.funding_rate_per_8h if market_params is not None else 0.0
    funding_hours = market_params.funding_interval_hours if market_params is not None else 8
    stop_loss = _pick_live_stop_loss(side, lower, upper, robot)

    return StrategyConfig(
        side=side,
        lower=lower,
        upper=upper,
        grids=int(grids),
        leverage=float(leverage),
        margin=float(margin),
        stop_loss=float(stop_loss),
        use_base_position=bool(
            robot.use_base_position if robot and robot.use_base_position is not None else inferred_grid.use_base_position if inferred_grid else position.quantity > 0
        ),
        strict_risk_control=True,
        reopen_after_stop=True,
        fee_rate=float(taker_fee),
        maker_fee_rate=float(maker_fee),
        taker_fee_rate=float(taker_fee),
        slippage=0.0,
        maintenance_margin_rate=0.005,
        funding_rate_per_8h=float(funding_rate),
        funding_interval_hours=int(funding_hours),
        use_mark_price_for_liquidation=False,
        price_tick_size=float(market_params.price_tick_size) if market_params is not None else 0.0,
        quantity_step_size=float(market_params.quantity_step_size) if market_params is not None else 0.0,
        min_notional=float(market_params.min_notional) if market_params is not None else 0.0,
        max_allowed_loss_usdt=None,
    )



def _build_live_simulated_pnl_curve(
    *,
    symbol: str,
    strategy_started_at: datetime,
    fetched_at: datetime,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
    market_params: MarketParamsResponse | None,
    total_pnl: float,
) -> list[CurvePoint]:
    start_ts = _normalize_datetime(strategy_started_at)
    end_ts = _normalize_datetime(fetched_at)
    if end_ts <= start_ts:
        return [CurvePoint(timestamp=end_ts, value=float(total_pnl))]

    strategy = _build_live_simulation_strategy(
        position=position,
        robot=robot,
        inferred_grid=inferred_grid,
        market_params=market_params,
    )
    interval = _choose_live_pnl_curve_interval(start_ts, end_ts)
    lookback_days = max(1, math.ceil((end_ts - start_ts).total_seconds() / 86400.0))
    data_cfg = DataConfig(
        source=DataSource.OKX,
        symbol=symbol,
        interval=interval,
        lookback_days=lookback_days,
        start_time=start_ts,
        end_time=end_ts,
    )
    candles = load_candles(data_cfg)
    funding_rates = load_funding_rates(data_cfg)
    result = run_backtest(candles=candles, strategy=strategy, funding_rates=funding_rates)
    if not result.equity_curve:
        raise DataLoadError("逐 K 模拟未生成任何权益曲线点")

    raw_values = [point.value - strategy.margin for point in result.equity_curve]
    base_value = raw_values[0] if raw_values else 0.0
    normalized_values = [value - base_value for value in raw_values]
    final_value = normalized_values[-1] if normalized_values else 0.0
    scale = (total_pnl / final_value) if abs(final_value) > LIVE_PNL_CURVE_EPSILON else None

    curve: list[CurvePoint] = []
    for point, value in zip(result.equity_curve, normalized_values):
        mapped = value * scale if scale is not None else value
        _append_curve_point(curve, point.timestamp, mapped)
    _append_curve_point(curve, end_ts, total_pnl)
    return _downsample_curve_points(curve)


def _build_okx_bot_summary(
    detail: dict[str, Any],
    *,
    position: LivePosition,
    open_orders: list[LiveOpenOrder],
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
) -> LiveSnapshotSummary:
    realized_pnl = _safe_float(
        _first_present(detail, "realizedPnl", "pnl", "gridProfit", "profit", "totalProfit"),
        fallback=sum(item.realized_pnl for item in fills) if fills else position.realized_pnl,
    )
    unrealized_pnl = _safe_float(
        _first_present(detail, "upl", "floatProfit", "unrealizedPnl"),
        fallback=position.unrealized_pnl,
    )
    fees_paid = abs(
        _safe_float(
            _first_present(detail, "fee", "totalFee", "fees", "feeAmt", "totalFeeAmt"),
            fallback=sum(abs(item.fee) for item in fills),
        )
    )
    funding_net = _safe_float(
        _first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding"),
        fallback=sum(item.amount for item in funding_entries),
    )
    total_pnl = _safe_float(_first_present(detail, "totalPnl", "totalProfit", "pnlTotal"), fallback=0.0)
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


def _build_okx_bot_inferred_grid(
    detail: dict[str, Any],
    *,
    position: LivePosition,
    open_orders: list[LiveOpenOrder],
    algo_id: str,
) -> LiveInferredGrid:
    active_levels = sorted({round(order.price, 12) for order in open_orders if order.price > 0})
    lower_value = _first_present(detail, "minPx", "lowerPx", "lowerLimit", "lowerPrice", "lower")
    upper_value = _first_present(detail, "maxPx", "upperPx", "upperLimit", "upperPrice", "upper")
    grid_count_value = _first_present(detail, "gridNum", "gridCount", "grid_count")
    lower = _safe_float(lower_value, fallback=0.0) or None
    upper = _safe_float(upper_value, fallback=0.0) or None
    grid_count = _safe_int(grid_count_value, 0) or None
    spacing = _safe_float(_first_present(detail, "gridSpacing", "gridProfitPx", "spread"), fallback=0.0) or None
    if spacing is None and lower is not None and upper is not None and grid_count and grid_count > 0:
        spacing = (upper - lower) / grid_count
    position_quantity = position.quantity if position.side == "long" else -position.quantity if position.side == "short" else 0.0
    side = _normalize_position_side(_first_present(detail, "direction", "side", "posSide"), quantity=position_quantity)
    use_base_position = _parse_boolish(_first_present(detail, "useBasePosition", "basePos")) or position.quantity > 0
    if (lower is None or upper is None or grid_count is None) and len(active_levels) >= 2:
        fallback = _infer_grid(position, open_orders)
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


def _build_okx_robot_overview(
    detail: dict[str, Any],
    *,
    algo_id: str,
    position: LivePosition,
    summary: LiveSnapshotSummary,
    inferred_grid: LiveInferredGrid,
) -> LiveRobotOverview:
    lower_price = _optional_float(_first_present(detail, "minPx", "lowerPx", "lowerLimit", "lowerPrice", "lower"))
    upper_price = _optional_float(_first_present(detail, "maxPx", "upperPx", "upperLimit", "upperPrice", "upper"))
    grid_count = _optional_int(_first_present(detail, "gridNum", "gridCount", "grid_count"))
    grid_spacing = _optional_float(_first_present(detail, "gridSpacing", "gridProfitPx", "spread"))
    if grid_spacing is None and lower_price is not None and upper_price is not None and grid_count not in {None, 0}:
        grid_spacing = (upper_price - lower_price) / grid_count

    direction_value = _coerce_optional_text(_first_present(detail, "direction", "side", "posSide"))
    direction = _normalize_position_side(
        direction_value,
        quantity=position.quantity if position.side == "long" else -position.quantity if position.side == "short" else 0.0,
    )
    use_base_position_raw = _first_present(detail, "useBasePosition", "basePos")
    use_base_position = (
        _parse_boolish(use_base_position_raw) if use_base_position_raw is not None else inferred_grid.use_base_position
    )
    total_fee_raw = _first_present(detail, "fee", "totalFee", "feeAmt", "fees")
    total_pnl_raw = _first_present(detail, "totalPnl", "totalProfit", "pnlTotal")
    display_name = _coerce_text(_first_present(detail, "algoClOrdId", "name", "alias"))
    if not display_name:
        inst_id = _coerce_text(_first_present(detail, "instId", "symbol")) or "OKX"
        display_name = f"{inst_id} · {algo_id[-6:]}"
    return LiveRobotOverview(
        algo_id=algo_id,
        name=display_name,
        state=_coerce_optional_text(_first_present(detail, "state", "status")),
        direction=direction,
        algo_type=_coerce_optional_text(_first_present(detail, "algoOrdType", "algoType")),
        run_type=_coerce_optional_text(_first_present(detail, "runType", "run_type")),
        created_at=_optional_datetime(_first_present(detail, "cTime", "createdAt", "createTime")),
        updated_at=_optional_datetime(_first_present(detail, "uTime", "updatedAt", "updateTime")),
        investment_usdt=_optional_float(_first_present(detail, "investment", "investAmt", "invest", "sz", "quoteSz")),
        configured_leverage=_optional_float(_first_present(detail, "lever", "leverage")),
        actual_leverage=_optional_float(_first_present(detail, "actualLever", "actualLeverage")),
        liquidation_price=_optional_float(_first_present(detail, "liqPx", "liquidationPx")),
        grid_count=grid_count,
        lower_price=lower_price,
        upper_price=upper_price,
        grid_spacing=grid_spacing,
        grid_profit=_optional_float(_first_present(detail, "gridProfit", "realizedPnl", "pnl", "profit")),
        floating_profit=_optional_float(_first_present(detail, "floatProfit", "upl", "unrealizedPnl")),
        total_fee=abs(_optional_float(total_fee_raw) or 0.0) if total_fee_raw is not None else None,
        funding_fee=_optional_float(_first_present(detail, "fundingFee", "fundingPnl", "totalFunding", "funding")),
        total_pnl=_optional_float(total_pnl_raw) if total_pnl_raw is not None else summary.total_pnl,
        pnl_ratio=_optional_float(_first_present(detail, "pnlRatio", "profitRatio", "yieldRate")),
        stop_loss_price=_optional_float(_first_present(detail, "slTriggerPx", "stopLossPx", "stopPx")),
        take_profit_price=_optional_float(_first_present(detail, "tpTriggerPx", "takeProfitPx", "tpPx")),
        use_base_position=use_base_position,
    )


def _fetch_okx_bot_snapshot(payload: LiveSnapshotRequest) -> _ExchangeSnapshot:
    return _exchange_fetch_okx_bot_snapshot(
        payload,
        perf_counter=time.perf_counter,
        bot_get_first_available=_okx_bot_get_first_available,
        detail_paths=OKX_BOT_DETAIL_PATHS,
        optional_datetime=_optional_datetime,
        first_present=_first_present,
        resolve_effective_strategy_started_at=_resolve_effective_strategy_started_at,
        resolve_created_at_from_list=_resolve_okx_bot_created_at_from_list,
        bot_get_sub_orders=_okx_bot_get_sub_orders,
        diag=_diag,
        build_position=_build_okx_bot_position,
        build_open_orders=_build_okx_bot_open_orders,
        build_fills=_build_okx_bot_fills,
        build_funding_entries=_build_okx_bot_funding_entries,
        collect_funding_entries=_okx_collect_funding_entries,
        collect_ledger_entries=_okx_collect_ledger_entries,
        coerce_text=_coerce_text,
        normalize_symbol=_normalize_okx_symbol,
        build_inferred_grid=_build_okx_bot_inferred_grid,
        build_summary=_build_okx_bot_summary,
        build_robot_overview=_build_okx_robot_overview,
        fills_page_limit=OKX_FILLS_PAGE_LIMIT,
        max_fills_items=OKX_MAX_FILLS_ITEMS,
    )

def _fetch_okx_snapshot(payload: LiveSnapshotRequest) -> _ExchangeSnapshot:
    return _exchange_fetch_okx_snapshot(
        payload,
        normalize_symbol=_normalize_okx_symbol,
        utc_now=_utc_now,
        signed_get=_okx_signed_get,
        ms=_ms,
        safe_float=_safe_float,
        normalize_datetime=_normalize_datetime,
        collect_funding_entries=_okx_collect_funding_entries,
        sort_orders=_sort_orders,
        sort_and_dedupe_fills=_sort_and_dedupe_fills,
        diag=_diag,
    )

def fetch_live_snapshot(payload: LiveSnapshotRequest) -> LiveSnapshotResponse:
    if payload.exchange != LiveExchange.OKX:
        raise LiveSnapshotError(
            "实盘监测目前仅支持 OKX algoId。",
            status_code=400,
            code="LIVE_BOT_EXCHANGE_UNSUPPORTED",
            retryable=False,
        )

    cache_key = _cache_key_for_snapshot(payload)
    cached = _cache_get_fresh(_CACHE_SNAPSHOT, cache_key, OKX_SNAPSHOT_CACHE_TTL_SEC)
    if cached is not None:
        cached_monitoring = _build_live_monitoring_info(
            poll_interval_sec=payload.monitoring_poll_interval_sec,
            last_success_at=cached.monitoring.last_success_at,
            source_latency_ms=cached.monitoring.source_latency_ms,
            fills_page_count=cached.monitoring.fills_page_count,
            fills_capped=cached.monitoring.fills_capped,
            orders_page_count=cached.monitoring.orders_page_count,
            stale=False,
        )
        return cached.model_copy(update={"monitoring": cached_monitoring}, deep=True)

    try:
        exchange_snapshot = _retry_live_action(lambda: _fetch_okx_bot_snapshot(payload), retries=2)
        diagnostics = list(exchange_snapshot.diagnostics)
        market_params = _fetch_market_params_best_effort(payload.exchange, payload.symbol, diagnostics)
        inferred_grid = exchange_snapshot.inferred_grid or _infer_grid(exchange_snapshot.position, exchange_snapshot.open_orders)
        fetched_at = _utc_now()
        compared_end_at = _floor_to_minute(fetched_at)
        effective_strategy_started_at = _resolve_effective_strategy_started_at(
            payload.strategy_started_at,
            exchange_snapshot.robot.created_at if exchange_snapshot.robot is not None else None,
        )
        summary = exchange_snapshot.summary or _build_summary(
            position=exchange_snapshot.position,
            open_orders=exchange_snapshot.open_orders,
            fills=exchange_snapshot.fills,
            funding_entries=exchange_snapshot.funding_entries,
        )
        ledger_entries = exchange_snapshot.ledger_entries or _build_ledger_entries(exchange_snapshot.fills, exchange_snapshot.funding_entries)
        daily_breakdown = _build_daily_breakdown(ledger_entries)
        ledger_summary = _build_ledger_summary(summary)
        fills_incomplete = any(
            item.code in {"fills_truncated", "fills_not_available", "LIVE_BOT_FILLS_CAPPED"}
            for item in diagnostics
        )
        if fills_incomplete:
            diagnostics.append(
                _diag(
                    "warning",
                    "pnl_curve_fills_incomplete",
                    "成交记录不完整，当前无法可靠按 OKX 历史价格 K 线回放全程收益曲线。",
                )
            )
        pnl_curve: list[CurvePoint] = []
        try:
            pnl_curve = _build_live_simulated_pnl_curve(
                symbol=exchange_snapshot.exchange_symbol or payload.symbol,
                strategy_started_at=effective_strategy_started_at,
                fetched_at=fetched_at,
                position=exchange_snapshot.position,
                robot=exchange_snapshot.robot,
                inferred_grid=inferred_grid,
                market_params=market_params,
                total_pnl=summary.total_pnl,
            )
            if pnl_curve:
                diagnostics.append(
                    _diag(
                        "info",
                        "pnl_curve_simulated",
                        "实盘收益曲线已按 OKX 历史价格 K 线逐 K 模拟重建，并按当前实盘收益归一到最新快照。",
                    )
                )
        except (DataLoadError, ValueError) as exc:
            diagnostics.append(
                _diag(
                    "warning",
                    "pnl_curve_simulation_unavailable",
                    f"逐 K 模拟收益曲线失败：{_sanitize_error_message(str(exc))}",
                )
            )

        if not pnl_curve and not fills_incomplete:
            try:
                pnl_curve = _build_live_pnl_curve(
                    symbol=exchange_snapshot.exchange_symbol or payload.symbol,
                    strategy_started_at=effective_strategy_started_at,
                    fetched_at=fetched_at,
                    fills=exchange_snapshot.fills,
                    funding_entries=exchange_snapshot.funding_entries,
                    total_pnl=summary.total_pnl,
                    current_mark_price=pick_positive_value(
                        market_params.reference_price if market_params is not None else None,
                        exchange_snapshot.position.mark_price,
                    ),
                    current_unrealized_pnl=summary.unrealized_pnl,
                )
                if pnl_curve:
                    diagnostics.append(
                        _diag(
                            "info",
                            "pnl_curve_replay_available",
                            "实盘收益曲线已按 OKX 历史标记价格 K 线与成交/资金费回放重建。",
                        )
                    )
            except DataLoadError as replay_exc:
                diagnostics.append(
                    _diag(
                        "warning",
                        "pnl_curve_kline_unavailable",
                        f"OKX 历史标记价格 K 线加载失败，未生成回放收益曲线：{_sanitize_error_message(str(replay_exc))}",
                    )
                )
        diagnostics = _normalize_diagnostics(diagnostics)
        completeness = _build_completeness(diagnostics)
        response = LiveSnapshotResponse(
            account=LiveAccountInfo(
                exchange=payload.exchange,
                symbol=exchange_snapshot.symbol or payload.symbol,
                exchange_symbol=exchange_snapshot.exchange_symbol,
                algo_id=payload.algo_id or "",
                strategy_started_at=_normalize_datetime(effective_strategy_started_at),
                fetched_at=fetched_at,
                masked_api_key=_mask_api_key(payload.credentials.api_key),
            ),
            robot=exchange_snapshot.robot
            or LiveRobotOverview(
                algo_id=payload.algo_id or "",
                name=f"{exchange_snapshot.exchange_symbol} · {(payload.algo_id or '')[-6:]}",
                direction=exchange_snapshot.position.side,
                liquidation_price=exchange_snapshot.position.liquidation_price,
                grid_count=inferred_grid.grid_count,
                lower_price=inferred_grid.lower,
                upper_price=inferred_grid.upper,
                grid_spacing=inferred_grid.grid_spacing,
                total_pnl=summary.total_pnl,
                use_base_position=inferred_grid.use_base_position,
            ),
            monitoring=_build_live_monitoring_info(
                poll_interval_sec=payload.monitoring_poll_interval_sec,
                last_success_at=fetched_at,
                source_latency_ms=exchange_snapshot.source_latency_ms,
                fills_page_count=exchange_snapshot.fills_page_count,
                fills_capped=exchange_snapshot.fills_capped,
                orders_page_count=exchange_snapshot.orders_page_count,
                stale=False,
            ),
            market_params=market_params,
            summary=summary,
            window=LiveWindowInfo(
                strategy_started_at=_normalize_datetime(effective_strategy_started_at),
                fetched_at=fetched_at,
                compared_end_at=compared_end_at,
            ),
            completeness=completeness,
            ledger_summary=ledger_summary,
            position=exchange_snapshot.position,
            open_orders=exchange_snapshot.open_orders,
            fills=exchange_snapshot.fills,
            funding_entries=exchange_snapshot.funding_entries,
            pnl_curve=pnl_curve,
            daily_breakdown=daily_breakdown,
            ledger_entries=ledger_entries,
            inferred_grid=inferred_grid,
            diagnostics=diagnostics,
        )
        _cache_set(_CACHE_SNAPSHOT, cache_key, response)
        return response
    except LiveSnapshotError:
        cached_any = _cache_get_any(_CACHE_SNAPSHOT, cache_key)
        if cached_any is None:
            raise
        stale_diagnostics = list(cached_any.diagnostics)
        if not any(item.code == "LIVE_BOT_SNAPSHOT_STALE" for item in stale_diagnostics):
            stale_diagnostics.append(_diag("warning", "LIVE_BOT_SNAPSHOT_STALE", "本次监测刷新失败，当前仍显示上一次成功结果。"))
        stale_response = cached_any.model_copy(
            update={
                "monitoring": _build_live_monitoring_info(
                    poll_interval_sec=payload.monitoring_poll_interval_sec,
                    last_success_at=cached_any.monitoring.last_success_at,
                    source_latency_ms=cached_any.monitoring.source_latency_ms,
                    fills_page_count=cached_any.monitoring.fills_page_count,
                    fills_capped=cached_any.monitoring.fills_capped,
                    orders_page_count=cached_any.monitoring.orders_page_count,
                    stale=True,
                ),
                "diagnostics": stale_diagnostics,
                "completeness": _build_completeness(stale_diagnostics),
            },
            deep=True,
        )
        return stale_response
