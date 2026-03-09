import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../test-utils/renderHook";

vi.mock("../lib/api", () => ({
  fetchLiveSnapshot: vi.fn().mockResolvedValue({
    account: {
      exchange: "okx",
      symbol: "BTCUSDT",
      exchange_symbol: "BTC-USDT-SWAP",
      algo_id: "123456",
      strategy_started_at: "2026-03-02T00:00:00+08:00",
      fetched_at: "2026-03-07T10:56:35.773+08:00",
      masked_api_key: "abc***89"
    },
    robot: {
      algo_id: "123456",
      name: "BTC Grid",
      state: "running",
      direction: "long",
      total_pnl: 1,
      floating_profit: 0.5,
      funding_fee: 0.1,
      investment_usdt: 1000,
      liquidation_price: 65000,
      stop_loss_price: 66000
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
    summary: {
      realized_pnl: 1,
      unrealized_pnl: 0.5,
      fees_paid: 0.1,
      funding_paid: 0,
      funding_net: 0.1,
      total_pnl: 1.4,
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
      unrealized_pnl: 0.5,
      realized_pnl: 1
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
      trading_net: 1.3,
      fees: 0.1,
      funding: 0.1,
      total_pnl: 1.4,
      realized: 1,
      unrealized: 0.5
    },
    market_params: null,
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
      side: "long",
      note: null
    },
    diagnostics: []
  }),
  getApiErrorInfo: () => ({ message: "请求失败" })
}));

import { fetchLiveSnapshot } from "../lib/api";
import { useLiveTradingSync } from "./useLiveTradingSync";

const baseDraft = {
  algo_id: "123456",
  profiles: {
    binance: { api_key: "", api_secret: "", passphrase: "" },
    bybit: { api_key: "", api_secret: "", passphrase: "" },
    okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-passphrase" }
  }
} as const;

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible"
  });
});

describe("useLiveTradingSync", () => {
  it("does not auto-sync before manual refresh", async () => {
    const hook = renderHook(() =>
      useLiveTradingSync({
        draft: baseDraft,
        exchange: "okx",
        symbol: "BTCUSDT",
        strategyStartedAt: "2026-03-02T00:00:00+08:00",
        active: true,
        ready: true,
        monitoringEnabled: false,
        pollIntervalSec: 15,
        monitoringScope: "running"
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchLiveSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await hook.value.refresh();
    });

    expect(fetchLiveSnapshot).toHaveBeenCalledTimes(1);
    expect(fetchLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ exchange: "okx", algo_id: "123456", symbol: "BTCUSDT" }),
      expect.any(Object)
    );
  });

  it("routes state notifications to center and event flow to transient toast", async () => {
    const fetchMock = vi.mocked(fetchLiveSnapshot);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-02T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "long",
          total_pnl: 1,
          floating_profit: 0.5,
          funding_fee: 0.1,
          investment_usdt: 1000,
          liquidation_price: 65000,
          stop_loss_price: 66000
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
        summary: {
          realized_pnl: 1,
          unrealized_pnl: 0.5,
          fees_paid: 0.1,
          funding_paid: 0,
          funding_net: 0.1,
          total_pnl: 1.4,
          position_notional: 1000,
          open_order_count: 1,
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
          unrealized_pnl: 0.5,
          realized_pnl: 1
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
          trading_net: 1.3,
          fees: 0.1,
          funding: 0.1,
          total_pnl: 1.4,
          realized: 1,
          unrealized: 0.5
        },
        market_params: null,
        open_orders: [
          {
            order_id: "ord-1",
            client_order_id: null,
            side: "buy",
            price: 69500,
            quantity: 0.1,
            filled_quantity: 0,
            reduce_only: false,
            status: "live",
            timestamp: "2026-03-07T10:56:00+08:00"
          }
        ],
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
          side: "long",
          note: null
        },
        diagnostics: []
      })
      .mockResolvedValueOnce({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-02T00:00:00+08:00",
          fetched_at: "2026-03-07T10:57:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "long",
          total_pnl: 5,
          floating_profit: 1,
          funding_fee: 0.1,
          investment_usdt: 1000,
          liquidation_price: 65000,
          stop_loss_price: 66000
        },
        monitoring: {
          poll_interval_sec: 15,
          last_success_at: "2026-03-07T10:57:35.773+08:00",
          freshness_sec: 0,
          stale: false,
          source_latency_ms: 120,
          fills_page_count: 1,
          fills_capped: false,
          orders_page_count: 1
        },
        summary: {
          realized_pnl: 5,
          unrealized_pnl: 1,
          fees_paid: 0.1,
          funding_paid: 0,
          funding_net: 0.1,
          total_pnl: 5.9,
          position_notional: 1000,
          open_order_count: 1,
          fill_count: 1
        },
        position: {
          side: "long",
          quantity: 1,
          entry_price: 70000,
          mark_price: 70120,
          notional: 1000,
          leverage: 5,
          liquidation_price: 65000,
          margin_mode: "isolated",
          unrealized_pnl: 1,
          realized_pnl: 5
        },
        window: {
          strategy_started_at: "2026-03-02T00:00:00+08:00",
          fetched_at: "2026-03-07T10:57:35.773+08:00",
          compared_end_at: "2026-03-07T10:57:00+08:00"
        },
        completeness: {
          fills_complete: true,
          funding_complete: true,
          bills_window_clipped: false,
          partial_failures: []
        },
        ledger_summary: {
          trading_net: 5.8,
          fees: 0.1,
          funding: 0.1,
          total_pnl: 5.9,
          realized: 5,
          unrealized: 1
        },
        market_params: null,
        open_orders: [
          {
            order_id: "ord-2",
            client_order_id: null,
            side: "sell",
            price: 70500,
            quantity: 0.1,
            filled_quantity: 0,
            reduce_only: false,
            status: "live",
            timestamp: "2026-03-07T10:57:00+08:00"
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
            timestamp: "2026-03-07T10:57:00+08:00"
          }
        ],
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
          side: "long",
          note: null
        },
        diagnostics: []
      });

    const notifyCenter = vi.fn();
    const showToast = vi.fn();
    const hook = renderHook(() =>
      useLiveTradingSync({
        draft: baseDraft,
        exchange: "okx",
        symbol: "BTCUSDT",
        strategyStartedAt: "2026-03-02T00:00:00+08:00",
        active: true,
        ready: true,
        monitoringEnabled: false,
        pollIntervalSec: 15,
        monitoringScope: "running",
        notifyCenter,
        showToast
      })
    );

    await act(async () => {
      await hook.value.refresh();
    });

    expect(notifyCenter).toHaveBeenCalledTimes(5);
    expect(notifyCenter.mock.calls.every(([item]) => item.dismiss === true)).toBe(true);
    expect(showToast).not.toHaveBeenCalled();

    await act(async () => {
      await hook.value.refresh();
    });

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "网格开仓", source: "live_trading" }));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "挂单新增", source: "live_trading" }));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "挂单减少", source: "live_trading" }));
    expect(notifyCenter).toHaveBeenCalledWith(expect.objectContaining({ id: "live-sync:fetch", dismiss: true }));
  });

  it("refreshes immediately when the tab becomes visible again", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetchLiveSnapshot);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      account: {
        exchange: "okx",
        symbol: "BTCUSDT",
        exchange_symbol: "BTC-USDT-SWAP",
        algo_id: "123456",
        strategy_started_at: "2026-03-02T00:00:00+08:00",
        fetched_at: "2026-03-07T10:56:35.773+08:00",
        masked_api_key: "abc***89"
      },
      robot: {
        algo_id: "123456",
        name: "BTC Grid",
        state: "running",
        direction: "long",
        total_pnl: 1,
        floating_profit: 0.5,
        funding_fee: 0.1,
        investment_usdt: 1000,
        liquidation_price: 65000,
        stop_loss_price: 66000
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
      summary: {
        realized_pnl: 1,
        unrealized_pnl: 0.5,
        fees_paid: 0.1,
        funding_paid: 0,
        funding_net: 0.1,
        total_pnl: 1.4,
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
        unrealized_pnl: 0.5,
        realized_pnl: 1
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
        trading_net: 1.3,
        fees: 0.1,
        funding: 0.1,
        total_pnl: 1.4,
        realized: 1,
        unrealized: 0.5
      },
      market_params: null,
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
        side: "long",
        note: null
      },
      diagnostics: []
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });

    renderHook(() =>
      useLiveTradingSync({
        draft: baseDraft,
        exchange: "okx",
        symbol: "BTCUSDT",
        strategyStartedAt: "2026-03-02T00:00:00+08:00",
        active: true,
        ready: true,
        monitoringEnabled: true,
        pollIntervalSec: 15,
        monitoringScope: "running"
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

});
