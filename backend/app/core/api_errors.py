from __future__ import annotations

from typing import Any, Mapping, Optional

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        meta: Optional[dict[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = int(status_code)
        self.code = code
        self.message = message
        self.meta = meta or {}
        self.headers = headers


def _request_id_from_state(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str) and request_id:
        return request_id
    return ""


def build_error_response(
    *,
    request: Request,
    status_code: int,
    code: str,
    message: str,
    meta: Optional[dict[str, Any]] = None,
    headers: Optional[Mapping[str, str]] = None,
) -> JSONResponse:
    request_id = _request_id_from_state(request)
    safe_meta = dict(meta or {})
    if "retryable" not in safe_meta:
        safe_meta["retryable"] = bool(status_code >= 500 or status_code == 429)
    payload = {
        "code": code,
        "message": message,
        "request_id": request_id,
        "meta": safe_meta,
        # Backward compatibility for existing frontend/tests that still read detail.
        "detail": message,
    }
    response = JSONResponse(status_code=status_code, content=payload)
    if request_id:
        response.headers["X-Request-Id"] = request_id
    if headers:
        for key, value in headers.items():
            response.headers[key] = value
    return response


def http_status_error_code(status_code: int) -> str:
    return f"HTTP_{status_code}"
