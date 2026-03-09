from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.domain_routes import router as api_router
from app.core.api_errors import ApiError, build_error_response, http_status_error_code
from app.core.audit import audit_http_request
from app.core.concurrency_limit import acquire_concurrency_slot, release_concurrency_slot
from app.core.metrics import inc_rate_limited, observe_http_request
from app.optimizer.optimizer import recover_interrupted_optimization_jobs
from app.core.rate_limit import check_rate_limit
from app.core.redis_state import ensure_state_redis_ready_for_arq_or_raise
from app.core.security import AuthPrincipal, authenticate_request
from app.core.settings import get_settings
from app.core.task_backend import any_inmemory_backend_enabled


def _configure_logging() -> None:
    level_name = get_settings().app_log_level.upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


_configure_logging()


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _enforce_runtime_safety()
    summary = recover_interrupted_optimization_jobs()
    logging.getLogger("app.startup").info(
        "optimization recovery summary: scanned=%s restarted=%s skipped=%s failed=%s",
        summary.get("scanned", 0),
        summary.get("restarted", 0),
        summary.get("skipped", 0),
        summary.get("failed", 0),
    )
    yield


app = FastAPI(
    title="Crypto永续网格回测工具 API",
    version="1.0.0",
    description="Professional crypto perpetual futures grid strategy backtesting API",
    lifespan=_lifespan,
)

allow_origins = get_settings().cors_allow_origins
allow_credentials = allow_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _configured_worker_count() -> int:
    return get_settings().configured_worker_count()


def _uses_inmemory_jobs() -> bool:
    return any_inmemory_backend_enabled()


def _enforce_runtime_safety() -> None:
    worker_count = _configured_worker_count()
    if _uses_inmemory_jobs() and worker_count > 1:
        raise RuntimeError(
            "检测到 BACKEND_WORKERS>1 且任务后端为内存模式。"
            "该组合会导致多进程任务状态不一致，已拒绝启动。"
            "请将 BACKEND_WORKERS 设为 1，或迁移到持久队列后端。"
        )
    ensure_state_redis_ready_for_arq_or_raise()


@app.middleware("http")
async def auth_context_middleware(request: Request, call_next):
    request_id = uuid4().hex
    request.state.request_id = request_id
    request.state.client_session = (
        request.headers.get("X-Client-Session", "").strip()
        or request.query_params.get("client_session", "").strip()
        or None
    )
    request_start = time.perf_counter()

    protected_api_path = request.url.path.startswith("/api/v1") and request.url.path not in {
        "/api/v1/health",
        "/api/v1/health/ready",
    }
    principal: AuthPrincipal | None = None
    lease = None
    if protected_api_path:
        try:
            principal = authenticate_request(request)
            request.state.principal = principal
        except HTTPException as exc:
            latency_ms = int((time.perf_counter() - request_start) * 1000)
            response = build_error_response(
                request=request,
                status_code=exc.status_code,
                code=http_status_error_code(exc.status_code),
                message=str(exc.detail),
                headers=exc.headers,
            )
            audit_http_request(request, principal=principal, status_code=exc.status_code, latency_ms=latency_ms)
            observe_http_request(
                method=request.method,
                path=request.url.path,
                status_code=exc.status_code,
                latency_ms=latency_ms,
            )
            return response

        allowed, retry_after, rate_scope = check_rate_limit(request, principal)
        if not allowed:
            latency_ms = int((time.perf_counter() - request_start) * 1000)
            response = build_error_response(
                request=request,
                status_code=429,
                code="RATE_LIMITED",
                message="请求过于频繁，请稍后重试",
                meta={
                    "retry_after_seconds": retry_after,
                    "scope": rate_scope,
                },
                headers={"Retry-After": str(retry_after)},
            )
            inc_rate_limited(rate_scope)
            audit_http_request(request, principal=principal, status_code=429, latency_ms=latency_ms)
            observe_http_request(
                method=request.method,
                path=request.url.path,
                status_code=429,
                latency_ms=latency_ms,
            )
            return response

        allowed_concurrency, retry_after, concurrency_scope, lease = acquire_concurrency_slot(request, principal)
        if not allowed_concurrency:
            latency_ms = int((time.perf_counter() - request_start) * 1000)
            response = build_error_response(
                request=request,
                status_code=429,
                code="RATE_LIMITED",
                message="当前高成本请求较多，请稍后重试",
                meta={
                    "retry_after_seconds": retry_after,
                    "scope": f"concurrency:{concurrency_scope}",
                },
                headers={"Retry-After": str(retry_after)},
            )
            inc_rate_limited(f"concurrency:{concurrency_scope}")
            audit_http_request(request, principal=principal, status_code=429, latency_ms=latency_ms)
            observe_http_request(
                method=request.method,
                path=request.url.path,
                status_code=429,
                latency_ms=latency_ms,
            )
            return response

    try:
        response = await call_next(request)
    finally:
        if protected_api_path:
            release_concurrency_slot(lease)
    response.headers["X-Request-Id"] = request_id
    latency_ms = int((time.perf_counter() - request_start) * 1000)
    audit_http_request(request, principal=principal, status_code=response.status_code, latency_ms=latency_ms)
    observe_http_request(
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        latency_ms=latency_ms,
    )
    return response


app.include_router(api_router)


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return build_error_response(
        request=request,
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
        meta=exc.meta,
        headers=exc.headers,
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return build_error_response(
        request=request,
        status_code=exc.status_code,
        code=http_status_error_code(exc.status_code),
        message=str(exc.detail),
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return build_error_response(
        request=request,
        status_code=422,
        code="VALIDATION_ERROR",
        message="请求参数校验失败",
        meta={"errors": _json_safe(exc.errors())},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.getLogger("app.error").exception(
        "Unhandled exception on %s %s request_id=%s client_session=%s",
        request.method,
        request.url.path,
        getattr(request.state, "request_id", None),
        getattr(request.state, "client_session", None),
        exc_info=exc,
    )
    return build_error_response(
        request=request,
        status_code=500,
        code="INTERNAL_ERROR",
        message="服务内部错误",
    )
