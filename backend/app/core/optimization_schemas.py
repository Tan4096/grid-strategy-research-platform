from __future__ import annotations

import os
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from app.core.schemas import CurvePoint, DataConfig, StrategyConfig


class OptimizationTarget(str, Enum):
    TOTAL_RETURN = "total_return"
    SHARPE = "sharpe"
    MIN_DRAWDOWN = "min_drawdown"
    RETURN_DRAWDOWN_RATIO = "return_drawdown_ratio"
    CUSTOM = "custom"


class OptimizationMode(str, Enum):
    GRID = "grid"
    BAYESIAN = "bayesian"
    RANDOM_PRUNED = "random_pruned"


class AnchorMode(str, Enum):
    BACKTEST_START_PRICE = "BACKTEST_START_PRICE"
    BACKTEST_AVG_PRICE = "BACKTEST_AVG_PRICE"
    CURRENT_PRICE = "CURRENT_PRICE"
    CUSTOM_PRICE = "CUSTOM_PRICE"


class SortOrder(str, Enum):
    DESC = "desc"
    ASC = "asc"


class SweepRange(BaseModel):
    enabled: bool = False
    start: Optional[float] = None
    end: Optional[float] = None
    step: Optional[float] = None
    values: Optional[List[float]] = None

    @model_validator(mode="after")
    def validate_sweep(self) -> "SweepRange":
        if not self.enabled:
            return self

        if self.values and len(self.values) > 0:
            return self

        if self.start is None or self.end is None or self.step is None:
            raise ValueError("enabled sweep requires values or (start, end, step)")
        if self.step <= 0:
            raise ValueError("sweep step must be > 0")
        if self.end < self.start:
            raise ValueError("sweep end must be >= start")
        return self


class OptimizationConfig(BaseModel):
    optimization_mode: OptimizationMode = OptimizationMode.RANDOM_PRUNED

    leverage: SweepRange = SweepRange(enabled=True, start=5, end=12, step=1)
    grids: SweepRange = SweepRange(enabled=True, start=4, end=12, step=1)
    band_width_pct: SweepRange = SweepRange(enabled=True, values=[5.0, 8.0, 10.0])
    stop_loss_ratio_pct: SweepRange = SweepRange(enabled=True, values=[0.5, 1.0, 2.0])
    optimize_base_position: bool = False
    anchor_mode: AnchorMode = AnchorMode.BACKTEST_START_PRICE
    custom_anchor_price: Optional[float] = Field(None, gt=0)

    target: OptimizationTarget = OptimizationTarget.RETURN_DRAWDOWN_RATIO
    custom_score_expr: Optional[str] = None

    min_closed_trades: int = Field(0, ge=0)
    max_drawdown_pct_limit: Optional[float] = Field(None, gt=0)
    require_positive_return: bool = False
    robust_validation_weight: float = Field(0.7, ge=0.0, le=1.0)
    robust_gap_penalty: float = Field(0.2, ge=0.0, le=10.0)

    # Legacy cap for exhaustive/space-based modes.
    max_combinations: int = Field(500, ge=1, le=200_000)
    # Primary cap for trial-based optimizers (random_pruned / bayesian).
    max_trials: int = Field(2_000, ge=1, le=200_000)
    auto_limit_combinations: bool = True
    max_workers: int = Field(default_factory=lambda: min(64, os.cpu_count() or 4), ge=1, le=64)
    batch_size: int = Field(300, ge=50, le=5000)
    chunk_size: int = Field(64, ge=1, le=2048)

    warmup_ratio: float = Field(0.15, ge=0.0, le=0.9)
    random_seed: Optional[int] = Field(None, ge=0)
    resume_study: bool = False
    resume_study_key: Optional[str] = None
    bayesian_adaptive_fallback_enabled: bool = True
    bayesian_adaptive_slowdown_factor: float = Field(1.8, ge=1.1, le=10.0)
    bayesian_adaptive_window_batches: int = Field(4, ge=2, le=20)
    bayesian_adaptive_min_trials_after_warmup: int = Field(64, ge=1, le=200_000)

    enable_early_pruning: bool = True
    drawdown_prune_multiplier: float = Field(1.5, ge=1.0, le=10.0)
    enable_profit_pruning: bool = True
    pruning_steps: int = Field(2, ge=1, le=5)

    enable_topk_refine: bool = False
    topk_refine_k: int = Field(5, ge=1, le=20)
    refine_leverage_delta: int = Field(1, ge=1, le=10)
    refine_grids_delta: int = Field(1, ge=1, le=10)
    refine_band_delta_pct: float = Field(0.5, ge=0.0, le=20.0)
    refine_stop_delta_pct: float = Field(0.25, ge=0.0, le=20.0)

    walk_forward_enabled: bool = True
    train_ratio: float = Field(0.5, gt=0.1, lt=0.9)

    @model_validator(mode="after")
    def validate_custom_score(self) -> "OptimizationConfig":
        if self.target == OptimizationTarget.CUSTOM and not self.custom_score_expr:
            raise ValueError("custom_score_expr is required when target=custom")
        if self.anchor_mode == AnchorMode.CUSTOM_PRICE and self.custom_anchor_price is None:
            raise ValueError("custom_anchor_price is required when anchor_mode=CUSTOM_PRICE")
        # Backward compatibility: older clients send max_combinations only.
        if "max_trials" not in self.model_fields_set and "max_combinations" in self.model_fields_set:
            self.max_trials = int(self.max_combinations)
        return self


class OptimizationRequest(BaseModel):
    base_strategy: StrategyConfig
    data: DataConfig
    optimization: OptimizationConfig = OptimizationConfig()


class OptimizationResultRow(BaseModel):
    row_id: int

    leverage: float
    grids: int
    use_base_position: bool
    base_grid_count: int
    initial_position_size: float
    anchor_price: float
    lower_price: float
    upper_price: float
    stop_price: float
    band_width_pct: float
    # Backward-compatible aliases, same values as lower/upper/stop prices.
    range_lower: float
    range_upper: float
    stop_loss: float
    stop_loss_ratio_pct: float

    total_return_usdt: float
    max_drawdown_pct: float
    sharpe_ratio: float
    win_rate: float
    return_drawdown_ratio: float
    score: float

    validation_total_return_usdt: Optional[float] = None
    validation_max_drawdown_pct: Optional[float] = None
    validation_sharpe_ratio: Optional[float] = None
    validation_win_rate: Optional[float] = None
    validation_return_drawdown_ratio: Optional[float] = None
    validation_score: Optional[float] = None
    validation_total_closed_trades: Optional[int] = None

    robust_score: Optional[float] = None
    overfit_penalty: Optional[float] = None
    passes_constraints: bool = True
    constraint_violations: List[str] = Field(default_factory=list)

    total_closed_trades: int


class HeatmapCell(BaseModel):
    leverage: float
    grids: int
    value: float
    use_base_position: bool
    base_grid_count: int
    initial_position_size: float
    anchor_price: float
    lower_price: float
    upper_price: float
    stop_price: float


class TimeWindowInfo(BaseModel):
    start_time: datetime
    end_time: datetime
    candles: int


class OptimizationProgressPoint(BaseModel):
    step: int
    value: float


class OptimizationJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class OptimizationJobMeta(BaseModel):
    job_id: str
    status: OptimizationJobStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    progress: float = 0.0
    total_steps: int = 0
    completed_steps: int = 0
    message: Optional[str] = None
    error: Optional[str] = None
    total_combinations: int = 0
    trials_completed: int = 0
    trials_pruned: int = 0
    pruning_ratio: float = 0.0


class OptimizationStartResponse(BaseModel):
    job_id: str
    status: OptimizationJobStatus
    total_combinations: int


class OptimizationProgressResponse(BaseModel):
    job: OptimizationJobMeta
    target: OptimizationTarget


class OptimizationStatusResponse(BaseModel):
    job: OptimizationJobMeta
    target: OptimizationTarget
    sort_by: str
    sort_order: SortOrder

    page: int
    page_size: int
    total_results: int
    rows: List[OptimizationResultRow]

    best_row: Optional[OptimizationResultRow] = None
    best_validation_row: Optional[OptimizationResultRow] = None
    best_equity_curve: List[CurvePoint] = []
    best_score_progression: List[OptimizationProgressPoint] = []
    convergence_curve_data: List[OptimizationProgressPoint] = []

    heatmap: List[HeatmapCell] = []

    train_window: Optional[TimeWindowInfo] = None
    validation_window: Optional[TimeWindowInfo] = None


class OptimizationRowsResponse(BaseModel):
    job: OptimizationJobMeta
    target: OptimizationTarget
    sort_by: str
    sort_order: SortOrder
    page: int
    page_size: int
    total_results: int
    rows: List[OptimizationResultRow]
    best_row: Optional[OptimizationResultRow] = None
    best_validation_row: Optional[OptimizationResultRow] = None


class OptimizationHeatmapResponse(BaseModel):
    job: OptimizationJobMeta
    target: OptimizationTarget
    heatmap: List[HeatmapCell] = []
    best_row: Optional[OptimizationResultRow] = None


class OptimizationResultBundle(BaseModel):
    rows: List[OptimizationResultRow]
    best_row: Optional[OptimizationResultRow] = None
    best_validation_row: Optional[OptimizationResultRow] = None
    best_equity_curve: List[CurvePoint] = []
    train_window: Optional[TimeWindowInfo] = None
    validation_window: Optional[TimeWindowInfo] = None
