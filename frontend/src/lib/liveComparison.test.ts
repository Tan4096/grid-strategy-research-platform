import { describe, expect, it } from "vitest";
import { buildLiveComparison } from "./liveComparison";
import type { BacktestRequest, BacktestResponse, LiveSnapshotResponse } from "../types";

const request: BacktestRequest = {
  strategy: {
    side: "long",
    lower: 68000,
    upper: 72000,
    grids: 8,
    leverage: 5,
    margin: 1000,
    stop_loss: 66000,
    use_base_position: false,
    strict_risk_control: true,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    slippage: 0,
    maintenance_margin_rate: 0.005
  },
  data: {
    source: "binance",
    symbol: "BTCUSDT",
    interval: "1h",
    lookback_days: 7,
    start_time: "2026-03-01T00:00:00+08:00",
    end_time: "2026-03-07T00:00:00+08:00"
  }
};

const result: BacktestResponse = {
  summary: {
    initial_margin: 1000,
    final_equity: 1100,
    total_return_usdt: 100,
    total_return_pct: 10,
    annualized_return_pct: null,
    average_round_profit: 5,
    max_drawdown_pct: 4,
    max_single_loss: -10,
    stop_loss_count: 0,
    liquidation_count: 0,
    full_grid_profit_count: 4,
    win_rate: 0.7,
    average_holding_hours: 6,
    total_closed_trades: 10,
    status: "completed",
    fees_paid: 2,
    funding_paid: 0.4,
    funding_net: -0.4,
    funding_statement_amount: 0.4,
    use_base_position: false,
    base_grid_count: 0,
    initial_position_size: 0,
    max_possible_loss_usdt: 300
  },
  candles: [],
  grid_lines: [],
  equity_curve: [],
  drawdown_curve: [],
  unrealized_pnl_curve: [{ timestamp: "2026-03-07T00:00:00+08:00", value: 6 }],
  margin_ratio_curve: [],
  leverage_usage_curve: [],
  liquidation_price_curve: [],
  trades: [
    {
      open_time: "2026-03-01T01:00:00+08:00",
      close_time: "2026-03-01T03:00:00+08:00",
      side: "long",
      entry_price: 69000,
      exit_price: 69500,
      quantity: 0.01,
      gross_pnl: 5,
      net_pnl: 4.6,
      fee_paid: 0.4,
      holding_hours: 2,
      close_reason: "grid_take_profit"
    }
  ],
  events: [
    {
      timestamp: "2026-03-07T00:00:00+08:00",
      event_type: "snapshot",
      price: 70500,
      message: "snapshot",
      payload: { open_positions: 3 }
    }
  ],
  analysis: null,
  scoring: null
};

const snapshot: LiveSnapshotResponse = {
  account: {
    exchange: "binance",
    symbol: "BTCUSDT",
    exchange_symbol: "BTCUSDT",
    algo_id: "",
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T00:05:00+08:00",
    masked_api_key: "abc***yz"
  },
  monitoring: {
    poll_interval_sec: 15,
    last_success_at: "2026-03-07T00:05:00+08:00",
    freshness_sec: 0,
    stale: false,
    source_latency_ms: 120,
    fills_page_count: 1,
    fills_capped: false,
    orders_page_count: 1
  },
  robot: {
    algo_id: "123456",
    name: "测试机器人",
    state: "running",
    direction: "long",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-01T00:00:00+08:00",
    updated_at: "2026-03-07T00:05:00+08:00",
    investment_usdt: 1000,
    configured_leverage: 5,
    actual_leverage: 4.8,
    liquidation_price: 65000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 72000,
    grid_spacing: 500,
    grid_profit: 5,
    floating_profit: 7,
    total_fee: 2.5,
    funding_fee: -0.2,
    total_pnl: 9.3,
    pnl_ratio: 0.12,
    stop_loss_price: 66000,
    take_profit_price: 73000,
    use_base_position: true
  },
  market_params: null,
  window: {
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T00:05:00+08:00",
    compared_end_at: "2026-03-07T00:05:00+08:00"
  },
  completeness: {
    fills_complete: true,
    funding_complete: true,
    bills_window_clipped: false,
    partial_failures: []
  },
  ledger_summary: {
    trading_net: 2.5,
    fees: 2.5,
    funding: -0.2,
    total_pnl: 9.3,
    realized: 5,
    unrealized: 7
  },
  summary: {
    realized_pnl: 5,
    unrealized_pnl: 7,
    fees_paid: 2.5,
    funding_paid: 0.2,
    funding_net: -0.2,
    total_pnl: 9.3,
    position_notional: 1000,
    open_order_count: 6,
    fill_count: 10
  },
  position: {
    side: "long",
    quantity: 0.02,
    entry_price: 70000,
    mark_price: 70500,
    notional: 1000,
    leverage: 5,
    liquidation_price: 65000,
    margin_mode: "isolated",
    unrealized_pnl: 7,
    realized_pnl: 5
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
    active_level_count: 3,
    active_levels: [68000, 68500, 69000],
    confidence: 0.8,
    use_base_position: false,
    side: "long",
    note: null
  },
  diagnostics: []
};

describe("buildLiveComparison", () => {
  it("compares live snapshot against current backtest result", () => {
    const comparison = buildLiveComparison({ request, result, snapshot });

    expect(comparison.blocked).toBe(false);
    expect(comparison.metrics).toHaveLength(8);
    expect(comparison.metrics[0].key).toBe("position_notional");
    expect(comparison.metrics.find((item) => item.key === "total_pnl")?.diff_value).toBeCloseTo(-90.7, 6);
    expect(comparison.reasons).toContain("当前实盘持仓名义价值与回测末仓位不在同一量级。");
  });

  it("blocks comparison when symbol does not match", () => {
    const comparison = buildLiveComparison({
      request: { ...request, data: { ...request.data, symbol: "ETHUSDT" } },
      result,
      snapshot
    });

    expect(comparison.blocked).toBe(true);
    expect(comparison.issues[0]).toContain("标的");
  });

  it("blocks comparison when live start time differs from backtest window", () => {
    const comparison = buildLiveComparison({
      request,
      result,
      snapshot: {
        ...snapshot,
        account: {
          ...snapshot.account,
          strategy_started_at: "2026-03-03T00:00:00+08:00"
        },
        window: {
          ...snapshot.window,
          strategy_started_at: "2026-03-03T00:00:00+08:00"
        }
      }
    });

    expect(comparison.blocked).toBe(true);
    expect(comparison.issues[0]).toContain("起点");
  });

  it("blocks comparison when backtest end time is stale", () => {
    const comparison = buildLiveComparison({
      request,
      result,
      snapshot: {
        ...snapshot,
        account: {
          ...snapshot.account,
          fetched_at: "2026-03-07T04:05:00+08:00"
        },
        window: {
          ...snapshot.window,
          fetched_at: "2026-03-07T04:05:00+08:00",
          compared_end_at: "2026-03-07T04:05:00+08:00"
        }
      }
    });

    expect(comparison.blocked).toBe(true);
    expect(comparison.issues[0]).toContain("结束时间");
  });
});
