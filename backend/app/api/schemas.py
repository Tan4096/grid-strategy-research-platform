from typing import Literal, Optional, List
from pydantic import BaseModel, Field, model_validator


class GridParams(BaseModel):
    lower: float = Field(..., gt=0)
    upper: float = Field(..., gt=0)
    grids: int = Field(..., ge=2, le=300)
    leverage: float = Field(..., gt=0)
    margin: float = Field(..., gt=0)
    stop_loss: float = Field(..., gt=0)
    auto_restart: bool = True
    fee_rate: float = Field(0.0004, ge=0)
    slippage: float = Field(0.0, ge=0)
    side: Literal["long", "short"] = "long"
    maintenance_margin_rate: float = Field(0.005, ge=0)

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.lower >= self.upper:
            raise ValueError("lower must be less than upper")
        return self

class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: Literal["1h", "4h"] = "1h"
    params: GridParams
    csv_data: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None


class TradeOut(BaseModel):
    entry_time: str
    exit_time: str
    side: str
    entry_price: float
    exit_price: float
    qty: float
    pnl: float
    fee: float
    duration_hours: float
    reason: str
    slot_index: int


class EquityPointOut(BaseModel):
    time: str
    equity: float
    drawdown: float
    leverage_usage: float
    margin_ratio: float


class BacktestSummaryOut(BaseModel):
    total_profit: float
    annualized_return: float
    avg_cycle_profit: float
    total_fees: float
    max_drawdown: float
    max_single_loss: float
    stop_loss_count: int
    liquidations: int
    profitable_cycles: int
    win_rate: float
    avg_holding_hours: float
    total_trades: int
    start_time: str
    end_time: str
    duration_days: float


class BacktestResponse(BaseModel):
    summary: BacktestSummaryOut
    equity_curve: List[EquityPointOut]
    trades: List[TradeOut]
    grid_levels: List[float]
    candles: List[dict]
    meta: dict
