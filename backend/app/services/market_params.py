from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.redis_state import get_state_redis
from app.core.schemas import DataSource, MarketParamsResponse
from app.services.symbol_utils import (
    looks_like_symbol_not_found_error,
    normalize_symbol_for_source,
    symbol_not_found_message,
)

BINANCE_EXCHANGE_INFO = "https://fapi.binance.com/fapi/v1/exchangeInfo"
BINANCE_PREMIUM_INDEX = "https://fapi.binance.com/fapi/v1/premiumIndex"

BYBIT_INSTRUMENT_INFO = "https://api.bybit.com/v5/market/instruments-info"
BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers"

OKX_INSTRUMENT_INFO = "https://www.okx.com/api/v5/public/instruments"
OKX_FUNDING_RATE = "https://www.okx.com/api/v5/public/funding-rate"
OKX_TICKER = "https://www.okx.com/api/v5/market/ticker"


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


def _cache_digest(source: DataSource, symbol: str) -> str:
    raw = f"{source.value}:{symbol.upper()}"
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:24]


def _redis_cache_key(source: DataSource, symbol: str) -> str:
    return f"app:market_params:{_cache_digest(source, symbol)}"


def _load_market_params_from_redis(source: DataSource, symbol: str) -> MarketParamsResponse | None:
    redis_client = get_state_redis()
    if redis_client is None:
        return None
    try:
        cached_raw = redis_client.get(_redis_cache_key(source, symbol))
    except Exception:
        return None
    if not cached_raw:
        return None
    try:
        parsed = json.loads(cached_raw)
        if not isinstance(parsed, dict):
            return None
        return MarketParamsResponse.model_validate(parsed)
    except Exception:
        return None


def _store_market_params_to_redis(source: DataSource, symbol: str, payload: MarketParamsResponse) -> None:
    redis_client = get_state_redis()
    if redis_client is None:
        return
    try:
        redis_client.set(
            _redis_cache_key(source, symbol),
            json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")),
            ex=_MARKET_PARAMS_CACHE_TTL_SECONDS,
        )
    except Exception:
        return


def _request_json(url: str, *, params: Dict[str, Any], timeout: int = 10) -> Any:
    response = _HTTP_SESSION.get(url, params=params, timeout=timeout)
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"invalid response payload: {url}") from exc
    if not response.ok:
        detail = (
            payload.get("msg")
            if isinstance(payload, dict)
            else None
        ) or (
            payload.get("retMsg")
            if isinstance(payload, dict)
            else None
        ) or (
            payload.get("detail")
            if isinstance(payload, dict)
            else None
        ) or f"HTTP {response.status_code}"
        raise RuntimeError(str(detail))
    return payload


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
        "reference_price": 0.0,
    }

    try:
        payload = _request_json(BINANCE_EXCHANGE_INFO, params={"symbol": symbol.upper()})
        symbols = payload.get("symbols", []) if isinstance(payload, dict) else []
        info = symbols[0] if symbols else None
        if not isinstance(info, dict):
            raise ValueError(symbol_not_found_message(DataSource.BINANCE, symbol))
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
    except ValueError:
        raise
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.BINANCE, symbol)) from exc
        notes.append(f"binance exchangeInfo fallback: {exc}")

    try:
        premium = _request_json(BINANCE_PREMIUM_INDEX, params={"symbol": symbol.upper()})
        if isinstance(premium, dict):
            out["funding_rate_per_8h"] = float(premium.get("lastFundingRate", 0.0))
            out["reference_price"] = _safe_float(premium.get("markPrice") or premium.get("indexPrice"), out["reference_price"])
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.BINANCE, symbol)) from exc
        notes.append(f"binance funding fallback: {exc}")

    return out, notes


def _fetch_bybit(symbol: str) -> Tuple[dict[str, float], list[str]]:
    notes: list[str] = []
    out = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "min_notional": 5.0,
        "reference_price": 0.0,
    }

    try:
        payload = _request_json(
            BYBIT_INSTRUMENT_INFO,
            params={"category": "linear", "symbol": symbol.upper()},
        )
        if not isinstance(payload, dict):
            raise RuntimeError("invalid bybit instrument payload")
        ret_code_raw = payload.get("retCode")
        ret_code = int(ret_code_raw) if ret_code_raw is not None else 0
        if ret_code != 0:
            raise RuntimeError(str(payload.get("retMsg") or f"retCode={ret_code}"))
        result = payload.get("result", {}) if isinstance(payload, dict) else {}
        lst = result.get("list", []) if isinstance(result, dict) else []
        info = lst[0] if isinstance(lst, list) and lst else None
        if not isinstance(info, dict):
            raise ValueError(symbol_not_found_message(DataSource.BYBIT, symbol))
        pf = info.get("priceFilter", {})
        lf = info.get("lotSizeFilter", {})
        if isinstance(pf, dict):
            out["price_tick_size"] = _safe_float(pf.get("tickSize"), out["price_tick_size"])
        if isinstance(lf, dict):
            out["quantity_step_size"] = _safe_float(lf.get("qtyStep"), out["quantity_step_size"])
            out["min_notional"] = _safe_float(lf.get("minNotionalValue"), out["min_notional"])
    except ValueError:
        raise
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.BYBIT, symbol)) from exc
        notes.append(f"bybit instrument fallback: {exc}")

    try:
        payload = _request_json(
            BYBIT_TICKERS,
            params={"category": "linear", "symbol": symbol.upper()},
        )
        if not isinstance(payload, dict):
            raise RuntimeError("invalid bybit ticker payload")
        ret_code_raw = payload.get("retCode")
        ret_code = int(ret_code_raw) if ret_code_raw is not None else 0
        if ret_code != 0:
            raise RuntimeError(str(payload.get("retMsg") or f"retCode={ret_code}"))
        result = payload.get("result", {}) if isinstance(payload, dict) else {}
        lst = result.get("list", []) if isinstance(result, dict) else []
        info = lst[0] if isinstance(lst, list) and lst else None
        if isinstance(info, dict):
            out["funding_rate_per_8h"] = float(info.get("fundingRate", 0.0))
            out["reference_price"] = _safe_float(info.get("markPrice") or info.get("lastPrice"), out["reference_price"])
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.BYBIT, symbol)) from exc
        notes.append(f"bybit funding fallback: {exc}")

    return out, notes


def _fetch_okx(symbol: str) -> Tuple[dict[str, float], list[str]]:
    notes: list[str] = []
    out = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "contract_size_base": 0.0,
        "min_notional": 5.0,
        "reference_price": 0.0,
    }
    inst_id = _okx_inst_id(symbol)
    inst_parts = inst_id.split("-")
    base_ccy = inst_parts[0].upper() if len(inst_parts) >= 1 else ""
    quote_ccy = inst_parts[1].upper() if len(inst_parts) >= 2 else "USDT"
    ticker_price_cache: float | None = None

    def get_okx_ticker_price() -> float:
        nonlocal ticker_price_cache
        if ticker_price_cache is not None:
            return ticker_price_cache
        ticker_payload = _request_json(
            OKX_TICKER,
            params={"instId": inst_id},
        )
        ticker_data = ticker_payload.get("data", []) if isinstance(ticker_payload, dict) else []
        ticker_info = ticker_data[0] if isinstance(ticker_data, list) and ticker_data else None
        if not isinstance(ticker_info, dict):
            ticker_price_cache = 0.0
            return ticker_price_cache
        last_price = _safe_float(ticker_info.get("last"), 0.0)
        mark_price = _safe_float(ticker_info.get("markPx"), 0.0)
        ticker_price_cache = max(last_price, mark_price)
        out["reference_price"] = ticker_price_cache
        return ticker_price_cache

    try:
        payload = _request_json(
            OKX_INSTRUMENT_INFO,
            params={"instType": "SWAP", "instId": inst_id},
        )
        if not isinstance(payload, dict):
            raise RuntimeError("invalid okx instrument payload")
        code = payload.get("code")
        if code is not None and code != "0":
            raise RuntimeError(str(payload.get("msg") or f"code={payload.get('code')}"))
        data = payload.get("data", []) if isinstance(payload, dict) else []
        info = data[0] if isinstance(data, list) and data else None
        if not isinstance(info, dict):
            raise ValueError(symbol_not_found_message(DataSource.OKX, symbol))
        out["price_tick_size"] = _safe_float(info.get("tickSz"), out["price_tick_size"])
        lot_sz = _safe_float(info.get("lotSz"), out["quantity_step_size"])
        min_sz = _safe_float(info.get("minSz"), 0.0)
        ct_val = _safe_float(info.get("ctVal"), 0.0)
        ct_val_ccy = str(info.get("ctValCcy") or "").upper()

        if ct_val > 0:
            if ct_val_ccy == base_ccy:
                out["contract_size_base"] = ct_val
            elif ct_val_ccy in {quote_ccy, "USDT", "USD", "USDC"}:
                ref_price = get_okx_ticker_price()
                if ref_price > 0:
                    out["contract_size_base"] = ct_val / ref_price
                else:
                    notes.append("okx contract_size_base conversion fallback: missing ticker price")
            elif ct_val_ccy:
                notes.append(
                    f"okx contract_size_base conversion fallback: unsupported ctValCcy={ct_val_ccy}"
                )

        # OKX SWAP quantity precision is in contracts (lotSz). Backtest engine quantity is base-asset amount.
        # Convert contract step -> base step when contract value currency is known.
        if lot_sz > 0 and ct_val > 0:
            if ct_val_ccy == base_ccy:
                out["quantity_step_size"] = lot_sz * ct_val
            elif ct_val_ccy in {quote_ccy, "USDT", "USD", "USDC"}:
                ref_price = get_okx_ticker_price()
                if ref_price > 0:
                    out["quantity_step_size"] = (lot_sz * ct_val) / ref_price
                else:
                    out["quantity_step_size"] = lot_sz
                    notes.append("okx quantity_step conversion fallback: missing ticker price")
            else:
                out["quantity_step_size"] = lot_sz
                notes.append(
                    f"okx quantity_step conversion fallback: unsupported ctValCcy={ct_val_ccy or 'UNKNOWN'}"
                )
        else:
            out["quantity_step_size"] = lot_sz

        estimated_contract_value = min_sz * ct_val if min_sz > 0 and ct_val > 0 else 0.0
        if estimated_contract_value > 0:
            if ct_val_ccy in {"", quote_ccy, "USDT", "USD", "USDC"}:
                out["min_notional"] = estimated_contract_value
            else:
                try:
                    ref_price = get_okx_ticker_price()
                    if ref_price > 0:
                        out["min_notional"] = estimated_contract_value * ref_price
                    else:
                        notes.append("okx min_notional conversion fallback: missing ticker price")
                except Exception as exc:
                    notes.append(f"okx min_notional conversion fallback: {exc}")
    except ValueError:
        raise
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.OKX, symbol)) from exc
        notes.append(f"okx instrument fallback: {exc}")

    try:
        payload = _request_json(
            OKX_FUNDING_RATE,
            params={"instId": inst_id},
        )
        if not isinstance(payload, dict):
            raise RuntimeError("invalid okx funding payload")
        code = payload.get("code")
        if code is not None and code != "0":
            raise RuntimeError(str(payload.get("msg") or f"code={payload.get('code')}"))
        data = payload.get("data", []) if isinstance(payload, dict) else []
        info = data[0] if isinstance(data, list) and data else None
        if isinstance(info, dict):
            out["funding_rate_per_8h"] = float(info.get("fundingRate", 0.0))
            out["reference_price"] = _safe_float(info.get("markPrice") or info.get("lastPrice"), out["reference_price"])
    except Exception as exc:
        if looks_like_symbol_not_found_error(str(exc)):
            raise ValueError(symbol_not_found_message(DataSource.OKX, symbol)) from exc
        notes.append(f"okx funding fallback: {exc}")

    return out, notes


def fetch_market_params(source: DataSource, symbol: str) -> MarketParamsResponse:
    symbol_upper = normalize_symbol_for_source(source, symbol)
    cache_key = (source.value, symbol_upper)
    now_ts = datetime.now(timezone.utc).timestamp()
    with _MARKET_PARAMS_CACHE_LOCK:
        cached = _MARKET_PARAMS_CACHE.get(cache_key)
        if cached and (now_ts - cached[0]) <= _MARKET_PARAMS_CACHE_TTL_SECONDS:
            return cached[1]
    redis_cached = _load_market_params_from_redis(source, symbol_upper)
    if redis_cached is not None:
        with _MARKET_PARAMS_CACHE_LOCK:
            _MARKET_PARAMS_CACHE[cache_key] = (now_ts, redis_cached)
        return redis_cached

    maker_fee_rate, taker_fee_rate = _fee_defaults(source)

    payload = {
        "funding_rate_per_8h": 0.0,
        "price_tick_size": 0.1,
        "quantity_step_size": 0.0001,
        "contract_size_base": 0.0,
        "min_notional": 5.0,
        "reference_price": 0.0,
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
        contract_size_base=float(payload["contract_size_base"]) if float(payload["contract_size_base"]) > 0 else None,
        min_notional=float(payload["min_notional"]),
        reference_price=float(payload["reference_price"]) if float(payload["reference_price"]) > 0 else None,
        fetched_at=datetime.now(timezone.utc),
        note=note,
    )
    with _MARKET_PARAMS_CACHE_LOCK:
        _MARKET_PARAMS_CACHE[cache_key] = (now_ts, response)
    _store_market_params_to_redis(source, symbol_upper, response)
    return response
