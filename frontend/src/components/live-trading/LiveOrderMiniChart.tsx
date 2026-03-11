import { useMemo, useState } from "react";
import type { LiveMonitoringTrendPoint } from "../../types";
import type { Candle, LivePosition } from "../../lib/api-schema";
import { buildLiveMiniPriceCandles } from "../../lib/liveMiniPriceCandles";
import { fmt } from "./shared";

interface Props {
  trend: LiveMonitoringTrendPoint[];
  currentPrice: number | null;
  backtestCandles?: Candle[];
  positionSide: LivePosition["side"];
  positionQuantity: number | null;
  entryPrice: number | null;
  buyLevels: number[];
  sellLevels: number[];
  fallbackLevels: number[];
}

interface DisplayCandle extends Candle {
  startTimestamp: string;
  endTimestamp: string;
}

const SVG_WIDTH = 960;
const SVG_HEIGHT = 176;
const PADDING = {
  top: 10,
  right: 92,
  bottom: 10,
  left: 126
};
const AXIS_X = 42;

function asPositiveFiniteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveMiniChartTheme() {
  if (typeof document === "undefined") {
    return {
      text: "#cbd5e1",
      minorText: "#94a3b8",
      grid: "rgba(148,163,184,0.14)",
      axis: "rgba(100,116,139,0.5)",
      candleWick: "rgba(226,232,240,0.95)",
      candleUp: "rgba(248,250,252,0.98)",
      candleDown: "rgba(148,163,184,0.55)",
      candleStroke: "rgba(148,163,184,0.95)",
      tooltipBg: "rgba(2,6,23,0.94)",
      tooltipBorder: "rgba(71,85,105,0.9)",
      tooltipText: "#e2e8f0",
      currentLine: "#f59e0b",
      currentChipBg: "rgba(245,158,11,0.18)",
      currentChipBorder: "rgba(245,158,11,0.6)",
      currentChipText: "#fbbf24",
      fallbackLine: "rgba(148,163,184,0.55)"
    };
  }
  const isLight = document.documentElement.classList.contains("theme-light");
  return isLight
    ? {
        text: "#0f172a",
        minorText: "#475569",
        grid: "rgba(148,163,184,0.18)",
        axis: "rgba(100,116,139,0.55)",
        candleWick: "rgba(15,23,42,0.95)",
        candleUp: "rgba(15,23,42,0.98)",
        candleDown: "rgba(203,213,225,0.88)",
        candleStroke: "rgba(71,85,105,0.95)",
        tooltipBg: "rgba(255,255,255,0.98)",
        tooltipBorder: "rgba(148,163,184,0.8)",
        tooltipText: "#0f172a",
        currentLine: "#d97706",
        currentChipBg: "rgba(245,158,11,0.16)",
        currentChipBorder: "rgba(217,119,6,0.55)",
        currentChipText: "#b45309",
        fallbackLine: "rgba(100,116,139,0.52)"
      }
    : {
        text: "#cbd5e1",
        minorText: "#94a3b8",
        grid: "rgba(148,163,184,0.14)",
        axis: "rgba(100,116,139,0.5)",
        candleWick: "rgba(226,232,240,0.95)",
        candleUp: "rgba(248,250,252,0.98)",
        candleDown: "rgba(148,163,184,0.55)",
        candleStroke: "rgba(148,163,184,0.95)",
        tooltipBg: "rgba(2,6,23,0.94)",
        tooltipBorder: "rgba(71,85,105,0.9)",
        tooltipText: "#e2e8f0",
        currentLine: "#f59e0b",
        currentChipBg: "rgba(245,158,11,0.18)",
        currentChipBorder: "rgba(245,158,11,0.6)",
        currentChipText: "#fbbf24",
        fallbackLine: "rgba(148,163,184,0.55)"
      };
}

function buildLevelLabels(
  entries: Array<{ price: number; tone: "buy" | "sell" | "neutral"; y: number }>,
  top: number,
  bottom: number
): Array<{ price: number; tone: "buy" | "sell" | "neutral"; y: number }> {
  const sorted = [...entries].sort((left, right) => left.y - right.y);
  const minGap = 14;
  const adjusted: Array<{ price: number; tone: "buy" | "sell" | "neutral"; y: number }> = [];

  sorted.forEach((item, index) => {
    const previous = adjusted[index - 1];
    const nextY = previous ? Math.max(item.y, previous.y + minGap) : item.y;
    adjusted.push({ ...item, y: nextY });
  });

  for (let index = adjusted.length - 1; index >= 0; index -= 1) {
    const item = adjusted[index];
    if (!item) {
      continue;
    }
    if (index === adjusted.length - 1) {
      item.y = Math.min(item.y, bottom);
      continue;
    }
    const next = adjusted[index + 1];
    item.y = Math.min(item.y, next.y - minGap);
  }

  adjusted.forEach((item) => {
    item.y = clamp(item.y, top, bottom);
  });

  return adjusted;
}

function pickNearestLevel(levels: number[], referencePrice: number | null): number | null {
  if (levels.length === 0 || referencePrice === null || !Number.isFinite(referencePrice)) {
    return null;
  }
  let nearest = levels[0] ?? null;
  let bestDistance = Number.POSITIVE_INFINITY;
  levels.forEach((level) => {
    const distance = Math.abs(level - referencePrice);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = level;
    }
  });
  return nearest;
}

function compactBacktestCandles(candles: Candle[], maxCandles = 72): DisplayCandle[] {
  if (candles.length <= maxCandles) {
    return candles.map((item) => ({
      ...item,
      startTimestamp: item.timestamp,
      endTimestamp: item.timestamp
    }));
  }
  const chunkSize = Math.max(1, Math.ceil(candles.length / maxCandles));
  const compacted: DisplayCandle[] = [];
  for (let start = 0; start < candles.length; start += chunkSize) {
    const chunk = candles.slice(start, start + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const middle = chunk[Math.floor(chunk.length / 2)] ?? chunk[chunk.length - 1] ?? chunk[0];
    compacted.push({
      timestamp: middle.timestamp,
      startTimestamp: chunk[0].timestamp,
      endTimestamp: chunk[chunk.length - 1]?.timestamp ?? chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map((item) => item.high)),
      low: Math.min(...chunk.map((item) => item.low)),
      close: chunk[chunk.length - 1]?.close ?? chunk[0].close,
      volume: chunk.reduce((sum, item) => sum + (Number.isFinite(item.volume) ? item.volume : 0), 0)
    });
  }
  return compacted;
}

function toDisplayCandles(candles: Candle[]): DisplayCandle[] {
  return candles.map((item) => ({
    ...item,
    startTimestamp: item.timestamp,
    endTimestamp: item.timestamp
  }));
}

function formatTooltipTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function formatTooltipTime(candle: DisplayCandle): { firstLine: string; secondLine: string | null } {
  const start = `起：${formatTooltipTimestamp(candle.startTimestamp)}`;
  if (candle.startTimestamp === candle.endTimestamp) {
    return { firstLine: start, secondLine: null };
  }
  return {
    firstLine: start,
    secondLine: `止：${formatTooltipTimestamp(candle.endTimestamp)}`
  };
}

export default function LiveOrderMiniChart({
  trend,
  currentPrice,
  backtestCandles = [],
  positionSide,
  positionQuantity,
  entryPrice,
  buyLevels,
  sellLevels,
  fallbackLevels
}: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const theme = resolveMiniChartTheme();
  const resolvedCurrentPrice = asPositiveFiniteNumber(currentPrice);
  const candles = useMemo<DisplayCandle[]>(() => {
    if (Array.isArray(backtestCandles) && backtestCandles.length > 0) {
      return compactBacktestCandles(backtestCandles, 72);
    }
    return toDisplayCandles(
      buildLiveMiniPriceCandles(trend, {
        fallbackPrice: resolvedCurrentPrice,
        positionSide,
        positionQuantity,
        entryPrice,
        maxCandles: 48
      })
    );
  }, [backtestCandles, entryPrice, positionQuantity, positionSide, resolvedCurrentPrice, trend]);
  const neutralLevels = useMemo(
    () => (buyLevels.length === 0 && sellLevels.length === 0 ? fallbackLevels : []),
    [buyLevels, fallbackLevels, sellLevels]
  );

  const geometry = useMemo(() => {
    const pricePool = [
      ...candles.flatMap((item) => [item.high, item.low]),
      ...buyLevels,
      ...sellLevels,
      ...neutralLevels,
      ...(resolvedCurrentPrice !== null ? [resolvedCurrentPrice] : [])
    ].filter((item) => Number.isFinite(item) && item > 0);

    if (pricePool.length === 0) {
      return null;
    }

    const rawMin = Math.min(...pricePool);
    const rawMax = Math.max(...pricePool);
    const span = rawMax - rawMin;
    const reference = Math.max(Math.abs(rawMin), Math.abs(rawMax), 1);
    const padding = span > 0 ? Math.max(span * 0.14, reference * 0.0015, 12) : Math.max(reference * 0.0035, 16);
    const minPrice = Math.max(0, rawMin - padding);
    const maxPrice = rawMax + padding;
    const chartLeft = PADDING.left;
    const chartRight = SVG_WIDTH - PADDING.right;
    const chartTop = PADDING.top;
    const chartBottom = SVG_HEIGHT - PADDING.bottom;
    const chartWidth = chartRight - chartLeft;
    const chartHeight = chartBottom - chartTop;

    const priceToY = (price: number): number => {
      if (maxPrice - minPrice <= 1e-9) {
        return chartTop + chartHeight / 2;
      }
      const ratio = (price - minPrice) / (maxPrice - minPrice);
      return chartBottom - ratio * chartHeight;
    };

    const slotWidth = chartWidth / Math.max(candles.length, 1);
    const candleBodyWidth = clamp(slotWidth * 0.56, 8, 16);
    const candleCenters = candles.map((_, index) => chartLeft + slotWidth * (index + 0.5));

    const axisTicks = Array.from({ length: 5 }).map((_, index) => {
      const ratio = index / 4;
      const value = rawMax - ratio * (rawMax - rawMin);
      return {
        value,
        y: priceToY(value)
      };
    });

    const levelLabels = buildLevelLabels(
      [
        ...buyLevels.map((price) => ({ price, tone: "buy" as const, y: priceToY(price) })),
        ...sellLevels.map((price) => ({ price, tone: "sell" as const, y: priceToY(price) })),
        ...neutralLevels.map((price) => ({ price, tone: "neutral" as const, y: priceToY(price) }))
      ],
      chartTop + 8,
      chartBottom - 6
    );

    return {
      rawMin,
      rawMax,
      chartLeft,
      chartRight,
      chartTop,
      chartBottom,
      chartWidth,
      chartHeight,
      slotWidth,
      candleBodyWidth,
      candleCenters,
      axisTicks,
      levelLabels,
      priceToY
    };
  }, [buyLevels, candles, neutralLevels, resolvedCurrentPrice, sellLevels]);

  const hoverMeta = useMemo(() => {
    if (!geometry || hoverIndex === null) {
      return null;
    }
    const candle = candles[hoverIndex];
    const centerX = geometry.candleCenters[hoverIndex];
    if (!candle || centerX === undefined) {
      return null;
    }
    return {
      candle,
      centerX,
      price: candle.close
    };
  }, [candles, geometry, hoverIndex]);

  const highlightedBuyLevel = useMemo(
    () => pickNearestLevel(buyLevels, hoverMeta?.price ?? resolvedCurrentPrice ?? null),
    [buyLevels, hoverMeta?.price, resolvedCurrentPrice]
  );
  const highlightedSellLevel = useMemo(
    () => pickNearestLevel(sellLevels, hoverMeta?.price ?? resolvedCurrentPrice ?? null),
    [hoverMeta?.price, resolvedCurrentPrice, sellLevels]
  );

  if (!geometry) {
    return (
      <div className="flex h-[156px] items-center justify-center rounded border border-slate-700/60 bg-slate-950/25 text-xs text-slate-500">
        暂无价格轨迹
      </div>
    );
  }

  const {
    rawMin,
    rawMax,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
    chartWidth,
    chartHeight,
    slotWidth,
    candleBodyWidth,
    candleCenters,
    axisTicks,
    levelLabels,
    priceToY
  } = geometry;

  const currentLineY = resolvedCurrentPrice !== null ? priceToY(resolvedCurrentPrice) : null;
  const currentLabelY = currentLineY !== null ? clamp(currentLineY - 11, chartTop + 2, chartBottom - 18) : null;
  const currentPriceText = resolvedCurrentPrice !== null ? fmt(resolvedCurrentPrice) : "--";

  return (
    <div className="relative rounded border border-slate-700/60 bg-slate-950/25 px-2 py-2">
      <svg
        data-testid="live-order-mini-chart"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="h-[156px] w-full cursor-crosshair"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <line x1={AXIS_X} x2={AXIS_X} y1={chartTop} y2={chartBottom} stroke={theme.axis} strokeWidth={1} />

        {axisTicks.map((tick, index) => (
          <g key={`axis-${index}`}>
            <line x1={AXIS_X} x2={AXIS_X + 6} y1={tick.y} y2={tick.y} stroke={theme.axis} strokeWidth={1} />
            <text x={AXIS_X - 6} y={tick.y + 3.5} textAnchor="end" fontSize="10.5" fill={theme.minorText}>
              {fmt(tick.value)}
            </text>
          </g>
        ))}

        {Array.from({ length: 4 }).map((_, index) => {
          const ratio = index / 3;
          const y = chartTop + ratio * chartHeight;
          return <line key={`grid-${index}`} x1={chartLeft} x2={chartRight} y1={y} y2={y} stroke={theme.grid} strokeWidth={1} />;
        })}

        {buyLevels.map((price) => {
          const y = priceToY(price);
          const isHighlighted = highlightedBuyLevel !== null && Math.abs(highlightedBuyLevel - price) < 1e-9;
          return (
            <line
              key={`buy-${price}`}
              data-testid={isHighlighted ? "live-order-highlight-buy" : undefined}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke="#22c55e"
              strokeOpacity={isHighlighted ? 0.98 : 0.78}
              strokeWidth={isHighlighted ? 2.6 : 1.5}
            />
          );
        })}

        {sellLevels.map((price) => {
          const y = priceToY(price);
          const isHighlighted = highlightedSellLevel !== null && Math.abs(highlightedSellLevel - price) < 1e-9;
          return (
            <line
              key={`sell-${price}`}
              data-testid={isHighlighted ? "live-order-highlight-sell" : undefined}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke="#ef4444"
              strokeOpacity={isHighlighted ? 0.98 : 0.78}
              strokeWidth={isHighlighted ? 2.6 : 1.5}
            />
          );
        })}

        {neutralLevels.map((price) => {
          const y = priceToY(price);
          return (
            <line
              key={`neutral-${price}`}
              x1={chartLeft}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke={theme.fallbackLine}
              strokeWidth={1.2}
              strokeDasharray="4 4"
            />
          );
        })}

        {levelLabels.map((item) => {
          const color = item.tone === "buy" ? "#22c55e" : item.tone === "sell" ? "#ef4444" : theme.minorText;
          const isHighlighted =
            (item.tone === "buy" && highlightedBuyLevel !== null && Math.abs(highlightedBuyLevel - item.price) < 1e-9) ||
            (item.tone === "sell" && highlightedSellLevel !== null && Math.abs(highlightedSellLevel - item.price) < 1e-9);
          return (
            <g key={`label-${item.tone}-${item.price}`}>
              <text
                x={chartLeft - 8}
                y={item.y + 3.5}
                textAnchor="end"
                fontSize={isHighlighted ? "11.5" : "11"}
                fill={color}
                fontWeight={isHighlighted ? 800 : 700}
              >
                {fmt(item.price)}
              </text>
            </g>
          );
        })}

        {candles.map((candle, index) => {
          const centerX = candleCenters[index] ?? chartLeft + chartWidth / 2;
          const wickTop = priceToY(candle.high);
          const wickBottom = priceToY(candle.low);
          const openY = priceToY(candle.open);
          const closeY = priceToY(candle.close);
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(openY - closeY), 4.5);
          const bodyFill = candle.close >= candle.open ? theme.candleUp : theme.candleDown;
          const isHovered = hoverIndex === index;

          return (
            <g key={`candle-${candle.timestamp}-${index}`}>
              {isHovered && (
                <line
                  x1={centerX}
                  x2={centerX}
                  y1={chartTop}
                  y2={chartBottom}
                  stroke={theme.minorText}
                  strokeOpacity={0.45}
                  strokeDasharray="4 4"
                />
              )}
              <line x1={centerX} x2={centerX} y1={wickTop} y2={wickBottom} stroke={theme.candleWick} strokeWidth={1.6} />
              <rect
                x={centerX - candleBodyWidth / 2}
                y={bodyTop}
                width={candleBodyWidth}
                height={bodyHeight}
                rx={1.5}
                fill={bodyFill}
                stroke={isHovered ? theme.text : theme.candleStroke}
                strokeWidth={isHovered ? 1.4 : 1}
              />
            </g>
          );
        })}

        {currentLineY !== null && currentLabelY !== null && (
          <g>
            <line
              x1={chartLeft}
              x2={chartRight}
              y1={currentLineY}
              y2={currentLineY}
              stroke={theme.currentLine}
              strokeWidth={1.6}
              strokeDasharray="6 4"
            />
            <rect
              x={chartRight + 8}
              y={currentLabelY}
              width={78}
              height={18}
              rx={9}
              fill={theme.currentChipBg}
              stroke={theme.currentChipBorder}
            />
            <text x={chartRight + 47} y={currentLabelY + 12} textAnchor="middle" fontSize="11" fill={theme.currentChipText} fontWeight={700}>
              {currentPriceText}
            </text>
          </g>
        )}

        {candleCenters.map((centerX, index) => {
          const slotStart = chartLeft + slotWidth * index;
          return (
            <rect
              key={`hit-${index}`}
              data-testid={`live-order-hit-${index}`}
              x={slotStart}
              y={chartTop}
              width={slotWidth}
              height={chartHeight}
              fill="transparent"
              onMouseMove={() => setHoverIndex(index)}
            />
          );
        })}

        <text x={SVG_WIDTH - 6} y={chartTop + 10} textAnchor="end" fontSize="11" fill={theme.minorText}>
          {fmt(rawMax)}
        </text>
        <text x={SVG_WIDTH - 6} y={chartBottom} textAnchor="end" fontSize="11" fill={theme.minorText}>
          {fmt(rawMin)}
        </text>
      </svg>

      {hoverMeta && (
        <div
          data-testid="live-order-mini-tooltip"
          className="pointer-events-none absolute right-2 top-2 rounded border px-2 py-1 text-[11px] shadow-lg"
          style={{ backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
        >
          <div className="font-semibold">{formatTooltipTime(hoverMeta.candle).firstLine}</div>
          {formatTooltipTime(hoverMeta.candle).secondLine ? (
            <div className="font-semibold">{formatTooltipTime(hoverMeta.candle).secondLine}</div>
          ) : null}
          <div>开 {fmt(hoverMeta.candle.open)}</div>
          <div>高 {fmt(hoverMeta.candle.high)}</div>
          <div>低 {fmt(hoverMeta.candle.low)}</div>
          <div>收 {fmt(hoverMeta.candle.close)}</div>
        </div>
      )}
    </div>
  );
}
