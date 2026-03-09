from __future__ import annotations

import importlib
import sqlite3
import time
from pathlib import Path

import pytest

import app.optimizer.job_store as job_store_module


def _load_store(monkeypatch: pytest.MonkeyPatch, db_path: Path):
    monkeypatch.setenv("OPTIMIZATION_STORE_PATH", str(db_path))
    monkeypatch.setenv("OPTIMIZATION_STORE_CLEANUP_INTERVAL_SECONDS", "999999")
    return importlib.reload(job_store_module)


def _save_snapshot(store, job_id: str, status: str = "completed") -> None:
    now_iso = "2026-02-27T00:00:00+00:00"
    store.save_job_snapshot(
        job_id=job_id,
        target="return_drawdown_ratio",
        status=status,
        request_payload={"optimization": {"target": "return_drawdown_ratio"}},
        meta={
            "job_id": job_id,
            "status": status,
            "created_at": now_iso,
            "started_at": now_iso,
            "finished_at": now_iso,
            "progress": 100.0,
            "total_steps": 1,
            "completed_steps": 1,
            "message": "done",
            "error": None,
            "total_combinations": 1,
            "trials_completed": 1,
            "trials_pruned": 0,
            "pruning_ratio": 0.0,
        },
        rows=[],
        best_row=None,
        best_validation_row=None,
        best_equity_curve=[],
        best_score_progression=[],
        convergence_curve_data=[],
        train_window=None,
        validation_window=None,
        include_rows=False,
    )


def test_list_recent_job_snapshots_cursor_paginates(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store = _load_store(monkeypatch, tmp_path / "jobs.sqlite3")

    _save_snapshot(store, "job-a")
    time.sleep(0.01)
    _save_snapshot(store, "job-b")
    time.sleep(0.01)
    _save_snapshot(store, "job-c")

    first_page, first_cursor = store.list_recent_job_snapshots_cursor(limit=2)
    assert [item["job_id"] for item in first_page] == ["job-c", "job-b"]
    assert isinstance(first_cursor, str) and first_cursor

    second_page, second_cursor = store.list_recent_job_snapshots_cursor(limit=2, cursor=first_cursor)
    assert [item["job_id"] for item in second_page] == ["job-a"]
    assert second_cursor is None


def test_ensure_db_creates_history_indexes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    db_path = tmp_path / "jobs.sqlite3"
    store = _load_store(monkeypatch, db_path)
    _save_snapshot(store, "job-index")

    with sqlite3.connect(str(db_path)) as conn:
        rows = conn.execute("PRAGMA index_list('optimization_job_snapshots')").fetchall()
    index_names = {str(row[1]) for row in rows}

    assert "idx_optimization_job_snapshots_updated_at" in index_names
    assert "idx_optimization_job_snapshots_status_updated_at" in index_names


def test_delete_job_snapshots_with_details_returns_deleted_ids(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store = _load_store(monkeypatch, tmp_path / "jobs.sqlite3")
    _save_snapshot(store, "job-a")
    _save_snapshot(store, "job-b")

    deleted, deleted_ids = store.delete_job_snapshots_with_details(["job-a", "missing-job"])

    assert deleted == 1
    assert deleted_ids == ["job-a"]


def test_soft_delete_terminal_job_snapshots_skips_running(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store = _load_store(monkeypatch, tmp_path / "jobs.sqlite3")
    _save_snapshot(store, "job-completed", status="completed")
    _save_snapshot(store, "job-failed", status="failed")
    _save_snapshot(store, "job-running", status="running")
    _save_snapshot(store, "job-pending", status="pending")

    deleted, deleted_ids, skipped_ids = store.soft_delete_terminal_job_snapshots_with_details(
        ["job-completed", "job-failed", "job-running", "job-pending", "missing-job"]
    )

    assert deleted == 2
    assert deleted_ids == ["job-completed", "job-failed"]
    assert skipped_ids == ["job-running", "job-pending"]

    visible, _ = store.list_recent_job_snapshots_cursor(limit=20)
    visible_ids = {item["job_id"] for item in visible}
    assert "job-running" in visible_ids
    assert "job-pending" in visible_ids
    assert "job-completed" not in visible_ids
    assert "job-failed" not in visible_ids
