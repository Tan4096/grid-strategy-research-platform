import { describe, expect, it } from "vitest";
import type { LiveSnapshotResponse } from "../types";

type SnapshotOverrides = {
  [Key in keyof LiveSnapshotResponse]?: LiveSnapshotResponse[Key] extends Array<infer Item>
    ? Item[]
    : LiveSnapshotResponse[Key] extends object
      ? Partial<LiveSnapshotResponse[Key]>
      : LiveSnapshotResponse[Key];
};
import { detectLiveMonitoringNotifications } from "./liveMonitoringNotifications";

function buildSnapshot(overrides: SnapshotOverrides = {}): LiveSnapshotResponse {
  return {
    account: {
      exchange: "okx",
      symbol: "BTCUSDT",
      exchange_symbol: "BTC-USDT-SWAP",
      algo_id: "123456",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      fetched_at: "2026-03-07T10:00:00+08:00",
      masked_api_key: "abc***89",
      ...(overrides.account ?? {})
    },
    robot: {
      algo_id: "123456",
      name: "BTC Grid",
      state: "running",
      direction: "long",
      algo_type: "contract_grid",
      run_type: "1",
      created_at: "2026-03-01T00:00:00+08:00",
      updated_at: "2026-03-07T10:00:00+08:00",
      investment_usdt: 1000,
      configured_leverage: 5,
      actual_leverage: 4.5,
      liquidation_price: 60000,
      grid_count: 8,
      lower_price: 68000,
      upper_price: 72000,
      grid_spacing: 500,
      grid_profit: 80,
      floating_profit: 10,
      total_fee: 1,
      funding_fee: 0.1,
      total_pnl: 90,
      pnl_ratio: 0.09,
      stop_loss_price: 60000,
      take_profit_price: 74000,
      use_base_position: true,
      ...(overrides.robot ?? {})
    },
    monitoring: {
      poll_interval_sec: 15,
      last_success_at: "2026-03-07T10:00:00+08:00",
      freshness_sec: 0,
      stale: false,
      source_latency_ms: 120,
      fills_page_count: 1,
      fills_capped: false,
      orders_page_count: 1,
      ...(overrides.monitoring ?? {})
    },
    market_params: null,
    summary: {
      realized_pnl: 80,
      unrealized_pnl: 10,
      fees_paid: 1,
      funding_paid: 0,
      funding_net: 0.1,
      total_pnl: 90,
      position_notional: 1000,
      open_order_count: 2,
      fill_count: 0,
      ...(overrides.summary ?? {})
    },
    window: {
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      fetched_at: "2026-03-07T10:00:00+08:00",
      compared_end_at: "2026-03-07T10:00:00+08:00",
      ...(overrides.window ?? {})
    },
    completeness: {
      fills_complete: true,
      funding_complete: true,
      bills_window_clipped: false,
      partial_failures: [],
      ...(overrides.completeness ?? {})
    },
    ledger_summary: {
      trading_net: 89,
      fees: 1,
      funding: 0.1,
      total_pnl: 90,
      realized: 80,
      unrealized: 10,
      ...(overrides.ledger_summary ?? {})
    },
    position: {
      side: "long",
      quantity: 1,
      entry_price: 70000,
      mark_price: 70000,
      notional: 1000,
      leverage: 5,
      liquidation_price: 60000,
      margin_mode: "isolated",
      unrealized_pnl: 10,
      realized_pnl: 80,
      ...(overrides.position ?? {})
    },
    open_orders: overrides.open_orders ?? [
      {
        order_id: "ord-1",
        client_order_id: null,
        side: "buy",
        price: 69500,
        quantity: 0.1,
        filled_quantity: 0,
        reduce_only: false,
        status: "live",
        timestamp: "2026-03-07T09:59:00+08:00"
      },
      {
        order_id: "ord-2",
        client_order_id: null,
        side: "sell",
        price: 70500,
        quantity: 0.1,
        filled_quantity: 0,
        reduce_only: false,
        status: "live",
        timestamp: "2026-03-07T09:59:10+08:00"
      }
    ],
    fills: overrides.fills ?? [],
    funding_entries: overrides.funding_entries ?? [],
    daily_breakdown: overrides.daily_breakdown ?? [],
    ledger_entries: overrides.ledger_entries ?? [],
    inferred_grid: {
      lower: 68000,
      upper: 72000,
      grid_count: 8,
      grid_spacing: 500,
      active_level_count: 2,
      active_levels: [69500, 70500],
      confidence: 0.9,
      use_base_position: true,
      side: "long",
      note: null,
      ...(overrides.inferred_grid ?? {})
    },
    diagnostics: overrides.diagnostics ?? []
  };
}

describe("detectLiveMonitoringNotifications", () => {
  it("emits fills and order changes as transient notifications", () => {
    const previous = buildSnapshot();
    const next = buildSnapshot({
      account: { fetched_at: "2026-03-07T10:01:00+08:00" },
      open_orders: [
        previous.open_orders[1],
        {
          order_id: "ord-3",
          client_order_id: null,
          side: "sell",
          price: 71000,
          quantity: 0.1,
          filled_quantity: 0,
          reduce_only: false,
          status: "live",
          timestamp: "2026-03-07T10:01:00+08:00"
        }
      ],
      fills: [
        {
          trade_id: "fill-1",
          order_id: "ord-1",
          side: "buy",
          price: 69500,
          quantity: 0.1,
          realized_pnl: 0,
          fee: 0.02,
          fee_currency: "USDT",
          is_maker: true,
          timestamp: "2026-03-07T10:01:00+08:00"
        }
      ]
    });

    const notifications = detectLiveMonitoringNotifications(previous, next);
    expect(notifications.map((item) => item.title)).toContain("网格开仓");
    expect(notifications.map((item) => item.title)).toContain("挂单新增");
    expect(notifications.map((item) => item.title)).toContain("挂单减少");
    expect(notifications.every((item) => item.title === "网格开仓" || item.title === "挂单新增" || item.title === "挂单减少" ? item.delivery === "toast" : true)).toBe(true);
  });

  it("keeps robot state in center and large pnl/notional shifts as toast", () => {
    const previous = buildSnapshot();
    const next = buildSnapshot({
      robot: {
        state: "stopped",
        total_pnl: 10,
        liquidation_price: 69600,
        stop_loss_price: 69750
      },
      summary: {
        total_pnl: 10,
        position_notional: 1800
      },
      position: {
        notional: 1800,
        liquidation_price: 69600,
        mark_price: 70000
      }
    });

    const notifications = detectLiveMonitoringNotifications(previous, next);
    expect(notifications.find((item) => item.title === "机器人状态变更")?.delivery).toBe("center");
    expect(notifications.find((item) => item.title === "机器人状态变更")?.kind).toBe("history");
    expect(notifications.find((item) => item.title === "机器人状态变更")?.detail.split(" · ")).toHaveLength(3);
    expect(notifications.find((item) => item.title === "敞口变动")?.delivery).toBe("toast");
    expect(notifications.find((item) => item.title === "收益回撤")?.delivery).toBe("toast");
    expect(notifications.find((item) => item.id === "live-sync:liquidation_risk")?.action).toBe("live_attention_liquidation_risk");
    expect(notifications.find((item) => item.id === "live-sync:stop_loss_risk")?.action).toBe("live_attention_stop_loss_risk");
  });

  it("surfaces only synced live attention states on first snapshot", () => {
    const next = buildSnapshot({
      monitoring: {
        stale: true,
        fills_capped: true,
        fills_page_count: 3
      },
      completeness: {
        fills_complete: false
      },
      diagnostics: [
        {
          level: "warning",
          code: "LIVE_BOT_ORDERS_UNAVAILABLE",
          message: "挂单抓取失败",
          action_hint: "review_ledger"
        }
      ]
    });

    const notifications = detectLiveMonitoringNotifications(null, next);
    expect(notifications.map((item) => item.title)).toContain("监测延迟");
    expect(notifications.map((item) => item.title)).toContain("挂单状态缺失");
    expect(notifications.map((item) => item.title)).not.toContain("成交窗口被截断");
    expect(notifications.find((item) => item.id === "live-sync:stale")?.kind).toBe("state");
    expect(notifications.find((item) => item.id === "live-sync:orders_unavailable")?.kind).toBe("state");
  });

  it("dismisses synced live risk notifications when conditions recover", () => {
    const previous = buildSnapshot({
      robot: {
        liquidation_price: 69600,
        stop_loss_price: 69750
      },
      position: {
        mark_price: 70000
      }
    });
    const next = buildSnapshot();

    const notifications = detectLiveMonitoringNotifications(previous, next);
    expect(notifications.find((item) => item.id === "live-sync:liquidation_risk")?.dismiss).toBe(true);
    expect(notifications.find((item) => item.id === "live-sync:stop_loss_risk")?.dismiss).toBe(true);
  });

  it("re-emits synced attention notifications while risk remains active", () => {
    const previous = buildSnapshot({
      robot: {
        liquidation_price: 69600,
        stop_loss_price: 69750
      },
      position: {
        mark_price: 70000
      }
    });
    const next = buildSnapshot({
      account: {
        fetched_at: "2026-03-07T10:01:00+08:00"
      },
      robot: {
        liquidation_price: 69600,
        stop_loss_price: 69750
      },
      position: {
        mark_price: 70000
      }
    });

    const notifications = detectLiveMonitoringNotifications(previous, next);
    expect(notifications.find((item) => item.id === "live-sync:liquidation_risk")?.title).toBe("强平风险升高");
    expect(notifications.find((item) => item.id === "live-sync:stop_loss_risk")?.title).toBe("止损触发临近");
    expect(notifications.find((item) => item.id === "live-sync:liquidation_risk")?.detail.split(" · ")).toHaveLength(3);
  });

  it("always emits dismiss events for inactive synced attention keys", () => {
    const previous = buildSnapshot();
    const next = buildSnapshot({
      account: {
        fetched_at: "2026-03-07T10:01:00+08:00"
      }
    });

    const notifications = detectLiveMonitoringNotifications(previous, next);
    expect(notifications.find((item) => item.id === "live-sync:stale")?.dismiss).toBe(true);
    expect(notifications.find((item) => item.id === "live-sync:orders_unavailable")?.dismiss).toBe(true);
    expect(notifications.find((item) => item.id === "live-sync:liquidation_risk")?.dismiss).toBe(true);
    expect(notifications.find((item) => item.id === "live-sync:stop_loss_risk")?.dismiss).toBe(true);
  });
});
