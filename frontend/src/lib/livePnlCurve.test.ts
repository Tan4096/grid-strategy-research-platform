import { describe, expect, it } from "vitest";
import type { LiveSnapshotResponse } from "../lib/api-schema";
import { buildLivePnlCurve } from "./livePnlCurve";

const baseSnapshot: LiveSnapshotResponse = {
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
  ledger_entries: [],
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

describe("buildLivePnlCurve", () => {
  it("falls back to latest snapshot when replay history is unavailable", () => {
    const curve = buildLivePnlCurve(
      {
        ...baseSnapshot,
        ledger_entries: [
          {
            timestamp: "2026-03-02T09:00:00+08:00",
            kind: "trade",
            amount: 8,
            pnl: 8,
            fee: 0
          }
        ]
      },
      []
    );

    expect(curve.source).toBe("snapshot");
    expect(curve.points).toEqual([
      {
        timestamp: "2026-03-07T10:56:35.773+08:00",
        value: 10.9
      }
    ]);
    expect(curve.sourceSummary).toContain("最新快照");
  });

  it("prefers replayed pnl curve data when backend provides it", () => {
    const curve = buildLivePnlCurve(
      {
        ...baseSnapshot,
        pnl_curve: [
          { timestamp: "2026-03-01T00:00:00+08:00", value: 0 },
          { timestamp: "2026-03-04T00:00:00+08:00", value: 6.4 },
          { timestamp: "2026-03-06T00:00:00+08:00", value: 9.7 }
        ]
      },
      []
    );

    expect(curve.source).toBe("replay");
    expect(curve.points[1]?.value).toBe(6.4);
    expect(curve.points[curve.points.length - 1]?.value).toBe(10.9);
    expect(curve.sourceSummary).toContain("历史价格重建");
  });

  it("falls back to latest snapshot when trend only covers monitoring period", () => {
    const curve = buildLivePnlCurve(baseSnapshot, [
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
    ]);

    expect(curve.source).toBe("snapshot");
    expect(curve.points[0]?.timestamp).toBe("2026-03-07T10:56:35.773+08:00");
    expect(curve.points[curve.points.length - 1]?.value).toBe(10.9);
    expect(curve.sourceSummary).toContain("未覆盖策略启动以来的完整区间");
  });

  it("uses monitoring trend when it starts near strategy start", () => {
    const curve = buildLivePnlCurve(baseSnapshot, [
      {
        timestamp: "2026-03-01T00:10:00+08:00",
        total_pnl: 0.8,
        floating_profit: 0.2,
        funding_fee: 0,
        notional: 1000
      },
      {
        timestamp: "2026-03-07T09:00:00+08:00",
        total_pnl: 9.8,
        floating_profit: -1.6,
        funding_fee: 0.3,
        notional: 980
      }
    ]);

    expect(curve.source).toBe("trend");
    expect(curve.points[0]?.value).toBe(0.8);
    expect(curve.points[curve.points.length - 1]?.value).toBe(10.9);
  });

  it("surfaces kline failure diagnostics when replay curve is unavailable", () => {
    const curve = buildLivePnlCurve(
      {
        ...baseSnapshot,
        diagnostics: [
          {
            level: "warning",
            code: "pnl_curve_kline_unavailable",
            message: "OKX 历史价格 K 线加载失败，未生成回放收益曲线：loaded OKX dataframe is empty after time range filtering",
            action_hint: "retry_sync"
          }
        ]
      },
      [
        {
          timestamp: "2026-03-06T10:00:00+08:00",
          total_pnl: 6.2,
          floating_profit: -1.1,
          funding_fee: 0.2,
          notional: 950
        }
      ]
    );

    expect(curve.source).toBe("snapshot");
    expect(curve.sourceSummary).toContain("K 线加载失败");
  });

  it("prefers monitoring trend over incomplete ledger history", () => {
    const curve = buildLivePnlCurve(
      {
        ...baseSnapshot,
        account: {
          ...baseSnapshot.account,
          fetched_at: "2026-03-08T10:56:35.773+08:00"
        },
        window: {
          ...baseSnapshot.window,
          fetched_at: "2026-03-08T10:56:35.773+08:00"
        },
        robot: {
          ...baseSnapshot.robot,
          total_pnl: 231.28,
          floating_profit: -44.42
        },
        summary: {
          ...baseSnapshot.summary,
          total_pnl: 231.28,
          unrealized_pnl: -44.42
        },
        completeness: {
          ...baseSnapshot.completeness,
          fills_complete: false
        },
        diagnostics: [
          {
            level: "warning",
            code: "pnl_curve_fills_incomplete",
            message: "成交记录不完整，当前无法可靠按 OKX 历史价格 K 线回放全程收益曲线。",
            action_hint: "review_ledger"
          }
        ],
        ledger_entries: [
          {
            timestamp: "2026-03-08T10:29:00+08:00",
            kind: "trade",
            amount: 0.1,
            pnl: 0.1,
            fee: 0
          }
        ]
      },
      [
        {
          timestamp: "2026-03-08T10:20:00+08:00",
          total_pnl: 205,
          floating_profit: -38,
          funding_fee: 0.4,
          notional: 1000
        },
        {
          timestamp: "2026-03-08T10:30:00+08:00",
          total_pnl: 229,
          floating_profit: -43,
          funding_fee: 0.4,
          notional: 1000
        }
      ]
    );

    expect(curve.source).toBe("snapshot");
    expect(curve.sourceSummary).toContain("成交记录不完整");
    expect(curve.points[curve.points.length - 1]?.value).toBe(231.28);
  });

  it("falls back from implausible replay curve when return-rate range explodes", () => {
    const curve = buildLivePnlCurve(
      {
        ...baseSnapshot,
        robot: {
          ...baseSnapshot.robot,
          investment_usdt: 1000,
          total_pnl: 179.61
        },
        pnl_curve: [
          { timestamp: "2026-02-19T21:43:00+08:00", value: 0 },
          { timestamp: "2026-02-28T00:00:00+08:00", value: 17514.2 },
          { timestamp: "2026-03-04T00:00:00+08:00", value: -56315.1 }
        ]
      },
      [
        {
          timestamp: "2026-03-06T10:00:00+08:00",
          total_pnl: 120,
          floating_profit: -1.1,
          funding_fee: 0.2,
          notional: 950
        },
        {
          timestamp: "2026-03-07T09:00:00+08:00",
          total_pnl: 150,
          floating_profit: -1.6,
          funding_fee: 0.3,
          notional: 980
        }
      ]
    );

    expect(curve.source).toBe("snapshot");
    expect(curve.points[curve.points.length - 1]?.value).toBe(179.61);
  });
});
