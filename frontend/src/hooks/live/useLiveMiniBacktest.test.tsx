import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "../../test-utils/renderHook";
import type { BacktestRequest, LiveSnapshotResponse } from "../../lib/api-schema";

vi.mock("../../lib/api", () => ({
  runBacktest: vi.fn().mockResolvedValue({
    summary: {
      total_return_usdt: 0,
      total_return_pct: 0,
      annualized_return_pct: 0,
      max_drawdown_pct: 0,
      max_drawdown_usdt: 0,
      sharpe_ratio: 0,
      win_rate_pct: 0,
      total_trades: 0,
      liquidation_count: 0,
      final_equity: 1000,
      fees_paid: 0,
      funding_net: 0,
      realized_pnl: 0,
      unrealized_pnl: 0,
      total_return_multiple: 0,
      final_margin_ratio: 0,
      max_margin_ratio: 0,
      final_leverage: 0,
      avg_leverage: 0,
      liquidation_price_last: null,
      stop_loss_count: 0,
      avg_holding_bars: 0,
      funding_statement_amount: 0,
      initial_margin: 1000
    },
    candles: [
      { timestamp: "2026-03-07T10:00:00+08:00", open: 70000, high: 70100, low: 69900, close: 70050, volume: 1 }
    ],
    grid_lines: [],
    equity_curve: [],
    drawdown_curve: [],
    unrealized_pnl_curve: [],
    margin_ratio_curve: [],
    leverage_usage_curve: [],
    liquidation_price_curve: [],
    trades: [],
    events: []
  })
}));

import { runBacktest } from "../../lib/api";
import { useLiveMiniBacktest } from "./useLiveMiniBacktest";

const request: BacktestRequest = {
  strategy: {
    side: "short", lower: 65000, upper: 71000, grids: 6, leverage: 8, margin: 1000, stop_loss: 72000,
    use_base_position: false, strict_risk_control: true, reopen_after_stop: true, fee_rate: 0.0004, maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0004, slippage: 0.0002, maintenance_margin_rate: 0.005, funding_rate_per_8h: 0, funding_interval_hours: 8,
    price_tick_size: 0.1, quantity_step_size: 0.001, min_notional: 5, max_allowed_loss_usdt: 100
  },
  data: { source: "binance", symbol: "ETHUSDT", interval: "1h", lookback_days: 7, start_time: "2026-03-01T00:00:00+08:00", end_time: null }
};

const snapshot: LiveSnapshotResponse = {
  account: { exchange: "okx", symbol: "BTCUSDT", exchange_symbol: "BTC-USDT-SWAP", algo_id: "123456", strategy_started_at: "2026-01-01T00:00:00+08:00", fetched_at: "2026-03-07T10:56:35.773+08:00", masked_api_key: "abc***89" },
  monitoring: { poll_interval_sec: 15, last_success_at: "2026-03-07T10:56:35.773+08:00", freshness_sec: 0, stale: false, source_latency_ms: 120, fills_page_count: 1, fills_capped: false, orders_page_count: 1 },
  window: { strategy_started_at: "2026-01-01T00:00:00+08:00", fetched_at: "2026-03-07T10:56:35.773+08:00", compared_end_at: "2026-03-07T10:56:00+08:00" },
  completeness: { fills_complete: true, funding_complete: true, bills_window_clipped: false, partial_failures: [] },
  ledger_summary: { trading_net: 0.5, fees: 0.5, funding: 0.2, total_pnl: 2.7, realized: 1, unrealized: 2 },
  robot: { algo_id: "123456", name: "测试机器人", state: "running", direction: "long", algo_type: "contract_grid", run_type: "1", created_at: "2026-03-02T00:00:00+08:00", updated_at: "2026-03-07T10:56:35.773+08:00", investment_usdt: 1000, configured_leverage: 5, actual_leverage: 4.8, liquidation_price: 65000, grid_count: 8, lower_price: 68000, upper_price: 72000, grid_spacing: 500, grid_profit: 1, floating_profit: 2, total_fee: 0.5, funding_fee: 0.2, total_pnl: 2.7, pnl_ratio: 0.12, stop_loss_price: 66000, take_profit_price: 73000, use_base_position: true },
  market_params: { source: "okx", symbol: "BTCUSDT", maker_fee_rate: 0.0002, taker_fee_rate: 0.0005, funding_rate_per_8h: 0.0001, funding_interval_hours: 8, price_tick_size: 0.1, quantity_step_size: 0.001, min_notional: 1, fetched_at: "2026-03-07T10:56:35.773+08:00", note: null },
  summary: { realized_pnl: 1, unrealized_pnl: 2, fees_paid: 0.5, funding_paid: 0.1, funding_net: 0.2, total_pnl: 2.7, position_notional: 1000, open_order_count: 0, fill_count: 0 },
  position: { side: "long", quantity: 1, entry_price: 70000, mark_price: 70100, notional: 1000, leverage: 5, liquidation_price: 65000, margin_mode: "isolated", unrealized_pnl: 2, realized_pnl: 1 },
  open_orders: [], fills: [], funding_entries: [], daily_breakdown: [], ledger_entries: [],
  inferred_grid: { lower: 68000, upper: 72000, grid_count: 8, grid_spacing: 500, active_level_count: 0, active_levels: [], confidence: 0.8, use_base_position: true, side: "long", note: null },
  diagnostics: []
};

describe("useLiveMiniBacktest", () => {
  it("runs a hidden live-aligned backtest and stores candles locally", async () => {
    vi.mocked(runBacktest).mockClear();
    const hook = renderHook(() => useLiveMiniBacktest({ request, snapshot }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runBacktest).toHaveBeenCalledTimes(1);
    const calledRequest = vi.mocked(runBacktest).mock.calls[0]?.[0];
    expect(calledRequest?.data.end_time).toBe("2026-03-07T02:56:00.000Z");
    expect(calledRequest?.data.start_time).toBe("2026-02-05T02:56:00.000Z");
    expect(hook.value.result?.candles).toHaveLength(1);
    expect(hook.value.loading).toBe(false);
  });

  it("skips the hidden backtest when disabled", async () => {
    vi.mocked(runBacktest).mockClear();
    const hook = renderHook(() => useLiveMiniBacktest({ request, snapshot, enabled: false }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runBacktest).not.toHaveBeenCalled();
    expect(hook.value.result).toBeNull();
    expect(hook.value.loading).toBe(false);
    expect(hook.value.error).toBeNull();
  });
});
