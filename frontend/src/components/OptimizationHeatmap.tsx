import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useRef, useState } from "react";
import { useLayoutCardHeight } from "../hooks/useLayoutCardHeight";
import { echarts, type HeatmapChartOption } from "../lib/echarts-heatmap";
import { OptimizationHeatmapCell } from "../types";

interface Props {
  data: OptimizationHeatmapCell[];
}

type HeatmapColorMode = "contrast" | "smooth";

function toNumberTuple(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.map((item) => Number(item));
  if (parsed.some((item) => !Number.isFinite(item))) {
    return null;
  }
  return parsed;
}

export default function OptimizationHeatmap({ data }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [colorMode, setColorMode] = useState<HeatmapColorMode>("contrast");
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const defaultMobileViewport =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false;
  const isMobileChart = containerWidth > 0 ? containerWidth < 640 : defaultMobileViewport;
  const isNarrowChart = containerWidth > 0 ? containerWidth < 420 : false;
  const useVerticalVisualMap = !isMobileChart;

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

  const chartHeight = useLayoutCardHeight(containerRef, {
    baseHeight: isMobileChart ? 330 : 400,
    minHeight: isMobileChart ? 200 : 220,
    maxHeight: 1500,
    reservedSpacePx: 8
  });
  const safeData = Array.isArray(data)
    ? data.filter(
        (item): item is OptimizationHeatmapCell =>
          Boolean(item) &&
          Number.isFinite(Number(item.leverage)) &&
          Number.isFinite(Number(item.grids)) &&
          Number.isFinite(Number(item.value))
      )
    : [];

  if (!safeData.length) {
    return (
      <div className="card p-4">
        <p className="text-sm text-slate-300">暂无热力图数据</p>
      </div>
    );
  }

  const leverageValues = Array.from(new Set(safeData.map((d) => d.leverage))).sort((a, b) => a - b);
  const gridValues = Array.from(new Set(safeData.map((d) => d.grids))).sort((a, b) => a - b);
  const minScore = Math.min(...safeData.map((d) => d.value));
  const maxScore = Math.max(...safeData.map((d) => d.value));
  const smoothMaxScore = Math.abs(maxScore - minScore) < 1e-12 ? minScore + 1e-9 : maxScore;
  const sortedScores = safeData.map((item) => item.value).sort((a, b) => a - b);
  const percentile = (ratio: number): number => {
    if (!sortedScores.length) {
      return 0;
    }
    const index = (sortedScores.length - 1) * ratio;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    const weight = index - low;
    if (low === high) {
      return sortedScores[low];
    }
    return sortedScores[low] * (1 - weight) + sortedScores[high] * weight;
  };
  const q20 = percentile(0.2);
  const q40 = percentile(0.4);
  const q60 = percentile(0.6);
  const q80 = percentile(0.8);
  const scoreBucket = (value: number): 0 | 1 | 2 | 3 | 4 => {
    if (value <= q20) return 0;
    if (value <= q40) return 1;
    if (value <= q60) return 2;
    if (value <= q80) return 3;
    return 4;
  };
  const bucketLabelMap: Record<number, string> = {
    0: "最低20%",
    1: "20%~40%",
    2: "40%~60%",
    3: "60%~80%",
    4: "最高20%"
  };

  const buildTooltipLines = (values: number[]): string[] | null => {
    if (values.length < 11) {
      return null;
    }
    const [x, y, score, useBasePosition, baseGridCount, initialPositionSize, anchorPrice, lowerPrice, upperPrice, stopPrice] = values;
    const bucket = Math.max(0, Math.min(4, Math.round(values[10])));
    const leverage = leverageValues[Math.max(0, Math.min(leverageValues.length - 1, Math.round(x)))];
    const grids = gridValues[Math.max(0, Math.min(gridValues.length - 1, Math.round(y)))];
    return [
      `杠杆: ${leverage}`,
      `网格: ${grids}`,
      `稳健评分: ${score.toFixed(4)}`,
      `分位区间: ${bucketLabelMap[bucket]}`,
      `开底仓: ${useBasePosition > 0 ? "是" : "否"}`,
      `底仓格数: ${baseGridCount}`,
      `底仓规模: ${initialPositionSize.toFixed(2)}`,
      `Anchor: ${anchorPrice.toFixed(2)}`,
      `下边界: ${lowerPrice.toFixed(2)}`,
      `上边界: ${upperPrice.toFixed(2)}`,
      `止损价: ${stopPrice.toFixed(2)}`
    ];
  };

  const handleHoverEvent = (raw: unknown) => {
    const params = raw as {
      componentType?: string;
      seriesType?: string;
      value?: unknown;
      event?: { event?: { offsetX?: number; offsetY?: number } };
    };
    if (params?.componentType !== "series" || params?.seriesType !== "heatmap") {
      return;
    }
    const values = toNumberTuple(params.value);
    if (!values) {
      setHoverTooltip(null);
      return;
    }
    const lines = buildTooltipLines(values);
    if (!lines || !containerRef.current) {
      setHoverTooltip(null);
      return;
    }
    const rawX = Number(params.event?.event?.offsetX ?? 0);
    const rawY = Number(params.event?.event?.offsetY ?? 0);
    const baseX = Number.isFinite(rawX) ? rawX : 0;
    const baseY = Number.isFinite(rawY) ? rawY : 0;
    const approxWidth = isMobileChart ? 170 : 210;
    const approxHeight = lines.length * (isMobileChart ? 16 : 18) + 14;
    const maxX = Math.max(8, containerRef.current.clientWidth - approxWidth - 8);
    const maxY = Math.max(8, containerRef.current.clientHeight - approxHeight - 8);
    const x = Math.min(maxX, Math.max(8, baseX + 14));
    const y = Math.min(maxY, Math.max(8, baseY - approxHeight - 12));
    setHoverTooltip({ x, y, lines });
  };

  const clearHoverTooltip = () => setHoverTooltip(null);

  const onEvents = {
    mouseover: handleHoverEvent,
    mousemove: handleHoverEvent,
    mouseout: clearHoverTooltip,
    globalout: clearHoverTooltip
  };

  const seriesData = safeData.map((d) => [
    leverageValues.indexOf(d.leverage),
    gridValues.indexOf(d.grids),
    d.value,
    d.use_base_position ? 1 : 0,
    d.base_grid_count,
    d.initial_position_size,
    d.anchor_price,
    d.lower_price,
    d.upper_price,
    d.stop_price,
    scoreBucket(d.value)
  ]);

  const option: HeatmapChartOption = {
    tooltip: {
      show: false
    },
    grid: {
      left: isMobileChart ? 44 : 60,
      right: useVerticalVisualMap ? (isNarrowChart ? 92 : 110) : isMobileChart ? 10 : 18,
      top: isMobileChart ? 28 : 34,
      bottom: isMobileChart ? 76 : 48
    },
    xAxis: {
      type: "category",
      data: leverageValues.map((x) => String(x)),
      name: "杠杆",
      nameLocation: "end",
      nameGap: isMobileChart ? 16 : 18,
      nameTextStyle: { color: "#94a3b8", fontSize: isMobileChart ? 11 : 12 },
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", fontSize: isMobileChart ? 10 : 12 }
    },
    yAxis: {
      type: "category",
      data: gridValues.map((x) => String(x)),
      name: "网格数",
      nameLocation: "middle",
      nameGap: isMobileChart ? 30 : 40,
      nameTextStyle: { color: "#94a3b8", fontSize: isMobileChart ? 11 : 12 },
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", fontSize: isMobileChart ? 10 : 12 }
    },
    visualMap:
      colorMode === "contrast"
        ? {
            type: "piecewise",
            dimension: 10,
            calculable: false,
            orient: useVerticalVisualMap ? "vertical" : "horizontal",
            right: useVerticalVisualMap ? 8 : undefined,
            top: useVerticalVisualMap ? "center" : undefined,
            left: useVerticalVisualMap ? undefined : "center",
            bottom: useVerticalVisualMap ? undefined : 4,
            itemGap: isNarrowChart ? 5 : 8,
            itemWidth: isNarrowChart ? 12 : 14,
            itemHeight: isNarrowChart ? 12 : 14,
            textStyle: { color: "#94a3b8", fontSize: isMobileChart ? 10 : 12 },
            pieces: [
              { value: 0, label: "最低20%", color: "#1e3a8a" },
              { value: 1, label: "20%~40%", color: "#2563eb" },
              { value: 2, label: "40%~60%", color: "#16a34a" },
              { value: 3, label: "60%~80%", color: "#f59e0b" },
              { value: 4, label: "最高20%", color: "#dc2626" }
            ]
          }
        : {
            type: "continuous",
            dimension: 2,
            min: minScore,
            max: smoothMaxScore,
            calculable: true,
            orient: useVerticalVisualMap ? "vertical" : "horizontal",
            right: useVerticalVisualMap ? 8 : undefined,
            top: useVerticalVisualMap ? "center" : undefined,
            left: useVerticalVisualMap ? undefined : "center",
            bottom: useVerticalVisualMap ? undefined : 4,
            itemWidth: isNarrowChart ? 12 : 14,
            itemHeight: useVerticalVisualMap ? (isNarrowChart ? 120 : 140) : 12,
            text: useVerticalVisualMap ? ["高", "低"] : ["低", "高"],
            textStyle: { color: "#94a3b8", fontSize: isMobileChart ? 10 : 12 },
            inRange: {
              color: ["#1d4ed8", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444"]
            }
          },
    series: [
      {
        type: "heatmap",
        data: seriesData,
        itemStyle: {
          borderColor: "rgba(2, 6, 23, 0.42)",
          borderWidth: 0.8
        },
        label: {
          show: false
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.4)"
          }
        }
      }
    ]
  };

  return (
    <div ref={containerRef} className="card fade-up p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">热力图 (杠杆 × 网格数)</p>
        <div className="flex items-center gap-1.5 rounded-md border border-slate-700/70 bg-slate-900/60 p-1">
          <button
            type="button"
            className={`ui-btn ui-btn-xs ${colorMode === "contrast" ? "ui-btn-primary" : "ui-btn-secondary"}`}
            onClick={() => setColorMode("contrast")}
          >
            高对比
          </button>
          <button
            type="button"
            className={`ui-btn ui-btn-xs ${colorMode === "smooth" ? "ui-btn-primary" : "ui-btn-secondary"}`}
            onClick={() => setColorMode("smooth")}
          >
            平滑
          </button>
        </div>
      </div>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ width: "100%", height: chartHeight, touchAction: "pan-y pinch-zoom" }}
        onEvents={onEvents}
        notMerge
        lazyUpdate
      />
      {hoverTooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-slate-600 bg-slate-950/95 px-2 py-1.5 text-[11px] text-slate-100 shadow-xl"
          style={{ left: hoverTooltip.x, top: hoverTooltip.y }}
        >
          {hoverTooltip.lines.map((line) => (
            <p key={line} className="leading-4 whitespace-nowrap">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
