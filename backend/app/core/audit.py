from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import Request

from app.core.security import AuthPrincipal

_AUDIT_LOGGER = logging.getLogger("app.audit")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _principal_dict(principal: AuthPrincipal | None) -> dict[str, str | None]:
    if principal is None:
        return {"subject": None, "role": None, "auth_type": None}
    return {
        "subject": principal.subject,
        "role": principal.role.value,
        "auth_type": principal.auth_type,
    }


def _request_context(request: Request) -> dict[str, Any]:
    path_params = getattr(request, "path_params", {}) or {}
    job_id = None
    if isinstance(path_params, dict):
        path_job_id = path_params.get("job_id")
        if isinstance(path_job_id, str) and path_job_id:
            job_id = path_job_id
    if job_id is None:
        query_job_ids = request.query_params.getlist("job_id")
        if len(query_job_ids) == 1:
            job_id = query_job_ids[0]
        elif len(query_job_ids) > 1:
            job_id = f"batch:{len(query_job_ids)}"

    return {
        "request_id": getattr(request.state, "request_id", None),
        "job_id": job_id,
        "client_session": (
            request.headers.get("X-Client-Session")
            or getattr(request.state, "client_session", None)
        ),
        "method": request.method,
        "path": request.url.path,
        "query": str(request.url.query or ""),
        "client_ip": request.client.host if request.client else None,
    }


def audit_http_request(
    request: Request,
    *,
    principal: AuthPrincipal | None,
    status_code: int,
    latency_ms: int,
) -> None:
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"} and status_code < 400:
        return
    payload = {
        "ts": _utc_now_iso(),
        "event": "http_request",
        "status_code": status_code,
        "latency_ms": latency_ms,
        "principal": _principal_dict(principal),
        "request": _request_context(request),
    }
    _AUDIT_LOGGER.info(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def audit_action(
    request: Request,
    *,
    principal: AuthPrincipal | None,
    action: str,
    outcome: str,
    details: dict[str, Any] | None = None,
) -> None:
    payload = {
        "ts": _utc_now_iso(),
        "event": "security_action",
        "action": action,
        "outcome": outcome,
        "principal": _principal_dict(principal),
        "request": _request_context(request),
        "details": details or {},
    }
    log_method = _AUDIT_LOGGER.warning if outcome != "success" else _AUDIT_LOGGER.info
    log_method(json.dumps(payload, ensure_ascii=False, sort_keys=True))
