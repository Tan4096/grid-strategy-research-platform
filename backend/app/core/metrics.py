from __future__ import annotations

import re
import threading
from typing import Dict, Tuple

from app.core.redis_state import get_state_redis


_LOCK = threading.Lock()
_HTTP_REQUEST_TOTAL: Dict[Tuple[str, str, str], int] = {}
_HTTP_REQUEST_LATENCY_SECONDS_SUM: Dict[Tuple[str, str], float] = {}
_HTTP_REQUEST_LATENCY_SECONDS_COUNT: Dict[Tuple[str, str], int] = {}
_JOB_DURATION_SECONDS_SUM: Dict[Tuple[str, str], float] = {}
_JOB_DURATION_SECONDS_COUNT: Dict[Tuple[str, str], int] = {}
_QUEUE_DEPTH: Dict[str, int] = {}
_RATE_LIMITED_TOTAL: Dict[str, int] = {}

_HEX_ID_RE = re.compile(r"/[0-9a-fA-F]{8,}")
_NUMERIC_ID_RE = re.compile(r"/\d{3,}")
_FIELD_SEP = "\x1f"

_REDIS_HTTP_REQUEST_TOTAL_KEY = "app:metrics:http_requests_total"
_REDIS_HTTP_LAT_SUM_KEY = "app:metrics:http_request_latency_seconds_sum"
_REDIS_HTTP_LAT_COUNT_KEY = "app:metrics:http_request_latency_seconds_count"
_REDIS_JOB_DURATION_SUM_KEY = "app:metrics:job_duration_seconds_sum"
_REDIS_JOB_DURATION_COUNT_KEY = "app:metrics:job_duration_seconds_count"
_REDIS_QUEUE_DEPTH_KEY = "app:metrics:job_queue_depth"
_REDIS_RATE_LIMITED_KEY = "app:metrics:rate_limited_total"


def _normalize_path(path: str) -> str:
    normalized = _HEX_ID_RE.sub("/{id}", path)
    normalized = _NUMERIC_ID_RE.sub("/{id}", normalized)
    return normalized


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _labels_str(labels: dict[str, str]) -> str:
    parts = [f'{key}="{_escape_label(value)}"' for key, value in labels.items()]
    return ",".join(parts)


def _field(*parts: str) -> str:
    return _FIELD_SEP.join(parts)


def _split_field(raw: str, expected_parts: int) -> tuple[str, ...] | None:
    parts = tuple(raw.split(_FIELD_SEP))
    if len(parts) != expected_parts:
        return None
    return parts


def _redis_hincrby(key: str, field: str, amount: int) -> bool:
    redis_client = get_state_redis()
    if redis_client is None:
        return False
    try:
        redis_client.hincrby(key, field, amount)
        return True
    except Exception:
        return False


def _redis_hincrbyfloat(key: str, field: str, amount: float) -> bool:
    redis_client = get_state_redis()
    if redis_client is None:
        return False
    try:
        redis_client.hincrbyfloat(key, field, amount)
        return True
    except Exception:
        return False


def _redis_hset(key: str, field: str, value: int) -> bool:
    redis_client = get_state_redis()
    if redis_client is None:
        return False
    try:
        redis_client.hset(key, field, int(value))
        return True
    except Exception:
        return False


def _redis_hgetall(key: str) -> dict[str, str] | None:
    redis_client = get_state_redis()
    if redis_client is None:
        return None
    try:
        return {str(k): str(v) for k, v in redis_client.hgetall(key).items()}
    except Exception:
        return None


def observe_http_request(*, method: str, path: str, status_code: int, latency_ms: int) -> None:
    normalized_path = _normalize_path(path)
    status = str(int(status_code))
    latency_seconds = max(0.0, float(latency_ms) / 1000.0)
    req_field = _field(method.upper(), normalized_path, status)
    lat_field = _field(method.upper(), normalized_path)

    redis_ok = _redis_hincrby(_REDIS_HTTP_REQUEST_TOTAL_KEY, req_field, 1)
    redis_ok = _redis_hincrbyfloat(_REDIS_HTTP_LAT_SUM_KEY, lat_field, latency_seconds) and redis_ok
    redis_ok = _redis_hincrby(_REDIS_HTTP_LAT_COUNT_KEY, lat_field, 1) and redis_ok
    if redis_ok:
        return

    with _LOCK:
        req_key = (method.upper(), normalized_path, status)
        _HTTP_REQUEST_TOTAL[req_key] = _HTTP_REQUEST_TOTAL.get(req_key, 0) + 1

        latency_key = (method.upper(), normalized_path)
        _HTTP_REQUEST_LATENCY_SECONDS_SUM[latency_key] = _HTTP_REQUEST_LATENCY_SECONDS_SUM.get(latency_key, 0.0) + latency_seconds
        _HTTP_REQUEST_LATENCY_SECONDS_COUNT[latency_key] = _HTTP_REQUEST_LATENCY_SECONDS_COUNT.get(latency_key, 0) + 1


def observe_job_duration(*, job_type: str, status: str, duration_seconds: float) -> None:
    safe_duration = max(0.0, float(duration_seconds))
    redis_ok = _redis_hincrbyfloat(
        _REDIS_JOB_DURATION_SUM_KEY,
        _field(job_type, status),
        safe_duration,
    )
    redis_ok = _redis_hincrby(_REDIS_JOB_DURATION_COUNT_KEY, _field(job_type, status), 1) and redis_ok
    if redis_ok:
        return
    key = (job_type, status)
    with _LOCK:
        _JOB_DURATION_SECONDS_SUM[key] = _JOB_DURATION_SECONDS_SUM.get(key, 0.0) + safe_duration
        _JOB_DURATION_SECONDS_COUNT[key] = _JOB_DURATION_SECONDS_COUNT.get(key, 0) + 1


def set_queue_depth(*, queue_name: str, depth: int) -> None:
    redis_ok = _redis_hset(_REDIS_QUEUE_DEPTH_KEY, queue_name, int(depth))
    if redis_ok:
        return
    with _LOCK:
        _QUEUE_DEPTH[queue_name] = max(0, int(depth))


def inc_rate_limited(scope: str) -> None:
    normalized = scope.strip().lower() or "unknown"
    if _redis_hincrby(_REDIS_RATE_LIMITED_KEY, normalized, 1):
        return
    with _LOCK:
        _RATE_LIMITED_TOTAL[normalized] = _RATE_LIMITED_TOTAL.get(normalized, 0) + 1


def render_prometheus() -> str:
    lines: list[str] = []
    http_request_total = _redis_hgetall(_REDIS_HTTP_REQUEST_TOTAL_KEY)
    http_latency_sum = _redis_hgetall(_REDIS_HTTP_LAT_SUM_KEY)
    http_latency_count = _redis_hgetall(_REDIS_HTTP_LAT_COUNT_KEY)
    job_duration_sum = _redis_hgetall(_REDIS_JOB_DURATION_SUM_KEY)
    job_duration_count = _redis_hgetall(_REDIS_JOB_DURATION_COUNT_KEY)
    queue_depth = _redis_hgetall(_REDIS_QUEUE_DEPTH_KEY)
    rate_limited_total = _redis_hgetall(_REDIS_RATE_LIMITED_KEY)

    use_redis = all(
        item is not None
        for item in (
            http_request_total,
            http_latency_sum,
            http_latency_count,
            job_duration_sum,
            job_duration_count,
            queue_depth,
            rate_limited_total,
        )
    )

    lines.extend(
        [
            "# HELP app_http_requests_total Total HTTP requests by method/path/status.",
            "# TYPE app_http_requests_total counter",
        ]
    )
    if use_redis:
        assert http_request_total is not None
        for raw_field, raw_value in sorted(http_request_total.items()):
            parsed = _split_field(raw_field, 3)
            if parsed is None:
                continue
            method, path, status = parsed
            lines.append(
                f'app_http_requests_total{{{_labels_str({"method": method, "path": path, "status": status})}}} {raw_value}'
            )
    else:
        with _LOCK:
            for (method, path, status), value in sorted(_HTTP_REQUEST_TOTAL.items()):
                lines.append(
                    f'app_http_requests_total{{{_labels_str({"method": method, "path": path, "status": status})}}} {value}'
                )

    lines.extend(
        [
            "# HELP app_http_request_latency_seconds_sum Sum of HTTP request latency in seconds.",
            "# TYPE app_http_request_latency_seconds_sum counter",
        ]
    )
    if use_redis:
        assert http_latency_sum is not None
        for raw_field, raw_value in sorted(http_latency_sum.items()):
            parsed = _split_field(raw_field, 2)
            if parsed is None:
                continue
            method, path = parsed
            lines.append(
                f'app_http_request_latency_seconds_sum{{{_labels_str({"method": method, "path": path})}}} {float(raw_value):.6f}'
            )
    else:
        with _LOCK:
            for (method, path), value in sorted(_HTTP_REQUEST_LATENCY_SECONDS_SUM.items()):
                lines.append(
                    f'app_http_request_latency_seconds_sum{{{_labels_str({"method": method, "path": path})}}} {value:.6f}'
                )

    lines.extend(
        [
            "# HELP app_http_request_latency_seconds_count Number of latency observations.",
            "# TYPE app_http_request_latency_seconds_count counter",
        ]
    )
    if use_redis:
        assert http_latency_count is not None
        for raw_field, raw_value in sorted(http_latency_count.items()):
            parsed = _split_field(raw_field, 2)
            if parsed is None:
                continue
            method, path = parsed
            lines.append(
                f'app_http_request_latency_seconds_count{{{_labels_str({"method": method, "path": path})}}} {raw_value}'
            )
    else:
        with _LOCK:
            for (method, path), value in sorted(_HTTP_REQUEST_LATENCY_SECONDS_COUNT.items()):
                lines.append(
                    f'app_http_request_latency_seconds_count{{{_labels_str({"method": method, "path": path})}}} {value}'
                )

    lines.extend(
        [
            "# HELP app_job_duration_seconds_sum Sum of background job runtime by type/status.",
            "# TYPE app_job_duration_seconds_sum counter",
        ]
    )
    if use_redis:
        assert job_duration_sum is not None
        for raw_field, raw_value in sorted(job_duration_sum.items()):
            parsed = _split_field(raw_field, 2)
            if parsed is None:
                continue
            job_type, status = parsed
            lines.append(
                f'app_job_duration_seconds_sum{{{_labels_str({"job_type": job_type, "status": status})}}} {float(raw_value):.6f}'
            )
    else:
        with _LOCK:
            for (job_type, status), value in sorted(_JOB_DURATION_SECONDS_SUM.items()):
                lines.append(
                    f'app_job_duration_seconds_sum{{{_labels_str({"job_type": job_type, "status": status})}}} {value:.6f}'
                )

    lines.extend(
        [
            "# HELP app_job_duration_seconds_count Number of background job runtime observations.",
            "# TYPE app_job_duration_seconds_count counter",
        ]
    )
    if use_redis:
        assert job_duration_count is not None
        for raw_field, raw_value in sorted(job_duration_count.items()):
            parsed = _split_field(raw_field, 2)
            if parsed is None:
                continue
            job_type, status = parsed
            lines.append(
                f'app_job_duration_seconds_count{{{_labels_str({"job_type": job_type, "status": status})}}} {raw_value}'
            )
    else:
        with _LOCK:
            for (job_type, status), value in sorted(_JOB_DURATION_SECONDS_COUNT.items()):
                lines.append(
                    f'app_job_duration_seconds_count{{{_labels_str({"job_type": job_type, "status": status})}}} {value}'
                )

    lines.extend(
        [
            "# HELP app_job_queue_depth Current queue depth by queue name.",
            "# TYPE app_job_queue_depth gauge",
        ]
    )
    if use_redis:
        assert queue_depth is not None
        for queue_name, depth in sorted(queue_depth.items()):
            lines.append(f'app_job_queue_depth{{{_labels_str({"queue": queue_name})}}} {int(depth)}')
    else:
        with _LOCK:
            for queue_name, depth in sorted(_QUEUE_DEPTH.items()):
                lines.append(f'app_job_queue_depth{{{_labels_str({"queue": queue_name})}}} {depth}')

    lines.extend(
        [
            "# HELP app_rate_limited_total Number of requests rejected by rate limiter.",
            "# TYPE app_rate_limited_total counter",
        ]
    )
    if use_redis:
        assert rate_limited_total is not None
        for scope, value in sorted(rate_limited_total.items()):
            lines.append(f'app_rate_limited_total{{{_labels_str({"scope": scope})}}} {value}')
    else:
        with _LOCK:
            for scope, value in sorted(_RATE_LIMITED_TOTAL.items()):
                lines.append(f'app_rate_limited_total{{{_labels_str({"scope": scope})}}} {value}')

    return "\n".join(lines) + "\n"
