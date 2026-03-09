from __future__ import annotations

from dataclasses import dataclass

from app.core.schemas import (
    LiveDiagnostic,
    LiveFill,
    LiveFundingEntry,
    LiveInferredGrid,
    LiveLedgerEntry,
    LiveOpenOrder,
    LivePosition,
    LiveRobotOverview,
    LiveSnapshotSummary,
)


class LiveSnapshotError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "LIVE_SNAPSHOT_FAILED",
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status_code = int(status_code)
        self.code = code
        self.retryable = bool(retryable)


@dataclass
class ExchangeSnapshot:
    exchange_symbol: str
    position: LivePosition
    open_orders: list[LiveOpenOrder]
    fills: list[LiveFill]
    funding_entries: list[LiveFundingEntry]
    diagnostics: list[LiveDiagnostic]
    ledger_entries: list[LiveLedgerEntry] | None = None
    inferred_grid: LiveInferredGrid | None = None
    summary: LiveSnapshotSummary | None = None
    robot: LiveRobotOverview | None = None
    symbol: str | None = None
    source_latency_ms: int = 0
    orders_page_count: int = 0
    fills_page_count: int = 0
    fills_capped: bool = False
