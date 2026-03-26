from __future__ import annotations

import re
from pathlib import Path

from app.optimizer.job_store import optimization_store_path


def sanitize_study_key(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-") or "default-study"


def optuna_study_storage_dir() -> Path:
    return optimization_store_path().resolve().parent / "optuna_studies"


def optuna_study_storage_url(study_key: str) -> tuple[str, str]:
    safe_key = sanitize_study_key(study_key)
    db_path = optuna_study_storage_dir() / f"btc-grid-optuna-{safe_key}.sqlite3"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path}", safe_key
