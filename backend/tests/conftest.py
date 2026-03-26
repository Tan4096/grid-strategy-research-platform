from __future__ import annotations

import pytest

from app.core.concurrency_limit import reset_concurrency_limit_state
from app.core.rate_limit import reset_rate_limit_state


@pytest.fixture(autouse=True)
def disable_auth_by_default_for_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    # Existing tests focus on domain logic and API behavior; auth-specific behavior
    # is covered in dedicated auth tests.
    monkeypatch.setenv("APP_AUTH_ENABLED", "0")
    monkeypatch.setenv("APP_RATE_LIMIT_ENABLED", "0")
    monkeypatch.setenv("APP_TASK_BACKEND", "inmemory")
    monkeypatch.delenv("APP_BACKTEST_TASK_BACKEND", raising=False)
    monkeypatch.delenv("APP_OPTIMIZATION_TASK_BACKEND", raising=False)
    monkeypatch.setenv("BACKTEST_RECOVERY_ENABLED", "0")
    monkeypatch.setenv("OPTIMIZATION_RECOVERY_ENABLED", "0")
    reset_rate_limit_state()
    reset_concurrency_limit_state()
