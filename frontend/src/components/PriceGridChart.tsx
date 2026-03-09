import { ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLayoutCardHeight } from "../hooks/useLayoutCardHeight";
import { useIsMobile } from "../hooks/responsive/useIsMobile";
import type { Candle, EventLog } from "../lib/api-schema";
import { readPlain, STORAGE_KEYS, writePlain } from "../lib/storage";
import {
  CHART_GRID_BOTTOM,
  CHART_GRID_TOP,
  buildTradeMarkerData,
  formatChartTimeFull,
  formatChartTimeShort,
  formatDuration,
  formatDurationCompact,
  formatPrice,
  resolveChartPalette,
  rgba
} from "./price-grid/chartUtils";
import { buildPriceGridChartOption } from "./price-grid/buildOption";
import { MarkerGeometry, syncPriceGridChartGeometry } from "./price-grid/syncGeometry";

interface Props {
  candles: Candle[];
  gridLines: number[];
  events?: EventLog[];
  symbol?: string;
}

interface CandleChartRuntime {
  EChartsComponent: ComponentType<{
    echarts: unknown;
    option: Record<string, unknown>;
    style?: Record<string, unknown>;
    lazyUpdate?: boolean;
    onChartReady?: (chart: unknown) => void;
    onEvents?: Record<string, (payload?: unknown) => void>;
  }>;
  echarts: unknown;
}

interface PriceGridLegendSelection {
  "K线": boolean;
  "网格线": boolean;
  "成交标注": boolean;
}

const DEFAULT_LEGEND_SELECTION: PriceGridLegendSelection = {
  "K线": true,
  "网格线": true,
  "成交标注": false
};

function normalizeLegendSelection(raw: unknown): PriceGridLegendSelection | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<Record<keyof PriceGridLegendSelection, unknown>>;
  return {
    "K线": typeof value["K线"] === "boolean" ? value["K线"] : DEFAULT_LEGEND_SELECTION["K线"],
    "网格线": typeof value["网格线"] === "boolean" ? value["网格线"] : DEFAULT_LEGEND_SELECTION["网格线"],
    "成交标注":
      typeof value["成交标注"] === "boolean" ? value["成交标注"] : DEFAULT_LEGEND_SELECTION["成交标注"]
  };
}

export default function PriceGridChart({
  candles,
  gridLines,
  events = [],
  symbol = "价格"
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number>(-1);
  const lastBarMinWidthRef = useRef<number>(-1);
  const lastMarkerGeometryRef = useRef<MarkerGeometry | null>(null);
  const fullRangeMarkerBaselineRef = useRef<MarkerGeometry | null>(null);
  const pendingMarkerBaselineCaptureRef = useRef<boolean>(false);
  const lastMarkerLabelVisibleRef = useRef<boolean | null>(null);
  const lastVisibleCountRef = useRef<number | null>(null);
  const lastHairlineModeRef = useRef<boolean | null>(null);
  const lastYAxisRef = useRef<{ min: number; max: number } | null>(null);
  const [runtime, setRuntime] = useState<CandleChartRuntime | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [legendSelected, setLegendSelected] = useState<PriceGridLegendSelection>(
    () => readPlain(STORAGE_KEYS.priceGridLegendSelection, normalizeLegendSelection) ?? DEFAULT_LEGEND_SELECTION
  );
  const showTradeMarkers = legendSelected["成交标注"];
  const candleCount = candles.length;
  const isMobileViewport = useIsMobile();
  const isMobileChart = containerWidth > 0 ? containerWidth < 760 : isMobileViewport;
  const isNarrowChart = containerWidth > 0 && containerWidth < 420;
  const boundaryGridMin = gridLines.length > 0 ? Math.min(...gridLines) : Number.NaN;
  const boundaryGridMax = gridLines.length > 0 ? Math.max(...gridLines) : Number.NaN;
  const chartHeight = useLayoutCardHeight(containerRef, {
    baseHeight: isMobileChart ? 350 : 430,
    minHeight: isMobileChart ? 210 : 220,
    maxHeight: 1600,
    reservedSpacePx: isMobileChart ? 8 : 10
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("echarts-for-react/lib/core"), import("../lib/echarts-candle")])
      .then(([reactEchartsModule, candleRuntimeModule]) => {
        if (cancelled) {
          return;
        }
        const EChartsComponent = reactEchartsModule.default as CandleChartRuntime["EChartsComponent"];
        setRuntime({
          EChartsComponent,
          echarts: candleRuntimeModule.echarts
        });
      })
      .catch(() => {
        // keep fallback state when runtime loading fails
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { xData, xDataCompact, kData, periodHigh, periodLow, periodDurationMs } = useMemo(() => {
    const nextXData = candles.map((c) => formatChartTimeFull(c.timestamp));
    const nextXDataCompact = candles.map((c) => formatChartTimeShort(c.timestamp));
    const nextKData = candles.map((c) => [c.open, c.close, c.low, c.high] as [number, number, number, number]);
    const nextPeriodHigh = candles.length > 0 ? Math.max(...candles.map((item) => item.high)) : Number.NaN;
    const nextPeriodLow = candles.length > 0 ? Math.min(...candles.map((item) => item.low)) : Number.NaN;
    const nextPeriodDurationMs =
      candles.length > 1
        ? new Date(candles[candles.length - 1].timestamp).getTime() - new Date(candles[0].timestamp).getTime()
        : 0;

    return {
      xData: nextXData,
      xDataCompact: nextXDataCompact,
      kData: nextKData,
      periodHigh: nextPeriodHigh,
      periodLow: nextPeriodLow,
      periodDurationMs: nextPeriodDurationMs
    };
  }, [candles]);
  const chartGridTop = isMobileChart ? 92 : CHART_GRID_TOP;
  const chartGridBottom = isMobileChart ? 88 : CHART_GRID_BOTTOM;
  const chartKey = `${candleCount}-${candles[0]?.timestamp ?? ""}-${candles[candleCount - 1]?.timestamp ?? ""}`;
  const palette = resolveChartPalette();
  const titleColor = palette.isLight ? "#0f172a" : "#dbeafe";
  const minorTextColor = palette.isLight ? "#334155" : "#94a3b8";
  const axisLineColor = palette.isLight ? "rgba(15,23,42,0.36)" : "#334155";
  const splitLineColor = palette.isLight ? "rgba(15,23,42,0.12)" : "rgba(148,163,184,0.14)";
  const tooltipBackground = palette.isLight ? "rgba(255,255,255,0.96)" : "#0f172a";
  const tooltipBorder = palette.isLight ? "rgba(15,23,42,0.26)" : "#475569";
  const tooltipTextColor = palette.isLight ? "#0f172a" : "#e2e8f0";
  const axisPointerLabelBg = palette.isLight ? "rgba(255,255,255,0.96)" : "#334155";
  const axisPointerLabelBorder = palette.isLight ? "rgba(15,23,42,0.26)" : "#475569";
  const axisPointerLabelText = palette.isLight ? "#0f172a" : "#e2e8f0";
  const zoomBorderColor = palette.isLight ? "rgba(15,23,42,0.22)" : "#334155";
  const zoomFillerColor = rgba(palette.accent, palette.isLight ? 0.24 : 0.18);
  const zoomBackgroundColor = palette.isLight ? "rgba(255,255,255,0.84)" : "rgba(15,23,42,0.65)";
  const zoomDataLineColor = palette.isLight ? "rgba(15,23,42,0.44)" : "rgba(148,163,184,0.65)";
  const zoomDataAreaColor = palette.isLight ? "rgba(148,163,184,0.22)" : "rgba(71,85,105,0.35)";
  const zoomSelectedLineColor = rgba(palette.accent, palette.isLight ? 0.95 : 0.9);
  const zoomSelectedAreaColor = rgba(palette.accent, palette.isLight ? 0.28 : 0.25);
  const gridBoundaryColor = rgba(palette.accent, palette.isLight ? 0.92 : 0.86);
  const gridLineColor = palette.isLight ? "rgba(15,23,42,0.22)" : "rgba(148,163,184,0.35)";
  const valueColor = palette.isLight ? "#0f172a" : "#f8fafc";

  const { openMarkerData, closeMarkerData, markerSummaryByCandle } = useMemo(
    () => buildTradeMarkerData(candles, events),
    [candles, events]
  );

  const gridSeries = useMemo(
    () =>
      gridLines.map((line, index) => {
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
            color: isBoundary ? gridBoundaryColor : gridLineColor,
            width: isBoundary ? 1.5 : 1,
            type: lineType
          }
        };
      }),
    [candles, gridBoundaryColor, gridLineColor, gridLines]
  );

  const syncChartGeometry = useCallback(() => {
    syncPriceGridChartGeometry({
      chart: chartRef.current,
      candleCount,
      candles,
      boundaryGridMin,
      boundaryGridMax,
      isMobileChart,
      showMarkers: showTradeMarkers,
      refs: {
        lastWidthRef,
        lastBarMinWidthRef,
        lastMarkerGeometryRef,
        fullRangeMarkerBaselineRef,
        pendingMarkerBaselineCaptureRef,
        lastMarkerLabelVisibleRef,
        lastVisibleCountRef,
        lastHairlineModeRef,
        lastYAxisRef
      }
    });
  }, [boundaryGridMax, boundaryGridMin, candleCount, candles, isMobileChart, showTradeMarkers]);

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
    writePlain(STORAGE_KEYS.priceGridLegendSelection, legendSelected);
  }, [legendSelected]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) {
      return;
    }
    const syncWidth = () => {
      const width = Math.max(0, Math.round(target.clientWidth || 0));
      setContainerWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
    };
    syncWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncWidth);
      return () => window.removeEventListener("resize", syncWidth);
    }
    const observer = new ResizeObserver(() => syncWidth());
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

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
  }, [scheduleSyncGeometry, candleCount, chartHeight]);

  const chartEvents = useMemo(
    () => ({
      datazoom: () => scheduleSyncGeometry(),
      finished: () => scheduleSyncGeometry(),
      legendselectchanged: (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const event = payload as { name?: unknown; selected?: Record<string, boolean> };
        const nextSelection: PriceGridLegendSelection = {
          "K线": typeof event.selected?.["K线"] === "boolean" ? Boolean(event.selected?.["K线"]) : legendSelected["K线"],
          "网格线":
            typeof event.selected?.["网格线"] === "boolean"
              ? Boolean(event.selected?.["网格线"])
              : legendSelected["网格线"],
          "成交标注":
            typeof event.selected?.["成交标注"] === "boolean"
              ? Boolean(event.selected?.["成交标注"])
              : legendSelected["成交标注"]
        };
        if (event.name === "成交标注") {
          if (nextSelection["成交标注"]) {
            pendingMarkerBaselineCaptureRef.current = true;
          } else {
            pendingMarkerBaselineCaptureRef.current = false;
            fullRangeMarkerBaselineRef.current = null;
          }
        }
        setLegendSelected((prev) =>
          prev["K线"] === nextSelection["K线"] &&
          prev["网格线"] === nextSelection["网格线"] &&
          prev["成交标注"] === nextSelection["成交标注"]
            ? prev
            : nextSelection
        );
        scheduleSyncGeometry();
      }
    }),
    [legendSelected, scheduleSyncGeometry]
  );

  const option = useMemo(
    () =>
      buildPriceGridChartOption({
        isMobileChart,
        isNarrowChart,
        symbol,
        titleColor,
        minorTextColor,
        axisLineColor,
        splitLineColor,
        axisPointerLabelBg,
        axisPointerLabelText,
        axisPointerLabelBorder,
        tooltipBackground,
        tooltipBorder,
        tooltipTextColor,
        valueColor,
        xData,
        xDataCompact,
        candles,
        markerSummaryByCandle,
        chartGridTop,
        chartGridBottom,
        candleCount,
        zoomBorderColor,
        zoomFillerColor,
        zoomBackgroundColor,
        zoomDataLineColor,
        zoomDataAreaColor,
        zoomSelectedLineColor,
        zoomSelectedAreaColor,
        kData,
        openMarkerData,
        closeMarkerData,
        gridSeries,
        legendSelected
      }),
    [
      axisLineColor,
      axisPointerLabelBg,
      axisPointerLabelBorder,
      axisPointerLabelText,
      candleCount,
      candles,
      chartGridBottom,
      chartGridTop,
      closeMarkerData,
      gridSeries,
      isMobileChart,
      isNarrowChart,
      kData,
      legendSelected,
      markerSummaryByCandle,
      minorTextColor,
      openMarkerData,
      splitLineColor,
      symbol,
      titleColor,
      tooltipBackground,
      tooltipBorder,
      tooltipTextColor,
      valueColor,
      xData,
      xDataCompact,
      zoomBackgroundColor,
      zoomBorderColor,
      zoomDataAreaColor,
      zoomDataLineColor,
      zoomFillerColor,
      zoomSelectedAreaColor,
      zoomSelectedLineColor
    ]
  );

  return (
    <div ref={containerRef} className="card fade-up relative p-2.5 sm:p-3">
      <div
        className={`pointer-events-none absolute z-10 rounded border border-slate-600/65 bg-slate-950/88 leading-none text-slate-200 ${
          isMobileChart
            ? `left-3 right-3 ${isNarrowChart ? "top-[54px]" : "top-[56px]"} h-[22px] px-2 text-[10px]`
            : "right-3 top-[10px] h-[24px] px-2.5 text-[11px]"
        }`}
      >
        <div className={`flex h-full items-center whitespace-nowrap ${isMobileChart ? "justify-between gap-x-2" : "justify-end gap-x-3"}`}>
          <p>
            {isMobileChart ? "高" : "高:"} <span className="mono">{formatPrice(periodHigh)}</span>
          </p>
          <p>
            {isMobileChart ? "低" : "低:"} <span className="mono">{formatPrice(periodLow)}</span>
          </p>
          {!isNarrowChart && (
            <p>
              {isMobileChart ? "时" : "时长:"}{" "}
              <span className="mono">{isMobileChart ? formatDurationCompact(periodDurationMs) : formatDuration(periodDurationMs)}</span>
            </p>
          )}
        </div>
      </div>
      {runtime ? (
        <runtime.EChartsComponent
          key={chartKey}
          echarts={runtime.echarts}
          option={option}
          style={{ width: "100%", height: chartHeight, touchAction: "pan-y pinch-zoom" }}
          lazyUpdate
          onChartReady={(chart) => {
            chartRef.current = chart as any;
            lastWidthRef.current = -1;
            lastBarMinWidthRef.current = -1;
            lastMarkerGeometryRef.current = null;
            fullRangeMarkerBaselineRef.current = null;
            pendingMarkerBaselineCaptureRef.current = false;
            lastMarkerLabelVisibleRef.current = null;
            lastVisibleCountRef.current = null;
            lastHairlineModeRef.current = null;
            lastYAxisRef.current = null;
            scheduleSyncGeometry();
          }}
          onEvents={chartEvents}
        />
      ) : (
        <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: chartHeight }}>
          K线图运行时加载中...
        </div>
      )}
    </div>
  );
}
