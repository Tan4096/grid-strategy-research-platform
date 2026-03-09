import { describe, expect, it } from "vitest";

import type { TradeEvent } from "../lib/api-schema";
import {
  buildAverageEntryCurve,
  buildCumulativeFeeCurve,
  buildCumulativeFundingCurve,
  buildCumulativeTradingCostCurve,
  buildOpenPositionsCurve,
  buildReturnRateCurve
} from "./backtestCurveTransforms";

describe("backtestCurveTransforms", () => {
  it("prefers structured snapshot payload", () => {
    const events = [
      {
        timestamp: "2026-02-27T10:00:00Z",
        event_type: "snapshot",
        price: 50000,
        message: "legacy message",
        payload: {
          open_positions: 3,
          avg_entry: 49888.12
        }
      }
    ];

    const openPositions = buildOpenPositionsCurve(events);
    const avgEntry = buildAverageEntryCurve(events);

    expect(openPositions).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 4 }]);
    expect(avgEntry).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 49888.12 }]);
  });

  it("keeps backward compatibility with legacy message format", () => {
    const events = [
      {
        timestamp: "2026-02-27T10:00:00Z",
        event_type: "snapshot",
        price: 50000,
        message: "equity=1000.0, avg_entry=49777.7, open_positions=2"
      }
    ];

    const openPositions = buildOpenPositionsCurve(events);
    const avgEntry = buildAverageEntryCurve(events);

    expect(openPositions).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 3 }]);
    expect(avgEntry).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 49777.7 }]);
  });

  it("uses funding statement sign for short grid cost curve", () => {
    const trades: TradeEvent[] = [
      {
        open_time: "2026-02-27T10:00:00Z",
        close_time: "2026-02-27T10:10:00Z",
        side: "short",
        entry_price: 50000,
        exit_price: 49900,
        quantity: 0.01,
        gross_pnl: 1,
        net_pnl: 0.6,
        fee_paid: 3,
        holding_hours: 0.2,
        close_reason: "grid_take_profit" as const
      }
    ];
    const events = [
      {
        timestamp: "2026-02-27T10:20:00Z",
        event_type: "funding",
        price: 50010,
        message: "funding",
        payload: { funding_pnl: -2, funding_statement_amount: -2, funding_net: 2, rate: 0.0001 }
      },
      {
        timestamp: "2026-02-27T10:30:00Z",
        event_type: "funding",
        price: 50020,
        message: "funding",
        payload: { funding_pnl: 4, funding_statement_amount: 4, funding_net: -4, rate: -0.0002 }
      }
    ];

    const fundingCurve = buildCumulativeFundingCurve(trades, events);
    const curve = buildCumulativeTradingCostCurve(trades, events);
    expect(fundingCurve).toEqual([
      { timestamp: "2026-02-27T10:20:00Z", value: -2 },
      { timestamp: "2026-02-27T10:30:00Z", value: 2 }
    ]);
    expect(curve).toEqual([
      { timestamp: "2026-02-27T10:10:00Z", value: 3 },
      { timestamp: "2026-02-27T10:20:00Z", value: 1 },
      { timestamp: "2026-02-27T10:30:00Z", value: 5 }
    ]);
  });

  it("uses funding statement sign for long grid cost curve", () => {
    const trades: TradeEvent[] = [
      {
        open_time: "2026-02-27T10:00:00Z",
        close_time: "2026-02-27T10:10:00Z",
        side: "long",
        entry_price: 50000,
        exit_price: 50100,
        quantity: 0.01,
        gross_pnl: 1,
        net_pnl: 0.6,
        fee_paid: 3,
        holding_hours: 0.2,
        close_reason: "grid_take_profit" as const
      }
    ];
    const events = [
      {
        timestamp: "2026-02-27T10:20:00Z",
        event_type: "funding",
        price: 50010,
        message: "funding",
        payload: { funding_pnl: -2, funding_statement_amount: -2, funding_net: 2, rate: -0.0001 }
      },
      {
        timestamp: "2026-02-27T10:30:00Z",
        event_type: "funding",
        price: 50020,
        message: "funding",
        payload: { funding_pnl: 4, funding_statement_amount: 4, funding_net: -4, rate: 0.0002 }
      }
    ];

    const fundingCurve = buildCumulativeFundingCurve(trades, events);
    const curve = buildCumulativeTradingCostCurve(trades, events);
    expect(fundingCurve).toEqual([
      { timestamp: "2026-02-27T10:20:00Z", value: -2 },
      { timestamp: "2026-02-27T10:30:00Z", value: 2 }
    ]);
    expect(curve).toEqual([
      { timestamp: "2026-02-27T10:10:00Z", value: 3 },
      { timestamp: "2026-02-27T10:20:00Z", value: 1 },
      { timestamp: "2026-02-27T10:30:00Z", value: 5 }
    ]);
  });

  it("keeps backward compatibility with legacy funding event sign", () => {
    const trades: TradeEvent[] = [
      {
        open_time: "2026-02-27T10:00:00Z",
        close_time: "2026-02-27T10:10:00Z",
        side: "short",
        entry_price: 50000,
        exit_price: 49900,
        quantity: 0.01,
        gross_pnl: 1,
        net_pnl: 0.6,
        fee_paid: 3,
        holding_hours: 0.2,
        close_reason: "grid_take_profit" as const
      }
    ];
    const events = [
      {
        timestamp: "2026-02-27T10:20:00Z",
        event_type: "funding",
        price: 50010,
        message: "funding",
        payload: { funding_pnl: 2, rate: 0.0001 }
      },
      {
        timestamp: "2026-02-27T10:30:00Z",
        event_type: "funding",
        price: 50020,
        message: "funding",
        payload: { funding_pnl: -4, rate: -0.0002 }
      }
    ];

    const fundingCurve = buildCumulativeFundingCurve(trades, events);
    const curve = buildCumulativeTradingCostCurve(trades, events);
    expect(fundingCurve).toEqual([
      { timestamp: "2026-02-27T10:20:00Z", value: -2 },
      { timestamp: "2026-02-27T10:30:00Z", value: 2 }
    ]);
    expect(curve).toEqual([
      { timestamp: "2026-02-27T10:10:00Z", value: 3 },
      { timestamp: "2026-02-27T10:20:00Z", value: 1 },
      { timestamp: "2026-02-27T10:30:00Z", value: 5 }
    ]);
  });

  it("uses fee events to place entry and exit fees on correct timestamps", () => {
    const trades: TradeEvent[] = [
      {
        open_time: "2026-02-27T10:00:00Z",
        close_time: "2026-02-27T10:10:00Z",
        side: "short",
        entry_price: 50000,
        exit_price: 49900,
        quantity: 0.01,
        gross_pnl: 1,
        net_pnl: 0.6,
        fee_paid: 3,
        holding_hours: 0.2,
        close_reason: "grid_take_profit" as const
      }
    ];
    const events = [
      {
        timestamp: "2026-02-27T10:00:00Z",
        event_type: "open",
        price: 50000,
        message: "grid=0, qty=0.01000000",
        payload: { fee_paid: 1 }
      },
      {
        timestamp: "2026-02-27T10:10:00Z",
        event_type: "close",
        price: 49900,
        message: "grid=0, reason=grid_take_profit, net_pnl=0.6",
        payload: { fee_paid: 2 }
      },
      {
        timestamp: "2026-02-27T10:20:00Z",
        event_type: "funding",
        price: 50010,
        message: "funding",
        payload: { funding_pnl: -2, funding_statement_amount: -2, funding_net: 2, rate: 0.0001 }
      }
    ];

    const feeCurve = buildCumulativeFeeCurve(trades, events);
    const fundingCurve = buildCumulativeFundingCurve(trades, events);
    const curve = buildCumulativeTradingCostCurve(trades, events);
    expect(feeCurve).toEqual([
      { timestamp: "2026-02-27T10:00:00Z", value: 1 },
      { timestamp: "2026-02-27T10:10:00Z", value: 3 }
    ]);
    expect(fundingCurve).toEqual([{ timestamp: "2026-02-27T10:20:00Z", value: -2 }]);
    expect(curve).toEqual([
      { timestamp: "2026-02-27T10:00:00Z", value: 1 },
      { timestamp: "2026-02-27T10:10:00Z", value: 3 },
      { timestamp: "2026-02-27T10:20:00Z", value: 1 }
    ]);
  });

  it("keeps open-position entry fees even without closed trade records", () => {
    const trades: TradeEvent[] = [];
    const events = [
      {
        timestamp: "2026-02-27T10:00:00Z",
        event_type: "open",
        price: 50000,
        message: "grid=0, qty=0.01000000",
        payload: { fee_paid: 1.5 }
      }
    ];

    const feeCurve = buildCumulativeFeeCurve(trades, events);
    const curve = buildCumulativeTradingCostCurve(trades, events);
    expect(feeCurve).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 1.5 }]);
    expect(curve).toEqual([{ timestamp: "2026-02-27T10:00:00Z", value: 1.5 }]);
  });
});

it("converts equity curve to return-rate curve using initial margin", () => {
  const curve = buildReturnRateCurve(
    [
      { timestamp: "2026-02-27T10:00:00Z", value: 2000 },
      { timestamp: "2026-02-27T11:00:00Z", value: 2200 },
      { timestamp: "2026-02-27T12:00:00Z", value: 1900 }
    ],
    2000
  );

  expect(curve.map((point) => point.timestamp)).toEqual([
    "2026-02-27T10:00:00Z",
    "2026-02-27T11:00:00Z",
    "2026-02-27T12:00:00Z"
  ]);
  expect(curve[0]?.value).toBeCloseTo(0, 8);
  expect(curve[1]?.value).toBeCloseTo(10, 8);
  expect(curve[2]?.value).toBeCloseTo(-5, 8);
});
