from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Iterable, Optional

from app.core.schemas import DataSource, LiveDiagnostic, LiveExchange, LiveFill, LiveFundingEntry, LiveLedgerEntry, LiveSnapshotRequest, MarketParamsResponse
from app.services.live_snapshot_adapters import (
    binance_collect_records as adapter_binance_collect_records,
    binance_signed_get as adapter_binance_signed_get,
    bybit_build_funding_entries as adapter_bybit_build_funding_entries,
    bybit_collect_execution_history as adapter_bybit_collect_execution_history,
    bybit_collect_transaction_logs as adapter_bybit_collect_transaction_logs,
    bybit_signed_get as adapter_bybit_signed_get,
    okx_collect_funding_entries as adapter_okx_collect_funding_entries,
    okx_collect_ledger_entries as adapter_okx_collect_ledger_entries,
    okx_iso_timestamp as adapter_okx_iso_timestamp,
    okx_signed_get as adapter_okx_signed_get,
    okx_split_billing_windows as adapter_okx_split_billing_windows,
)
from app.services.live_snapshot_exchange_adapters import (
    fetch_binance_snapshot as exchange_fetch_binance_snapshot,
    fetch_bybit_snapshot as exchange_fetch_bybit_snapshot,
    fetch_okx_snapshot as exchange_fetch_okx_snapshot,
)
from app.services.live_snapshot_types import ExchangeSnapshot, LiveSnapshotError
from app.services.market_params import fetch_market_params
from app.services.symbol_utils import normalize_symbol_for_source

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


def normalize_binance_symbol(symbol: str) -> str:
    return normalize_symbol_for_source(DataSource.BINANCE, symbol)



def normalize_bybit_symbol(symbol: str) -> str:
    return normalize_symbol_for_source(DataSource.BYBIT, symbol)



def normalize_okx_symbol(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    compact = normalize_symbol_for_source(DataSource.OKX, raw)
    if raw.endswith("-SWAP"):
        return raw
    if compact.endswith("USDT"):
        return f"{compact[:-4]}-USDT-SWAP"
    return raw



def pick_positive_value(*values: float | None) -> float:
    for value in values:
        if value is not None and math.isfinite(value) and value > 0:
            return float(value)
    return 0.0



def fetch_market_params_best_effort(
    exchange: LiveExchange,
    symbol: str,
    diagnostics: list[LiveDiagnostic],
    *,
    to_data_source,
    sanitize_error_message,
) -> Optional[MarketParamsResponse]:
    try:
        return fetch_market_params(to_data_source(exchange), symbol)
    except Exception as exc:
        diagnostics.append(
            LiveDiagnostic(
                level="warning",
                code="market_params_unavailable",
                message=f"交易环境参数同步失败：{sanitize_error_message(str(exc))}",
            )
        )
        return None



def binance_signed_get(payload: LiveSnapshotRequest, path: str, params: dict[str, Any], *, utc_now, query_string, request_json) -> Any:
    return adapter_binance_signed_get(
        payload,
        path,
        params,
        utc_now=utc_now,
        query_string=query_string,
        request_json=request_json,
        base_url=BINANCE_FUTURES_BASE_URL,
    )



def binance_collect_records(
    payload: LiveSnapshotRequest,
    path: str,
    base_params: dict[str, Any],
    *,
    time_field: str,
    safe_int,
    signed_get,
    limit: int = BINANCE_MAX_PAGE_LIMIT,
    max_pages: int = BINANCE_MAX_PAGES,
) -> tuple[list[dict[str, Any]], bool]:
    return adapter_binance_collect_records(
        payload,
        path,
        base_params,
        time_field=time_field,
        signed_get=signed_get,
        safe_int=safe_int,
        limit=limit,
        max_pages=max_pages,
    )



def fetch_binance_snapshot(payload: LiveSnapshotRequest, **deps) -> ExchangeSnapshot:
    return exchange_fetch_binance_snapshot(payload, **deps)



def bybit_signed_get(payload: LiveSnapshotRequest, path: str, params: dict[str, Any], *, utc_now, query_string, request_json, safe_int, sanitize_error_message) -> Any:
    return adapter_bybit_signed_get(
        payload,
        path,
        params,
        utc_now=utc_now,
        query_string=query_string,
        request_json=request_json,
        safe_int=safe_int,
        sanitize_error_message=sanitize_error_message,
        base_url=BYBIT_BASE_URL,
    )



def bybit_collect_execution_history(payload: LiveSnapshotRequest, symbol: str, *, start_at: datetime, end_at: datetime, time_chunks, ms, signed_get, coerce_text) -> tuple[list[dict[str, Any]], bool]:
    return adapter_bybit_collect_execution_history(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        time_chunks=time_chunks,
        ms=ms,
        signed_get=signed_get,
        execution_page_limit=BYBIT_EXECUTION_PAGE_LIMIT,
        execution_max_pages=BYBIT_EXECUTION_MAX_PAGES,
        max_window_days=BYBIT_MAX_WINDOW_DAYS,
        coerce_text=coerce_text,
    )



def bybit_collect_transaction_logs(payload: LiveSnapshotRequest, symbol: str, *, start_at: datetime, end_at: datetime, time_chunks, ms, signed_get, coerce_text) -> tuple[list[dict[str, Any]], bool, Optional[str]]:
    return adapter_bybit_collect_transaction_logs(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        time_chunks=time_chunks,
        ms=ms,
        signed_get=signed_get,
        transaction_page_limit=BYBIT_TRANSACTION_PAGE_LIMIT,
        transaction_max_pages=BYBIT_TRANSACTION_MAX_PAGES,
        max_window_days=BYBIT_MAX_WINDOW_DAYS,
        coerce_text=coerce_text,
    )



def bybit_build_funding_entries(logs: Iterable[dict[str, Any]], *, safe_float, coerce_text, normalize_datetime, sort_and_dedupe_funding) -> list[LiveFundingEntry]:
    return adapter_bybit_build_funding_entries(
        logs,
        safe_float=safe_float,
        coerce_text=coerce_text,
        normalize_datetime=normalize_datetime,
        sort_and_dedupe_funding=sort_and_dedupe_funding,
    )



def fetch_bybit_snapshot(payload: LiveSnapshotRequest, **deps) -> ExchangeSnapshot:
    return exchange_fetch_bybit_snapshot(payload, **deps)



def okx_iso_timestamp(*, utc_now) -> str:
    return adapter_okx_iso_timestamp(utc_now=utc_now)



def okx_signed_get(payload: LiveSnapshotRequest, path: str, params: Optional[dict[str, Any]] = None, *, query_string, request_json, iso_timestamp, sanitize_error_message) -> Any:
    return adapter_okx_signed_get(
        payload,
        path,
        params,
        query_string=query_string,
        request_json=request_json,
        iso_timestamp=iso_timestamp,
        sanitize_error_message=sanitize_error_message,
        base_url=OKX_BASE_URL,
    )



def okx_split_billing_windows(start_at: datetime, end_at: datetime, *, normalize_datetime, time_chunks) -> tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]], bool]:
    start = normalize_datetime(start_at)
    end = normalize_datetime(end_at)
    recent_cutoff = end - __import__("datetime").timedelta(days=OKX_BILLS_RECENT_WINDOW_DAYS)
    archive_cutoff = end - __import__("datetime").timedelta(days=OKX_BILLS_ARCHIVE_WINDOW_DAYS)
    clipped = start < archive_cutoff
    effective_start = max(start, archive_cutoff)

    archive_windows: list[tuple[datetime, datetime]] = []
    recent_windows: list[tuple[datetime, datetime]] = []
    if effective_start < recent_cutoff:
        archive_windows = time_chunks(effective_start, min(recent_cutoff, end), chunk_days=30)
    if end > recent_cutoff:
        recent_windows = time_chunks(max(effective_start, recent_cutoff), end, chunk_days=7)
    return recent_windows, archive_windows, clipped



def okx_collect_funding_entries(payload: LiveSnapshotRequest, symbol: str, *, ms, start_at: datetime, end_at: datetime, split_billing_windows, signed_get, safe_float, coerce_text, normalize_datetime, sort_and_dedupe_funding) -> tuple[list[LiveFundingEntry], bool, bool]:
    return adapter_okx_collect_funding_entries(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        split_billing_windows=split_billing_windows,
        signed_get=signed_get,
        ms=ms,
        coerce_text=coerce_text,
        safe_float=safe_float,
        normalize_datetime=normalize_datetime,
        sort_and_dedupe_funding=sort_and_dedupe_funding,
    )



def okx_collect_ledger_entries(payload: LiveSnapshotRequest, symbol: str, *, ms, start_at: datetime, end_at: datetime, split_billing_windows, signed_get, safe_float, coerce_text, normalize_datetime, sort_entries) -> tuple[list[LiveLedgerEntry], bool, bool]:
    entries, truncated, clipped = adapter_okx_collect_ledger_entries(
        payload,
        symbol,
        start_at=start_at,
        end_at=end_at,
        split_billing_windows=split_billing_windows,
        signed_get=signed_get,
        ms=ms,
        coerce_text=coerce_text,
        safe_float=safe_float,
        normalize_datetime=normalize_datetime,
    )
    return sort_entries(entries), truncated, clipped



def fetch_okx_snapshot(payload: LiveSnapshotRequest, **deps) -> ExchangeSnapshot:
    return exchange_fetch_okx_snapshot(payload, **deps)
