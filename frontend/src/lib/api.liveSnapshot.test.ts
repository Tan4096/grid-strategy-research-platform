import { describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      account: {
        exchange: "okx",
        symbol: "BTCUSDT",
        exchange_symbol: "BTC-USDT-SWAP",
        algo_id: "123456",
        strategy_started_at: "2026-03-01T00:00:00+08:00",
        fetched_at: "2026-03-07T10:56:35.773+08:00",
        masked_api_key: "abc***89"
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
        single_amount: "1.08",
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
        quantity_step_size: 0.0001,
        contract_size_base: "0.01",
        min_notional: 7,
        reference_price: 70000,
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
    }),
    headers: new Headers()
  })
);

import { fetchLiveSnapshot } from "./api";

describe("fetchLiveSnapshot", () => {
  it("normalizes legacy snapshot payloads", async () => {
    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.window.strategy_started_at).toBe("2026-03-01T00:00:00+08:00");
    expect(result.account.algo_id).toBe("123456");
    expect(result.robot.name).toBe("BTC Grid");
    expect(result.robot.actual_leverage).toBe(4.8);
    expect(result.robot.single_amount).toBe(1.08);
    expect(result.market_params?.contract_size_base).toBe(0.01);
    expect(result.completeness.fills_complete).toBe(true);
    expect(result.ledger_summary.total_pnl).toBe(2.7);
    expect(result.daily_breakdown).toEqual([]);
    expect(result.ledger_entries).toEqual([]);
  });

  it("parses numeric strings for liquidation and stop-loss fields", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-01T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "short",
          liquidationPrice: "65000",
          stopLossPrice: "66000"
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
          side: "short",
          quantity: "1",
          entry_price: "70000",
          mark_price: "70100",
          notional: "1000",
          leverage: "5",
          liquidation_price: null,
          margin_mode: "isolated",
          unrealized_pnl: "2",
          realized_pnl: "1"
        },
        open_orders: [],
        fills: [],
        funding_entries: [],
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
      }),
      headers: new Headers()
    });

    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.robot.liquidation_price).toBe(65000);
    expect(result.robot.stop_loss_price).toBe(66000);
    expect(result.position.mark_price).toBe(70100);
  });

  it("normalizes market reference price aliases", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-01T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
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
          referencePrice: "68900",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          note: null
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "short"
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
          side: "short",
          quantity: 1,
          entry_price: 70000,
          mark_price: 0,
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
      }),
      headers: new Headers()
    });

    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.market_params?.reference_price).toBe(68900);
  });

  it("rebuilds daily breakdown from ledger entries when ledger history is available", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-01T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "short"
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
          fill_count: 3
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
          unrealized_pnl: 2,
          realized_pnl: 1
        },
        open_orders: [],
        fills: [],
        funding_entries: [],
        daily_breakdown: [
          {
            date: "2026-03-07",
            realized_pnl: 0,
            fees_paid: 99,
            funding_net: 0,
            trading_net: -99,
            total_pnl: -99,
            entry_count: 1
          }
        ],
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
            timestamp: "2026-03-07T09:30:00+08:00",
            kind: "fee",
            amount: -1.2,
            pnl: 0,
            fee: 1.2,
            side: "sell",
            trade_id: "trade-1",
            note: "taker fee"
          },
          {
            timestamp: "2026-03-07T08:00:00+08:00",
            kind: "funding",
            amount: 0.4,
            pnl: 0,
            fee: 0,
            currency: "USDT",
            note: "funding income"
          }
        ],
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
      }),
      headers: new Headers()
    });

    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.daily_breakdown).toEqual([
      {
        date: "2026-03-07",
        realized_pnl: 8,
        fees_paid: 1.2,
        funding_net: 0.4,
        trading_net: 6.8,
        total_pnl: 7.2,
        entry_count: 3
      }
    ]);
  });

  it("maps realized_pnl aliases from ledger trade rows into realized pnl", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-01T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "short"
        },
        summary: {
          realized_pnl: 5,
          unrealized_pnl: 0,
          fees_paid: 0,
          funding_paid: 0,
          funding_net: 0,
          total_pnl: 5,
          position_notional: 1000,
          open_order_count: 0,
          fill_count: 1
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
          unrealized_pnl: 0,
          realized_pnl: 5
        },
        open_orders: [],
        fills: [],
        funding_entries: [],
        daily_breakdown: [],
        ledger_entries: [
          {
            timestamp: "2026-03-07T09:30:00+08:00",
            kind: "trade",
            realized_pnl: 5,
            side: "sell",
            trade_id: "trade-2",
            note: "trade realized pnl only"
          }
        ],
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
      }),
      headers: new Headers()
    });

    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.ledger_entries[0]?.pnl).toBe(5);
    expect(result.ledger_entries[0]?.amount).toBe(5);
    expect(result.daily_breakdown[0]?.realized_pnl).toBe(5);
    expect(result.daily_breakdown[0]?.trading_net).toBe(5);
  });

  it("merges fills into daily breakdown when raw ledger entries miss realized trades", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        account: {
          exchange: "okx",
          symbol: "BTCUSDT",
          exchange_symbol: "BTC-USDT-SWAP",
          algo_id: "123456",
          strategy_started_at: "2026-03-01T00:00:00+08:00",
          fetched_at: "2026-03-07T10:56:35.773+08:00",
          masked_api_key: "abc***89"
        },
        robot: {
          algo_id: "123456",
          name: "BTC Grid",
          state: "running",
          direction: "short"
        },
        summary: {
          realized_pnl: 8,
          unrealized_pnl: 0,
          fees_paid: 1.2,
          funding_paid: 0,
          funding_net: 0.4,
          total_pnl: 7.2,
          position_notional: 1000,
          open_order_count: 0,
          fill_count: 1
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
          unrealized_pnl: 0,
          realized_pnl: 8
        },
        open_orders: [],
        fills: [
          {
            timestamp: "2026-03-07T09:30:00+08:00",
            trade_id: "trade-3",
            order_id: "order-3",
            side: "sell",
            price: 70100,
            quantity: 0.01,
            realized_pnl: 8,
            fee: 1.2,
            fee_currency: "USDT",
            is_maker: false
          }
        ],
        funding_entries: [
          {
            timestamp: "2026-03-07T08:00:00+08:00",
            amount: 0.4,
            currency: "USDT"
          }
        ],
        daily_breakdown: [
          {
            date: "2026-03-07",
            realized_pnl: 0,
            fees_paid: 1.2,
            funding_net: 0.4,
            trading_net: -1.2,
            total_pnl: -0.8,
            entry_count: 2
          }
        ],
        ledger_entries: [
          {
            timestamp: "2026-03-07T08:00:00+08:00",
            kind: "funding",
            amount: 0.4,
            pnl: 0,
            fee: 0,
            currency: "USDT",
            note: "funding income"
          }
        ],
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
      }),
      headers: new Headers()
    });

    const result = await fetchLiveSnapshot({
      exchange: "okx",
      symbol: "BTCUSDT",
      strategy_started_at: "2026-03-01T00:00:00+08:00",
      algo_id: "123456",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.ledger_entries.filter((item) => item.kind === "trade")).toHaveLength(1);
    expect(result.ledger_entries.filter((item) => item.kind === "fee")).toHaveLength(1);
    expect(result.daily_breakdown).toEqual([
      {
        date: "2026-03-07",
        realized_pnl: 8,
        fees_paid: 1.2,
        funding_net: 0.4,
        trading_net: 6.8,
        total_pnl: 7.2,
        entry_count: 3
      }
    ]);
  });
});
