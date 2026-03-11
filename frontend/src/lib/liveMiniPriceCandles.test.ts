import { describe, expect, it } from "vitest";
import type { LiveMonitoringTrendPoint } from "../types";
import { buildLiveMiniPriceCandles } from "./liveMiniPriceCandles";

describe("buildLiveMiniPriceCandles", () => {
  it("chunks mark price snapshots into compact candles", () => {
    const trend: LiveMonitoringTrendPoint[] = [
      { timestamp: "2026-03-10T10:00:00+08:00", total_pnl: 0, floating_profit: 0, funding_fee: 0, notional: 0, mark_price: 100 },
      { timestamp: "2026-03-10T10:01:00+08:00", total_pnl: 0, floating_profit: 0, funding_fee: 0, notional: 0, mark_price: 110 },
      { timestamp: "2026-03-10T10:02:00+08:00", total_pnl: 0, floating_profit: 0, funding_fee: 0, notional: 0, mark_price: 105 },
      { timestamp: "2026-03-10T10:03:00+08:00", total_pnl: 0, floating_profit: 0, funding_fee: 0, notional: 0, mark_price: 120 },
      { timestamp: "2026-03-10T10:04:00+08:00", total_pnl: 0, floating_profit: 0, funding_fee: 0, notional: 0, mark_price: 115 }
    ];

    const candles = buildLiveMiniPriceCandles(trend, {
      fallbackPrice: 118,
      maxCandles: 2
    });

    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 100, close: 105 });
    expect(candles[1]).toMatchObject({ open: 120, high: 120, low: 115, close: 118 });
  });

  it("reconstructs price candles from floating profit when mark price is missing", () => {
    const trend: LiveMonitoringTrendPoint[] = [
      { timestamp: "2026-03-10T10:00:00+08:00", total_pnl: 0, floating_profit: -100, funding_fee: 0, notional: 0 },
      { timestamp: "2026-03-10T10:01:00+08:00", total_pnl: 0, floating_profit: -60, funding_fee: 0, notional: 0 },
      { timestamp: "2026-03-10T10:02:00+08:00", total_pnl: 0, floating_profit: -80, funding_fee: 0, notional: 0 }
    ];

    const candles = buildLiveMiniPriceCandles(trend, {
      fallbackPrice: 70090,
      positionSide: "short",
      positionQuantity: 1,
      entryPrice: 70000,
      maxCandles: 3
    });

    expect(candles[0]).toMatchObject({ open: 70100, high: 70100, low: 70100 });
    expect(candles[1]).toMatchObject({ open: 70060, high: 70060, low: 70060 });
    expect(candles[2]).toMatchObject({ open: 70080, close: 70090 });
  });

  it("falls back to a single price candle when trend history is empty", () => {
    const candles = buildLiveMiniPriceCandles([], {
      fallbackPrice: 70123.45,
      maxCandles: 12
    });

    expect(candles).toEqual([
      {
        timestamp: expect.any(String),
        open: 70123.45,
        high: 70123.45,
        low: 70123.45,
        close: 70123.45,
        volume: 0
      }
    ]);
  });
});
