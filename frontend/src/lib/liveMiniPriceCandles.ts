import type { Candle } from "./api-schema";
import type { LiveMonitoringTrendPoint } from "../types";
import type { LivePosition } from "./api-schema";

interface BuildLiveMiniPriceCandlesOptions {
  fallbackPrice: number | null | undefined;
  positionSide?: LivePosition["side"] | null;
  positionQuantity?: number | null;
  entryPrice?: number | null;
  maxCandles?: number;
}

function asPositiveFiniteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function deriveTrendPrice(
  point: LiveMonitoringTrendPoint,
  options: BuildLiveMiniPriceCandlesOptions
): number | null {
  const directPrice = asPositiveFiniteNumber(point.mark_price);
  if (directPrice !== null) {
    return directPrice;
  }

  const entryPrice = asPositiveFiniteNumber(options.entryPrice);
  const quantity = asPositiveFiniteNumber(options.positionQuantity);
  const side = options.positionSide;
  if (entryPrice === null || quantity === null) {
    return null;
  }
  if (!Number.isFinite(point.floating_profit)) {
    return null;
  }

  if (side === "long") {
    return entryPrice + point.floating_profit / quantity;
  }
  if (side === "short") {
    return entryPrice - point.floating_profit / quantity;
  }
  return null;
}

export function buildLiveMiniPriceCandles(
  trend: LiveMonitoringTrendPoint[],
  options: BuildLiveMiniPriceCandlesOptions
): Candle[] {
  const pricedPoints = trend
    .map((item) => ({
      timestamp: item.timestamp,
      price: deriveTrendPrice(item, options)
    }))
    .filter((item): item is { timestamp: string; price: number } => item.price !== null);

  const resolvedFallbackPrice = asPositiveFiniteNumber(options.fallbackPrice);
  if (pricedPoints.length === 0) {
    if (resolvedFallbackPrice === null) {
      return [];
    }
    return [
      {
        timestamp: trend[trend.length - 1]?.timestamp ?? new Date().toISOString(),
        open: resolvedFallbackPrice,
        high: resolvedFallbackPrice,
        low: resolvedFallbackPrice,
        close: resolvedFallbackPrice,
        volume: 0
      }
    ];
  }

  const safeMaxCandles = Math.max(1, Math.floor(options.maxCandles ?? 24));
  const bucketCount = Math.min(safeMaxCandles, pricedPoints.length);
  const chunkSize = Math.max(1, Math.ceil(pricedPoints.length / bucketCount));
  const candles: Candle[] = [];

  for (let start = 0; start < pricedPoints.length; start += chunkSize) {
    const chunk = pricedPoints.slice(start, start + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const prices = chunk.map((item) => item.price);
    candles.push({
      timestamp: chunk[chunk.length - 1]?.timestamp ?? chunk[0].timestamp,
      open: chunk[0].price,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: chunk[chunk.length - 1]?.price ?? chunk[0].price,
      volume: 0
    });
  }

  if (candles.length > 0 && resolvedFallbackPrice !== null) {
    const latest = candles[candles.length - 1];
    if (latest) {
      latest.close = resolvedFallbackPrice;
      latest.high = Math.max(latest.high, resolvedFallbackPrice);
      latest.low = Math.min(latest.low, resolvedFallbackPrice);
    }
  }

  return candles;
}
