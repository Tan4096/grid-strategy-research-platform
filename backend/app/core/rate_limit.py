from __future__ import annotations

import hashlib
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Tuple

from fastapi import Request

from app.core.redis_state import get_state_redis
from app.core.security import AuthPrincipal


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _enabled() -> bool:
    return _truthy(os.getenv("APP_RATE_LIMIT_ENABLED"), default=True)


def _write_rpm_per_subject() -> int:
    return max(5, int(os.getenv("APP_RATE_LIMIT_WRITE_RPM", "120")))


def _write_rpm_per_ip() -> int:
    return max(10, int(os.getenv("APP_RATE_LIMIT_IP_WRITE_RPM", "240")))


def _bucket_ttl_seconds() -> int:
    return max(60, int(os.getenv("APP_RATE_LIMIT_BUCKET_TTL_SECONDS", "1800")))


def _window_seconds() -> int:
    return max(10, int(os.getenv("APP_RATE_LIMIT_WINDOW_SECONDS", "60")))


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


_LOCK = threading.Lock()
_SUBJECT_BUCKETS: dict[str, _Bucket] = {}
_IP_BUCKETS: dict[str, _Bucket] = {}


def _is_rate_limited_method(method: str) -> bool:
    normalized = method.upper()
    return normalized in {"POST", "PUT", "PATCH", "DELETE"}


def _refill_and_consume(
    buckets: dict[str, _Bucket],
    key: str,
    rate_per_minute: int,
    now: float,
) -> Tuple[bool, int]:
    refill_per_second = rate_per_minute / 60.0
    capacity = float(rate_per_minute)
    bucket = buckets.get(key)
    if bucket is None:
        bucket = _Bucket(tokens=capacity, updated_at=now)
        buckets[key] = bucket
    else:
        elapsed = max(0.0, now - bucket.updated_at)
        if elapsed > 0:
            bucket.tokens = min(capacity, bucket.tokens + elapsed * refill_per_second)
            bucket.updated_at = now

    if bucket.tokens >= 1.0:
        bucket.tokens -= 1.0
        return True, 0

    if refill_per_second <= 0:
        return False, 60
    wait_seconds = max(1, int(math.ceil((1.0 - bucket.tokens) / refill_per_second)))
    return False, wait_seconds


def _cleanup_buckets(now: float) -> None:
    ttl_seconds = _bucket_ttl_seconds()
    for buckets in (_SUBJECT_BUCKETS, _IP_BUCKETS):
        stale_keys = [key for key, bucket in buckets.items() if (now - bucket.updated_at) > ttl_seconds]
        for key in stale_keys:
            buckets.pop(key, None)


def _rate_limit_subject(request: Request, principal: AuthPrincipal | None) -> str:
    if principal is not None and principal.subject != "auth-disabled":
        return principal.subject
    explicit_client = request.headers.get("X-Client-Session", "").strip()
    if explicit_client:
        return explicit_client
    if principal is None:
        return "anonymous"
    # 匿名部署下主语统一为 auth-disabled，会导致全局串扰；优先绑定IP。
    return request.client.host if request.client is not None else "anonymous"


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:24]


def _redis_consume(window_key: str, rate_per_minute: int, now_epoch: int) -> tuple[bool, int] | None:
    redis_client = get_state_redis()
    if redis_client is None:
        return None
    window_seconds = _window_seconds()
    window_start = now_epoch - (now_epoch % window_seconds)
    retry_after = max(1, window_seconds - (now_epoch - window_start) + 1)
    key = f"app:rate_limit:{window_key}:{window_start}"
    try:
        current = int(redis_client.incr(key))
        if current == 1:
            redis_client.expire(key, retry_after)
    except Exception:
        return None
    if current <= rate_per_minute:
        return True, 0
    return False, retry_after


def check_rate_limit(request: Request, principal: AuthPrincipal | None) -> tuple[bool, int, str]:
    if not _enabled() or not _is_rate_limited_method(request.method):
        return True, 0, "ok"

    subject = _rate_limit_subject(request, principal)
    client_ip = request.client.host if request.client is not None else "unknown"
    subject_rpm = _write_rpm_per_subject()
    ip_rpm = _write_rpm_per_ip()
    now_epoch = int(time.time())

    redis_subject = _redis_consume(f"subject:{_digest(subject)}", subject_rpm, now_epoch)
    redis_ip = _redis_consume(f"ip:{_digest(client_ip)}", ip_rpm, now_epoch)
    if redis_subject is not None and redis_ip is not None:
        allowed_subject, retry_subject = redis_subject
        allowed_ip, retry_ip = redis_ip
        if allowed_subject and allowed_ip:
            return True, 0, "ok"
        if not allowed_subject and not allowed_ip:
            return False, max(retry_subject, retry_ip), "subject+ip"
        if not allowed_subject:
            return False, retry_subject, "subject"
        return False, retry_ip, "ip"

    now = time.monotonic()

    with _LOCK:
        _cleanup_buckets(now)
        allowed_subject, retry_subject = _refill_and_consume(
            _SUBJECT_BUCKETS,
            key=subject,
            rate_per_minute=subject_rpm,
            now=now,
        )
        allowed_ip, retry_ip = _refill_and_consume(
            _IP_BUCKETS,
            key=client_ip,
            rate_per_minute=ip_rpm,
            now=now,
        )

    if allowed_subject and allowed_ip:
        return True, 0, "ok"
    if not allowed_subject and not allowed_ip:
        return False, max(retry_subject, retry_ip), "subject+ip"
    if not allowed_subject:
        return False, retry_subject, "subject"
    return False, retry_ip, "ip"


def reset_rate_limit_state() -> None:
    redis_client = get_state_redis()
    if redis_client is not None:
        try:
            keys = list(redis_client.scan_iter(match="app:rate_limit:*"))
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass
    with _LOCK:
        _SUBJECT_BUCKETS.clear()
        _IP_BUCKETS.clear()
