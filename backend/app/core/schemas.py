from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class GridSide(str, Enum):
    LONG = "long"
    SHORT = "short"


class Interval(str, Enum):
    M1 = "1m"
    M3 = "3m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H2 = "2h"
    H4 = "4h"
    H6 = "6h"
    H8 = "8h"
    H12 = "12h"
    D1 = "1d"


class DataSource(str, Enum):
    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"
    CSV = "csv"


class LiveExchange(str, Enum):
    BINANCE = "binance"
    BYBIT = "bybit"
    OKX = "okx"


class Candle(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class StrategyConfig(BaseModel):
    side: GridSide = GridSide.LONG
    lower: float = Field(..., gt=0)
    upper: float = Field(..., gt=0)
    grids: int = Field(..., ge=2, le=300)
    leverage: float = Field(..., gt=0, le=125)
    margin: float = Field(..., gt=0)
    stop_loss: float = Field(..., gt=0)
    use_base_position: bool = False
    strict_risk_control: bool = True
    reopen_after_stop: bool = True
    fee_rate: float = Field(0.0004, ge=0)
    maker_fee_rate: Optional[float] = Field(None, ge=0)
    taker_fee_rate: Optional[float] = Field(None, ge=0)
    slippage: float = Field(0.0, ge=0, le=0.05)
    maintenance_margin_rate: float = Field(0.005, gt=0, le=0.2)
    funding_rate_per_8h: float = Field(0.0, ge=-0.05, le=0.05)
    funding_interval_hours: int = Field(8, ge=1, le=24)
    use_mark_price_for_liquidation: bool = False
    price_tick_size: float = Field(0.0, ge=0.0)
    quantity_step_size: float = Field(0.0, ge=0.0)
    min_notional: float = Field(0.0, ge=0.0)
    max_allowed_loss_usdt: Optional[float] = Field(None, gt=0)

    @model_validator(mode="after")
    def validate_price_range(self) -> "StrategyConfig":
        if self.upper <= self.lower:
            raise ValueError("upper must be greater than lower")
        if self.side == GridSide.LONG and self.stop_loss >= self.lower:
            raise ValueError("for long grid, stop_loss must be lower than LOWER")
        if self.side == GridSide.SHORT and self.stop_loss <= self.upper:
            raise ValueError("for short grid, stop_loss must be higher than UPPER")
        return self

    @model_validator(mode="after")
    def normalize_fee_rate(self) -> "StrategyConfig":
        # Accept either decimal fee (0.0004) or percentage-style input (0.04 => 0.04%).
        if self.fee_rate > 0.01:
            self.fee_rate = self.fee_rate / 100.0
        if self.maker_fee_rate is not None and self.maker_fee_rate > 0.01:
            self.maker_fee_rate = self.maker_fee_rate / 100.0
        if self.taker_fee_rate is not None and self.taker_fee_rate > 0.01:
            self.taker_fee_rate = self.taker_fee_rate / 100.0
        if self.maker_fee_rate is None:
            self.maker_fee_rate = self.fee_rate
        if self.taker_fee_rate is None:
            self.taker_fee_rate = self.fee_rate
        return self


class DataConfig(BaseModel):
    source: DataSource = DataSource.BINANCE
    symbol: str = "BTCUSDT"
    interval: Interval = Interval.H1
    lookback_days: int = Field(14, ge=1, le=365)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    csv_content: Optional[str] = None

    @model_validator(mode="after")
    def validate_time_range(self) -> "DataConfig":
        beijing_tz = timezone(timedelta(hours=8))

        if self.start_time and self.start_time.tzinfo is None:
            self.start_time = self.start_time.replace(tzinfo=beijing_tz)
        if self.end_time and self.end_time.tzinfo is None:
            self.end_time = self.end_time.replace(tzinfo=beijing_tz)

        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("start_time must be earlier than end_time")

        return self


class BacktestRequest(BaseModel):
    strategy: StrategyConfig
    data: DataConfig = Field(default_factory=DataConfig)


class CurvePoint(BaseModel):
    timestamp: datetime
    value: float


class TradeEvent(BaseModel):
    open_time: datetime
    close_time: datetime
    side: Literal["long", "short"]
    entry_price: float
    exit_price: float
    quantity: float
    gross_pnl: float
    net_pnl: float
    fee_paid: float
    holding_hours: float
    close_reason: Literal["grid_take_profit", "stop_loss", "liquidation"]


class EventLog(BaseModel):
    timestamp: datetime
    event_type: str
    price: float
    message: str
    payload: Optional[dict[str, Any]] = None


class BacktestSummary(BaseModel):
    initial_margin: float
    final_equity: float
    total_return_usdt: float
    total_return_pct: float
    annualized_return_pct: Optional[float]
    average_round_profit: float
    max_drawdown_pct: float
    max_single_loss: float
    stop_loss_count: int
    liquidation_count: int
    full_grid_profit_count: int
    win_rate: float
    average_holding_hours: float
    total_closed_trades: int
    status: str
    fees_paid: float
    funding_paid: float
    funding_net: float
    funding_statement_amount: float
    use_base_position: bool
    base_grid_count: int
    initial_position_size: float
    max_possible_loss_usdt: float


class StrategyAnalysis(BaseModel):
    risk_level: Literal["low", "medium", "high"]
    structure_dependency: Literal["range", "mixed", "trend_sensitive"]
    overfitting_flag: bool
    validation_degradation_pct: float
    liquidation_risk: Literal["low", "medium", "high"]
    stability_score: float
    diagnosis_tags: list[str]
    ai_explanation: Optional[str] = None


class StrategyScoring(BaseModel):
    profit_score: float
    risk_score: float
    stability_score: float
    robustness_score: float
    behavior_score: float
    final_score: float
    grade: Literal["A", "B", "C", "D", "E"]
    profit_reasons: list[str] = Field(default_factory=list)
    risk_reasons: list[str] = Field(default_factory=list)
    stability_reasons: list[str] = Field(default_factory=list)
    robustness_reasons: list[str] = Field(default_factory=list)
    behavior_reasons: list[str] = Field(default_factory=list)


class BacktestResult(BaseModel):
    summary: BacktestSummary
    candles: list[Candle]
    grid_lines: list[float]
    equity_curve: list[CurvePoint]
    drawdown_curve: list[CurvePoint]
    unrealized_pnl_curve: list[CurvePoint]
    margin_ratio_curve: list[CurvePoint]
    leverage_usage_curve: list[CurvePoint]
    liquidation_price_curve: list[CurvePoint]
    trades: list[TradeEvent]
    events: list[EventLog]
    analysis: Optional[StrategyAnalysis] = None
    scoring: Optional[StrategyScoring] = None


class BacktestJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BacktestJobMeta(BaseModel):
    job_id: str
    status: BacktestJobStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    progress: float = 0.0
    message: Optional[str] = None
    error: Optional[str] = None


class BacktestStartResponse(BaseModel):
    job_id: str
    status: BacktestJobStatus
    idempotency_reused: bool = False


class BacktestStatusResponse(BaseModel):
    job: BacktestJobMeta
    result: Optional[BacktestResult] = None


class BacktestAnchorPriceResponse(BaseModel):
    anchor_price: float
    anchor_time: datetime
    anchor_source: Literal["first_candle_close", "avg_candle_close", "last_candle_close", "custom_price"]
    candle_count: int


class MarketParamsResponse(BaseModel):
    source: DataSource
    symbol: str
    maker_fee_rate: float
    taker_fee_rate: float
    funding_rate_per_8h: float
    funding_interval_hours: int
    price_tick_size: float
    quantity_step_size: float
    min_notional: float
    reference_price: Optional[float] = None
    fetched_at: datetime
    note: Optional[str] = None


class LiveCredentials(BaseModel):
    api_key: str = Field(..., min_length=1)
    api_secret: str = Field(..., min_length=1)
    passphrase: Optional[str] = None


class LiveRobotListRequest(BaseModel):
    exchange: LiveExchange
    scope: Literal["running", "recent"] = "running"
    credentials: LiveCredentials

    @model_validator(mode="after")
    def normalize(self) -> "LiveRobotListRequest":
        if self.exchange != LiveExchange.OKX:
            raise ValueError("OKX robot list only supports exchange=okx")
        if not (self.credentials.passphrase or "").strip():
            raise ValueError("OKX robot list requires credentials.passphrase")
        return self


class LiveRobotListItem(BaseModel):
    algo_id: str
    name: str
    symbol: str
    exchange_symbol: str
    state: Optional[str] = None
    side: Optional[Literal["long", "short", "flat"]] = None
    updated_at: Optional[datetime] = None
    run_type: Optional[str] = None
    configured_leverage: Optional[float] = None
    investment_usdt: Optional[float] = None
    lower_price: Optional[float] = None
    upper_price: Optional[float] = None
    grid_count: Optional[int] = None


class LiveRobotListResponse(BaseModel):
    scope: Literal["running", "recent"] = "running"
    items: list[LiveRobotListItem] = Field(default_factory=list)


class LiveSnapshotRequest(BaseModel):
    exchange: LiveExchange
    symbol: str = Field(..., min_length=2)
    strategy_started_at: datetime
    algo_id: Optional[str] = None
    monitoring_poll_interval_sec: int = Field(15, ge=5, le=60)
    monitoring_scope: Literal["running", "recent"] = "running"
    credentials: LiveCredentials

    @model_validator(mode="after")
    def normalize(self) -> "LiveSnapshotRequest":
        beijing_tz = timezone(timedelta(hours=8))
        self.symbol = self.symbol.strip().upper()
        self.algo_id = (self.algo_id or "").strip() or None
        if self.strategy_started_at.tzinfo is None:
            self.strategy_started_at = self.strategy_started_at.replace(tzinfo=beijing_tz)
        self.monitoring_poll_interval_sec = max(5, min(60, int(self.monitoring_poll_interval_sec or 15)))
        if self.exchange == LiveExchange.OKX:
            if not self.algo_id:
                raise ValueError("OKX live snapshot requires algo_id")
            if not (self.credentials.passphrase or "").strip():
                raise ValueError("OKX live snapshot requires credentials.passphrase")
        return self


class LiveAccountInfo(BaseModel):
    exchange: LiveExchange
    symbol: str
    exchange_symbol: str
    algo_id: str
    strategy_started_at: datetime
    fetched_at: datetime
    masked_api_key: str


class LiveSnapshotSummary(BaseModel):
    realized_pnl: float
    unrealized_pnl: float
    fees_paid: float
    funding_paid: float
    funding_net: float
    total_pnl: float
    position_notional: float
    open_order_count: int
    fill_count: int


class LiveRobotOverview(BaseModel):
    algo_id: str
    name: str
    state: Optional[str] = None
    direction: Optional[Literal["long", "short", "flat"]] = None
    algo_type: Optional[str] = None
    run_type: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    investment_usdt: Optional[float] = None
    configured_leverage: Optional[float] = None
    actual_leverage: Optional[float] = None
    liquidation_price: Optional[float] = None
    grid_count: Optional[int] = None
    lower_price: Optional[float] = None
    upper_price: Optional[float] = None
    grid_spacing: Optional[float] = None
    grid_profit: Optional[float] = None
    floating_profit: Optional[float] = None
    total_fee: Optional[float] = None
    funding_fee: Optional[float] = None
    total_pnl: Optional[float] = None
    pnl_ratio: Optional[float] = None
    stop_loss_price: Optional[float] = None
    take_profit_price: Optional[float] = None
    use_base_position: Optional[bool] = None


class LivePosition(BaseModel):
    side: Literal["long", "short", "flat"] = "flat"
    quantity: float = 0.0
    entry_price: float = 0.0
    mark_price: float = 0.0
    notional: float = 0.0
    leverage: Optional[float] = None
    liquidation_price: Optional[float] = None
    margin_mode: Optional[str] = None
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0


class LiveOpenOrder(BaseModel):
    order_id: str
    client_order_id: Optional[str] = None
    side: Literal["buy", "sell"]
    price: float
    quantity: float
    filled_quantity: float = 0.0
    reduce_only: bool = False
    status: str = "open"
    timestamp: Optional[datetime] = None


class LiveFill(BaseModel):
    trade_id: str
    order_id: Optional[str] = None
    side: Literal["buy", "sell"]
    price: float
    quantity: float
    realized_pnl: float = 0.0
    fee: float = 0.0
    fee_currency: Optional[str] = None
    is_maker: Optional[bool] = None
    timestamp: datetime


class LiveFundingEntry(BaseModel):
    timestamp: datetime
    amount: float
    rate: Optional[float] = None
    position_size: Optional[float] = None
    currency: Optional[str] = None


class LiveInferredGrid(BaseModel):
    lower: Optional[float] = None
    upper: Optional[float] = None
    grid_count: Optional[int] = None
    grid_spacing: Optional[float] = None
    active_level_count: int = 0
    active_levels: list[float] = Field(default_factory=list)
    confidence: float = 0.0
    use_base_position: Optional[bool] = None
    side: Optional[GridSide] = None
    note: Optional[str] = None


class LiveDiagnostic(BaseModel):
    level: Literal["info", "warning", "error"]
    code: str
    message: str
    action_hint: Optional[str] = None


class LiveWindowInfo(BaseModel):
    strategy_started_at: datetime
    fetched_at: datetime
    compared_end_at: datetime


class LiveCompleteness(BaseModel):
    fills_complete: bool = True
    funding_complete: bool = True
    bills_window_clipped: bool = False
    partial_failures: list[str] = Field(default_factory=list)


class LiveLedgerSummary(BaseModel):
    trading_net: float
    fees: float
    funding: float
    total_pnl: float
    realized: float
    unrealized: float


class LiveLedgerEntry(BaseModel):
    timestamp: datetime
    kind: Literal["trade", "fee", "funding"]
    amount: float
    pnl: float = 0.0
    fee: float = 0.0
    currency: Optional[str] = None
    side: Optional[Literal["buy", "sell"]] = None
    order_id: Optional[str] = None
    trade_id: Optional[str] = None
    is_maker: Optional[bool] = None
    note: Optional[str] = None


class LiveMonitoringInfo(BaseModel):
    poll_interval_sec: int
    last_success_at: datetime
    freshness_sec: int
    stale: bool = False
    source_latency_ms: int = 0
    fills_page_count: int = 0
    fills_capped: bool = False
    orders_page_count: int = 0


class LiveDailyBreakdown(BaseModel):
    date: str
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    funding_net: float = 0.0
    trading_net: float = 0.0
    total_pnl: float = 0.0
    entry_count: int = 0


class LiveSnapshotResponse(BaseModel):
    account: LiveAccountInfo
    robot: LiveRobotOverview
    monitoring: LiveMonitoringInfo
    market_params: Optional[MarketParamsResponse] = None
    summary: LiveSnapshotSummary
    window: LiveWindowInfo
    completeness: LiveCompleteness
    ledger_summary: LiveLedgerSummary
    position: LivePosition
    open_orders: list[LiveOpenOrder] = Field(default_factory=list)
    fills: list[LiveFill] = Field(default_factory=list)
    funding_entries: list[LiveFundingEntry] = Field(default_factory=list)
    pnl_curve: list[CurvePoint] = Field(default_factory=list)
    daily_breakdown: list[LiveDailyBreakdown] = Field(default_factory=list)
    ledger_entries: list[LiveLedgerEntry] = Field(default_factory=list)
    inferred_grid: LiveInferredGrid
    diagnostics: list[LiveDiagnostic] = Field(default_factory=list)


def default_request() -> BacktestRequest:
    beijing_tz = timezone(timedelta(hours=8))
    default_end = datetime.now(beijing_tz).replace(second=0, microsecond=0)
    default_start = default_end - timedelta(days=14)

    return BacktestRequest(
        strategy=StrategyConfig(
            side=GridSide.LONG,
            lower=62000,
            upper=70000,
            grids=24,
            leverage=5,
            margin=2000,
            stop_loss=59000,
            use_base_position=False,
            strict_risk_control=True,
            reopen_after_stop=True,
            fee_rate=0.0004,
            maker_fee_rate=0.0002,
            taker_fee_rate=0.0004,
            slippage=0.0002,
            maintenance_margin_rate=0.005,
            funding_rate_per_8h=0.0,
            funding_interval_hours=8,
            use_mark_price_for_liquidation=False,
            price_tick_size=0.1,
            quantity_step_size=0.0001,
            min_notional=5.0,
            max_allowed_loss_usdt=None,
        ),
        data=DataConfig(
            source=DataSource.BINANCE,
            symbol="BTCUSDT",
            interval=Interval.H1,
            lookback_days=14,
            start_time=default_start,
            end_time=default_end,
        ),
    )
