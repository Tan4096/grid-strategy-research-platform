from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.schemas import DataSource
from app.services.live_snapshot_types import LiveSnapshotError


def retry_live_action(fn, retries: int):
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



def cache_key_for_robot_list(payload, *, hash_api_key) -> str:
    return f"{hash_api_key(payload.credentials.api_key)}|{payload.scope}"



def cache_key_for_snapshot(payload, *, hash_api_key, normalize_datetime) -> str:
    return "|".join([
        hash_api_key(payload.credentials.api_key),
        payload.algo_id or "",
        payload.symbol.strip().upper(),
        normalize_datetime(payload.strategy_started_at).isoformat(),
        payload.monitoring_scope,
    ])



def mask_api_key(value: str) -> str:
    raw = (value or "").strip()
    if len(raw) <= 5:
        return "*" * len(raw)
    return f"{raw[:3]}{'*' * max(1, len(raw) - 5)}{raw[-2:]}"



def to_data_source(exchange) -> DataSource:
    return DataSource(exchange.value)



def safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if math.isnan(result) or math.isinf(result):
        return float(fallback)
    return result



def safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback



def utc_now() -> datetime:
    return datetime.now(timezone.utc)



def coerce_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""



def coerce_optional_text(value: Any) -> str | None:
    text = coerce_text(value)
    return text or None



def first_present(payload: dict[str, Any], *keys: str) -> Any:
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



def parse_boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return float(value) != 0.0
    raw = coerce_text(value).lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    try:
        return float(raw) != 0.0
    except (TypeError, ValueError):
        return False



def normalize_position_side(value: Any, *, quantity: float = 0.0) -> str:
    raw = coerce_text(value).lower()
    if raw in {"long", "buy", "net_long"}:
        return "long"
    if raw in {"short", "sell", "net_short"}:
        return "short"
    if quantity > 0:
        return "long"
    if quantity < 0:
        return "short"
    return "flat"



def normalize_order_side(value: Any) -> str:
    raw = coerce_text(value).lower()
    if raw in {"sell", "short"}:
        return "sell"
    return "buy"



def optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return safe_float(value, fallback=0.0)



def optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return safe_int(value, fallback=0)



def normalize_datetime(value: Any) -> datetime:
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
            return normalize_datetime(int(raw))
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    raise LiveSnapshotError(f"无法解析时间: {value!r}", status_code=400, retryable=False)



def optional_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return normalize_datetime(value)



def ms(value: datetime) -> int:
    return int(normalize_datetime(value).timestamp() * 1000)



def time_chunks(start_at: datetime, end_at: datetime, *, chunk_days: int) -> list[tuple[datetime, datetime]]:
    current = normalize_datetime(start_at)
    end_ts = normalize_datetime(end_at)
    chunks: list[tuple[datetime, datetime]] = []
    while current < end_ts:
        next_end = min(current + timedelta(days=chunk_days), end_ts)
        chunks.append((current, next_end))
        current = next_end
    return chunks



def floor_to_minute(value: datetime) -> datetime:
    normalized = normalize_datetime(value)
    return normalized.replace(second=0, microsecond=0)
