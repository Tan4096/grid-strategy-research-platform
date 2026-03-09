from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Request

from app.core.redis_state import get_state_redis
from app.core.security import AuthPrincipal
from app.core.settings import get_settings


ConcurrencyScope = Literal["job_start", "history_delete"]


@dataclass(frozen=True)
class ConcurrencyLease:
    scope: ConcurrencyScope
    backend: Literal["redis", "memory"]
    subject_key: str | None
    ip_key: str | None
    global_key: str | None


@dataclass
class _Counter:
    value: int
    updated_at: float


_LOCK = threading.Lock()
_MEMORY_COUNTERS: dict[str, _Counter] = {}



def _enabled() -> bool:
    return get_settings().app_concurrency_limit_enabled



def _per_subject_limit() -> int:
    return max(1, get_settings().app_concurrency_limit_per_subject)



def _per_ip_limit() -> int:
    return max(1, get_settings().app_concurrency_limit_per_ip)



def _global_limit() -> int:
    return max(1, get_settings().app_concurrency_limit_global)



def _ttl_seconds() -> int:
    return max(30, get_settings().app_concurrency_limit_ttl_seconds)



def _request_scope(request: Request) -> ConcurrencyScope | None:
    method = request.method.upper()
    path = request.url.path
    if method == "POST" and path in {"/api/v1/backtest/start", "/api/v1/optimization/start"}:
        return "job_start"
    if method == "DELETE" and path.startswith("/api/v1/optimization-history"):
        return "history_delete"
    return None



def _subject(principal: AuthPrincipal | None, client_ip: str) -> str:
    if principal is not None and principal.subject != "auth-disabled":
        return principal.subject
    return client_ip



def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:24]



def _redis_key(scope: ConcurrencyScope, dimension: str, value: str) -> str:
    return f"app:concurrency:{scope}:{dimension}:{value}"



def _redis_try_acquire(
    *,
    scope: ConcurrencyScope,
    subject_key: str,
    ip_key: str,
    global_key: str,
) -> tuple[bool, int, ConcurrencyLease] | None:
    redis_client = get_state_redis()
    if redis_client is None:
        return None

    ttl = _ttl_seconds()
    subject_limit = _per_subject_limit()
    ip_limit = _per_ip_limit()
    global_limit = _global_limit()

    touched_keys: list[str] = []
    try:
        current_subject_raw: Any = redis_client.incr(subject_key)
        current_subject = int(current_subject_raw)
        touched_keys.append(subject_key)
        if current_subject == 1:
            redis_client.expire(subject_key, ttl)

        current_ip_raw: Any = redis_client.incr(ip_key)
        current_ip = int(current_ip_raw)
        touched_keys.append(ip_key)
        if current_ip == 1:
            redis_client.expire(ip_key, ttl)

        current_global_raw: Any = redis_client.incr(global_key)
        current_global = int(current_global_raw)
        touched_keys.append(global_key)
        if current_global == 1:
            redis_client.expire(global_key, ttl)

        if current_subject <= subject_limit and current_ip <= ip_limit and current_global <= global_limit:
            return True, 0, ConcurrencyLease(scope=scope, backend="redis", subject_key=subject_key, ip_key=ip_key, global_key=global_key)

        for key in touched_keys:
            try:
                redis_client.decr(key)
            except Exception:
                continue
        return False, 1, ConcurrencyLease(scope=scope, backend="redis", subject_key=None, ip_key=None, global_key=None)
    except Exception:
        for key in touched_keys:
            try:
                redis_client.decr(key)
            except Exception:
                continue
        return None



def _cleanup_memory_locked(now: float) -> None:
    ttl = _ttl_seconds()
    stale_keys = [key for key, counter in _MEMORY_COUNTERS.items() if counter.value <= 0 and (now - counter.updated_at) > ttl]
    for key in stale_keys:
        _MEMORY_COUNTERS.pop(key, None)



def _memory_increment_locked(key: str, now: float) -> int:
    counter = _MEMORY_COUNTERS.get(key)
    if counter is None:
        counter = _Counter(value=0, updated_at=now)
        _MEMORY_COUNTERS[key] = counter
    counter.value += 1
    counter.updated_at = now
    return counter.value



def _memory_decrement_locked(key: str, now: float) -> None:
    counter = _MEMORY_COUNTERS.get(key)
    if counter is None:
        return
    counter.value = max(0, counter.value - 1)
    counter.updated_at = now



def _memory_try_acquire(
    *,
    scope: ConcurrencyScope,
    subject_key: str,
    ip_key: str,
    global_key: str,
) -> tuple[bool, int, ConcurrencyLease | None]:
    subject_limit = _per_subject_limit()
    ip_limit = _per_ip_limit()
    global_limit = _global_limit()
    now = time.monotonic()

    with _LOCK:
        _cleanup_memory_locked(now)
        current_subject = _memory_increment_locked(subject_key, now)
        current_ip = _memory_increment_locked(ip_key, now)
        current_global = _memory_increment_locked(global_key, now)

        allowed = current_subject <= subject_limit and current_ip <= ip_limit and current_global <= global_limit
        if not allowed:
            _memory_decrement_locked(subject_key, now)
            _memory_decrement_locked(ip_key, now)
            _memory_decrement_locked(global_key, now)
            return False, 1, None

    return True, 0, ConcurrencyLease(scope=scope, backend="memory", subject_key=subject_key, ip_key=ip_key, global_key=global_key)



def acquire_concurrency_slot(
    request: Request,
    principal: AuthPrincipal | None,
) -> tuple[bool, int, str, ConcurrencyLease | None]:
    if not _enabled():
        return True, 0, "ok", None

    scope = _request_scope(request)
    if scope is None:
        return True, 0, "ok", None

    client_ip = request.client.host if request.client is not None else "unknown"
    subject = _subject(principal, client_ip)

    subject_key = _redis_key(scope, "subject", _digest(subject))
    ip_key = _redis_key(scope, "ip", _digest(client_ip))
    global_key = _redis_key(scope, "global", "all")

    redis_result = _redis_try_acquire(scope=scope, subject_key=subject_key, ip_key=ip_key, global_key=global_key)
    if redis_result is not None:
        allowed, retry_after, lease = redis_result
        return allowed, retry_after, scope, lease if allowed else None

    memory_allowed, memory_retry_after, memory_lease = _memory_try_acquire(
        scope=scope,
        subject_key=subject_key,
        ip_key=ip_key,
        global_key=global_key,
    )
    return memory_allowed, memory_retry_after, scope, memory_lease



def release_concurrency_slot(lease: ConcurrencyLease | None) -> None:
    if lease is None:
        return

    keys = [item for item in [lease.subject_key, lease.ip_key, lease.global_key] if item]
    if not keys:
        return

    if lease.backend == "redis":
        redis_client = get_state_redis()
        if redis_client is None:
            return
        for key in keys:
            try:
                redis_client.decr(key)
            except Exception:
                continue
        return

    now = time.monotonic()
    with _LOCK:
        for key in keys:
            _memory_decrement_locked(key, now)
        _cleanup_memory_locked(now)



def reset_concurrency_limit_state() -> None:
    redis_client = get_state_redis()
    if redis_client is not None:
        try:
            keys = list(redis_client.scan_iter(match="app:concurrency:*"))
            if keys:
                redis_client.delete(*keys)
        except Exception:
            pass
    with _LOCK:
        _MEMORY_COUNTERS.clear()
