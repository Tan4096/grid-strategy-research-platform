import { describe, expect, it } from "vitest";
import { buildLiveAlignedBacktestRequest } from "./liveBacktestAlignment";
import type { BacktestRequest, LiveSnapshotResponse } from "../lib/api-schema";

const request: BacktestRequest = {
  strategy: {
    side: "short",
    lower: 65000,
    upper: 71000,
    grids: 6,
    leverage: 8,
    margin: 1000,
    stop_loss: 72000,
    use_base_position: false,
    strict_risk_control: true,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0004,
    slippage: 0.0002,
    maintenance_margin_rate: 0.005,
    funding_rate_per_8h: 0,
    funding_interval_hours: 8,
    price_tick_size: 0.1,
    quantity_step_size: 0.001,
    min_notional: 5
  },
  data: {
    source: "binance",
    symbol: "ETHUSDT",
    interval: "1h",
    lookback_days: 7,
    start_time: "2026-03-01T00:00:00+08:00",
    end_time: null,
      }
};

const snapshot: LiveSnapshotResponse = {
  account: {
    exchange: "okx",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    algo_id: "123456",
    strategy_started_at: "2026-03-02T00:00:00+08:00",
    fetched_at: "2026-03-07T10:56:35.773+08:00",
    masked_api_key: "abc***89"
  },
  monitoring: {
    poll_interval_sec: 15,
    last_success_at: "2026-03-07T10:56:35.773+08:00",
    freshness_sec: 0,
    stale: false,
    source_latency_ms: 120,
    fills_page_count: 1,
    fills_capped: false,
    orders_page_count: 1
  },
  window: {
    strategy_started_at: "2026-03-02T00:00:00+08:00",
    fetched_at: "2026-03-07T10:56:35.773+08:00",
    compared_end_at: "2026-03-07T10:56:00+08:00"
  },
  completeness: {
    fills_complete: true,
    funding_complete: true,
    bills_window_clipped: false,
    partial_failures: []
  },
  ledger_summary: {
    trading_net: 0.5,
    fees: 0.5,
    funding: 0.2,
    total_pnl: 2.7,
    realized: 1,
    unrealized: 2
  },
  robot: {
    algo_id: "123456",
    name: "测试机器人",
    state: "running",
    direction: "long",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-02T00:00:00+08:00",
    updated_at: "2026-03-07T10:56:35.773+08:00",
    investment_usdt: 1000,
    configured_leverage: 5,
    actual_leverage: 4.8,
    liquidation_price: 65000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 72000,
    grid_spacing: 500,
    grid_profit: 1,
    floating_profit: 2,
    total_fee: 0.5,
    funding_fee: 0.2,
    total_pnl: 2.7,
    pnl_ratio: 0.12,
    stop_loss_price: 66000,
    take_profit_price: 73000,
    use_base_position: true
  },
  market_params: {
    source: "okx",
    symbol: "BTCUSDT",
    maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0005,
    funding_rate_per_8h: 0.0001,
    funding_interval_hours: 8,
    price_tick_size: 0.1,
    quantity_step_size: 0.001,
    min_notional: 1,
    fetched_at: "2026-03-07T10:56:35.773+08:00",
    note: null
  },
  summary: {
    realized_pnl: 1,
    unrealized_pnl: 2,
    fees_paid: 0.5,
    funding_paid: 0.1,
    funding_net: 0.2,
    total_pnl: 2.7,
    position_notional: 1000,
    open_order_count: 0,
    fill_count: 0
  },
  position: {
    side: "long",
    quantity: 1,
    entry_price: 70000,
    mark_price: 70100,
    notional: 1000,
    leverage: 5,
    liquidation_price: 65000,
    margin_mode: "isolated",
    unrealized_pnl: 2,
    realized_pnl: 1
  },
  open_orders: [],
  fills: [],
  funding_entries: [],
  daily_breakdown: [],
  ledger_entries: [],
  inferred_grid: {
    lower: 68000,
    upper: 72000,
    grid_count: 8,
    grid_spacing: 500,
    active_level_count: 0,
    active_levels: [],
    confidence: 0.8,
    use_base_position: true,
    side: "long",
    note: null
  },
  diagnostics: []
};

describe("buildLiveAlignedBacktestRequest", () => {
  it("aligns backtest request to live snapshot window and market params", () => {
    const next = buildLiveAlignedBacktestRequest(request, snapshot);

    expect(next.data.source).toBe("okx");
    expect(next.data.symbol).toBe("BTCUSDT");
    expect(next.data.start_time).toBe("2026-03-02T00:00:00+08:00");
    expect(next.data.end_time).toBe("2026-03-07T02:56:00.000Z");
    expect(next.strategy.side).toBe("long");
    expect(next.strategy.use_base_position).toBe(true);
    expect(next.strategy.taker_fee_rate).toBe(0.0005);
    expect(next.strategy.min_notional).toBe(1);
  });
});
