from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple, TypeVar

from app.core.job_events import publish_job_event

_INIT_LOCK = threading.Lock()
_INITIALIZED = False
_BASE_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_DB_PATH = _BASE_DIR / "data" / "optimization_jobs.sqlite3"
_DB_PATH = Path(os.getenv("OPTIMIZATION_STORE_PATH", str(_DEFAULT_DB_PATH))).expanduser()
_PERSIST_ROWS_LIMIT = max(100, int(os.getenv("OPTIMIZATION_PERSIST_ROWS_LIMIT", "5000")))
_STORE_MAX_AGE_DAYS = max(1, int(os.getenv("OPTIMIZATION_STORE_MAX_AGE_DAYS", "30")))
_STORE_MAX_ROWS = max(200, int(os.getenv("OPTIMIZATION_STORE_MAX_ROWS", "5000")))
_OPERATION_STORE_MAX_AGE_DAYS = max(
    1, int(os.getenv("OPTIMIZATION_OPERATION_STORE_MAX_AGE_DAYS", str(_STORE_MAX_AGE_DAYS)))
)
_OPERATION_STORE_MAX_ROWS = max(
    200, int(os.getenv("OPTIMIZATION_OPERATION_STORE_MAX_ROWS", str(_STORE_MAX_ROWS)))
)
_SOFT_DELETE_TTL_HOURS = max(1, int(os.getenv("OPTIMIZATION_SOFT_DELETE_TTL_HOURS", "48")))
_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("OPTIMIZATION_STORE_CLEANUP_INTERVAL_SECONDS", "300")))
_LAST_CLEANUP_AT = 0.0
_SQLITE_TIMEOUT_SECONDS = max(1.0, float(os.getenv("OPTIMIZATION_SQLITE_TIMEOUT_SECONDS", "5.0")))
_SQLITE_WRITE_RETRIES = max(1, int(os.getenv("OPTIMIZATION_SQLITE_WRITE_RETRIES", "4")))
_SQLITE_RETRY_BASE_SECONDS = max(0.01, float(os.getenv("OPTIMIZATION_SQLITE_RETRY_BASE_SECONDS", "0.05")))
_T = TypeVar("_T")
_TERMINAL_SNAPSHOT_STATUSES = ("completed", "failed", "cancelled")


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=_SQLITE_TIMEOUT_SECONDS)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def optimization_store_path() -> Path:
    return _DB_PATH


def optimization_soft_delete_ttl_hours() -> int:
    return _SOFT_DELETE_TTL_HOURS


def probe_optimization_store_writable() -> tuple[bool, str]:
    try:
        _ensure_db()
        # Write probe without mutating real records.
        set_job_cancel_requested("__healthcheck__", False)
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
    raise RuntimeError("optimization sqlite write retry exhausted unexpectedly")


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
                    deleted_at TEXT,
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
                    validation_window_json TEXT,
                    cancel_requested INTEGER DEFAULT 0
                )
                """
            )
            existing_cols = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(optimization_job_snapshots)").fetchall()
            }
            if "request_json" not in existing_cols:
                conn.execute("ALTER TABLE optimization_job_snapshots ADD COLUMN request_json TEXT")
            if "cancel_requested" not in existing_cols:
                conn.execute("ALTER TABLE optimization_job_snapshots ADD COLUMN cancel_requested INTEGER DEFAULT 0")
            if "deleted_at" not in existing_cols:
                conn.execute("ALTER TABLE optimization_job_snapshots ADD COLUMN deleted_at TEXT")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_optimization_job_snapshots_updated_at
                ON optimization_job_snapshots(updated_at DESC, job_id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_optimization_job_snapshots_status_updated_at
                ON optimization_job_snapshots(status, updated_at DESC, job_id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_optimization_job_snapshots_deleted_updated_at
                ON optimization_job_snapshots(deleted_at, updated_at DESC, job_id DESC)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS optimization_operation_events (
                    operation_id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    requested INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    failed INTEGER NOT NULL DEFAULT 0,
                    skipped INTEGER NOT NULL DEFAULT 0,
                    job_ids_json TEXT NOT NULL,
                    failed_items_json TEXT NOT NULL,
                    undo_until TEXT,
                    summary_text TEXT,
                    request_id TEXT,
                    meta_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_optimization_operation_events_created_at
                ON optimization_operation_events(created_at DESC, operation_id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_optimization_operation_events_action_status_created_at
                ON optimization_operation_events(action, status, created_at DESC, operation_id DESC)
                """
            )
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
    operation_cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(days=_OPERATION_STORE_MAX_AGE_DAYS)
    ).isoformat()
    soft_delete_cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(hours=_SOFT_DELETE_TTL_HOURS)
    ).isoformat()

    def _cleanup(conn: sqlite3.Connection) -> None:
        conn.execute(
            "DELETE FROM optimization_job_snapshots WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            (soft_delete_cutoff_iso,),
        )
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
        conn.execute(
            "DELETE FROM optimization_operation_events WHERE updated_at < ?",
            (operation_cutoff_iso,),
        )
        conn.execute(
            """
            DELETE FROM optimization_operation_events
            WHERE operation_id IN (
                SELECT operation_id FROM optimization_operation_events
                ORDER BY created_at DESC, operation_id DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (_OPERATION_STORE_MAX_ROWS,),
        )

    _run_write_transaction(_cleanup)


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
    cancel_requested: Optional[bool] = None,
) -> None:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    now_iso = datetime.now(timezone.utc).isoformat()
    created_at = str(meta.get("created_at", now_iso))
    rows_payload = rows[:_PERSIST_ROWS_LIMIT] if include_rows else []
    cancel_raw = None if cancel_requested is None else (1 if cancel_requested else 0)

    def _save(conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            INSERT INTO optimization_job_snapshots (
                job_id, created_at, updated_at, deleted_at, status, target,
                request_json,
                meta_json, rows_json, best_row_json, best_validation_row_json,
                best_equity_curve_json, best_score_progression_json, convergence_curve_data_json,
                train_window_json, validation_window_json, cancel_requested
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
            ON CONFLICT(job_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                deleted_at = NULL,
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
                validation_window_json = CASE WHEN excluded.validation_window_json IS NULL THEN optimization_job_snapshots.validation_window_json ELSE excluded.validation_window_json END,
                cancel_requested = CASE WHEN excluded.cancel_requested IS NULL THEN optimization_job_snapshots.cancel_requested ELSE excluded.cancel_requested END
            """,
            (
                job_id,
                created_at,
                now_iso,
                None,
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
                cancel_raw,
            ),
        )

    _run_write_transaction(_save)
    publish_job_event("optimization", job_id)


def load_job_snapshot(job_id: str) -> Optional[Dict[str, Any]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                job_id, target, status, request_json, meta_json, rows_json, best_row_json, best_validation_row_json,
                best_equity_curve_json, best_score_progression_json, convergence_curve_data_json,
                train_window_json, validation_window_json, cancel_requested
            FROM optimization_job_snapshots
            WHERE job_id = ? AND deleted_at IS NULL
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
        "cancel_requested": bool(int(row["cancel_requested"] or 0)),
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
            WHERE deleted_at IS NULL
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


def _decode_history_cursor(raw: Optional[str]) -> Optional[Tuple[str, str]]:
    if not raw:
        return None
    try:
        updated_at, job_id = raw.split("|", 1)
    except ValueError:
        return None
    updated_at = updated_at.strip()
    job_id = job_id.strip()
    if not updated_at or not job_id:
        return None
    return updated_at, job_id


def _encode_history_cursor(updated_at: str, job_id: str) -> str:
    return f"{updated_at}|{job_id}"


def list_recent_job_snapshots_cursor(
    *,
    limit: int = 50,
    cursor: Optional[str] = None,
    status: Optional[str] = None,
) -> tuple[list[Dict[str, Any]], Optional[str]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    capped_limit = max(1, min(int(limit), 500))
    decoded_cursor = _decode_history_cursor(cursor)
    cursor_updated_at = decoded_cursor[0] if decoded_cursor else None
    cursor_job_id = decoded_cursor[1] if decoded_cursor else None
    normalized_status = (status or "").strip().lower() or None

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT job_id, target, status, meta_json, updated_at
            FROM optimization_job_snapshots
            WHERE
                deleted_at IS NULL
                AND
                (? IS NULL OR status = ?)
                AND (
                    ? IS NULL
                    OR updated_at < ?
                    OR (updated_at = ? AND job_id < ?)
                )
            ORDER BY updated_at DESC, job_id DESC
            LIMIT ?
            """,
            (
                normalized_status,
                normalized_status,
                cursor_updated_at,
                cursor_updated_at,
                cursor_updated_at,
                cursor_job_id,
                capped_limit + 1,
            ),
        ).fetchall()

    has_more = len(rows) > capped_limit
    page_rows = rows[:capped_limit]
    next_cursor = None
    if has_more and page_rows:
        tail = page_rows[-1]
        next_cursor = _encode_history_cursor(str(tail["updated_at"]), str(tail["job_id"]))

    result: list[Dict[str, Any]] = []
    for row in page_rows:
        result.append(
            {
                "job_id": row["job_id"],
                "target": row["target"],
                "status": row["status"],
                "updated_at": row["updated_at"],
                "meta": json.loads(row["meta_json"]),
            }
        )
    return result, next_cursor


def _decode_operation_cursor(raw: Optional[str]) -> Optional[Tuple[str, str]]:
    if not raw:
        return None
    try:
        created_at, operation_id = raw.split("|", 1)
    except ValueError:
        return None
    created_at = created_at.strip()
    operation_id = operation_id.strip()
    if not created_at or not operation_id:
        return None
    return created_at, operation_id


def _encode_operation_cursor(created_at: str, operation_id: str) -> str:
    return f"{created_at}|{operation_id}"


def save_operation_event(
    *,
    operation_id: str,
    action: str,
    status: str,
    requested: int,
    success: int,
    failed: int,
    skipped: int,
    job_ids: list[str],
    failed_items: list[dict[str, Any]],
    undo_until: Optional[str] = None,
    summary_text: Optional[str] = None,
    request_id: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    now_iso = datetime.now(timezone.utc).isoformat()
    normalized_job_ids = _normalize_job_ids(job_ids)

    def _save(conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            INSERT INTO optimization_operation_events (
                operation_id, created_at, updated_at, action, status,
                requested, success, failed, skipped,
                job_ids_json, failed_items_json, undo_until, summary_text, request_id, meta_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(operation_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                action = excluded.action,
                status = excluded.status,
                requested = excluded.requested,
                success = excluded.success,
                failed = excluded.failed,
                skipped = excluded.skipped,
                job_ids_json = excluded.job_ids_json,
                failed_items_json = excluded.failed_items_json,
                undo_until = excluded.undo_until,
                summary_text = excluded.summary_text,
                request_id = excluded.request_id,
                meta_json = excluded.meta_json
            """,
            (
                operation_id.strip(),
                now_iso,
                now_iso,
                str(action or "").strip().lower(),
                str(status or "").strip().lower(),
                max(0, int(requested)),
                max(0, int(success)),
                max(0, int(failed)),
                max(0, int(skipped)),
                _json_dumps(normalized_job_ids),
                _json_dumps(failed_items or []),
                undo_until,
                summary_text,
                request_id,
                _json_dumps(meta or {}),
            ),
        )

    _run_write_transaction(_save)


def get_operation_event(operation_id: str) -> Optional[dict[str, Any]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    op_id = str(operation_id or "").strip()
    if not op_id:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                operation_id, created_at, updated_at, action, status,
                requested, success, failed, skipped,
                job_ids_json, failed_items_json, undo_until, summary_text, request_id, meta_json
            FROM optimization_operation_events
            WHERE operation_id = ?
            """,
            (op_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "operation_id": str(row["operation_id"]),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
        "action": str(row["action"]),
        "status": str(row["status"]),
        "requested": int(row["requested"] or 0),
        "success": int(row["success"] or 0),
        "failed": int(row["failed"] or 0),
        "skipped": int(row["skipped"] or 0),
        "job_ids": json.loads(row["job_ids_json"]) if row["job_ids_json"] else [],
        "failed_items": json.loads(row["failed_items_json"]) if row["failed_items_json"] else [],
        "undo_until": str(row["undo_until"]) if row["undo_until"] is not None else None,
        "summary_text": str(row["summary_text"]) if row["summary_text"] is not None else None,
        "request_id": str(row["request_id"]) if row["request_id"] is not None else None,
        "meta": json.loads(row["meta_json"]) if row["meta_json"] else {},
    }


def list_operation_events_cursor(
    *,
    limit: int = 30,
    cursor: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    _ensure_db()
    _cleanup_old_snapshots_if_needed()
    capped_limit = max(1, min(int(limit), 200))
    decoded_cursor = _decode_operation_cursor(cursor)
    cursor_created_at = decoded_cursor[0] if decoded_cursor else None
    cursor_operation_id = decoded_cursor[1] if decoded_cursor else None
    normalized_action = str(action or "").strip().lower() or None
    normalized_status = str(status or "").strip().lower() or None

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                operation_id, created_at, updated_at, action, status,
                requested, success, failed, skipped,
                job_ids_json, failed_items_json, undo_until, summary_text, request_id, meta_json
            FROM optimization_operation_events
            WHERE
                (? IS NULL OR action = ?)
                AND
                (? IS NULL OR status = ?)
                AND (
                    ? IS NULL
                    OR created_at < ?
                    OR (created_at = ? AND operation_id < ?)
                )
            ORDER BY created_at DESC, operation_id DESC
            LIMIT ?
            """,
            (
                normalized_action,
                normalized_action,
                normalized_status,
                normalized_status,
                cursor_created_at,
                cursor_created_at,
                cursor_created_at,
                cursor_operation_id,
                capped_limit + 1,
            ),
        ).fetchall()

    has_more = len(rows) > capped_limit
    page_rows = rows[:capped_limit]
    next_cursor = None
    if has_more and page_rows:
        tail = page_rows[-1]
        next_cursor = _encode_operation_cursor(str(tail["created_at"]), str(tail["operation_id"]))

    result: list[dict[str, Any]] = []
    for row in page_rows:
        result.append(
            {
                "operation_id": str(row["operation_id"]),
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
                "action": str(row["action"]),
                "status": str(row["status"]),
                "requested": int(row["requested"] or 0),
                "success": int(row["success"] or 0),
                "failed": int(row["failed"] or 0),
                "skipped": int(row["skipped"] or 0),
                "job_ids": json.loads(row["job_ids_json"]) if row["job_ids_json"] else [],
                "failed_items": json.loads(row["failed_items_json"]) if row["failed_items_json"] else [],
                "undo_until": str(row["undo_until"]) if row["undo_until"] is not None else None,
                "summary_text": str(row["summary_text"]) if row["summary_text"] is not None else None,
                "request_id": str(row["request_id"]) if row["request_id"] is not None else None,
                "meta": json.loads(row["meta_json"]) if row["meta_json"] else {},
            }
        )
    return result, next_cursor


def list_recoverable_job_snapshots(limit: int = 20) -> list[Dict[str, Any]]:
    _ensure_db()
    capped_limit = max(1, min(int(limit), 200))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT job_id, target, status, request_json, meta_json, cancel_requested
            FROM optimization_job_snapshots
            WHERE status IN ('pending', 'running') AND deleted_at IS NULL
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
                "request_payload": json.loads(row["request_json"]) if row["request_json"] else None,
                "meta": json.loads(row["meta_json"]),
                "cancel_requested": bool(int(row["cancel_requested"] or 0)),
            }
        )
    return result


def set_job_cancel_requested(job_id: str, requested: bool = True) -> bool:
    _ensure_db()
    def _set_cancel(conn: sqlite3.Connection) -> bool:
        cursor = conn.execute(
            """
            UPDATE optimization_job_snapshots
            SET cancel_requested = ?, updated_at = ?
            WHERE job_id = ?
            """,
            (1 if requested else 0, datetime.now(timezone.utc).isoformat(), job_id),
        )
        return int(cursor.rowcount or 0) > 0
    return _run_write_transaction(_set_cancel)


def is_job_cancel_requested(job_id: str) -> bool:
    _ensure_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT cancel_requested FROM optimization_job_snapshots WHERE job_id = ? AND deleted_at IS NULL",
            (job_id,),
        ).fetchone()
    if row is None:
        return False
    return bool(int(row["cancel_requested"] or 0))


def count_active_job_snapshots() -> int:
    _ensure_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM optimization_job_snapshots
            WHERE status IN ('pending', 'running') AND deleted_at IS NULL
            """
        ).fetchone()
    return int(row["cnt"] if row is not None else 0)


def clear_all_job_snapshots() -> int:
    _ensure_db()
    def _clear_all(conn: sqlite3.Connection) -> int:
        cursor = conn.execute("DELETE FROM optimization_job_snapshots")
        return int(cursor.rowcount or 0)
    return _run_write_transaction(_clear_all)


def _normalize_job_ids(job_ids: list[str]) -> list[str]:
    normalized = [job_id.strip() for job_id in job_ids if isinstance(job_id, str) and job_id.strip()]
    return list(dict.fromkeys(normalized))


def _collect_existing_job_ids(
    conn: sqlite3.Connection,
    *,
    job_ids: list[str],
    include_soft_deleted: bool = False,
    only_soft_deleted: bool = False,
) -> set[str]:
    existing_ids: set[str] = set()
    chunk_size = 400
    for i in range(0, len(job_ids), chunk_size):
        chunk = job_ids[i : i + chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        if only_soft_deleted:
            where_deleted = "deleted_at IS NOT NULL"
        elif include_soft_deleted:
            where_deleted = "1=1"
        else:
            where_deleted = "deleted_at IS NULL"
        rows = conn.execute(
            f"SELECT job_id FROM optimization_job_snapshots WHERE {where_deleted} AND job_id IN ({placeholders})",
            chunk,
        ).fetchall()
        for row in rows:
            existing_ids.add(str(row["job_id"]))
    return existing_ids


def soft_delete_all_job_snapshots() -> tuple[int, list[str]]:
    deleted, deleted_ids, _ = soft_delete_all_terminal_job_snapshots_with_details()
    return deleted, deleted_ids


def soft_delete_all_terminal_job_snapshots_with_details() -> tuple[int, list[str], list[str]]:
    _ensure_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    deleted_ids: list[str] = []
    skipped_ids: list[str] = []

    def _soft_delete_all(conn: sqlite3.Connection) -> int:
        nonlocal deleted_ids, skipped_ids
        rows = conn.execute(
            "SELECT job_id, status FROM optimization_job_snapshots WHERE deleted_at IS NULL"
        ).fetchall()
        terminal_set: set[str] = set()
        skipped_set: set[str] = set()
        for row in rows:
            job_id = str(row["job_id"])
            status = str(row["status"]).strip().lower()
            if status in _TERMINAL_SNAPSHOT_STATUSES:
                terminal_set.add(job_id)
            else:
                skipped_set.add(job_id)
        deleted_ids = sorted(terminal_set)
        skipped_ids = sorted(skipped_set)
        if not terminal_set:
            return 0
        placeholders = ",".join("?" for _ in terminal_set)
        cursor = conn.execute(
            f"UPDATE optimization_job_snapshots SET deleted_at = ?, updated_at = ? "
            f"WHERE deleted_at IS NULL AND status IN ('completed', 'failed', 'cancelled') "
            f"AND job_id IN ({placeholders})",
            (now_iso, now_iso, *sorted(terminal_set)),
        )
        return int(cursor.rowcount or 0)

    deleted = _run_write_transaction(_soft_delete_all)
    return deleted, deleted_ids, skipped_ids


def soft_delete_job_snapshots_with_details(job_ids: list[str]) -> tuple[int, list[str]]:
    deleted, deleted_ids, _ = soft_delete_terminal_job_snapshots_with_details(job_ids)
    return deleted, deleted_ids


def soft_delete_terminal_job_snapshots_with_details(job_ids: list[str]) -> tuple[int, list[str], list[str]]:
    _ensure_db()
    unique_ids = _normalize_job_ids(job_ids)
    if not unique_ids:
        return 0, [], []

    with _connect() as conn:
        active_rows: list[tuple[str, str]] = []
        chunk_size = 400
        for i in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[i : i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT job_id, status FROM optimization_job_snapshots "
                f"WHERE deleted_at IS NULL AND job_id IN ({placeholders})",
                chunk,
            ).fetchall()
            for row in rows:
                active_rows.append((str(row["job_id"]), str(row["status"]).strip().lower()))

    terminal_active_ids = {job_id for job_id, status in active_rows if status in _TERMINAL_SNAPSHOT_STATUSES}
    skipped_non_terminal_ids = {job_id for job_id, status in active_rows if status not in _TERMINAL_SNAPSHOT_STATUSES}
    if not terminal_active_ids:
        return 0, [], [job_id for job_id in unique_ids if job_id in skipped_non_terminal_ids]

    now_iso = datetime.now(timezone.utc).isoformat()
    chunk_size = 400

    def _soft_delete_chunks(conn: sqlite3.Connection) -> int:
        total_deleted = 0
        terminal_ids_sorted = sorted(terminal_active_ids)
        for i in range(0, len(terminal_ids_sorted), chunk_size):
            chunk = terminal_ids_sorted[i : i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            cursor = conn.execute(
                f"UPDATE optimization_job_snapshots SET deleted_at = ?, updated_at = ? "
                f"WHERE deleted_at IS NULL AND status IN ('completed', 'failed', 'cancelled') "
                f"AND job_id IN ({placeholders})",
                (now_iso, now_iso, *chunk),
            )
            total_deleted += int(cursor.rowcount or 0)
        return total_deleted

    total_deleted = _run_write_transaction(_soft_delete_chunks)
    deleted_ids = [job_id for job_id in unique_ids if job_id in terminal_active_ids]
    skipped_ids = [job_id for job_id in unique_ids if job_id in skipped_non_terminal_ids]
    return total_deleted, deleted_ids, skipped_ids


def restore_job_snapshots_with_details(job_ids: list[str]) -> tuple[int, list[str]]:
    _ensure_db()
    unique_ids = _normalize_job_ids(job_ids)
    if not unique_ids:
        return 0, []

    with _connect() as conn:
        existing_ids = _collect_existing_job_ids(
            conn,
            job_ids=unique_ids,
            include_soft_deleted=False,
            only_soft_deleted=True,
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    chunk_size = 400

    def _restore_chunks(conn: sqlite3.Connection) -> int:
        total_restored = 0
        for i in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[i : i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            cursor = conn.execute(
                f"UPDATE optimization_job_snapshots SET deleted_at = NULL, updated_at = ? "
                f"WHERE deleted_at IS NOT NULL AND job_id IN ({placeholders})",
                (now_iso, *chunk),
            )
            total_restored += int(cursor.rowcount or 0)
        return total_restored

    total_restored = _run_write_transaction(_restore_chunks)
    restored_ids = [job_id for job_id in unique_ids if job_id in existing_ids]
    return total_restored, restored_ids


def delete_job_snapshots(job_ids: list[str]) -> int:
    deleted, _ = delete_job_snapshots_with_details(job_ids)
    return deleted


def delete_job_snapshots_with_details(job_ids: list[str]) -> tuple[int, list[str]]:
    _ensure_db()
    unique_ids = _normalize_job_ids(job_ids)
    if not unique_ids:
        return 0, []
    with _connect() as conn:
        existing_ids = _collect_existing_job_ids(
            conn,
            job_ids=unique_ids,
            include_soft_deleted=True,
            only_soft_deleted=False,
        )
    chunk_size = 400

    def _delete_chunks(conn: sqlite3.Connection) -> int:
        total_deleted = 0
        for i in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[i : i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            cursor = conn.execute(
                f"DELETE FROM optimization_job_snapshots WHERE job_id IN ({placeholders})",
                chunk,
            )
            total_deleted += int(cursor.rowcount or 0)
        return total_deleted

    total_deleted = _run_write_transaction(_delete_chunks)
    deleted_ids = [job_id for job_id in unique_ids if job_id in existing_ids]
    return total_deleted, deleted_ids
