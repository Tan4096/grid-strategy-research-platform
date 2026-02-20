import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { echarts, type CandleChartOption } from "../lib/echarts-candle";
import { Candle } from "../types";

interface Props {
  candles: Candle[];
  gridLines: number[];
  symbol?: string;
  marketStructure?: string;
  gridFitLabel?: string;
}

const CHART_GRID_TOP = 52;
const CHART_GRID_BOTTOM = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateAlignedBodyWidth(categoryWidth: number, dpr: number): number {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const cssMin = 1;
  const cssMax = 64;
  const widthRatio = categoryWidth >= 24 ? 0.92 : categoryWidth >= 12 ? 0.84 : 0.7;
  let cssWidth = Math.floor(categoryWidth * widthRatio);
  cssWidth = clamp(cssWidth, cssMin, cssMax);
  if (cssWidth > 1 && cssWidth % 2 === 0) {
    cssWidth -= 1;
  }
  const pxWidth = Math.max(1, Math.round(cssWidth * safeDpr));
  return Number((pxWidth / safeDpr).toFixed(4));
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function parseOhlc(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const nums = raw.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (nums.length < 4) {
    return null;
  }
  // Compatible with both [open, close, low, high] and [x, open, close, low, high].
  const base = nums.length >= 5 ? nums.slice(nums.length - 4) : nums.slice(0, 4);
  const [open, close, low, high] = base;
  return [open, close, low, high];
}

function formatDuration(ms: number): string {
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

export default function PriceGridChart({
  candles,
  gridLines,
  symbol = "价格",
  marketStructure = "-",
  gridFitLabel = "-"
}: Props) {
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number>(-1);
  const lastYAxisRef = useRef<{ min: number; max: number } | null>(null);
  const candleCount = candles.length;
  const defaultZoomStart = 0;

  const xData = candles.map((c) => new Date(c.timestamp).toLocaleString());
  const kData = candles.map((c) => [c.open, c.close, c.low, c.high]);
  const periodHigh = candles.length > 0 ? Math.max(...candles.map((item) => item.high)) : NaN;
  const periodLow = candles.length > 0 ? Math.min(...candles.map((item) => item.low)) : NaN;
  const periodDurationMs =
    candles.length > 1
      ? new Date(candles[candles.length - 1].timestamp).getTime() - new Date(candles[0].timestamp).getTime()
      : 0;
  const chartKey = `${candleCount}-${candles[0]?.timestamp ?? ""}-${candles[candleCount - 1]?.timestamp ?? ""}`;

  const gridSeries = gridLines.map((line, index) => {
    const isBoundary = index === 0 || index === gridLines.length - 1;
    const lineType: "solid" | "dashed" = isBoundary ? "solid" : "dashed";
    return {
      name: "网格线",
      type: "line" as const,
      data: candles.map(() => Number(line.toFixed(4))),
      symbol: "none" as const,
      showSymbol: false,
      showAllSymbol: false,
      silent: true,
      tooltip: { show: false },
      emphasis: {
        disabled: true
      },
      lineStyle: {
        color: isBoundary ? "#0ea5e9" : "rgba(148,163,184,0.35)",
        width: isBoundary ? 1.5 : 1,
        type: lineType
      }
    };
  });

  const syncChartGeometry = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || candleCount < 2) {
      return;
    }
    const p0 = Number(chart.convertToPixel({ xAxisIndex: 0 }, 0));
    const p1 = Number(chart.convertToPixel({ xAxisIndex: 0 }, 1));
    const categoryWidth = Math.abs(p1 - p0);
    if (!Number.isFinite(categoryWidth) || categoryWidth <= 0) {
      return;
    }
    const dpr =
      typeof (chart as unknown as { getDevicePixelRatio?: () => number }).getDevicePixelRatio === "function"
        ? (chart as unknown as { getDevicePixelRatio: () => number }).getDevicePixelRatio()
        : window.devicePixelRatio || 1;
    const nextWidth = calculateAlignedBodyWidth(categoryWidth, dpr);
    const widthChanged = Math.abs(lastWidthRef.current - nextWidth) >= 1e-4;

    const option = chart.getOption();
    const firstZoom = Array.isArray(option.dataZoom) ? option.dataZoom[0] : undefined;
    const rawStart = Number((firstZoom as { start?: unknown } | undefined)?.start ?? 0);
    const rawEnd = Number((firstZoom as { end?: unknown } | undefined)?.end ?? 100);
    const startPct = clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 100);
    const endPct = clamp(Number.isFinite(rawEnd) ? rawEnd : 100, 0, 100);
    const leftPct = Math.min(startPct, endPct);
    const rightPct = Math.max(startPct, endPct);
    const startIndex = clamp(Math.floor((leftPct / 100) * (candleCount - 1)), 0, candleCount - 1);
    const endIndex = clamp(Math.ceil((rightPct / 100) * (candleCount - 1)), 0, candleCount - 1);

    let visibleLow = Number.POSITIVE_INFINITY;
    let visibleHigh = Number.NEGATIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i += 1) {
      const candle = candles[i];
      if (!candle) {
        continue;
      }
      if (candle.low < visibleLow) {
        visibleLow = candle.low;
      }
      if (candle.high > visibleHigh) {
        visibleHigh = candle.high;
      }
    }
    if (!Number.isFinite(visibleLow) || !Number.isFinite(visibleHigh)) {
      return;
    }
    const rawSpan = Math.max(visibleHigh - visibleLow, visibleHigh * 0.0001);
    const pad = rawSpan * 0.08;
    const axisMin = Number((visibleLow - pad).toFixed(2));
    const axisMax = Number((visibleHigh + pad).toFixed(2));
    const prevYAxis = lastYAxisRef.current;
    const yAxisChanged = !prevYAxis || Math.abs(prevYAxis.min - axisMin) > 1e-6 || Math.abs(prevYAxis.max - axisMax) > 1e-6;

    if (!widthChanged && !yAxisChanged) {
      return;
    }

    const partial: {
      series?: Array<{ id: string; barWidth: number }>;
      yAxis?: Array<{ min: number; max: number }>;
    } = {};
    if (widthChanged) {
      partial.series = [
        {
          id: "kline-main",
          barWidth: nextWidth
        }
      ];
      lastWidthRef.current = nextWidth;
    }
    if (yAxisChanged) {
      partial.yAxis = [{ min: axisMin, max: axisMax }];
      lastYAxisRef.current = { min: axisMin, max: axisMax };
    }

    chart.setOption(
      partial,
      { silent: true, lazyUpdate: true, notMerge: false }
    );
  }, [candles, candleCount]);

  const scheduleSyncGeometry = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      syncChartGeometry();
    });
  }, [syncChartGeometry]);

  useEffect(() => {
    scheduleSyncGeometry();
    const onResize = () => scheduleSyncGeometry();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleSyncGeometry, candleCount]);

  const chartEvents = useMemo(
    () => ({
      datazoom: () => scheduleSyncGeometry(),
      finished: () => scheduleSyncGeometry()
    }),
    [scheduleSyncGeometry]
  );

  const option: CandleChartOption = {
    animation: false,
    title: {
      text: `${symbol} K线 + 网格区间`,
      left: 10,
      top: 8,
      textStyle: {
        color: "#dbeafe",
        fontSize: 14,
        fontWeight: 600
      }
    },
    legend: {
      top: 10,
      right: 170,
      textStyle: { color: "#94a3b8", fontSize: 12 },
      data: ["K线", "网格线"]
    },
    grid: {
      left: 62,
      right: 24,
      top: CHART_GRID_TOP,
      bottom: CHART_GRID_BOTTOM
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        label: {
          backgroundColor: "#334155",
          color: "#e2e8f0",
          borderColor: "#475569",
          borderWidth: 1
        }
      },
      backgroundColor: "#0f172a",
      borderColor: "#475569",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12
      },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const candleItem = list.find(
          (item) =>
            item &&
            typeof item === "object" &&
            "seriesType" in item &&
            (item as { seriesType: string }).seriesType === "candlestick"
        ) as
          | {
              axisValueLabel?: string;
              value?: unknown;
            }
          | undefined;

        if (!candleItem) {
          return "";
        }

        const parsed = parseOhlc(candleItem.value);
        if (!parsed) {
          return "";
        }
        const [open, close, low, high] = parsed;
        const changePct = open !== 0 ? ((close - open) / open) * 100 : 0;
        const changeColor = changePct >= 0 ? "#34d399" : "#f87171";

        return [
          `<div style="font-weight:600;margin-bottom:4px;">${candleItem.axisValueLabel ?? ""}</div>`,
          `<div>O <span style="color:#f8fafc">${formatPrice(open)}</span></div>`,
          `<div>H <span style="color:#f8fafc">${formatPrice(high)}</span></div>`,
          `<div>L <span style="color:#f8fafc">${formatPrice(low)}</span></div>`,
          `<div>C <span style="color:#f8fafc">${formatPrice(close)}</span></div>`,
          `<div>Δ <span style="color:${changeColor}">${formatPercent(changePct)}</span></div>`
        ].join("");
      }
    },
    xAxis: {
      type: "category",
      data: xData,
      boundaryGap: true,
      axisLine: { lineStyle: { color: "#334155" } },
      axisTick: { alignWithLabel: true },
      axisLabel: { color: "#94a3b8", fontSize: 12, hideOverlap: true }
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: "#334155" } },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.14)" } },
      axisLabel: { color: "#94a3b8", fontSize: 12 }
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        preventDefaultMouseMove: true,
        minSpan: candleCount > 1 ? 1 : undefined,
        start: defaultZoomStart,
        end: 100
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 24,
        bottom: 20,
        borderColor: "#334155",
        fillerColor: "rgba(14,165,233,0.18)",
        backgroundColor: "rgba(15,23,42,0.65)",
        dataBackground: {
          lineStyle: { color: "rgba(148,163,184,0.65)" },
          areaStyle: { color: "rgba(71,85,105,0.35)" }
        },
        selectedDataBackground: {
          lineStyle: { color: "rgba(56,189,248,0.9)" },
          areaStyle: { color: "rgba(56,189,248,0.25)" }
        },
        textStyle: { color: "#94a3b8", fontSize: 11 },
        start: defaultZoomStart,
        end: 100
      }
    ],
    series: [
      {
        id: "kline-main",
        name: "K线",
        type: "candlestick" as const,
        data: kData,
        barWidth: "56%",
        barMaxWidth: 64,
        progressive: 0,
        itemStyle: {
          color: "#10b981",
          color0: "#f43f5e",
          borderColor: "#10b981",
          borderColor0: "#f43f5e",
          borderWidth: 1
        }
      },
      ...gridSeries
    ]
  };

  return (
    <div className="card fade-up relative p-3">
      <div className="pointer-events-none absolute right-3 top-3 z-10 rounded border border-slate-600/70 bg-slate-950 px-2.5 py-1.5 text-right text-xs text-slate-200">
        <p>市场结构: {marketStructure}</p>
        <p>网格适配度: {gridFitLabel}</p>
      </div>
      <ReactEChartsCore
        key={chartKey}
        echarts={echarts}
        option={option}
        style={{ width: "100%", height: 430 }}
        lazyUpdate
        onChartReady={(chart) => {
          chartRef.current = chart;
          lastWidthRef.current = -1;
          lastYAxisRef.current = null;
          scheduleSyncGeometry();
        }}
        onEvents={chartEvents}
      />
      <div className="mt-2 grid grid-cols-1 gap-2 rounded border border-slate-700/60 bg-slate-950/35 p-2.5 text-xs text-slate-300 sm:grid-cols-3">
        <p>
          区间最高价: <span className="mono text-slate-100">{formatPrice(periodHigh)}</span>
        </p>
        <p>
          区间最低价: <span className="mono text-slate-100">{formatPrice(periodLow)}</span>
        </p>
        <p>
          区间时长: <span className="mono text-slate-100">{formatDuration(periodDurationMs)}</span>
        </p>
      </div>
    </div>
  );
}
