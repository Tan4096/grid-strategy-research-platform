from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.services.live_snapshot_diagnostics import sanitize_error_message
from app.services.live_snapshot_types import LiveSnapshotError


def build_http_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=2,
        connect=2,
        read=2,
        backoff_factor=0.2,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=32)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_HTTP_SESSION = build_http_session()


def query_string(params: dict[str, Any]) -> str:
    normalized: list[tuple[str, str]] = []
    for key in sorted(params.keys()):
        value = params[key]
        if value is None:
            continue
        if isinstance(value, bool):
            normalized.append((key, "true" if value else "false"))
            continue
        normalized.append((key, str(value)))
    return urlencode(normalized)


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    params: Optional[dict[str, Any]] = None,
    timeout: int = 12,
) -> Any:
    try:
        response = _HTTP_SESSION.request(
            method,
            url,
            headers=headers,
            params=params,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise LiveSnapshotError("交易所连接失败，请稍后重试", status_code=503, retryable=True) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise LiveSnapshotError("交易所返回了无法解析的数据", status_code=502, retryable=True) from exc

    if response.status_code == 401:
        raise LiveSnapshotError("API 凭证校验失败，请检查 Key 权限和 IP 白名单", status_code=400)
    if response.status_code == 429:
        raise LiveSnapshotError("交易所限频，请稍后重试", status_code=429, retryable=True)
    if not response.ok:
        detail = ""
        if isinstance(payload, dict):
            for key in ("msg", "retMsg", "message", "detail"):
                if payload.get(key):
                    detail = str(payload[key])
                    break
        detail = detail or f"HTTP {response.status_code}"
        raise LiveSnapshotError(sanitize_error_message(detail), status_code=400)
    return payload
