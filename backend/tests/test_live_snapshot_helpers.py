from __future__ import annotations

from app.core.schemas import LiveDiagnostic
from app.services.live_snapshot_cache import cache_get_any, cache_get_fresh, cache_set, hash_api_key
from app.services.live_snapshot_diagnostics import (
    action_hint_for_code,
    build_diag,
    normalize_diagnostics,
    sanitize_error_message,
)
from app.services.live_snapshot_http import query_string


def test_cache_helpers_respect_ttl(monkeypatch) -> None:
    store: dict[str, tuple[float, object]] = {}
    monotonic = iter([100.0, 102.0, 106.5])
    monkeypatch.setattr("app.services.live_snapshot_cache.time.monotonic", lambda: next(monotonic))

    cache_set(store, "snapshot-key", {"value": 1})

    assert cache_get_fresh(store, "snapshot-key", 5.0) == {"value": 1}
    assert cache_get_fresh(store, "snapshot-key", 5.0) is None
    assert cache_get_any(store, "snapshot-key") == {"value": 1}
    assert len(hash_api_key("demo-key")) == 16



def test_diagnostics_helpers_fill_action_hints_and_sanitize_messages() -> None:
    built = build_diag("warning", "fills_not_available", "成交暂不可用")
    assert built.action_hint == "retry_sync"
    assert action_hint_for_code("funding_source") == "review_ledger"

    normalized = normalize_diagnostics(
        [
            LiveDiagnostic(
                level="warning",
                code="funding_not_available",
                message="资金费缺失",
                action_hint=None,
            )
        ]
    )
    assert normalized[0].action_hint == "retry_sync"
    assert sanitize_error_message("bad api_secret + SIGNATURE + secret") == "bad *** + *** + ***"



def test_query_string_sorts_keys_and_serializes_booleans() -> None:
    assert query_string({"b": 2, "a": True, "c": None, "d": False}) == "a=true&b=2&d=false"
