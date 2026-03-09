import { describe, expect, it } from "vitest";

import type { Candle, EventLog } from "../../types";
import { buildTradeMarkerData } from "./chartUtils";

const candles: Candle[] = [
  {
    timestamp: "2026-03-01T00:00:00Z",
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1
  },
  {
    timestamp: "2026-03-01T01:00:00Z",
    open: 100,
    high: 102,
    low: 98,
    close: 101,
    volume: 1
  }
];

describe("buildTradeMarkerData", () => {
  it("aggregates base-position markers into a separate label", () => {
    const events: EventLog[] = [
      {
        timestamp: "2026-03-01T00:00:00Z",
        event_type: "open",
        price: 100,
        message: "grid=0, qty=1",
        payload: { grid_index: 0, as_base_position: true }
      },
      {
        timestamp: "2026-03-01T00:00:00Z",
        event_type: "open",
        price: 100,
        message: "grid=1, qty=1",
        payload: { grid_index: 1, as_base_position: true }
      },
      {
        timestamp: "2026-03-01T00:00:00Z",
        event_type: "open",
        price: 100,
        message: "grid=2, qty=1",
        payload: { grid_index: 2, as_base_position: true }
      },
      {
        timestamp: "2026-03-01T00:00:00Z",
        event_type: "open",
        price: 99.5,
        message: "grid=5, qty=1",
        payload: { grid_index: 5, as_base_position: false }
      },
      {
        timestamp: "2026-03-01T01:00:00Z",
        event_type: "close",
        price: 101,
        message: "grid=0, reason=grid_take_profit",
        payload: { grid_index: 0 }
      },
      {
        timestamp: "2026-03-01T01:00:00Z",
        event_type: "close",
        price: 101,
        message: "grid=1, reason=grid_take_profit",
        payload: { grid_index: 1 }
      }
    ];

    const result = buildTradeMarkerData(candles, events);

    expect(result.openMarkerData).toHaveLength(2);
    expect(result.openMarkerData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: [0, 99.5], gridIndex: 5 }),
        expect.objectContaining({ value: [0, 100], labelText: "底仓x3" })
      ])
    );

    expect(result.closeMarkerData).toEqual([expect.objectContaining({ value: [1, 101], labelText: "底仓x2" })]);
    expect(result.markerSummaryByCandle.get(0)).toEqual({ open: 4, close: 0 });
    expect(result.markerSummaryByCandle.get(1)).toEqual({ open: 0, close: 2 });
  });
});
