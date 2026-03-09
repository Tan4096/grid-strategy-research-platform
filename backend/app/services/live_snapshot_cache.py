from __future__ import annotations

import hashlib
import time


def hash_api_key(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()[:16]


def cache_get_fresh(store: dict[str, tuple[float, object]], key: str, ttl_sec: float):
    entry = store.get(key)
    if not entry:
        return None
    stored_at, payload = entry
    if time.monotonic() - stored_at > ttl_sec:
        return None
    return payload.model_copy(deep=True) if hasattr(payload, "model_copy") else payload


def cache_get_any(store: dict[str, tuple[float, object]], key: str):
    entry = store.get(key)
    if not entry:
        return None
    _, payload = entry
    return payload.model_copy(deep=True) if hasattr(payload, "model_copy") else payload


def cache_set(store: dict[str, tuple[float, object]], key: str, value: object) -> None:
    store[key] = (
        time.monotonic(),
        value.model_copy(deep=True) if hasattr(value, "model_copy") else value,
    )
