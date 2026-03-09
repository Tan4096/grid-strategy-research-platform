import { act } from "react";
import { describe, expect, it } from "vitest";
import type { LiveMonitoringTrendPoint } from "../../types";
import type { BacktestRequest, LiveSnapshotResponse } from "../../lib/api-schema";
import { renderHook } from "../../test-utils/renderHook";
import { useLiveTradingViewModel } from "./useLiveTradingViewModel";

const request: BacktestRequest = {
  strategy: {
    side: "long",
    lower: 68000,
    upper: 72000,
    grids: 8,
    leverage: 5,
    margin: 1000,
    stop_loss: 66000,
    use_base_position: true,
    strict_risk_control: true,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0005,
    slippage: 0,
    maintenance_margin_rate: 0.005,
    funding_rate_per_8h: 0,
    funding_interval_hours: 8,
    use_mark_price_for_liquidation: false,
    price_tick_size: 0.1,
    quantity_step_size: 0.001,
    min_notional: 1,
    max_allowed_loss_usdt: 100
  },
  data: {
    source: "okx",
    symbol: "BTCUSDT",
    interval: "1h",
    start_time: "2026-03-01T00:00:00+08:00",
    end_time: null,
    lookback_days: 14,
      }
};

const trend: LiveMonitoringTrendPoint[] = [
  {
    timestamp: "2026-03-06T10:00:00+08:00",
    total_pnl: 6.2,
    floating_profit: -1.1,
    funding_fee: 0.2,
    notional: 950
  },
  {
    timestamp: "2026-03-07T09:00:00+08:00",
    total_pnl: 9.8,
    floating_profit: -1.6,
    funding_fee: 0.3,
    notional: 980
  }
];

const snapshot: LiveSnapshotResponse = {
  account: {
    exchange: "okx",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    algo_id: "123456",
    strategy_started_at: "2026-03-01T00:00:00+08:00",
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
  robot: {
    algo_id: "123456",
    name: "BTC Grid",
    state: "running",
    direction: "short",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-01T00:00:00+08:00",
    updated_at: "2026-03-07T10:56:35.773+08:00",
    investment_usdt: 1000,
    configured_leverage: 5,
    actual_leverage: 4.8,
    liquidation_price: 65000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 72000,
    grid_spacing: 500,
    grid_profit: 12,
    floating_profit: -2,
    total_fee: 1.5,
    funding_fee: 0.4,
    total_pnl: 10.9,
    pnl_ratio: 0.12,
    stop_loss_price: 66000,
    take_profit_price: 73000,
    use_base_position: true
  },
  market_params: null,
  summary: {
    realized_pnl: 12,
    unrealized_pnl: -2,
    fees_paid: 1.5,
    funding_paid: 0,
    funding_net: 0.4,
    total_pnl: 10.9,
    position_notional: 1000,
    open_order_count: 0,
    fill_count: 0
  },
  window: {
    strategy_started_at: "2026-03-01T00:00:00+08:00",
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
    trading_net: 12.5,
    fees: 1.5,
    funding: 0.4,
    total_pnl: 10.9,
    realized: 12,
    unrealized: -2
  },
  position: {
    side: "short",
    quantity: 1,
    entry_price: 70000,
    mark_price: 70100,
    notional: 1000,
    leverage: 5,
    liquidation_price: 65000,
    margin_mode: "isolated",
    unrealized_pnl: -2,
    realized_pnl: 12
  },
  open_orders: [],
  fills: [],
  funding_entries: [],
  daily_breakdown: [],
  ledger_entries: [
    {
      timestamp: "2026-03-07T09:30:00+08:00",
      kind: "trade",
      amount: 8,
      pnl: 8,
      fee: 0,
      side: "sell",
      trade_id: "trade-1",
      note: "latest trade"
    },
    {
      timestamp: "2026-03-07T08:00:00+08:00",
      kind: "funding",
      amount: 0.4,
      pnl: 0,
      fee: 0,
      currency: "USDT",
      note: "funding income"
    },
    {
      timestamp: "2026-03-05T08:00:00+08:00",
      kind: "fee",
      amount: -1.2,
      pnl: 0,
      fee: 1.2,
      is_maker: true,
      note: "maker fee"
    }
  ],
  inferred_grid: {
    lower: 68000,
    upper: 72000,
    grid_count: 8,
    grid_spacing: 500,
    active_level_count: 0,
    active_levels: [],
    confidence: 0.9,
    use_base_position: true,
    side: "short",
    note: null
  },
  diagnostics: []
};

describe("useLiveTradingViewModel", () => {
  it("filters ledger entries by time window, preset, keyword and maker flag", () => {
    const hook = renderHook(() =>
      useLiveTradingViewModel({
        request,
        snapshot,
        autoRefreshPaused: false,
        trend
      })
    );

    expect(hook.value.presetCounts).toEqual({
      all: 3,
      trades: 1,
      fees: 1,
      funding: 1
    });

    act(() => {
      hook.value.setTimeFilter("24h");
    });
    expect(hook.value.filteredEntries).toHaveLength(2);

    act(() => {
      hook.value.setLedgerPreset("funding");
    });
    expect(hook.value.filteredEntries.map((item) => item.kind)).toEqual(["funding"]);

    act(() => {
      hook.value.setLedgerPreset("all");
      hook.value.setTimeFilter("all");
      hook.value.setMakerFilter("maker");
      hook.value.setSearchQuery("maker");
    });
    expect(hook.value.filteredEntries).toHaveLength(1);
    expect(hook.value.filteredEntries[0]?.kind).toBe("fee");

    hook.unmount();
  });

  it("marks paused monitoring as sync issue and exposes return-rate chart data", () => {
    const hook = renderHook(() =>
      useLiveTradingViewModel({
        request,
        snapshot,
        autoRefreshPaused: true,
        trend
      })
    );

    expect(hook.value.dataStatus?.label).toBe("异常");
    expect(hook.value.dataStatus?.detail).toContain("最近一次成功数据");
    expect(hook.value.pnlCurveChartUsesReturnRate).toBe(true);
    const lastPoint = hook.value.pnlCurveChartData[hook.value.pnlCurveChartData.length - 1];
    expect(lastPoint?.value).toBeCloseTo(hook.value.pnlCurveReturnPct ?? 0, 4);
    expect(hook.value.pnlCurveColor).toBe("#84cc16");

    hook.unmount();
  });
});
