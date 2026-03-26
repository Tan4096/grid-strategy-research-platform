from __future__ import annotations

from pathlib import Path

from app.optimizer import storage_paths


def test_optuna_study_storage_url_uses_persistent_store_parent(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(storage_paths, "optimization_store_path", lambda: tmp_path / "optimization_jobs.sqlite3")

    storage_url, study_name = storage_paths.optuna_study_storage_url("BTC Grid / 1h")

    expected_dir = tmp_path / "optuna_studies"
    assert study_name == "BTC-Grid-1h"
    assert storage_url == f"sqlite:///{expected_dir / 'btc-grid-optuna-BTC-Grid-1h.sqlite3'}"
    assert expected_dir.is_dir()
