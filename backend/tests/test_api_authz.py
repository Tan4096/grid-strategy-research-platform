from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app.core.schemas import default_request
from app.main import app
from app.tasks.arq_queue import ArqEnqueueError


def _headers(api_key: str, confirm: str | None = None, confirm_count: int | None = None) -> dict[str, str]:
    result = {"X-API-Key": api_key}
    if confirm:
        result["X-Confirm-Action"] = confirm
    if confirm_count is not None:
        result["X-Confirm-Count"] = str(confirm_count)
    return result


def test_auth_requires_credentials_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "admin-key:admin:admin-user")
    client = TestClient(app)

    response = client.get("/api/v1/backtest/defaults")

    assert response.status_code == 401
    payload = response.json()
    assert payload["code"] == "HTTP_401"
    assert isinstance(payload.get("message"), str) and payload["message"]
    assert payload.get("detail") == payload.get("message")
    assert payload.get("request_id")


def test_full_history_clear_requires_admin_role(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv(
        "APP_AUTH_API_KEYS",
        "viewer-key:viewer:viewer-user,operator-key:operator:operator-user,admin-key:admin:admin-user",
    )
    client = TestClient(app)

    response = client.delete(
        "/api/v1/optimization-history",
        headers=_headers("operator-key", confirm="CLEAR_ALL_OPTIMIZATION_HISTORY"),
    )

    assert response.status_code == 403


def test_full_history_clear_requires_second_confirmation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "admin-key:admin:admin-user")
    monkeypatch.setattr(
        "app.api.routes.clear_optimization_history",
        lambda: {
            "requested": 3,
            "deleted": 3,
            "failed": 0,
            "deleted_job_ids": ["a", "b", "c"],
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )
    client = TestClient(app)

    missing_confirm = client.delete("/api/v1/optimization-history", headers=_headers("admin-key"))
    assert missing_confirm.status_code == 400

    confirmed = client.delete(
        "/api/v1/optimization-history",
        headers=_headers("admin-key", confirm="CLEAR_ALL_OPTIMIZATION_HISTORY"),
    )
    assert confirmed.status_code == 200
    payload = confirmed.json()
    assert payload["requested"] == 3
    assert payload["deleted"] == 3
    assert payload["failed"] == 0
    assert payload["deleted_job_ids"] == ["a", "b", "c"]
    assert payload["failed_job_ids"] == []
    assert payload["failed_items"] == []
    assert payload["skipped"] == 0
    assert payload["skipped_job_ids"] == []
    assert payload["soft_delete_ttl_hours"] == 48
    assert isinstance(payload.get("operation_id"), str) and payload["operation_id"]
    assert isinstance(payload.get("undo_until"), str) and payload["undo_until"]
    assert isinstance(payload.get("summary_text"), str) and payload["summary_text"]
    assert isinstance(payload.get("request_id"), str) and payload["request_id"]
    assert payload.get("meta") == {"retryable": False}


def test_full_history_clear_blocked_in_public_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_PUBLIC_MODE", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "admin-key:admin:admin-user")
    client = TestClient(app)

    response = client.delete(
        "/api/v1/optimization-history",
        headers=_headers("admin-key", confirm="CLEAR_ALL_OPTIMIZATION_HISTORY"),
    )

    assert response.status_code == 403
    assert "禁用全量清空" in response.json()["message"]


def test_selected_history_clear_requires_confirmation_and_allows_operator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": len(ids),
            "failed": 0,
            "deleted_job_ids": ids,
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )
    client = TestClient(app)

    missing_confirm = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-a"), ("job_id", "job-b")],
        headers=_headers("operator-key"),
    )
    assert missing_confirm.status_code == 400

    confirmed = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-a"), ("job_id", "job-b")],
        headers=_headers("operator-key", confirm="CLEAR_SELECTED_OPTIMIZATION_HISTORY", confirm_count=2),
    )
    assert confirmed.status_code == 200
    payload = confirmed.json()
    assert payload["requested"] == 2
    assert payload["deleted"] == 2
    assert payload["failed"] == 0
    assert payload["deleted_job_ids"] == ["job-a", "job-b"]
    assert payload["failed_job_ids"] == []
    assert payload["failed_items"] == []
    assert payload["skipped"] == 0
    assert payload["skipped_job_ids"] == []
    assert payload["soft_delete_ttl_hours"] == 48
    assert payload["summary_text"] == "清空完成：请求 2 条，成功 2 条，失败 0 条。"
    assert isinstance(payload["operation_id"], str) and payload["operation_id"]
    assert isinstance(payload["undo_until"], str) and payload["undo_until"]
    assert isinstance(payload["request_id"], str) and payload["request_id"]
    assert payload["meta"] == {"retryable": False}


def test_selected_history_clear_requires_confirm_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": len(ids),
            "failed": 0,
            "deleted_job_ids": ids,
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )
    client = TestClient(app)

    response = client.delete(
        "/api/v1/optimization-history/selected",
        params=[("job_id", "job-a"), ("job_id", "job-b")],
        headers=_headers("operator-key", confirm="CLEAR_SELECTED_OPTIMIZATION_HISTORY", confirm_count=1),
    )

    assert response.status_code == 400
    assert "X-Confirm-Count=2" in response.json()["message"]


def test_selected_history_clear_rejects_too_many_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    client = TestClient(app)

    many_ids = [("job_id", f"job-{i}") for i in range(501)]
    response = client.delete(
        "/api/v1/optimization-history/selected",
        params=many_ids,
        headers=_headers("operator-key", confirm="CLEAR_SELECTED_OPTIMIZATION_HISTORY", confirm_count=len(many_ids)),
    )

    assert response.status_code == 400
    assert "500" in response.json()["detail"]


def test_selected_history_clear_uses_public_mode_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_PUBLIC_MODE", "1")
    monkeypatch.setenv("OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC", "3")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    client = TestClient(app)

    params = [("job_id", "job-a"), ("job_id", "job-b"), ("job_id", "job-c"), ("job_id", "job-d")]
    response = client.delete(
        "/api/v1/optimization-history/selected",
        params=params,
        headers=_headers("operator-key", confirm="CLEAR_SELECTED_OPTIMIZATION_HISTORY", confirm_count=4),
    )

    assert response.status_code == 403
    assert "3 条" in response.json()["message"]


def test_write_api_is_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    monkeypatch.setenv("APP_RATE_LIMIT_ENABLED", "1")
    monkeypatch.setenv("APP_RATE_LIMIT_WRITE_RPM", "5")
    monkeypatch.setenv("APP_RATE_LIMIT_IP_WRITE_RPM", "5")
    monkeypatch.setattr(
        "app.api.routes.clear_selected_optimization_history",
        lambda ids: {
            "requested": len(ids),
            "deleted": len(ids),
            "failed": 0,
            "deleted_job_ids": ids,
            "failed_job_ids": [],
            "failed_items": [],
            "skipped": 0,
            "skipped_job_ids": [],
            "soft_delete_ttl_hours": 48,
        },
    )
    client = TestClient(app)

    params = [("job_id", "job-a")]
    headers = _headers("operator-key", confirm="CLEAR_SELECTED_OPTIMIZATION_HISTORY", confirm_count=1)

    for _ in range(5):
        ok = client.delete("/api/v1/optimization-history/selected", params=params, headers=headers)
        assert ok.status_code == 200

    limited = client.delete("/api/v1/optimization-history/selected", params=params, headers=headers)
    assert limited.status_code == 429
    body = limited.json()
    assert body["code"] == "RATE_LIMITED"


def test_startup_rejects_multi_worker_with_inmemory_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BACKEND_WORKERS", "2")
    monkeypatch.setenv("APP_TASK_BACKEND", "inmemory")

    with pytest.raises(RuntimeError):
        with TestClient(app):
            pass


def test_startup_rejects_arq_when_state_redis_required_and_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BACKEND_WORKERS", "1")
    monkeypatch.setenv("APP_TASK_BACKEND", "arq")
    monkeypatch.setenv("APP_STATE_REDIS_REQUIRED_IN_ARQ", "1")
    monkeypatch.setattr("app.core.redis_state.get_state_redis", lambda: None)

    with pytest.raises(RuntimeError):
        with TestClient(app):
            pass


def test_startup_allows_multi_worker_when_all_jobs_use_arq(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BACKEND_WORKERS", "2")
    monkeypatch.setenv("APP_TASK_BACKEND", "arq")
    monkeypatch.setenv("APP_STATE_REDIS_REQUIRED_IN_ARQ", "0")

    with TestClient(app) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200


def test_health_ready_is_public_and_returns_ok_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "admin-key:admin:admin-user")
    monkeypatch.setattr(
        "app.api.routes.build_ready_report",
        lambda: (
            True,
            {
                "redis": {"status": "ok"},
                "sqlite": {"status": "ok"},
                "task_backend": {"status": "ok"},
            },
            "ready",
        ),
    )
    client = TestClient(app)

    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {
            "redis": {"status": "ok"},
            "sqlite": {"status": "ok"},
            "task_backend": {"status": "ok"},
        },
        "message": "ready",
    }


def test_health_ready_returns_503_when_degraded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "admin-key:admin:admin-user")
    monkeypatch.setattr(
        "app.api.routes.build_ready_report",
        lambda: (
            False,
            {
                "redis": {"status": "degraded", "reason": "unavailable"},
                "sqlite": {"status": "ok"},
                "task_backend": {"status": "degraded"},
            },
            "one or more readiness checks failed",
        ),
    )
    client = TestClient(app)

    response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "checks": {
            "redis": {"status": "degraded", "reason": "unavailable"},
            "sqlite": {"status": "ok"},
            "task_backend": {"status": "degraded"},
        },
        "message": "one or more readiness checks failed",
    }


def test_backtest_start_returns_structured_enqueue_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    monkeypatch.setattr(
        "app.api.routes.start_backtest_job",
        lambda payload: (_ for _ in ()).throw(
            ArqEnqueueError(
                "enqueue failed",
                queue="grid-strategy-research-platform",
                backend="arq",
                retryable=True,
            )
        ),
    )
    client = TestClient(app)

    response = client.post(
        "/api/v1/backtest/start",
        headers=_headers("operator-key"),
        json=default_request().model_dump(mode="json"),
    )

    assert response.status_code == 503
    payload = response.json()
    assert payload["code"] == "TASK_ENQUEUE_FAILED"
    assert payload["meta"]["queue"] == "grid-strategy-research-platform"
    assert payload["meta"]["backend"] == "arq"
    assert payload["meta"]["retryable"] is True


def test_optimization_start_returns_structured_enqueue_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_AUTH_ENABLED", "1")
    monkeypatch.setenv("APP_AUTH_API_KEYS", "operator-key:operator:operator-user")
    monkeypatch.setattr(
        "app.api.routes.start_optimization_job",
        lambda payload: (_ for _ in ()).throw(
            ArqEnqueueError(
                "enqueue failed",
                queue="grid-strategy-research-platform",
                backend="arq",
                retryable=False,
            )
        ),
    )
    request = default_request()
    client = TestClient(app)

    response = client.post(
        "/api/v1/optimization/start",
        headers=_headers("operator-key"),
        json={
            "base_strategy": request.strategy.model_dump(mode="json"),
            "data": request.data.model_dump(mode="json"),
            "optimization": {},
        },
    )

    assert response.status_code == 503
    payload = response.json()
    assert payload["code"] == "TASK_ENQUEUE_FAILED"
    assert payload["meta"] == {
        "queue": "grid-strategy-research-platform",
        "backend": "arq",
        "retryable": False,
    }


def test_client_session_query_fallback_is_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str | None] = {"client_session": None}

    def _capture_audit(request, principal, status_code, latency_ms):  # type: ignore[no-untyped-def]
        captured["client_session"] = getattr(request.state, "client_session", None)

    monkeypatch.setattr("app.main.audit_http_request", _capture_audit)
    client = TestClient(app)

    response = client.get("/api/v1/health?client_session=sse-session-001")

    assert response.status_code == 200
    assert captured["client_session"] == "sse-session-001"
