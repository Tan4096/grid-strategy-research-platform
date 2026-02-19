from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal, Optional

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
    reopen_after_stop: bool = True
    fee_rate: float = Field(0.0004, ge=0)
    slippage: float = Field(0.0, ge=0, le=0.05)
    maintenance_margin_rate: float = Field(0.005, gt=0, le=0.2)

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
    use_base_position: bool
    base_grid_count: int
    initial_position_size: float


class BacktestResult(BaseModel):
    summary: BacktestSummary
    candles: list[Candle]
    grid_lines: list[float]
    equity_curve: list[CurvePoint]
    drawdown_curve: list[CurvePoint]
    margin_ratio_curve: list[CurvePoint]
    leverage_usage_curve: list[CurvePoint]
    liquidation_price_curve: list[CurvePoint]
    trades: list[TradeEvent]
    events: list[EventLog]


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
            reopen_after_stop=True,
            fee_rate=0.0004,
            slippage=0.0002,
            maintenance_margin_rate=0.005,
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
