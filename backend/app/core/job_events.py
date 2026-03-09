from __future__ import annotations

import json
import logging
from typing import Any

from app.core.redis_state import get_state_redis

_LOGGER = logging.getLogger("app.job_events")
_SUPPORTED_JOB_TYPES = {"backtest", "optimization"}


def normalize_job_type(job_type: str) -> str:
    normalized = str(job_type).strip().lower()
    if normalized in _SUPPORTED_JOB_TYPES:
        return normalized
    return "unknown"


def job_event_channel(job_type: str, job_id: str) -> str:
    normalized_type = normalize_job_type(job_type)
    normalized_job_id = str(job_id).strip()
    return f"app:job_events:{normalized_type}:{normalized_job_id}"


def publish_job_event(job_type: str, job_id: str, payload: dict[str, Any] | None = None) -> None:
    normalized_job_id = str(job_id).strip()
    if not normalized_job_id:
        return
    redis_client = get_state_redis()
    if redis_client is None:
        return
    message: dict[str, Any] = {
        "job_type": normalize_job_type(job_type),
        "job_id": normalized_job_id,
    }
    if payload is not None:
        message["payload"] = payload
    try:
        redis_client.publish(
            job_event_channel(job_type, normalized_job_id),
            json.dumps(message, ensure_ascii=False, separators=(",", ":"), default=str),
        )
    except Exception as exc:  # pragma: no cover - network/redis dependent
        _LOGGER.debug("failed to publish job event: %s", exc)
