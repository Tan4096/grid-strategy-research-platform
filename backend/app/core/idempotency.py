from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, Tuple

from app.core.redis_state import get_state_redis


_DEFAULT_TTL_SECONDS = max(60, int(os.getenv("IDEMPOTENCY_TTL_SECONDS", "86400")))
_MAX_CACHE_SIZE = max(1000, int(os.getenv("IDEMPOTENCY_CACHE_MAX_KEYS", "50000")))
_REDIS_LOCK_TIMEOUT_SECONDS = max(3, int(os.getenv("IDEMPOTENCY_REDIS_LOCK_TIMEOUT_SECONDS", "8")))
_REDIS_WAIT_TIMEOUT_SECONDS = max(1.0, float(os.getenv("IDEMPOTENCY_REDIS_WAIT_TIMEOUT_SECONDS", "5.0")))
_REDIS_WAIT_STEP_SECONDS = max(0.01, float(os.getenv("IDEMPOTENCY_REDIS_WAIT_STEP_SECONDS", "0.05")))


@dataclass
class _IdempotencyEntry:
    value: str
    expires_at: float


_LOCK = threading.Lock()
_ENTRIES: Dict[str, _IdempotencyEntry] = {}
_RELEASE_LOCK_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


def normalize_idempotency_key(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    # Keep key size bounded for logs/memory.
    return normalized[:256]


def _cleanup_locked(now: float) -> None:
    expired = [key for key, entry in _ENTRIES.items() if entry.expires_at <= now]
    for key in expired:
        _ENTRIES.pop(key, None)

    if len(_ENTRIES) <= _MAX_CACHE_SIZE:
        return

    # Evict soonest-expiring keys first when cache grows unexpectedly.
    stale_keys = sorted(_ENTRIES.items(), key=lambda item: item[1].expires_at)
    for key, _ in stale_keys[: max(0, len(_ENTRIES) - _MAX_CACHE_SIZE)]:
        _ENTRIES.pop(key, None)


def _release_redis_lock(redis_client, lock_key: str, token: str) -> None:
    try:
        redis_client.eval(_RELEASE_LOCK_LUA, 1, lock_key, token)
    except Exception:
        return


def _redis_get_or_create(
    *,
    cache_key: str,
    create: Callable[[], str],
    ttl: int,
) -> Tuple[str, bool] | None:
    redis_client = get_state_redis()
    if redis_client is None:
        return None

    lock_key = f"{cache_key}:lock"
    deadline = time.monotonic() + _REDIS_WAIT_TIMEOUT_SECONDS

    try:
        while True:
            existing = redis_client.get(cache_key)
            if existing:
                return str(existing), True

            token = uuid.uuid4().hex
            acquired = redis_client.set(lock_key, token, nx=True, ex=_REDIS_LOCK_TIMEOUT_SECONDS)
            if acquired:
                try:
                    existing = redis_client.get(cache_key)
                    if existing:
                        return str(existing), True
                    created = create()
                    redis_client.set(cache_key, created, ex=ttl)
                    return created, False
                finally:
                    _release_redis_lock(redis_client, lock_key, token)

            if time.monotonic() >= deadline:
                break
            time.sleep(_REDIS_WAIT_STEP_SECONDS)

        # Lock holder可能崩溃，兜底使用SET NX避免覆盖已有值。
        created = create()
        if redis_client.set(cache_key, created, nx=True, ex=ttl):
            return created, False
        existing = redis_client.get(cache_key)
        if existing:
            return str(existing), True
        return created, False
    except Exception:
        return None


def get_or_create_idempotent_value(
    *,
    namespace: str,
    scoped_key: str,
    create: Callable[[], str],
    ttl_seconds: int | None = None,
) -> Tuple[str, bool]:
    ttl = max(60, int(ttl_seconds if ttl_seconds is not None else _DEFAULT_TTL_SECONDS))
    cache_key = f"{namespace}:{scoped_key}"
    redis_result = _redis_get_or_create(cache_key=cache_key, create=create, ttl=ttl)
    if redis_result is not None:
        return redis_result

    now = time.monotonic()

    with _LOCK:
        _cleanup_locked(now)
        existing = _ENTRIES.get(cache_key)
        if existing and existing.expires_at > now:
            return existing.value, True

    created_value = create()
    expires_at = now + ttl
    with _LOCK:
        _cleanup_locked(now)
        # Double-check to keep first-writer semantics under races.
        existing = _ENTRIES.get(cache_key)
        if existing and existing.expires_at > now:
            return existing.value, True
        _ENTRIES[cache_key] = _IdempotencyEntry(value=created_value, expires_at=expires_at)
    return created_value, False


def invalidate_idempotent_value(*, namespace: str, scoped_key: str) -> None:
    cache_key = f"{namespace}:{scoped_key}"
    redis_client = get_state_redis()
    if redis_client is not None:
        try:
            redis_client.delete(cache_key)
            redis_client.delete(f"{cache_key}:lock")
        except Exception:
            pass
    with _LOCK:
        _ENTRIES.pop(cache_key, None)
