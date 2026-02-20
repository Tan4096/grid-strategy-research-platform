from __future__ import annotations

import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.schemas import DataSource, MarketParamsResponse

BINANCE_EXCHANGE_INFO = "https://fapi.binance.com/fapi/v1/exchangeInfo"
BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex"

BYBIT_INSTRUMENT_INFO = "https://api.bybit.com/v5/market/instruments-info"
BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers"

OKX_INSTRUMENT_INFO = "https://www.okx.com/api/v5/public/instruments"
OKX_FUNDING_RATE = "https://www.okx.com/api/v5/public/funding-rate"


def _build_http_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.3,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=32)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_HTTP_SESSION = _build_http_session()
_MARKET_PARAMS_CACHE_TTL_SECONDS = max(10, int(os.getenv("MARKET_PARAMS_CACHE_TTL_SECONDS", "60")))
_MARKET_PARAMS_CACHE: Dict[Tuple[str, str], Tuple[float, MarketParamsResponse]] = {}
_MARKET_PARAMS_CACHE_LOCK = threading.Lock()


def _request_json(url: str, *, params: Dict[str, Any], timeout: int = 10) -> Any:
    response = _HTTP_SESSION.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _okx_inst_id(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if normalized.endswith("-SWAP"):
        return normalized
    if normalized.endswith("USDT"):
        base = normalized.removesuffix("USDT")
        return f"{base}-USDT-SWAP"
    return normalized


def _fee_defaults(source: DataSource) -> Tuple[float, float]:
    if source == DataSource.BINANCE:
        return 0.0002, 0.0004
    if source == DataSource.BYBIT:
        return 0.0002, 0.00055
    if source == DataSource.OKX:
        return 0.0002, 0.0005
    return 0.0002, 0.0004


def _safe_float(value: Any, fallback: float) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return fallback
    if num <= 0:
        return fallback
    return num


def _fetch_binance(symbol: str) -> Tuple[dict[str, float], list[str]]:
    notes: list[str] = []
    out = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "min_notional": 5.0,
    }

    try:
        payload = _request_json(BINANCE_EXCHANGE_INFO, params={"symbol": symbol.upper()})
        symbols = payload.get("symbols", []) if isinstance(payload, dict) else []
        info = symbols[0] if symbols else None
        if isinstance(info, dict):
            filters = info.get("filters", [])
            if isinstance(filters, list):
                for item in filters:
                    if not isinstance(item, dict):
                        continue
                    ftype = item.get("filterType")
                    if ftype == "PRICE_FILTER":
                        out["price_tick_size"] = _safe_float(item.get("tickSize"), out["price_tick_size"])
                    elif ftype == "LOT_SIZE":
                        out["quantity_step_size"] = _safe_float(item.get("stepSize"), out["quantity_step_size"])
                    elif ftype in ("MIN_NOTIONAL", "NOTIONAL"):
                        out["min_notional"] = _safe_float(item.get("notional") or item.get("minNotional"), out["min_notional"])
    except Exception as exc:
        notes.append(f"binance exchangeInfo fallback: {exc}")

    try:
        premium = _request_json(BINANCE_PREMIUM_INDEX, params={"symbol": symbol.upper()})
        if isinstance(premium, dict):
            out["funding_rate_per_8h"] = float(premium.get("lastFundingRate", 0.0))
    except Exception as exc:
        notes.append(f"binance funding fallback: {exc}")

    return out, notes


def _fetch_bybit(symbol: str) -> Tuple[dict[str, float], list[str]]:
    notes: list[str] = []
    out = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "min_notional": 5.0,
    }

    try:
        payload = _request_json(
            BYBIT_INSTRUMENT_INFO,
            params={"category": "linear", "symbol": symbol.upper()},
        )
        result = payload.get("result", {}) if isinstance(payload, dict) else {}
        lst = result.get("list", []) if isinstance(result, dict) else []
        info = lst[0] if isinstance(lst, list) and lst else None
        if isinstance(info, dict):
            pf = info.get("priceFilter", {})
            lf = info.get("lotSizeFilter", {})
            if isinstance(pf, dict):
                out["price_tick_size"] = _safe_float(pf.get("tickSize"), out["price_tick_size"])
            if isinstance(lf, dict):
                out["quantity_step_size"] = _safe_float(lf.get("qtyStep"), out["quantity_step_size"])
                out["min_notional"] = _safe_float(lf.get("minNotionalValue"), out["min_notional"])
    except Exception as exc:
        notes.append(f"bybit instrument fallback: {exc}")

    try:
        payload = _request_json(
            BYBIT_TICKERS,
            params={"category": "linear", "symbol": symbol.upper()},
        )
        result = payload.get("result", {}) if isinstance(payload, dict) else {}
        lst = result.get("list", []) if isinstance(result, dict) else []
        info = lst[0] if isinstance(lst, list) and lst else None
        if isinstance(info, dict):
            out["funding_rate_per_8h"] = float(info.get("fundingRate", 0.0))
    except Exception as exc:
        notes.append(f"bybit funding fallback: {exc}")

    return out, notes


def _fetch_okx(symbol: str) -> Tuple[dict[str, float], list[str]]:
    notes: list[str] = []
    out = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "min_notional": 5.0,
    }
    inst_id = _okx_inst_id(symbol)

    try:
        payload = _request_json(
            OKX_INSTRUMENT_INFO,
            params={"instType": "SWAP", "instId": inst_id},
        )
        data = payload.get("data", []) if isinstance(payload, dict) else []
        info = data[0] if isinstance(data, list) and data else None
        if isinstance(info, dict):
            out["price_tick_size"] = _safe_float(info.get("tickSz"), out["price_tick_size"])
            out["quantity_step_size"] = _safe_float(info.get("lotSz"), out["quantity_step_size"])
            min_sz = _safe_float(info.get("minSz"), 0.0)
            ct_val = _safe_float(info.get("ctVal"), 0.0)
            estimated_min_notional = min_sz * ct_val if min_sz > 0 and ct_val > 0 else 0.0
            if estimated_min_notional > 0:
                out["min_notional"] = estimated_min_notional
    except Exception as exc:
        notes.append(f"okx instrument fallback: {exc}")

    try:
        payload = _request_json(
            OKX_FUNDING_RATE,
            params={"instId": inst_id},
        )
        data = payload.get("data", []) if isinstance(payload, dict) else []
        info = data[0] if isinstance(data, list) and data else None
        if isinstance(info, dict):
            out["funding_rate_per_8h"] = float(info.get("fundingRate", 0.0))
    except Exception as exc:
        notes.append(f"okx funding fallback: {exc}")

    return out, notes


def fetch_market_params(source: DataSource, symbol: str) -> MarketParamsResponse:
    symbol_upper = symbol.strip().upper()
    cache_key = (source.value, symbol_upper)
    now_ts = datetime.now(timezone.utc).timestamp()
    with _MARKET_PARAMS_CACHE_LOCK:
        cached = _MARKET_PARAMS_CACHE.get(cache_key)
        if cached and (now_ts - cached[0]) <= _MARKET_PARAMS_CACHE_TTL_SECONDS:
            return cached[1]

    maker_fee_rate, taker_fee_rate = _fee_defaults(source)

    payload = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "min_notional": 5.0,
    }
    notes: list[str] = []

    if source == DataSource.BINANCE:
        fetched, n = _fetch_binance(symbol_upper)
        payload.update(fetched)
        notes.extend(n)
    elif source == DataSource.BYBIT:
        fetched, n = _fetch_bybit(symbol_upper)
        payload.update(fetched)
        notes.extend(n)
    elif source == DataSource.OKX:
        fetched, n = _fetch_okx(symbol_upper)
        payload.update(fetched)
        notes.extend(n)
    else:
        notes.append("csv source has no exchange metadata; using fallback defaults")

    note = "; ".join(notes) if notes else None
    response = MarketParamsResponse(
        source=source,
        symbol=symbol_upper,
        maker_fee_rate=maker_fee_rate,
        taker_fee_rate=taker_fee_rate,
        funding_rate_per_8h=float(payload["funding_rate_per_8h"]),
        funding_interval_hours=8,
        price_tick_size=float(payload["price_tick_size"]),
        quantity_step_size=float(payload["quantity_step_size"]),
        min_notional=float(payload["min_notional"]),
        fetched_at=datetime.now(timezone.utc),
        note=note,
    )
    with _MARKET_PARAMS_CACHE_LOCK:
        _MARKET_PARAMS_CACHE[cache_key] = (now_ts, response)
    return response
