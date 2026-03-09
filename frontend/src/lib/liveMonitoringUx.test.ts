import { describe, expect, it } from "vitest";
import type { LiveRobotListItem, LiveSnapshotResponse } from "../lib/api-schema";
import {
  buildLiveMonitoringHeadline,
  buildLiveMonitoringReadiness,
  buildPrimaryAttentionItem,
  findPreferredLiveRobot,
  sortLiveRobotItems
} from "./liveMonitoringUx";

const snapshotBase: LiveSnapshotResponse = {
  account: {
    exchange: "okx",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    algo_id: "123",
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T10:00:00+08:00",
    masked_api_key: "abc***12"
  },
  robot: {
    algo_id: "123",
    name: "BTC Grid",
    state: "running",
    direction: "short",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-01T00:00:00+08:00",
    updated_at: "2026-03-07T10:00:00+08:00",
    investment_usdt: 1000,
    configured_leverage: 5,
    actual_leverage: 4.5,
    liquidation_price: 72000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 71000,
    grid_spacing: 375,
    grid_profit: 120,
    floating_profit: -20,
    total_fee: 10,
    funding_fee: 5,
    total_pnl: 105,
    pnl_ratio: 0.105,
    stop_loss_price: 71500,
    take_profit_price: 67500,
    use_base_position: false
  },
  monitoring: {
    poll_interval_sec: 15,
    last_success_at: "2026-03-07T10:00:00+08:00",
    freshness_sec: 0,
    stale: false,
    source_latency_ms: 120,
    fills_page_count: 1,
    fills_capped: false,
    orders_page_count: 1
  },
  market_params: null,
  summary: {
    realized_pnl: 120,
    unrealized_pnl: -20,
    fees_paid: 10,
    funding_paid: 0,
    funding_net: 5,
    total_pnl: 105,
    position_notional: 1000,
    open_order_count: 3,
    fill_count: 20
  },
  window: {
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T10:00:00+08:00",
    compared_end_at: "2026-03-07T10:00:00+08:00"
  },
  completeness: {
    fills_complete: true,
    funding_complete: true,
    bills_window_clipped: false,
    partial_failures: []
  },
  ledger_summary: {
    trading_net: 110,
    fees: 10,
    funding: 5,
    total_pnl: 105,
    realized: 120,
    unrealized: -20
  },
  position: {
    side: "short",
    quantity: 1,
    entry_price: 70000,
    mark_price: 70000,
    notional: 1000,
    leverage: 5,
    liquidation_price: 72000,
    margin_mode: "isolated",
    unrealized_pnl: -20,
    realized_pnl: 120
  },
  open_orders: [],
  fills: [],
  funding_entries: [],
  daily_breakdown: [
    {
      date: "2026-03-07",
      realized_pnl: 50,
      fees_paid: 2,
      funding_net: 1,
      trading_net: 49,
      total_pnl: 48,
      entry_count: 8
    }
  ],
  ledger_entries: [],
  inferred_grid: {
    lower: 68000,
    upper: 71000,
    grid_count: 8,
    grid_spacing: 375,
    active_level_count: 2,
    active_levels: [69000, 70000],
    confidence: 0.9,
    use_base_position: false,
    side: "short",
    note: null
  },
  diagnostics: []
};

describe("buildLiveMonitoringHeadline", () => {
  it("marks danger when liquidation distance is below 2%", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 71300
      }
    });
    expect(headline.riskLevel).toBe("danger");
    expect(headline.attentionItems[0]?.key).toBe("liquidation_risk");
  });

  it("marks watch when stop-loss distance is below 5%", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 76000,
        stop_loss_price: 73000
      }
    });
    expect(headline.riskLevel).toBe("watch");
    expect(headline.attentionItems.some((item) => item.key === "stop_loss_risk")).toBe(true);
  });

  it("marks low integrity when snapshot is stale and fills are capped", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 78000,
        stop_loss_price: 76000
      },
      monitoring: {
        ...snapshotBase.monitoring,
        stale: true,
        fills_capped: true,
        fills_page_count: 5
      },
      completeness: {
        ...snapshotBase.completeness,
        fills_complete: false
      }
    });
    expect(headline.integrityLevel).toBe("low");
    expect(headline.attentionItems.map((item) => item.key)).toContain("stale");
    expect(headline.attentionItems.map((item) => item.key)).toContain("fills_capped");
  });




  it("prefers market params reference price when available", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      market_params: {
        source: "okx",
        symbol: "BTCUSDT",
        maker_fee_rate: 0.0002,
        taker_fee_rate: 0.0005,
        funding_rate_per_8h: 0,
        funding_interval_hours: 8,
        price_tick_size: 0.1,
        quantity_step_size: 0.001,
        min_notional: 1,
        reference_price: 68900,
        fetched_at: "2026-03-07T10:00:00+08:00",
        note: null
      },
      position: {
        ...snapshotBase.position,
        mark_price: 0,
        entry_price: 0,
        notional: 0
      },
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 78159.9,
        stop_loss_price: 73500
      }
    });
    expect(headline.liquidationDistancePct).toBeCloseTo(((78159.9 - 68900) / 68900) * 100, 4);
    expect(headline.stopDistancePct).toBeCloseTo(((73500 - 68900) / 68900) * 100, 4);
  });

  it("derives distances from notional and quantity when mark price is missing", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 78159.9,
        stop_loss_price: 73500
      },
      position: {
        ...snapshotBase.position,
        quantity: 0.25,
        entry_price: 0,
        mark_price: 0,
        notional: 17225
      },
      summary: {
        ...snapshotBase.summary,
        position_notional: 17225
      }
    });
    expect(headline.liquidationDistancePct).toBeCloseTo(((78159.9 - 68900) / 68900) * 100, 4);
    expect(headline.stopDistancePct).toBeCloseTo(((73500 - 68900) / 68900) * 100, 4);
  });

  it("falls back when mark or liquidation fields are zero placeholders", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 0,
        stop_loss_price: 71000
      },
      position: {
        ...snapshotBase.position,
        entry_price: 70000,
        mark_price: 0,
        liquidation_price: 72000
      }
    });
    expect(headline.liquidationDistancePct).toBeCloseTo(((72000 - 70000) / 70000) * 100, 6);
    expect(headline.stopDistancePct).toBeCloseTo(((71000 - 70000) / 70000) * 100, 6);
  });

  it("uses daily breakdown as pnl_24h fallback", () => {
    const headline = buildLiveMonitoringHeadline(snapshotBase);
    expect(headline.pnl24h).toBe(48);
    expect(headline.pnlSourceSummary).toContain("网格已实现 120.00 USDT");
  });
});

describe("live monitoring helpers", () => {
  it("builds readiness steps for pending and warning states", () => {
    const steps = buildLiveMonitoringReadiness({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategyStartedAt: null,
      credentialsReady: false,
      selectedRobotReady: false,
      selectedRobotMissing: true,
      robotListLoading: false,
      robotListError: null,
      monitoringActive: false,
      autoRefreshPaused: true,
      autoRefreshPausedReason: "API 限频"
    });

    expect(steps.map((step) => step.status)).toEqual(["pending", "pending", "warning"]);
    expect(steps[2]?.detail).toBe("当前对象已失效");
  });

  it("returns the highest priority attention item", () => {
    const headline = buildLiveMonitoringHeadline({
      ...snapshotBase,
      robot: {
        ...snapshotBase.robot,
        liquidation_price: 72800,
        stop_loss_price: 74000
      }
    });

    expect(buildPrimaryAttentionItem(headline.attentionItems)?.key).toBe("liquidation_risk");
  });

});

describe("robot selection helpers", () => {
  const items: LiveRobotListItem[] = [
    { algo_id: "3", name: "ETH recent", symbol: "ETHUSDT", exchange_symbol: "ETH-USDT-SWAP", state: "running", updated_at: "2026-03-07T09:00:00+08:00" },
    { algo_id: "2", name: "BTC stopped", symbol: "BTCUSDT", exchange_symbol: "BTC-USDT-SWAP", state: "stopped", updated_at: "2026-03-07T11:00:00+08:00" },
    { algo_id: "1", name: "BTC running", symbol: "BTC-USDT-SWAP", exchange_symbol: "BTC-USDT-SWAP", state: "running", updated_at: "2026-03-07T10:00:00+08:00" }
  ];

  it("sorts same-symbol running robots first", () => {
    const sorted = sortLiveRobotItems(items, "BTCUSDT");
    expect(sorted[0]?.algo_id).toBe("1");
  });

  it("finds same-symbol running match first", () => {
    expect(findPreferredLiveRobot(items, "BTCUSDT", { requireRunning: true })?.algo_id).toBe("1");
  });

  it("returns null when there is no same-symbol match", () => {
    expect(findPreferredLiveRobot(items, "SOLUSDT")?.algo_id ?? null).toBeNull();
  });
});
