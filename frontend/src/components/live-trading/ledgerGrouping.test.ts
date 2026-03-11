import { describe, expect, it } from "vitest";
import type { LiveSnapshotResponse } from "../../lib/api-schema";
import { buildGridLedgerGroups } from "./ledgerGrouping";

const snapshot: LiveSnapshotResponse = {
  account: {
    exchange: "okx",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    algo_id: "algo-1",
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-11T10:00:00+08:00",
    masked_api_key: "***"
  },
  monitoring: {
    poll_interval_sec: 15,
    last_success_at: "2026-03-11T10:00:00+08:00",
    freshness_sec: 0,
    stale: false,
    source_latency_ms: 100,
    fills_page_count: 1,
    fills_capped: false,
    orders_page_count: 1
  },
  robot: {
    algo_id: "algo-1",
    name: "BTC Grid",
    state: "running",
    direction: "long",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-01T00:00:00+08:00",
    updated_at: "2026-03-11T10:00:00+08:00",
    investment_usdt: 1000,
    strategy_start_price: 101,
    configured_leverage: 5,
    actual_leverage: 5,
    liquidation_price: 65000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 72000,
    grid_spacing: 2,
    grid_profit: 0,
    floating_profit: 0,
    total_fee: 0.3,
    funding_fee: 0.2,
    total_pnl: 1.9,
    pnl_ratio: 0.01,
    stop_loss_price: 66000,
    take_profit_price: 73000,
    use_base_position: true
  },
  market_params: null,
  summary: {
    realized_pnl: 2,
    unrealized_pnl: -0.2,
    fees_paid: 0.3,
    funding_paid: 0,
    funding_net: 0.2,
    total_pnl: 1.9,
    position_notional: 100,
    open_order_count: 0,
    fill_count: 3
  },
  window: {
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-11T10:00:00+08:00",
    compared_end_at: "2026-03-11T10:00:00+08:00"
  },
  completeness: {
    fills_complete: true,
    funding_complete: true,
    bills_window_clipped: false,
    partial_failures: []
  },
  ledger_summary: {
    trading_net: 1.7,
    fees: 0.3,
    funding: 0.2,
    total_pnl: 1.9,
    realized: 2,
    unrealized: -0.2
  },
  position: {
    side: "long",
    quantity: 1,
    entry_price: 99,
    mark_price: 99,
    notional: 99,
    leverage: 5,
    liquidation_price: 70,
    margin_mode: "cross",
    unrealized_pnl: -0.2,
    realized_pnl: 2
  },
  open_orders: [
    {
      order_id: "close-order-open-2",
      side: "sell",
      price: 101,
      quantity: 1,
      filled_quantity: 0,
      reduce_only: false,
      status: "live",
      timestamp: "2026-03-10T12:30:00+08:00"
    }
  ],
  fills: [
    {
      trade_id: "open-1",
      order_id: "order-open-1",
      side: "buy",
      price: 100,
      quantity: 1,
      realized_pnl: 0,
      fee: 0.1,
      fee_currency: "USDT",
      is_maker: true,
      placed_at: "2026-03-10T09:55:00+08:00",
      timestamp: "2026-03-10T10:00:00+08:00"
    },
    {
      trade_id: "close-1",
      order_id: "order-close-1",
      side: "sell",
      price: 102,
      quantity: 1,
      realized_pnl: 2,
      fee: 0.1,
      fee_currency: "USDT",
      is_maker: true,
      placed_at: "2026-03-10T10:05:00+08:00",
      timestamp: "2026-03-10T11:00:00+08:00"
    },
    {
      trade_id: "open-2",
      order_id: "order-open-2",
      side: "buy",
      price: 99,
      quantity: 1,
      realized_pnl: 0,
      fee: 0.1,
      fee_currency: "USDT",
      is_maker: true,
      placed_at: "2026-03-10T11:55:00+08:00",
      timestamp: "2026-03-10T12:00:00+08:00"
    }
  ],
  funding_entries: [
    {
      timestamp: "2026-03-11T08:00:00+08:00",
      amount: 0.2,
      currency: "USDT"
    }
  ],
  pnl_curve: [],
  daily_breakdown: [],
  ledger_entries: [],
  inferred_grid: {
    lower: 68000,
    upper: 72000,
    grid_count: 8,
    grid_spacing: 2,
    active_level_count: 0,
    active_levels: [],
    confidence: 0.9,
    use_base_position: true,
    side: "long",
    note: null
  },
  diagnostics: []
};

describe("buildGridLedgerGroups", () => {
  it("splits fills into closed grids, open grids and funding rows", () => {
    const grouped = buildGridLedgerGroups(snapshot);

    expect(grouped.closedGroups).toHaveLength(1);
    expect(grouped.openGroups).toHaveLength(1);
    expect(grouped.fundingRows).toHaveLength(1);

    expect(grouped.closedGroups[0]?.openLeg.fill.trade_id).toBe("open-1");
    expect(grouped.closedGroups[0]?.closeLeg.fill.trade_id).toBe("close-1");
    expect(grouped.closedGroups[0]?.realizedPnl).toBeCloseTo(2);
    expect(grouped.closedGroups[0]?.feesPaid).toBeCloseTo(0.2);
    expect(grouped.closedGroups[0]?.netPnl).toBeCloseTo(1.8);

    expect(grouped.openGroups[0]?.openLeg.fill.trade_id).toBe("open-2");
    expect(grouped.openGroups[0]?.unrealizedPnl).toBeCloseTo(0);
    expect(grouped.openGroups[0]?.feesPaid).toBeCloseTo(0.1);
  });

  it("only matches profitable closes whose order was placed after the opening fill", () => {
    const mutated: LiveSnapshotResponse = {
      ...snapshot,
      fills: [
        snapshot.fills[0],
        {
          ...snapshot.fills[1],
          trade_id: "close-before-open-order",
          order_id: "order-close-before-open-order",
          price: 98,
          realized_pnl: -2,
          placed_at: "2026-03-10T09:00:00+08:00",
          timestamp: "2026-03-10T10:30:00+08:00"
        },
        snapshot.fills[1]
      ]
    };

    const grouped = buildGridLedgerGroups(mutated);

    expect(grouped.closedGroups).toHaveLength(1);
    expect(grouped.closedGroups[0]?.closeLeg.fill.trade_id).toBe("close-1");
    expect(grouped.openGroups).toHaveLength(0);
  });
});
