from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, TypeVar

from app.core.job_events import publish_job_event


_INIT_LOCK = threading.Lock()
_INITIALIZED = False
_BASE_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_DB_PATH = _BASE_DIR / "data" / "backtest_jobs.sqlite3"
_DB_PATH = Path(os.getenv("BACKTEST_STORE_PATH", str(_DEFAULT_DB_PATH))).expanduser()
_STORE_MAX_AGE_DAYS = max(1, int(os.getenv("BACKTEST_STORE_MAX_AGE_DAYS", "30")))
_STORE_MAX_ROWS = max(200, int(os.getenv("BACKTEST_STORE_MAX_ROWS", "5000")))
_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("BACKTEST_STORE_CLEANUP_INTERVAL_SECONDS", "300")))
_LAST_CLEANUP_AT = 0.0
_SQLITE_TIMEOUT_SECONDS = max(1.0, float(os.getenv("BACKTEST_SQLITE_TIMEOUT_SECONDS", "5.0")))
_SQLITE_WRITE_RETRIES = max(1, int(os.getenv("BACKTEST_SQLITE_WRITE_RETRIES", "4")))
_SQLITE_RETRY_BASE_SECONDS = max(0.01, float(os.getenv("BACKTEST_SQLITE_RETRY_BASE_SECONDS", "0.05")))
_T = TypeVar("_T")


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=_SQLITE_TIMEOUT_SECONDS)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def backtest_store_path() -> Path:
    return _DB_PATH


def probe_backtest_store_writable() -> tuple[bool, str]:
    try:
        _ensure_db()
        # Write probe without mutating real records.
        set_backtest_cancel_requested("__healthcheck__", False)
    except Exception as exc:
        return False, str(exc)
    return True, "ok"


def _is_busy_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "database is locked" in text or "database is busy" in text


def _run_write_transaction(operation: Callable[[sqlite3.Connection], _T]) -> _T:
    last_exc: Exception | None = None
    for attempt in range(_SQLITE_WRITE_RETRIES):
        try:
            with _connect() as conn:
                result = operation(conn)
                conn.commit()
                return result
        except sqlite3.OperationalError as exc:
            if not _is_busy_error(exc) or attempt >= (_SQLITE_WRITE_RETRIES - 1):
                raise
            last_exc = exc
            time.sleep(_SQLITE_RETRY_BASE_SECONDS * (attempt + 1))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("backtest sqlite write retry exhausted unexpectedly")


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
                CREATE TABLE IF NOT EXISTS backtest_job_snapshots (
                    job_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    meta_json TEXT NOT NULL,
                    payload_json TEXT,
                    result_json TEXT,
                    cancel_requested INTEGER DEFAULT 0
                )
                """
            )
            existing_cols = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(backtest_job_snapshots)").fetchall()
            }
            if "cancel_requested" not in existing_cols:
                conn.execute("ALTER TABLE backtest_job_snapshots ADD COLUMN cancel_requested INTEGER DEFAULT 0")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_backtest_job_snapshots_updated_at
                ON backtest_job_snapshots(updated_at DESC, job_id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_backtest_job_snapshots_status_updated_at
                ON backtest_job_snapshots(status, updated_at DESC, job_id DESC)
                """
            )
            conn.commit()
        _INITIALIZED = True


def _cleanup_if_needed(force: bool = False) -> None:
    global _LAST_CLEANUP_AT
    now = time.monotonic()
    if not force and (now - _LAST_CLEANUP_AT) < _CLEANUP_INTERVAL_SECONDS:
        return
    _LAST_CLEANUP_AT = now
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=_STORE_MAX_AGE_DAYS)).isoformat()
    def _cleanup(conn: sqlite3.Connection) -> None:
        conn.execute(
            "DELETE FROM backtest_job_snapshots WHERE updated_at < ?",
            (cutoff_iso,),
        )
        conn.execute(
            """
            DELETE FROM backtest_job_snapshots
            WHERE job_id IN (
                SELECT job_id FROM backtest_job_snapshots
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (_STORE_MAX_ROWS,),
        )

    _run_write_transaction(_cleanup)


def save_backtest_job_snapshot(
    *,
    job_id: str,
    status: str,
    created_at: str,
    meta: Dict[str, Any],
    payload: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None,
    cancel_requested: Optional[bool] = None,
) -> None:
    _ensure_db()
    _cleanup_if_needed()
    now_iso = datetime.now(timezone.utc).isoformat()
    payload_json = json.dumps(payload, ensure_ascii=False, default=str) if payload is not None else None
    result_json = json.dumps(result, ensure_ascii=False, default=str) if result is not None else None
    cancel_raw = None if cancel_requested is None else (1 if cancel_requested else 0)

    def _save(conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            INSERT INTO backtest_job_snapshots (
                job_id, created_at, updated_at, status, meta_json, payload_json, result_json, cancel_requested
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
            ON CONFLICT(job_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                status = excluded.status,
                meta_json = excluded.meta_json,
                payload_json = CASE
                    WHEN excluded.payload_json IS NULL THEN backtest_job_snapshots.payload_json
                    ELSE excluded.payload_json
                END,
                result_json = CASE
                    WHEN excluded.result_json IS NULL THEN backtest_job_snapshots.result_json
                    ELSE excluded.result_json
                END,
                cancel_requested = CASE
                    WHEN excluded.cancel_requested IS NULL THEN backtest_job_snapshots.cancel_requested
                    ELSE excluded.cancel_requested
                END
            """,
            (
                job_id,
                created_at,
                now_iso,
                status,
                json.dumps(meta, ensure_ascii=False, default=str),
                payload_json,
                result_json,
                cancel_raw,
            ),
        )

    _run_write_transaction(_save)
    publish_job_event("backtest", job_id)


def load_backtest_job_snapshot(job_id: str) -> Optional[Dict[str, Any]]:
    _ensure_db()
    _cleanup_if_needed()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT job_id, status, meta_json, payload_json, result_json, cancel_requested
            FROM backtest_job_snapshots
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "job_id": str(row["job_id"]),
        "status": str(row["status"]),
        "meta": json.loads(row["meta_json"]),
        "payload": json.loads(row["payload_json"]) if row["payload_json"] else None,
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
        "cancel_requested": bool(int(row["cancel_requested"] or 0)),
    }


def set_backtest_cancel_requested(job_id: str, requested: bool = True) -> bool:
    _ensure_db()
    def _set_cancel(conn: sqlite3.Connection) -> bool:
        cursor = conn.execute(
            """
            UPDATE backtest_job_snapshots
            SET cancel_requested = ?, updated_at = ?
            WHERE job_id = ?
            """,
            (1 if requested else 0, datetime.now(timezone.utc).isoformat(), job_id),
        )
        return int(cursor.rowcount or 0) > 0
    return _run_write_transaction(_set_cancel)


def is_backtest_cancel_requested(job_id: str) -> bool:
    _ensure_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT cancel_requested FROM backtest_job_snapshots WHERE job_id = ?",
            (job_id,),
        ).fetchone()
    if row is None:
        return False
    return bool(int(row["cancel_requested"] or 0))


def count_active_backtest_jobs() -> int:
    _ensure_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM backtest_job_snapshots
            WHERE status IN ('pending', 'running')
            """
        ).fetchone()
    return int(row["cnt"] if row is not None else 0)
