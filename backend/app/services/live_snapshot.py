from __future__ import annotations

from typing import Any, Optional
import time
from datetime import timedelta

from app.core.schemas import DataConfig, DataSource, Interval, LiveDiagnostic, LiveRobotListRequest, LiveRobotListResponse, LiveSnapshotRequest, LiveSnapshotResponse, MarketParamsResponse
from app.services.data_loader import DataLoadError, load_mark_price_candles
from app.services.live_snapshot_cache import cache_get_any as _cache_get_any, cache_get_fresh as _cache_get_fresh, cache_set as _cache_set
from app.services.live_snapshot_diagnostics import build_diag as _diag, normalize_diagnostics as _normalize_diagnostics, sanitize_error_message as _sanitize_error_message
from app.services.live_snapshot_http import query_string as _query_string, request_json as _request_json
from app.services.live_snapshot_normalize import build_completeness as _build_completeness, build_daily_breakdown as _build_daily_breakdown, build_ledger_entries as _build_ledger_entries, build_ledger_summary as _build_ledger_summary, build_summary as _build_summary, infer_grid as _infer_grid, sort_and_dedupe_fills as _sort_and_dedupe_fills, sort_and_dedupe_funding as _sort_and_dedupe_funding, sort_orders as _sort_orders
from app.services.live_snapshot_types import LiveSnapshotError
from app.services import live_snapshot_aggregate as _aggregate_layer
from app.services import live_snapshot_bindings as _bindings
from app.services import live_snapshot_clients as _clients_layer
from app.services import live_snapshot_collectors as _collectors_layer

OKX_SNAPSHOT_CACHE_TTL_SEC = 3.0
OKX_ROBOT_LIST_CACHE_TTL_SEC = 10.0
_CACHE_LIST: dict[str, tuple[float, object]] = {}
_CACHE_SNAPSHOT: dict[str, tuple[float, object]] = {}

_retry_live_action = _bindings._retry_live_action
_cache_key_for_robot_list = _bindings._cache_key_for_robot_list
_cache_key_for_snapshot = _bindings._cache_key_for_snapshot
_mask_api_key = _bindings._mask_api_key
_to_data_source = _bindings._to_data_source
_safe_float = _bindings._safe_float
_safe_int = _bindings._safe_int
_utc_now = _bindings._utc_now
_coerce_text = _bindings._coerce_text
_coerce_optional_text = _bindings._coerce_optional_text
_first_present = _bindings._first_present
_parse_boolish = _bindings._parse_boolish
_normalize_position_side = _bindings._normalize_position_side
_normalize_order_side = _bindings._normalize_order_side
_optional_float = _bindings._optional_float
_optional_int = _bindings._optional_int
_normalize_datetime = _bindings._normalize_datetime
_optional_datetime = _bindings._optional_datetime
_ms = _bindings._ms
_time_chunks = _bindings._time_chunks
_floor_to_minute = _bindings._floor_to_minute
_build_live_pnl_curve_points = _bindings._build_live_pnl_curve_points
_normalize_binance_symbol = _bindings._normalize_binance_symbol
_normalize_bybit_symbol = _bindings._normalize_bybit_symbol
_normalize_okx_symbol = _bindings._normalize_okx_symbol
pick_positive_value = _bindings.pick_positive_value
_binance_signed_get = _bindings._binance_signed_get
_binance_collect_records = _bindings._binance_collect_records
_fetch_binance_snapshot = _bindings._fetch_binance_snapshot
_bybit_signed_get = _bindings._bybit_signed_get
_bybit_collect_execution_history = _bindings._bybit_collect_execution_history
_bybit_collect_transaction_logs = _bindings._bybit_collect_transaction_logs
_bybit_build_funding_entries = _bindings._bybit_build_funding_entries
_fetch_bybit_snapshot = _bindings._fetch_bybit_snapshot
_build_live_robot_list_item = _bindings._build_live_robot_list_item
_build_live_monitoring_info = _bindings._build_live_monitoring_info
_okx_bot_param_variants = _bindings._okx_bot_param_variants
_okx_bot_sub_order_paths = _bindings._okx_bot_sub_order_paths
_build_okx_bot_position = _bindings._build_okx_bot_position
_build_okx_bot_open_orders = _bindings._build_okx_bot_open_orders
_build_okx_bot_fills = _bindings._build_okx_bot_fills
_build_okx_bot_funding_entries = _bindings._build_okx_bot_funding_entries
_resolve_effective_strategy_started_at = _bindings._resolve_effective_strategy_started_at
_build_okx_bot_summary = _bindings._build_okx_bot_summary
_build_okx_bot_inferred_grid = _bindings._build_okx_bot_inferred_grid
_build_okx_robot_overview = _bindings._build_okx_robot_overview




def _fetch_strategy_start_price_best_effort(*, symbol: str, strategy_started_at):
    try:
        start_at = _normalize_datetime(strategy_started_at)
        candles = load_mark_price_candles(
            DataConfig(
                source=DataSource.OKX,
                symbol=symbol,
                interval=Interval.M1,
                lookback_days=1,
                start_time=start_at - timedelta(minutes=2),
                end_time=start_at + timedelta(minutes=2),
            ),
            start_utc=start_at - timedelta(minutes=2),
            end_utc=start_at + timedelta(minutes=2),
        )
        if not candles:
            return None
        nearest = min(candles, key=lambda candle: abs((candle.timestamp - start_at).total_seconds()))
        return float(nearest.close) if nearest.close > 0 else None
    except (DataLoadError, ValueError):
        return None

def _fetch_market_params_best_effort(exchange, symbol: str, diagnostics: list[LiveDiagnostic]) -> Optional[MarketParamsResponse]:
    return _clients_layer.fetch_market_params_best_effort(exchange, symbol, diagnostics, to_data_source=_to_data_source, sanitize_error_message=_sanitize_error_message)



def _build_live_pnl_curve(**kwargs):
    return _bindings._build_live_pnl_curve(**kwargs)



def _build_live_simulated_pnl_curve(**kwargs):
    return _bindings._build_live_simulated_pnl_curve(**kwargs)



def _okx_iso_timestamp() -> str:
    return _clients_layer.okx_iso_timestamp(utc_now=_utc_now)



def _okx_signed_get(payload: LiveSnapshotRequest, path: str, params: Optional[dict[str, Any]] = None) -> Any:
    return _clients_layer.okx_signed_get(payload, path, params, query_string=_query_string, request_json=_request_json, iso_timestamp=_okx_iso_timestamp, sanitize_error_message=_sanitize_error_message)



def _okx_split_billing_windows(start_at, end_at):
    return _clients_layer.okx_split_billing_windows(start_at, end_at, normalize_datetime=_normalize_datetime, time_chunks=_time_chunks)



def _okx_collect_funding_entries(payload: LiveSnapshotRequest, symbol: str, *, start_at, end_at):
    return _clients_layer.okx_collect_funding_entries(payload, symbol, start_at=start_at, end_at=end_at, ms=_ms, split_billing_windows=_okx_split_billing_windows, signed_get=_okx_signed_get, safe_float=_safe_float, coerce_text=_coerce_text, normalize_datetime=_normalize_datetime, sort_and_dedupe_funding=_sort_and_dedupe_funding)



def _okx_collect_ledger_entries(payload: LiveSnapshotRequest, symbol: str, *, start_at, end_at):
    return _clients_layer.okx_collect_ledger_entries(payload, symbol, start_at=start_at, end_at=end_at, ms=_ms, split_billing_windows=_okx_split_billing_windows, signed_get=_okx_signed_get, safe_float=_safe_float, coerce_text=_coerce_text, normalize_datetime=_normalize_datetime, sort_entries=lambda items: sorted(items, key=lambda item: (_normalize_datetime(item.timestamp), item.kind, item.amount)))



def _fetch_okx_snapshot(payload: LiveSnapshotRequest):
    return _clients_layer.fetch_okx_snapshot(payload, normalize_symbol=_normalize_okx_symbol, utc_now=_utc_now, signed_get=_okx_signed_get, ms=_ms, safe_float=_safe_float, normalize_datetime=_normalize_datetime, collect_funding_entries=_okx_collect_funding_entries, sort_orders=_sort_orders, sort_and_dedupe_fills=_sort_and_dedupe_fills, diag=_diag)



def _okx_signed_get_robot_list(payload: LiveRobotListRequest, path: str, params: Optional[dict[str, Any]] = None) -> Any:
    return _collectors_layer.okx_signed_get_robot_list(payload, path, params, query_string=_query_string, request_json=_request_json, iso_timestamp=_okx_iso_timestamp, sanitize_error_message=_sanitize_error_message)



def _okx_bot_get_first_available(payload: LiveSnapshotRequest, paths: tuple[str, ...], *, extra_params: Optional[dict[str, Any]] = None, required: bool = False):
    return _collectors_layer.okx_bot_get_first_available(payload, paths, extra_params=extra_params, required=required, okx_signed_get=_okx_signed_get, bot_param_variants=_okx_bot_param_variants)



def _okx_bot_get_sub_orders(payload: LiveSnapshotRequest, entry_type: str, *, limit: int, start_at=None, max_items: int = 200):
    return _collectors_layer.okx_bot_get_sub_orders(payload, entry_type, limit=limit, start_at=start_at, max_items=max_items, normalize_datetime=_normalize_datetime, sub_order_paths=_okx_bot_sub_order_paths, bot_param_variants=_okx_bot_param_variants, retry_live_action=_retry_live_action, okx_signed_get=_okx_signed_get, first_present=_first_present, optional_datetime=_optional_datetime, coerce_optional_text=_coerce_optional_text)



def _resolve_okx_bot_created_at_from_list(payload: LiveSnapshotRequest):
    return _collectors_layer.resolve_okx_bot_created_at_from_list(payload, signed_get_robot_list=_okx_signed_get_robot_list, retry_live_action=_retry_live_action, build_robot_list_item=_build_live_robot_list_item, normalize_datetime=_normalize_datetime, utc_now=_utc_now, okx_bot_list_param_variants=_okx_bot_param_variants)



def _fetch_okx_bot_snapshot(payload: LiveSnapshotRequest):
    return _collectors_layer.fetch_okx_bot_snapshot(payload, perf_counter=time.perf_counter, bot_get_first_available=_okx_bot_get_first_available, optional_datetime=_optional_datetime, first_present=_first_present, resolve_effective_strategy_started_at=_resolve_effective_strategy_started_at, resolve_created_at_from_list=_resolve_okx_bot_created_at_from_list, bot_get_sub_orders=_okx_bot_get_sub_orders, diag=_diag, build_position=_build_okx_bot_position, build_open_orders=_build_okx_bot_open_orders, build_fills=_build_okx_bot_fills, build_funding_entries=_build_okx_bot_funding_entries, collect_funding_entries=_okx_collect_funding_entries, collect_ledger_entries=_okx_collect_ledger_entries, coerce_text=_coerce_text, normalize_symbol=_normalize_okx_symbol, build_inferred_grid=_build_okx_bot_inferred_grid, build_summary=_build_okx_bot_summary, build_robot_overview=_build_okx_robot_overview)



def fetch_okx_robot_list(payload: LiveRobotListRequest) -> LiveRobotListResponse:
    if payload.exchange != payload.exchange.OKX:
        raise LiveSnapshotError("机器人列表目前仅支持 OKX。", status_code=400, code="LIVE_BOT_LIST_EXCHANGE_UNSUPPORTED", retryable=False)
    return _collectors_layer.fetch_okx_robot_list(payload, cache_get_fresh=_cache_get_fresh, cache_set=_cache_set, cache_key_for_robot_list=_cache_key_for_robot_list, cache_store=_CACHE_LIST, retry_live_action=_retry_live_action, signed_get_robot_list=_okx_signed_get_robot_list, utc_now=_utc_now, build_robot_list_item=_build_live_robot_list_item)



def fetch_live_snapshot(payload: LiveSnapshotRequest) -> LiveSnapshotResponse:
    if payload.exchange != payload.exchange.OKX:
        raise LiveSnapshotError("实盘监测目前仅支持 OKX algoId。", status_code=400, code="LIVE_BOT_EXCHANGE_UNSUPPORTED", retryable=False)
    return _aggregate_layer.fetch_live_snapshot_aggregate(payload, cache_key=_cache_key_for_snapshot(payload), cache_snapshot_store=_CACHE_SNAPSHOT, cache_get_fresh=_cache_get_fresh, cache_get_any=_cache_get_any, cache_set=_cache_set, snapshot_cache_ttl_sec=OKX_SNAPSHOT_CACHE_TTL_SEC, retry_live_action=_retry_live_action, fetch_okx_bot_snapshot=_fetch_okx_bot_snapshot, fetch_market_params_best_effort=_fetch_market_params_best_effort, infer_grid=_infer_grid, utc_now=_utc_now, floor_to_minute=_floor_to_minute, resolve_effective_strategy_started_at=_resolve_effective_strategy_started_at, build_summary=_build_summary, build_ledger_entries=_build_ledger_entries, build_daily_breakdown=_build_daily_breakdown, build_ledger_summary=_build_ledger_summary, build_completeness=_build_completeness, build_monitoring_info=_build_live_monitoring_info, normalize_datetime=_normalize_datetime, normalize_diagnostics=_normalize_diagnostics, mask_api_key=_mask_api_key, build_live_simulated_pnl_curve=_build_live_simulated_pnl_curve, build_live_pnl_curve=_build_live_pnl_curve, diag=_diag, sanitize_error_message=_sanitize_error_message, pick_positive_value=pick_positive_value, fetch_strategy_start_price_best_effort=_fetch_strategy_start_price_best_effort)
