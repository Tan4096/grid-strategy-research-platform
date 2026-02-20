from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

_INIT_LOCK = threading.Lock()
_INITIALIZED = False
_BASE_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_DB_PATH = _BASE_DIR / "data" / "optimization_jobs.sqlite3"
_DB_PATH = Path(os.getenv("OPTIMIZATION_STORE_PATH", str(_DEFAULT_DB_PATH))).expanduser()
_PERSIST_ROWS_LIMIT = max(100, int(os.getenv("OPTIMIZATION_PERSIST_ROWS_LIMIT", "5000")))
_STORE_MAX_AGE_DAYS = max(1, int(os.getenv("OPTIMIZATION_STORE_MAX_AGE_DAYS", "30")))
_STORE_MAX_ROWS = max(200, int(os.getenv("OPTIMIZATION_STORE_MAX_ROWS", "5000")))
_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("OPTIMIZATION_STORE_CLEANUP_INTERVAL_SECONDS", "300")))
_LAST_CLEANUP_AT = 0.0


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_db() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _INIT_LOCK:
        if _INITIALIZED:
            return
        with _connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS optimization_job_snapshots (
                    job_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    target TEXT NOT NULL,
                    request_json TEXT,
                    meta_json TEXT NOT NULL,
                    rows_json TEXT NOT NULL,
                    best_row_json TEXT,
                    best_validation_row_json TEXT,
                    best_equity_curve_json TEXT NOT NULL,
                    best_score_progression_json TEXT NOT NULL,
                    convergence_curve_data_json TEXT NOT NULL,
                    train_window_json TEXT,
                    validation_window_json TEXT
                )
                """
            )
            existing_cols = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(optimization_job_snapshots)").fetchall()
            }
            if "request_json" not in existing_cols:
                conn.execute("ALTER TABLE optimization_job_snapshots ADD COLUMN request_json TEXT")
            conn.commit()
        _INITIALIZED = True


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _cleanup_old_snapshots_if_needed(force: bool = False) -> None:
    global _LAST_CLEANUP_AT
    now = time.monotonic()
    if not force and (now - _LAST_CLEANUP_AT) < _CLEANUP_INTERVAL_SECONDS:
        return
    _LAST_CLEANUP_AT = now

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=_STORE_MAX_AGE_DAYS)).isoformat()

    with _connect() as conn:
        conn.execute(
            "DELETE FROM optimization_job_snapshots WHERE updated_at < ?",
            (cutoff_iso,),
        )
        conn.execute(
            """
            DELETE FROM optimization_job_snapshots
            WHERE job_id IN (
                SELECT job_id FROM optimization_job_snapshots
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (_STORE_MAX_ROWS,),
        )
        conn.commit()


def save_job_snapshot(
    *,
    job_id: str,
    target: str,
    status: str,
    request_payload: Optional[Dict[str, Any]],
    meta: Dict[str, Any],
    rows: list[Dict[str, Any]],
    best_row: Optional[Dict[str, Any]],
    best_validation_row: Optional[Dict[str, Any]],
    best_equity_curve: list[Dict[str, Any]],
    best_score_progression: list[Dict[str, Any]],
    convergence_curve_data: list[Dict[str, Any]],
    train_window: Optional[Dict[str, Any]],
    validation_window: Optional[Dict[str, Any]],
    include_rows: bool,
) -> None:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    now_iso = datetime.now(timezone.utc).isoformat()
    created_at = str(meta.get("created_at", now_iso))
    rows_payload = rows[:_PERSIST_ROWS_LIMIT] if include_rows else []

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO optimization_job_snapshots (
                job_id, created_at, updated_at, status, target,
                request_json,
                meta_json, rows_json, best_row_json, best_validation_row_json,
                best_equity_curve_json, best_score_progression_json, convergence_curve_data_json,
                train_window_json, validation_window_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                status = excluded.status,
                target = excluded.target,
                request_json = CASE WHEN excluded.request_json IS NULL THEN optimization_job_snapshots.request_json ELSE excluded.request_json END,
                meta_json = excluded.meta_json,
                rows_json = CASE WHEN excluded.rows_json = '[]' THEN optimization_job_snapshots.rows_json ELSE excluded.rows_json END,
                best_row_json = CASE WHEN excluded.best_row_json IS NULL THEN optimization_job_snapshots.best_row_json ELSE excluded.best_row_json END,
                best_validation_row_json = CASE WHEN excluded.best_validation_row_json IS NULL THEN optimization_job_snapshots.best_validation_row_json ELSE excluded.best_validation_row_json END,
                best_equity_curve_json = CASE WHEN excluded.best_equity_curve_json = '[]' THEN optimization_job_snapshots.best_equity_curve_json ELSE excluded.best_equity_curve_json END,
                best_score_progression_json = CASE WHEN excluded.best_score_progression_json = '[]' THEN optimization_job_snapshots.best_score_progression_json ELSE excluded.best_score_progression_json END,
                convergence_curve_data_json = CASE WHEN excluded.convergence_curve_data_json = '[]' THEN optimization_job_snapshots.convergence_curve_data_json ELSE excluded.convergence_curve_data_json END,
                train_window_json = CASE WHEN excluded.train_window_json IS NULL THEN optimization_job_snapshots.train_window_json ELSE excluded.train_window_json END,
                validation_window_json = CASE WHEN excluded.validation_window_json IS NULL THEN optimization_job_snapshots.validation_window_json ELSE excluded.validation_window_json END
            """,
            (
                job_id,
                created_at,
                now_iso,
                status,
                target,
                _json_dumps(request_payload) if request_payload is not None else None,
                _json_dumps(meta),
                _json_dumps(rows_payload),
                _json_dumps(best_row) if best_row is not None else None,
                _json_dumps(best_validation_row) if best_validation_row is not None else None,
                _json_dumps(best_equity_curve),
                _json_dumps(best_score_progression),
                _json_dumps(convergence_curve_data),
                _json_dumps(train_window) if train_window is not None else None,
                _json_dumps(validation_window) if validation_window is not None else None,
            ),
        )
        conn.commit()


def load_job_snapshot(job_id: str) -> Optional[Dict[str, Any]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                job_id, target, status, request_json, meta_json, rows_json, best_row_json, best_validation_row_json,
                best_equity_curve_json, best_score_progression_json, convergence_curve_data_json,
                train_window_json, validation_window_json
            FROM optimization_job_snapshots
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
    if row is None:
        return None

    return {
        "job_id": row["job_id"],
        "target": row["target"],
        "status": row["status"],
        "request_payload": json.loads(row["request_json"]) if row["request_json"] else None,
        "meta": json.loads(row["meta_json"]),
        "rows": json.loads(row["rows_json"]),
        "best_row": json.loads(row["best_row_json"]) if row["best_row_json"] else None,
        "best_validation_row": json.loads(row["best_validation_row_json"]) if row["best_validation_row_json"] else None,
        "best_equity_curve": json.loads(row["best_equity_curve_json"]),
        "best_score_progression": json.loads(row["best_score_progression_json"]),
        "convergence_curve_data": json.loads(row["convergence_curve_data_json"]),
        "train_window": json.loads(row["train_window_json"]) if row["train_window_json"] else None,
        "validation_window": json.loads(row["validation_window_json"]) if row["validation_window_json"] else None,
    }


def list_recent_job_snapshots(limit: int = 50) -> list[Dict[str, Any]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    capped_limit = max(1, min(int(limit), 500))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT job_id, target, status, meta_json
            FROM optimization_job_snapshots
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (capped_limit,),
        ).fetchall()
    result: list[Dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                "job_id": row["job_id"],
                "target": row["target"],
                "status": row["status"],
                "meta": json.loads(row["meta_json"]),
            }
        )
    return result
