import { CurvePoint, EventLog, TradeEvent } from "../types";

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLegacyNumericField(message: string, field: string): number | null {
  for (const chunk of message.split(",")) {
    const [rawKey, rawValue] = chunk.split("=", 2);
    if (!rawKey || rawValue === undefined) {
      continue;
    }
    if (rawKey.trim().toLowerCase() !== field.toLowerCase()) {
      continue;
    }
    return toFiniteNumber(rawValue.trim());
  }
  return null;
}

function parseEventFee(event: EventLog): number {
  const fee = toFiniteNumber(event.payload?.fee_paid) ?? parseLegacyNumericField(event.message, "fee_paid");
  if (fee === null || !Number.isFinite(fee) || fee <= 0) {
    return 0;
  }
  return fee;
}

function parseOpenPositions(event: EventLog): number | null {
  const payloadValue = toFiniteNumber(event.payload?.open_positions);
  if (payloadValue !== null && payloadValue >= 0) {
    return payloadValue;
  }
  const fallback = parseLegacyNumericField(event.message, "open_positions");
  if (fallback === null || fallback < 0) {
    return null;
  }
  return fallback;
}

export function buildOpenPositionsCurve(events: EventLog[]): CurvePoint[] {
  return events
    .filter((event) => event.event_type === "snapshot")
    .map((event) => {
      const value = parseOpenPositions(event);
      if (value === null) {
        return null;
      }
      return {
        timestamp: event.timestamp,
        value: value + 1
      };
    })
    .filter((point): point is CurvePoint => point !== null);
}

function parseAverageEntry(event: EventLog): number | null {
  const payloadValue = toFiniteNumber(event.payload?.avg_entry);
  if (payloadValue !== null && payloadValue > 0) {
    return payloadValue;
  }
  const fallback = parseLegacyNumericField(event.message, "avg_entry");
  if (fallback === null || fallback <= 0) {
    return null;
  }
  return fallback;
}

export function buildAverageEntryCurve(events: EventLog[]): CurvePoint[] {
  return events
    .filter((event) => event.event_type === "snapshot")
    .map((event) => {
      const value = parseAverageEntry(event);
      if (value === null) {
        return null;
      }
      return {
        timestamp: event.timestamp,
        value
      };
    })
    .filter((point): point is CurvePoint => point !== null);
}

export function buildReturnRateCurve(equityCurve: CurvePoint[], initialMargin: number): CurvePoint[] {
  if (!Array.isArray(equityCurve) || equityCurve.length === 0 || !Number.isFinite(initialMargin) || initialMargin <= 0) {
    return [];
  }

  return equityCurve
    .map((point) => {
      const equity = toFiniteNumber(point.value);
      if (equity === null) {
        return null;
      }
      return {
        timestamp: point.timestamp,
        value: ((equity / initialMargin) - 1) * 100
      };
    })
    .filter((point): point is CurvePoint => point !== null);
}

function parseFundingCost(event: EventLog): number {
  const fundingStatementAmount =
    toFiniteNumber(event.payload?.funding_statement_amount) ?? parseLegacyNumericField(event.message, "funding_statement_amount");
  if (fundingStatementAmount !== null && Number.isFinite(fundingStatementAmount) && fundingStatementAmount !== 0) {
    return fundingStatementAmount;
  }
  const fundingNet = toFiniteNumber(event.payload?.funding_net) ?? parseLegacyNumericField(event.message, "funding_net");
  if (fundingNet !== null && Number.isFinite(fundingNet) && fundingNet !== 0) {
    return -fundingNet;
  }
  const fundingPnl =
    toFiniteNumber(event.payload?.funding_pnl) ?? parseLegacyNumericField(event.message, "funding_pnl");
  if (fundingPnl === null || !Number.isFinite(fundingPnl) || fundingPnl === 0) {
    return 0;
  }
  return fundingPnl < 0 ? Math.abs(fundingPnl) : -Math.abs(fundingPnl);
}

function parseFundingRate(event: EventLog): number | null {
  const rate = toFiniteNumber(event.payload?.rate) ?? parseLegacyNumericField(event.message, "rate");
  if (rate === null || !Number.isFinite(rate) || rate === 0) {
    return null;
  }
  return rate;
}

function inferGridSide(trades: TradeEvent[], events: EventLog[]): "long" | "short" | null {
  for (const trade of trades) {
    if (trade.side === "long" || trade.side === "short") {
      return trade.side;
    }
  }
  for (const event of events) {
    if (event.event_type !== "funding") {
      continue;
    }
    const fundingNet = toFiniteNumber(event.payload?.funding_net) ?? parseLegacyNumericField(event.message, "funding_net");
    const fundingPnl =
      toFiniteNumber(event.payload?.funding_pnl) ?? parseLegacyNumericField(event.message, "funding_pnl");
    const rate = parseFundingRate(event);
    if (fundingNet !== null && rate !== null && fundingNet !== 0) {
      return Math.sign(fundingNet) === -Math.sign(rate) ? "long" : "short";
    }
    if (fundingPnl === null || rate === null || fundingPnl === 0) {
      continue;
    }
    return Math.sign(fundingPnl) === -Math.sign(rate) ? "long" : "short";
  }
  return null;
}

function parseFundingCostBySide(event: EventLog, side: "long" | "short" | null): number {
  const fundingStatementAmount =
    toFiniteNumber(event.payload?.funding_statement_amount) ?? parseLegacyNumericField(event.message, "funding_statement_amount");
  if (fundingStatementAmount !== null && Number.isFinite(fundingStatementAmount) && fundingStatementAmount !== 0) {
    return fundingStatementAmount;
  }
  const fundingNet = toFiniteNumber(event.payload?.funding_net) ?? parseLegacyNumericField(event.message, "funding_net");
  if (fundingNet !== null && Number.isFinite(fundingNet) && fundingNet !== 0) {
    return -fundingNet;
  }
  const fundingPnl =
    toFiniteNumber(event.payload?.funding_pnl) ?? parseLegacyNumericField(event.message, "funding_pnl");
  if (fundingPnl === null || !Number.isFinite(fundingPnl) || fundingPnl === 0) {
    return 0;
  }
  const absFunding = Math.abs(fundingPnl);
  const rate = parseFundingRate(event);
  if (side && rate !== null) {
    if (side === "short") {
      return rate > 0 ? -absFunding : absFunding;
    }
    return rate < 0 ? -absFunding : absFunding;
  }
  return parseFundingCost(event);
}

function buildFeeTimeline(trades: TradeEvent[], events: EventLog[]): Array<{ timestamp: string; cost: number }> {
  const normalizedTrades = Array.isArray(trades) ? trades : [];
  const normalizedEvents = Array.isArray(events) ? events : [];
  const feeEvents = normalizedEvents.filter(
    (event) => (event.event_type === "open" || event.event_type === "close") && parseEventFee(event) > 0
  );
  const timeline: Array<{ timestamp: string; cost: number }> = [];

  if (feeEvents.length > 0) {
    for (const event of feeEvents) {
      timeline.push({
        timestamp: event.timestamp,
        cost: parseEventFee(event)
      });
    }
  } else {
    for (const trade of normalizedTrades) {
      const fee = toFiniteNumber(trade.fee_paid);
      if (fee === null || fee <= 0) {
        continue;
      }
      timeline.push({
        timestamp: trade.close_time || trade.open_time,
        cost: fee
      });
    }
  }

  return timeline;
}

function buildFundingTimeline(trades: TradeEvent[], events: EventLog[]): Array<{ timestamp: string; cost: number }> {
  const normalizedTrades = Array.isArray(trades) ? trades : [];
  const normalizedEvents = Array.isArray(events) ? events : [];
  const side = inferGridSide(normalizedTrades, normalizedEvents);
  const timeline: Array<{ timestamp: string; cost: number }> = [];

  for (const event of normalizedEvents) {
    if (event.event_type !== "funding") {
      continue;
    }
    const fundingCost = parseFundingCostBySide(event, side);
    if (fundingCost === 0) {
      continue;
    }
    timeline.push({
      timestamp: event.timestamp,
      cost: fundingCost
    });
  }

  return timeline;
}

function buildCumulativeCurve(timeline: Array<{ timestamp: string; cost: number }>): CurvePoint[] {
  if (!timeline.length) {
    return [];
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let cumulative = 0;
  return timeline.map((item) => {
    cumulative += item.cost;
    return {
      timestamp: item.timestamp,
      value: cumulative
    };
  });
}

export function buildCumulativeFeeCurve(trades: TradeEvent[], events: EventLog[] = []): CurvePoint[] {
  return buildCumulativeCurve(buildFeeTimeline(trades, events));
}

export function buildCumulativeFundingCurve(trades: TradeEvent[], events: EventLog[]): CurvePoint[] {
  return buildCumulativeCurve(buildFundingTimeline(trades, events));
}

export function buildCumulativeTradingCostCurve(trades: TradeEvent[], events: EventLog[]): CurvePoint[] {
  return buildCumulativeCurve([...buildFeeTimeline(trades, events), ...buildFundingTimeline(trades, events)]);
}
