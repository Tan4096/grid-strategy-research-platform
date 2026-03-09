import type { Candle, EventLog } from "../../lib/api-schema";

export interface TradeMarkerPoint {
  value: [number, number];
  gridIndex?: number;
  labelText?: string;
}

export interface MarkerSummary {
  open: number;
  close: number;
}

export interface MarkerBuildResult {
  openMarkerData: TradeMarkerPoint[];
  closeMarkerData: TradeMarkerPoint[];
  markerSummaryByCandle: Map<number, MarkerSummary>;
}

export const CHART_GRID_TOP = 52;
export const CHART_GRID_BOTTOM = 100;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateAlignedBodyWidth(categoryWidth: number, dpr: number, minCssWidth: number): number {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const cssMin = clamp(Math.floor(minCssWidth), 1, 64);
  const cssMax = 64;
  const widthRatio = categoryWidth >= 24 ? 0.92 : categoryWidth >= 12 ? 0.84 : 0.7;
  let cssWidth = Math.floor(categoryWidth * widthRatio);
  cssWidth = clamp(cssWidth, cssMin, cssMax);
  if (cssWidth > cssMin && cssWidth % 2 === 0) {
    cssWidth -= 1;
  }
  const pxWidth = Math.max(1, Math.round(cssWidth * safeDpr));
  return Number((pxWidth / safeDpr).toFixed(4));
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function parseOhlc(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const nums = raw.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (nums.length < 4) {
    return null;
  }
  const base = nums.length >= 5 ? nums.slice(nums.length - 4) : nums.slice(0, 4);
  const [open, close, low, high] = base;
  return [open, close, low, high];
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0分钟";
  }
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}天`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}小时`);
  }
  parts.push(`${minutes}分钟`);
  return parts.join(" ");
}

export function formatDurationCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0分";
  }
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  if (days > 0) {
    return `${days}天${hours}小时`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  return `${totalMinutes}分`;
}

export function formatChartTimeShort(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function formatChartTimeFull(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString();
}

export function extractGridIndex(event: EventLog): number | null {
  const payloadRaw = event.payload?.grid_index;
  const payloadParsed = Number(payloadRaw);
  if (Number.isFinite(payloadParsed)) {
    return payloadParsed;
  }

  for (const chunk of event.message.split(",")) {
    const [rawKey, rawValue] = chunk.split("=", 2);
    if (!rawKey || rawValue === undefined) {
      continue;
    }
    if (rawKey.trim().toLowerCase() !== "grid") {
      continue;
    }
    const parsed = Number(rawValue.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatBaseLabel(count: number): string {
  return count > 1 ? `底仓x${count}` : "底仓";
}

function pushBaseMarker(
  groupedMarkers: Map<string, { point: TradeMarkerPoint; count: number }>,
  idx: number,
  price: number
): void {
  const key = `${idx}:${price.toFixed(8)}`;
  const existing = groupedMarkers.get(key);
  if (existing) {
    existing.count += 1;
    existing.point.labelText = formatBaseLabel(existing.count);
    return;
  }
  groupedMarkers.set(key, {
    point: {
      value: [idx, price],
      labelText: formatBaseLabel(1)
    },
    count: 1
  });
}

export function buildTradeMarkerData(candles: Candle[], events: EventLog[]): MarkerBuildResult {
  const openPoints: TradeMarkerPoint[] = [];
  const closePoints: TradeMarkerPoint[] = [];
  const baseOpenGrouped = new Map<string, { point: TradeMarkerPoint; count: number }>();
  const baseCloseGrouped = new Map<string, { point: TradeMarkerPoint; count: number }>();
  const summary = new Map<number, MarkerSummary>();
  const activeBaseGridIndexes = new Set<number>();

  const timestampToIndex = new Map<number, number>();
  candles.forEach((candle, idx) => {
    const ts = new Date(candle.timestamp).getTime();
    if (Number.isFinite(ts) && !timestampToIndex.has(ts)) {
      timestampToIndex.set(ts, idx);
    }
  });

  const bump = (idx: number, key: keyof MarkerSummary) => {
    const prev = summary.get(idx) ?? { open: 0, close: 0 };
    prev[key] += 1;
    summary.set(idx, prev);
  };

  events.forEach((event) => {
    const ts = new Date(event.timestamp).getTime();
    const idx = timestampToIndex.get(ts);
    const price = Number(event.price);
    const gridIndex = extractGridIndex(event);
    if (idx === undefined || !Number.isFinite(price)) {
      return;
    }

    if (event.event_type === "open") {
      const isBasePosition = Boolean(event.payload?.as_base_position);
      if (isBasePosition) {
        if (gridIndex !== null) {
          activeBaseGridIndexes.add(gridIndex);
        }
        pushBaseMarker(baseOpenGrouped, idx, price);
      } else {
        openPoints.push({ value: [idx, price], gridIndex: gridIndex ?? undefined });
      }
      bump(idx, "open");
      return;
    }

    if (event.event_type === "close") {
      const isBasePosition = gridIndex !== null && activeBaseGridIndexes.has(gridIndex);
      if (isBasePosition) {
        activeBaseGridIndexes.delete(gridIndex);
        pushBaseMarker(baseCloseGrouped, idx, price);
      } else {
        closePoints.push({ value: [idx, price], gridIndex: gridIndex ?? undefined });
      }
      bump(idx, "close");
    }
  });

  return {
    openMarkerData: [...openPoints, ...Array.from(baseOpenGrouped.values(), (entry) => entry.point)],
    closeMarkerData: [...closePoints, ...Array.from(baseCloseGrouped.values(), (entry) => entry.point)],
    markerSummaryByCandle: summary
  };
}

function parseRgbTuple(value: string): [number, number, number] | null {
  const parts = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  if (parts.length !== 3) {
    return null;
  }
  return [parts[0], parts[1], parts[2]];
}

export function rgba(tuple: [number, number, number], alpha: number): string {
  return `rgba(${tuple[0]},${tuple[1]},${tuple[2]},${alpha})`;
}

export function resolveChartPalette() {
  const defaultAccent: [number, number, number] = [34, 211, 238];
  if (typeof window === "undefined") {
    return {
      isLight: false,
      accent: defaultAccent
    };
  }

  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const accent = parseRgbTuple(styles.getPropertyValue("--accent-rgb")) ?? defaultAccent;
  const isLight = root.classList.contains("theme-light");
  return {
    isLight,
    accent
  };
}
