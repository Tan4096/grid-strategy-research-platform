from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Optional

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.schemas import Candle, DataConfig, DataSource, Interval

BINANCE_FUTURES_KLINES = "https://fapi.binance.com/fapi/v1/klines"
BINANCE_FUNDING_RATE = "https://fapi.binance.com/fapi/v1/fundingRate"
BYBIT_LINEAR_KLINES = "https://api.bybit.com/v5/market/kline"
BYBIT_FUNDING_HISTORY = "https://api.bybit.com/v5/market/funding/history"
OKX_HISTORY_CANDLES = "https://www.okx.com/api/v5/market/history-candles"
OKX_FUNDING_HISTORY = "https://www.okx.com/api/v5/public/funding-rate-history"
BEIJING_TZ = timezone(timedelta(hours=8))

INTERVAL_TO_MS = {
    Interval.M1.value: 60_000,
    Interval.M3.value: 3 * 60_000,
    Interval.M5.value: 5 * 60_000,
    Interval.M15.value: 15 * 60_000,
    Interval.M30.value: 30 * 60_000,
    Interval.H1.value: 60 * 60_000,
    Interval.H2.value: 2 * 60 * 60_000,
    Interval.H4.value: 4 * 60 * 60_000,
    Interval.H6.value: 6 * 60 * 60_000,
    Interval.H8.value: 8 * 60 * 60_000,
    Interval.H12.value: 12 * 60 * 60_000,
    Interval.D1.value: 24 * 60 * 60_000,
}

INTERVAL_TO_PANDAS_RULE = {
    Interval.M1.value: "1min",
    Interval.M3.value: "3min",
    Interval.M5.value: "5min",
    Interval.M15.value: "15min",
    Interval.M30.value: "30min",
    Interval.H1.value: "1h",
    Interval.H2.value: "2h",
    Interval.H4.value: "4h",
    Interval.H6.value: "6h",
    Interval.H8.value: "8h",
    Interval.H12.value: "12h",
    Interval.D1.value: "1d",
}

BYBIT_INTERVAL_MAP: dict[Interval, tuple[str, bool]] = {
    Interval.M1: ("1", False),
    Interval.M3: ("3", False),
    Interval.M5: ("5", False),
    Interval.M15: ("15", False),
    Interval.M30: ("30", False),
    Interval.H1: ("60", False),
    Interval.H2: ("120", False),
    Interval.H4: ("240", False),
    Interval.H6: ("360", False),
    Interval.H8: ("240", True),
    Interval.H12: ("720", False),
    Interval.D1: ("D", False),
}

BYBIT_INTERVAL_TO_MS = {
    "1": 60_000,
    "3": 3 * 60_000,
    "5": 5 * 60_000,
    "15": 15 * 60_000,
    "30": 30 * 60_000,
    "60": 60 * 60_000,
    "120": 2 * 60 * 60_000,
    "240": 4 * 60 * 60_000,
    "360": 6 * 60 * 60_000,
    "720": 12 * 60 * 60_000,
    "D": 24 * 60 * 60_000,
}

OKX_BAR_MAP: dict[Interval, tuple[str, bool]] = {
    Interval.M1: ("1m", False),
    Interval.M3: ("3m", False),
    Interval.M5: ("5m", False),
    Interval.M15: ("15m", False),
    Interval.M30: ("30m", False),
    Interval.H1: ("1H", False),
    Interval.H2: ("2H", False),
    Interval.H4: ("4H", False),
    Interval.H6: ("6H", False),
    Interval.H8: ("4H", True),
    Interval.H12: ("12H", False),
    Interval.D1: ("1D", False),
}

OKX_BAR_TO_MS = {
    "1m": 60_000,
    "3m": 3 * 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1H": 60 * 60_000,
    "2H": 2 * 60 * 60_000,
    "4H": 4 * 60 * 60_000,
    "6H": 6 * 60 * 60_000,
    "12H": 12 * 60 * 60_000,
    "1D": 24 * 60 * 60_000,
}


class DataLoadError(RuntimeError):
    pass


FundingRatePoint = tuple[datetime, float]


def _build_http_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=0.4,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=32)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_HTTP_SESSION = _build_http_session()
_DATA_CACHE_TTL_SECONDS = max(5, int(os.getenv("DATA_CACHE_TTL_SECONDS", "90")))
_DATA_CACHE_MAX_ITEMS = max(16, int(os.getenv("DATA_CACHE_MAX_ITEMS", "256")))
_CANDLE_CACHE: dict[tuple[str, ...], tuple[float, list[Candle]]] = {}
_FUNDING_CACHE: dict[tuple[str, ...], tuple[float, list[FundingRatePoint]]] = {}
_DATA_CACHE_LOCK = threading.Lock()


def _utc_minute_iso(value: datetime) -> str:
    if value.tzinfo is None:
        normalized = value.replace(tzinfo=timezone.utc)
    else:
        normalized = value.astimezone(timezone.utc)
    return normalized.replace(second=0, microsecond=0).isoformat()


def _build_data_cache_key(data_cfg: DataConfig, start_utc: datetime, end_utc: datetime, *, kind: str) -> tuple[str, ...]:
    return (
        kind,
        data_cfg.source.value,
        data_cfg.symbol.upper(),
        data_cfg.interval.value,
        _utc_minute_iso(start_utc),
        _utc_minute_iso(end_utc),
    )


def _get_cached_data(
    cache: dict[tuple[str, ...], tuple[float, object]],
    key: tuple[str, ...],
) -> object | None:
    now = time.monotonic()
    with _DATA_CACHE_LOCK:
        entry = cache.get(key)
        if entry is None:
            return None
        cached_at, payload = entry
        if (now - cached_at) > _DATA_CACHE_TTL_SECONDS:
            cache.pop(key, None)
            return None
        return payload


def _set_cached_data(
    cache: dict[tuple[str, ...], tuple[float, object]],
    key: tuple[str, ...],
    payload: object,
) -> None:
    now = time.monotonic()
    with _DATA_CACHE_LOCK:
        cache[key] = (now, payload)
        overflow = len(cache) - _DATA_CACHE_MAX_ITEMS
        if overflow <= 0:
            return
        oldest_keys = [item[0] for item in sorted(cache.items(), key=lambda item: item[1][0])[:overflow]]
        for stale_key in oldest_keys:
            cache.pop(stale_key, None)


def _request_json(url: str, *, params: dict[str, object], provider: str, timeout: int = 15) -> object:
    try:
        response = _HTTP_SESSION.get(url, params=params, timeout=timeout)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise DataLoadError(f"failed to fetch {provider} data: {exc}") from exc
    return _parse_response_json(response, provider)


def _resolve_time_window(data_cfg: DataConfig) -> tuple[datetime, datetime]:
    end_time = data_cfg.end_time
    if end_time is None:
        end_time = datetime.now(BEIJING_TZ).replace(second=0, microsecond=0)
    elif end_time.tzinfo is None:
        end_time = end_time.replace(tzinfo=BEIJING_TZ)
    else:
        end_time = end_time.astimezone(BEIJING_TZ)

    start_time = data_cfg.start_time
    if start_time is None:
        start_time = end_time - timedelta(days=data_cfg.lookback_days)
    elif start_time.tzinfo is None:
        start_time = start_time.replace(tzinfo=BEIJING_TZ)
    else:
        start_time = start_time.astimezone(BEIJING_TZ)

    if start_time >= end_time:
        raise DataLoadError("start_time must be earlier than end_time")

    return start_time.astimezone(timezone.utc), end_time.astimezone(timezone.utc)


def _filter_by_time_range(
    df: pd.DataFrame, start_utc: Optional[datetime], end_utc: Optional[datetime]
) -> pd.DataFrame:
    if start_utc is None and end_utc is None:
        return df

    filtered = df
    if start_utc is not None:
        filtered = filtered[filtered["timestamp"] >= pd.Timestamp(start_utc)]
    if end_utc is not None:
        filtered = filtered[filtered["timestamp"] <= pd.Timestamp(end_utc)]
    return filtered


def _normalize_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    required = ["timestamp", "open", "high", "low", "close"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise DataLoadError(f"missing required columns: {missing}")

    normalized = df.copy()

    if pd.api.types.is_numeric_dtype(normalized["timestamp"]):
        ts = pd.to_numeric(normalized["timestamp"], errors="coerce")
        median = ts.dropna().median() if not ts.dropna().empty else None
        unit = "s"
        if median is not None:
            if median > 1e17:
                unit = "ns"
            elif median > 1e14:
                unit = "us"
            elif median > 1e11:
                unit = "ms"
        normalized["timestamp"] = pd.to_datetime(ts, utc=True, errors="coerce", unit=unit)
    else:
        normalized["timestamp"] = pd.to_datetime(normalized["timestamp"], utc=True, errors="coerce")
    normalized = normalized.dropna(subset=["timestamp"])

    for col in ["open", "high", "low", "close", "volume"]:
        if col in normalized.columns:
            normalized[col] = pd.to_numeric(normalized[col], errors="coerce")
        else:
            normalized[col] = 0.0

    normalized = normalized.dropna(subset=["open", "high", "low", "close"])
    normalized = normalized.sort_values("timestamp").drop_duplicates(subset=["timestamp"])
    return normalized


def _resample_interval(df: pd.DataFrame, interval: Interval) -> pd.DataFrame:
    rule = INTERVAL_TO_PANDAS_RULE.get(interval.value)
    if rule is None:
        raise DataLoadError(f"unsupported resample interval: {interval.value}")

    if interval == Interval.M1:
        return df

    resampled = (
        df.set_index("timestamp")
        .resample(rule)
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna()
        .reset_index()
    )
    return resampled


def _candles_from_df(df: pd.DataFrame) -> list[Candle]:
    return [
        Candle(
            timestamp=row.timestamp.to_pydatetime(),
            open=float(row.open),
            high=float(row.high),
            low=float(row.low),
            close=float(row.close),
            volume=float(row.volume),
        )
        for row in df.itertuples(index=False)
    ]


def _okx_inst_id(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if normalized.endswith("-SWAP"):
        return normalized
    if normalized.endswith("USDT"):
        base = normalized.removesuffix("USDT")
        return f"{base}-USDT-SWAP"
    raise DataLoadError(f"unsupported OKX symbol format: {symbol}")


def _parse_response_json(
    response: requests.Response,
    provider: str,
) -> object:
    try:
        return response.json()
    except ValueError as exc:
        raise DataLoadError(f"invalid {provider} response payload") from exc


def load_from_binance(
    data_cfg: DataConfig,
    *,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
) -> list[Candle]:
    if start_utc is None or end_utc is None:
        start_utc, end_utc = _resolve_time_window(data_cfg)
    interval_ms = INTERVAL_TO_MS[data_cfg.interval.value]
    current_start_ms = int(start_utc.timestamp() * 1000)
    end_ms = int(end_utc.timestamp() * 1000)

    payload_rows = []
    while current_start_ms < end_ms:
        params = {
            "symbol": data_cfg.symbol.upper(),
            "interval": data_cfg.interval.value,
            "startTime": current_start_ms,
            "endTime": end_ms,
            "limit": 1500,
        }

        try:
            payload = _request_json(BINANCE_FUTURES_KLINES, params=params, provider="Binance", timeout=15)
        except DataLoadError:
            raise

        if not isinstance(payload, list):
            raise DataLoadError("invalid Binance kline response")
        if not payload:
            break

        payload_rows.extend(payload)
        last_open_time_ms = int(payload[-1][0])
        next_start_ms = last_open_time_ms + interval_ms
        if next_start_ms <= current_start_ms:
            break
        current_start_ms = next_start_ms

    if not payload_rows:
        raise DataLoadError("Binance returned empty kline data for selected time window")

    rows = []
    for kline in payload_rows:
        rows.append(
            {
                "timestamp": datetime.fromtimestamp(kline[0] / 1000.0, tz=timezone.utc),
                "open": float(kline[1]),
                "high": float(kline[2]),
                "low": float(kline[3]),
                "close": float(kline[4]),
                "volume": float(kline[5]),
            }
        )

    df = pd.DataFrame(rows)
    normalized = _normalize_dataframe(df)
    normalized = _filter_by_time_range(normalized, start_utc, end_utc)
    if normalized.empty:
        raise DataLoadError("loaded Binance dataframe is empty after time range filtering")

    return _candles_from_df(normalized)


def load_from_bybit(
    data_cfg: DataConfig,
    *,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
) -> list[Candle]:
    if start_utc is None or end_utc is None:
        start_utc, end_utc = _resolve_time_window(data_cfg)
    interval_token, needs_resample = BYBIT_INTERVAL_MAP[data_cfg.interval]
    fetch_interval_ms = BYBIT_INTERVAL_TO_MS[interval_token]
    start_ms = int(start_utc.timestamp() * 1000)
    current_end_ms = int(end_utc.timestamp() * 1000)

    payload_rows: list[list[object]] = []
    while current_end_ms >= start_ms:
        params = {
            "category": "linear",
            "symbol": data_cfg.symbol.upper(),
            "interval": interval_token,
            "end": current_end_ms,
            "limit": 1000,
        }
        try:
            payload = _request_json(BYBIT_LINEAR_KLINES, params=params, provider="Bybit", timeout=15)
        except DataLoadError:
            raise

        if not isinstance(payload, dict) or int(payload.get("retCode", -1)) != 0:
            message = payload.get("retMsg") if isinstance(payload, dict) else "unknown response"
            raise DataLoadError(f"Bybit returned error: {message}")

        result = payload.get("result", {})
        klines = result.get("list", []) if isinstance(result, dict) else []
        if not isinstance(klines, list) or not klines:
            break

        chunk = sorted(klines, key=lambda row: int(row[0]))
        payload_rows.extend(chunk)
        oldest_open_time_ms = int(chunk[0][0])
        next_end_ms = oldest_open_time_ms - fetch_interval_ms
        if next_end_ms >= current_end_ms:
            break
        current_end_ms = next_end_ms

    if not payload_rows:
        raise DataLoadError("Bybit returned empty kline data for selected time window")

    rows = []
    for kline in payload_rows:
        rows.append(
            {
                "timestamp": datetime.fromtimestamp(int(kline[0]) / 1000.0, tz=timezone.utc),
                "open": float(kline[1]),
                "high": float(kline[2]),
                "low": float(kline[3]),
                "close": float(kline[4]),
                "volume": float(kline[5]),
            }
        )

    df = pd.DataFrame(rows)
    normalized = _normalize_dataframe(df)
    normalized = _filter_by_time_range(normalized, start_utc, end_utc)
    if needs_resample:
        normalized = _resample_interval(normalized, data_cfg.interval)
    if normalized.empty:
        raise DataLoadError("loaded Bybit dataframe is empty after time range filtering")

    return _candles_from_df(normalized)


def load_from_okx(
    data_cfg: DataConfig,
    *,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
) -> list[Candle]:
    if start_utc is None or end_utc is None:
        start_utc, end_utc = _resolve_time_window(data_cfg)
    bar_token, needs_resample = OKX_BAR_MAP[data_cfg.interval]
    fetch_interval_ms = OKX_BAR_TO_MS[bar_token]
    start_ms = int(start_utc.timestamp() * 1000)
    current_after_ms = int(end_utc.timestamp() * 1000)
    inst_id = _okx_inst_id(data_cfg.symbol)

    payload_rows: list[list[object]] = []
    while current_after_ms >= start_ms:
        params = {
            "instId": inst_id,
            "bar": bar_token,
            "after": current_after_ms,
            "limit": 100,
        }
        try:
            payload = _request_json(OKX_HISTORY_CANDLES, params=params, provider="OKX", timeout=15)
        except DataLoadError:
            raise

        if not isinstance(payload, dict) or payload.get("code") != "0":
            message = payload.get("msg") if isinstance(payload, dict) else "unknown response"
            raise DataLoadError(f"OKX returned error: {message}")

        klines = payload.get("data", [])
        if not isinstance(klines, list) or not klines:
            break

        chunk = sorted(klines, key=lambda row: int(row[0]))
        payload_rows.extend(chunk)
        oldest_open_time_ms = int(chunk[0][0])
        next_after_ms = oldest_open_time_ms - fetch_interval_ms
        if next_after_ms >= current_after_ms:
            break
        current_after_ms = next_after_ms

    if not payload_rows:
        raise DataLoadError("OKX returned empty kline data for selected time window")

    rows = []
    for kline in payload_rows:
        rows.append(
            {
                "timestamp": datetime.fromtimestamp(int(kline[0]) / 1000.0, tz=timezone.utc),
                "open": float(kline[1]),
                "high": float(kline[2]),
                "low": float(kline[3]),
                "close": float(kline[4]),
                "volume": float(kline[5]),
            }
        )

    df = pd.DataFrame(rows)
    normalized = _normalize_dataframe(df)
    normalized = _filter_by_time_range(normalized, start_utc, end_utc)
    if needs_resample:
        normalized = _resample_interval(normalized, data_cfg.interval)
    if normalized.empty:
        raise DataLoadError("loaded OKX dataframe is empty after time range filtering")

    return _candles_from_df(normalized)


def _rename_csv_columns(df: pd.DataFrame) -> pd.DataFrame:
    mapping_candidates = {
        "timestamp": ["timestamp", "time", "datetime", "date", "open_time"],
        "open": ["open", "o"],
        "high": ["high", "h"],
        "low": ["low", "l"],
        "close": ["close", "c"],
        "volume": ["volume", "v"],
    }

    lowercase_cols = {col.lower().strip(): col for col in df.columns}
    renamed = {}
    for target, aliases in mapping_candidates.items():
        for alias in aliases:
            if alias in lowercase_cols:
                renamed[lowercase_cols[alias]] = target
                break

    out = df.rename(columns=renamed)
    return out


def load_from_csv_content(
    data_cfg: DataConfig,
    *,
    start_utc: Optional[datetime] = None,
    end_utc: Optional[datetime] = None,
) -> list[Candle]:
    if not data_cfg.csv_content:
        raise DataLoadError("CSV source selected but csv_content is empty")

    try:
        raw_df = pd.read_csv(StringIO(data_cfg.csv_content))
    except Exception as exc:  # pragma: no cover - pandas parse errors vary by version
        raise DataLoadError(f"failed to parse csv content: {exc}") from exc

    renamed = _rename_csv_columns(raw_df)
    normalized = _normalize_dataframe(renamed)
    if start_utc is None or end_utc is None:
        start_utc, end_utc = _resolve_time_window(data_cfg)
    filtered = _filter_by_time_range(normalized, start_utc, end_utc)
    interval_df = _resample_interval(filtered, data_cfg.interval)

    if interval_df.empty:
        raise DataLoadError("csv data is empty after parsing/filtering/resampling")

    return _candles_from_df(interval_df)


def _normalize_funding_points(points: list[FundingRatePoint]) -> list[FundingRatePoint]:
    if not points:
        return []
    by_ts: dict[datetime, float] = {}
    for ts, rate in points:
        by_ts[ts] = float(rate)
    return sorted(by_ts.items(), key=lambda item: item[0])


def _load_binance_funding_rates(data_cfg: DataConfig, start_utc: datetime, end_utc: datetime) -> list[FundingRatePoint]:
    symbol = data_cfg.symbol.upper()
    start_ms = int(start_utc.timestamp() * 1000)
    end_ms = int(end_utc.timestamp() * 1000)

    cursor_ms = start_ms
    points: list[FundingRatePoint] = []
    while cursor_ms <= end_ms:
        payload = _request_json(
            BINANCE_FUNDING_RATE,
            params={
                "symbol": symbol,
                "startTime": cursor_ms,
                "endTime": end_ms,
                "limit": 1000,
            },
            provider="Binance funding",
            timeout=15,
        )
        if not isinstance(payload, list):
            raise DataLoadError("invalid Binance funding response")
        if not payload:
            break

        max_ts = cursor_ms
        for row in payload:
            if not isinstance(row, dict):
                continue
            try:
                ts_ms = int(row.get("fundingTime"))
                rate = float(row.get("fundingRate"))
            except (TypeError, ValueError):
                continue
            if ts_ms < start_ms or ts_ms > end_ms:
                continue
            points.append((datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc), rate))
            if ts_ms > max_ts:
                max_ts = ts_ms

        if max_ts <= cursor_ms:
            break
        cursor_ms = max_ts + 1
        if len(payload) < 1000:
            break

    return _normalize_funding_points(points)


def _load_bybit_funding_rates(data_cfg: DataConfig, start_utc: datetime, end_utc: datetime) -> list[FundingRatePoint]:
    symbol = data_cfg.symbol.upper()
    start_ms = int(start_utc.timestamp() * 1000)
    end_ms = int(end_utc.timestamp() * 1000)

    cursor_ms = start_ms
    points: list[FundingRatePoint] = []
    while cursor_ms <= end_ms:
        payload = _request_json(
            BYBIT_FUNDING_HISTORY,
            params={
                "category": "linear",
                "symbol": symbol,
                "startTime": cursor_ms,
                "endTime": end_ms,
                "limit": 200,
            },
            provider="Bybit funding",
            timeout=15,
        )
        if not isinstance(payload, dict) or int(payload.get("retCode", -1)) != 0:
            message = payload.get("retMsg") if isinstance(payload, dict) else "unknown response"
            raise DataLoadError(f"Bybit returned funding error: {message}")

        result = payload.get("result", {})
        rows = result.get("list", []) if isinstance(result, dict) else []
        if not isinstance(rows, list) or not rows:
            break

        max_ts = cursor_ms
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_ts = row.get("fundingRateTimestamp") or row.get("fundingTime") or row.get("fundingRateTime")
            try:
                ts_ms = int(raw_ts)
                rate = float(row.get("fundingRate"))
            except (TypeError, ValueError):
                continue
            if ts_ms < start_ms or ts_ms > end_ms:
                continue
            points.append((datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc), rate))
            if ts_ms > max_ts:
                max_ts = ts_ms

        if max_ts <= cursor_ms:
            break
        cursor_ms = max_ts + 1
        if len(rows) < 200:
            break

    return _normalize_funding_points(points)


def _load_okx_funding_rates(data_cfg: DataConfig, start_utc: datetime, end_utc: datetime) -> list[FundingRatePoint]:
    inst_id = _okx_inst_id(data_cfg.symbol)
    start_ms = int(start_utc.timestamp() * 1000)
    end_ms = int(end_utc.timestamp() * 1000)

    cursor_after_ms = end_ms
    points: list[FundingRatePoint] = []
    while cursor_after_ms >= start_ms:
        payload = _request_json(
            OKX_FUNDING_HISTORY,
            params={
                "instId": inst_id,
                "after": cursor_after_ms,
                "limit": 100,
            },
            provider="OKX funding",
            timeout=15,
        )
        if not isinstance(payload, dict) or payload.get("code") != "0":
            message = payload.get("msg") if isinstance(payload, dict) else "unknown response"
            raise DataLoadError(f"OKX returned funding error: {message}")

        rows = payload.get("data", [])
        if not isinstance(rows, list) or not rows:
            break

        min_ts = cursor_after_ms
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                ts_ms = int(row.get("fundingTime"))
                rate = float(row.get("fundingRate"))
            except (TypeError, ValueError):
                continue
            if ts_ms < start_ms or ts_ms > end_ms:
                continue
            points.append((datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc), rate))
            if ts_ms < min_ts:
                min_ts = ts_ms

        if min_ts >= cursor_after_ms:
            break
        cursor_after_ms = min_ts - 1
        if len(rows) < 100:
            break

    return _normalize_funding_points(points)


def load_funding_rates(data_cfg: DataConfig) -> list[FundingRatePoint]:
    if data_cfg.source == DataSource.CSV:
        return []

    start_utc, end_utc = _resolve_time_window(data_cfg)
    cache_key = _build_data_cache_key(data_cfg, start_utc, end_utc, kind="funding")
    cached = _get_cached_data(_FUNDING_CACHE, cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    points: list[FundingRatePoint] = []
    try:
        if data_cfg.source == DataSource.BINANCE:
            points = _load_binance_funding_rates(data_cfg, start_utc, end_utc)
        elif data_cfg.source == DataSource.BYBIT:
            points = _load_bybit_funding_rates(data_cfg, start_utc, end_utc)
        elif data_cfg.source == DataSource.OKX:
            points = _load_okx_funding_rates(data_cfg, start_utc, end_utc)
    except DataLoadError:
        # Funding fetch errors should not block backtest; engine will fallback to static funding rate.
        points = []
    except Exception:
        points = []

    _set_cached_data(_FUNDING_CACHE, cache_key, points)
    return points


def load_candles(data_cfg: DataConfig) -> list[Candle]:
    start_utc, end_utc = _resolve_time_window(data_cfg)
    if data_cfg.source != DataSource.CSV:
        cache_key = _build_data_cache_key(data_cfg, start_utc, end_utc, kind="candles")
        cached = _get_cached_data(_CANDLE_CACHE, cache_key)
        if cached is not None:
            return cached  # type: ignore[return-value]

    candles: list[Candle]
    if data_cfg.source == DataSource.BINANCE:
        candles = load_from_binance(data_cfg, start_utc=start_utc, end_utc=end_utc)
    elif data_cfg.source == DataSource.BYBIT:
        candles = load_from_bybit(data_cfg, start_utc=start_utc, end_utc=end_utc)
    elif data_cfg.source == DataSource.OKX:
        candles = load_from_okx(data_cfg, start_utc=start_utc, end_utc=end_utc)
    elif data_cfg.source == DataSource.CSV:
        candles = load_from_csv_content(data_cfg, start_utc=start_utc, end_utc=end_utc)
    else:
        raise DataLoadError(f"unsupported data source: {data_cfg.source}")

    if data_cfg.source != DataSource.CSV:
        cache_key = _build_data_cache_key(data_cfg, start_utc, end_utc, kind="candles")
        _set_cached_data(_CANDLE_CACHE, cache_key, candles)
    return candles
