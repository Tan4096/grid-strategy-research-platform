import { useId, useMemo, useRef } from "react";
import type { CurvePoint } from "../lib/api-schema";
import {
  NEGATIVE_CURVE_COLOR,
  NEUTRAL_CURVE_COLOR,
  POSITIVE_CURVE_COLOR,
  resolveCurveColorByValue
} from "../lib/curveColors";
import StateBlock from "./ui/StateBlock";
import {
  buildLineChartOption,
  clamp,
  formatAxisTimeShort,
  formatAxisValue,
  formatChangeText,
  formatExtrema,
  formatValue
} from "./line-chart/buildLineChartOption";
import { useLineChartInteraction } from "./line-chart/useLineChartInteraction";
import { useLineChartResponsive } from "./line-chart/useLineChartResponsive";

interface Props {
  title: string;
  data: CurvePoint[];
  color: string;
  height?: number;
  yAxisLabel?: string;
  area?: boolean;
  compact?: boolean;
  autoHeight?: boolean;
  tight?: boolean;
  hoverSyncRatio?: number | null;
  onHoverSyncRatioChange?: (ratio: number | null) => void;
  returnAmountBase?: number;
}

interface BoundaryMarker {
  key: string;
  y: number;
  label: string;
}

function resolveBoundaryMarkerTheme(): { color: string; textStroke: string } {
  if (typeof document === "undefined") {
    return {
      color: "#f8fafc",
      textStroke: "rgba(2,6,23,0.82)"
    };
  }
  const isLight = document.documentElement.classList.contains("theme-light");
  return isLight
    ? {
        color: "#0f172a",
        textStroke: "rgba(255,255,255,0.96)"
      }
    : {
        color: "#f8fafc",
        textStroke: "rgba(2,6,23,0.82)"
      };
}

function buildBoundaryMarkers(
  values: number[],
  points: Array<{ x: number; y: number }>,
  yAxisLabel: string | undefined,
  paddingTop: number,
  baselineY: number,
  isMobileChart: boolean
): BoundaryMarker[] {
  if (!values.length || !points.length) {
    return [];
  }

  const startValue = values[0];
  const endValue = values[values.length - 1];
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  if (!startPoint || !endPoint || !Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return [];
  }

  const labelTop = paddingTop + (isMobileChart ? 10 : 12);
  const labelBottom = baselineY - (isMobileChart ? 8 : 10);
  const minGap = isMobileChart ? 18 : 22;
  let startY = clamp(startPoint.y, labelTop, labelBottom);
  let endY = clamp(endPoint.y, labelTop, labelBottom);

  if (Math.abs(startY - endY) < minGap) {
    if (startY <= endY) {
      startY = clamp(startY - minGap / 2, labelTop, labelBottom);
      endY = clamp(endY + minGap / 2, labelTop, labelBottom);
      if (Math.abs(startY - endY) < minGap) {
        endY = clamp(startY + minGap, labelTop, labelBottom);
        startY = clamp(endY - minGap, labelTop, labelBottom);
      }
    } else {
      startY = clamp(startY + minGap / 2, labelTop, labelBottom);
      endY = clamp(endY - minGap / 2, labelTop, labelBottom);
      if (Math.abs(startY - endY) < minGap) {
        endY = clamp(startY - minGap, labelTop, labelBottom);
        startY = clamp(endY + minGap, labelTop, labelBottom);
      }
    }
  }

  if (points.length === 1) {
    return [
      {
        key: "start-end",
        y: startY,
        label: `起/终 ${formatAxisValue(startValue, yAxisLabel)}`
      }
    ];
  }

  return [
    {
      key: "start",
      y: startY,
      label: `起 ${formatAxisValue(startValue, yAxisLabel)}`
    },
    {
      key: "end",
      y: endY,
      label: `终 ${formatAxisValue(endValue, yAxisLabel)}`
    }
  ];
}

export default function LineChart({
  title,
  data,
  color,
  height = 340,
  yAxisLabel,
  area = false,
  compact = false,
  autoHeight = false,
  tight = false,
  hoverSyncRatio,
  onHoverSyncRatioChange,
  returnAmountBase
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const { svgWidth, isMobileChart, isNarrowChart, resolvedHeight } = useLineChartResponsive({
    containerRef,
    headerRef,
    height,
    autoHeight,
    compact,
    tight,
    dataLength: data.length
  });
  const chart = useMemo(
    () =>
      data.length
        ? buildLineChartOption({
            data,
            yAxisLabel,
            svgWidth,
            resolvedHeight,
            compact,
            tight,
            isMobileChart
          })
        : null,
    [compact, data, isMobileChart, resolvedHeight, svgWidth, tight, yAxisLabel]
  );

  const {
    hoverIndex,
    clearHover,
    handlePointerMove,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  } = useLineChartInteraction({
    dataLength: data.length,
    points: chart?.points ?? [],
    chartLeft: chart?.chartLeft ?? 0,
    chartWidth: chart?.chartWidth ?? 0,
    svgWidth,
    resolvedHeight,
    hoverSyncRatio,
    onHoverSyncRatioChange,
    isNarrowChart,
    svgRef,
    tooltipRef
  });

  const normalizedReturnAmountBase = useMemo(
    () =>
      Number.isFinite(returnAmountBase) && (returnAmountBase ?? 0) > 0
        ? Number(returnAmountBase)
        : null,
    [returnAmountBase]
  );

  const hoverMeta = useMemo(() => {
    if (!chart || hoverIndex === null) {
      return { point: null, value: null, timestamp: null, delta: null, returnAmount: null };
    }
    const point = chart.points[hoverIndex] ?? null;
    const value = chart.values[hoverIndex] ?? null;
    const timestamp = data[hoverIndex]?.timestamp ?? null;
    const prevValue = chart.values[Math.max(hoverIndex - 1, 0)] ?? null;
    const delta = value !== null && prevValue !== null ? value - prevValue : null;
    const returnAmount =
      yAxisLabel === "收益率" && normalizedReturnAmountBase !== null && value !== null
        ? (normalizedReturnAmountBase * value) / 100
        : null;
    return { point, value, timestamp, delta, returnAmount };
  }, [chart, data, hoverIndex, normalizedReturnAmountBase, yAxisLabel]);
  const activeCurveColor = useMemo(() => {
    if (!chart || yAxisLabel !== "收益率") {
      return color;
    }
    const defaultReferenceValue =
      normalizedReturnAmountBase !== null ? (normalizedReturnAmountBase * chart.latest) / 100 : chart.latest;
    const currentReferenceValue = hoverMeta.returnAmount ?? defaultReferenceValue;
    return resolveCurveColorByValue(
      currentReferenceValue,
      POSITIVE_CURVE_COLOR,
      NEGATIVE_CURVE_COLOR,
      NEUTRAL_CURVE_COLOR
    );
  }, [chart, color, hoverMeta.returnAmount, normalizedReturnAmountBase, yAxisLabel]);
  const xTickIndexes = chart
    ? compact
      ? Array.from(new Set([0, Math.round((data.length - 1) * 0.5), data.length - 1])).sort((a, b) => a - b)
      : chart.xTickIndexes
    : [];
  const boundaryMarkers = useMemo(
    () =>
      chart
        ? buildBoundaryMarkers(
            chart.values,
            chart.points,
            yAxisLabel,
            chart.paddingTop,
            chart.baselineY,
            isMobileChart
          )
        : [],
    [chart, isMobileChart, yAxisLabel]
  );
  const boundaryMarkerTheme = resolveBoundaryMarkerTheme();
  const gradientId = useId();

  if (!chart) {
    return <StateBlock variant="empty" message="暂无曲线数据" minHeight={resolvedHeight} />;
  }
  const isReturnRateChart = yAxisLabel === "收益率";
  const zeroAxisY = (() => {
    if (!isReturnRateChart) {
      return null;
    }
    const range = chart.maxValue - chart.minValue;
    if (!Number.isFinite(range) || Math.abs(range) < 1e-9) {
      return chart.latest >= 0 ? chart.baselineY : chart.paddingTop;
    }
    const innerHeight = chart.baselineY - chart.paddingTop;
    const normalized = (0 - chart.minValue) / range;
    const projected = chart.paddingTop + (1 - normalized) * innerHeight;
    return clamp(projected, chart.paddingTop, chart.baselineY);
  })();

  return (
    <div ref={containerRef} className={`card fade-up ${tight ? "p-2" : compact ? "p-2 sm:p-2.5" : "p-2.5 sm:p-3"}`}>
      <div
        ref={headerRef}
        className={`${tight ? "mb-0.5" : compact ? "mb-1" : "mb-2"} flex flex-wrap items-center justify-between gap-2 px-1`}
      >
        <div>
          <p className={`${tight ? "text-[13px]" : compact ? "text-sm" : isMobileChart ? "text-sm" : "text-[15px]"} font-semibold text-slate-100`}>
            {title}
          </p>
          {!compact && !isNarrowChart && (
            <p className="text-xs text-slate-400">
              起始: {isMobileChart ? formatAxisTimeShort(data[0].timestamp) : new Date(data[0].timestamp).toLocaleString()}，结束:{" "}
              {isMobileChart
                ? formatAxisTimeShort(data[data.length - 1].timestamp)
                : new Date(data[data.length - 1].timestamp).toLocaleString()}
            </p>
          )}
        </div>
        <div className={`${isMobileChart ? "w-full text-left" : "text-right"} ${tight ? "text-[10px]" : compact ? "text-[11px]" : "text-xs"} text-slate-300`}>
          <p>当前: {formatValue(chart.latest, yAxisLabel)}</p>
          <p>区间最低: {formatExtrema(chart.minValue, yAxisLabel)}</p>
          <p>区间最高: {formatExtrema(chart.maxValue, yAxisLabel)}</p>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${resolvedHeight}`}
          className="w-full cursor-crosshair"
          style={{ height: resolvedHeight, touchAction: "pan-y pinch-zoom" }}
          onMouseMove={handlePointerMove}
          onMouseLeave={clearHover}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {area && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={activeCurveColor} stopOpacity="0.32" />
                <stop offset="55%" stopColor={activeCurveColor} stopOpacity="0.12" />
                <stop offset="100%" stopColor={activeCurveColor} stopOpacity="0" />
              </linearGradient>
            </defs>
          )}
          {chart.yTicks.map((line) => (
            <line
              key={line.ratio}
              x1={chart.chartLeft}
              x2={chart.chartRight}
              y1={line.y}
              y2={line.y}
              stroke="rgba(148,163,184,0.16)"
              strokeWidth={1}
            />
          ))}
          {zeroAxisY !== null ? (
            <line
              x1={chart.chartLeft}
              x2={chart.chartRight}
              y1={zeroAxisY}
              y2={zeroAxisY}
              stroke="rgba(148,163,184,0.62)"
              strokeWidth={1}
              strokeDasharray="6 4"
            />
          ) : null}

          <line
            x1={chart.chartLeft}
            x2={chart.chartLeft}
            y1={chart.paddingTop}
            y2={chart.baselineY}
            stroke="#334155"
            strokeWidth={1}
          />
          <line
            x1={chart.chartLeft}
            x2={chart.chartRight}
            y1={chart.baselineY}
            y2={chart.baselineY}
            stroke="#334155"
            strokeWidth={1}
          />

          {chart.yTicks.map((tick) => (
            <g key={`y-label-${tick.ratio}`}>
              <line x1={chart.chartLeft - 4} x2={chart.chartLeft} y1={tick.y} y2={tick.y} stroke="#475569" strokeWidth={1} />
              <text x={chart.chartLeft - 8} y={tick.y + 4.5} textAnchor="end" fontSize={isMobileChart ? "10.5" : "12"} fill="#94a3b8">
                {formatAxisValue(tick.value, yAxisLabel)}
              </text>
            </g>
          ))}

          {boundaryMarkers.map((marker) => (
            <g key={`boundary-${marker.key}`}>
              <line
                x1={chart.chartLeft - 6}
                x2={chart.chartLeft}
                y1={marker.y}
                y2={marker.y}
                stroke={boundaryMarkerTheme.color}
                strokeWidth={1.5}
              />
              <text
                x={chart.chartLeft - 10}
                y={marker.y + 4}
                textAnchor="end"
                fontSize={isMobileChart ? "10.5" : "11.5"}
                fontWeight={700}
                fill={boundaryMarkerTheme.color}
                stroke={boundaryMarkerTheme.textStroke}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {marker.label}
              </text>
            </g>
          ))}

          {xTickIndexes.map((idx) => {
            const point = chart.points[idx];
            const label = formatAxisTimeShort(data[idx].timestamp);
            const anchor = idx === 0 ? "start" : idx === data.length - 1 ? "end" : "middle";
            return (
              <g key={`x-label-${idx}`}>
                <line x1={point.x} x2={point.x} y1={chart.baselineY} y2={chart.baselineY + 4} stroke="#475569" strokeWidth={1} />
                <text
                  x={point.x}
                  y={chart.baselineY + chart.xAxisLabelOffset}
                  textAnchor={anchor}
                  fontSize={isMobileChart ? "10.5" : "11.5"}
                  fill="#94a3b8"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {area && <path d={chart.areaPath} fill={`url(#${gradientId})`} />}

          <path d={chart.path} fill="none" stroke={activeCurveColor} strokeWidth={2.2} />

          {hoverMeta.point && (
            <line
              x1={hoverMeta.point.x}
              x2={hoverMeta.point.x}
              y1={chart.paddingTop}
              y2={chart.baselineY}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {hoverMeta.point && (
            <line
              x1={chart.chartLeft}
              x2={chart.chartRight}
              y1={hoverMeta.point.y}
              y2={hoverMeta.point.y}
              stroke="rgba(148,163,184,0.32)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          <circle cx={chart.points[0].x} cy={chart.points[0].y} r={3} fill="#f59e0b" />
          <circle
            cx={chart.points[chart.points.length - 1].x}
            cy={chart.points[chart.points.length - 1].y}
            r={3}
            fill={activeCurveColor}
          />

          {hoverMeta.point && (
            <circle
              cx={hoverMeta.point.x}
              cy={hoverMeta.point.y}
              r={4}
              fill={activeCurveColor}
              stroke="#e2e8f0"
              strokeWidth={1.5}
            />
          )}
        </svg>

        <div
          ref={tooltipRef}
          className={`pointer-events-none absolute left-2 top-2 rounded border border-slate-600 bg-slate-950 text-slate-200 shadow-lg ${
            isNarrowChart ? "max-w-[170px] px-2 py-1 text-[11px]" : "min-w-[220px] max-w-[260px] px-2.5 py-1.5 text-xs"
          } ${hoverMeta.point && hoverMeta.value !== null && hoverMeta.timestamp ? "opacity-100" : "opacity-0"}`}
        >
          {hoverMeta.point && hoverMeta.value !== null && hoverMeta.timestamp ? (
            <>
              <p>
                <span className="text-slate-400">时间:</span>{" "}
                <span className="mono text-slate-100">{new Date(hoverMeta.timestamp).toLocaleString()}</span>
              </p>
              <p>
                <span className="text-slate-400">{yAxisLabel ?? "数值"}:</span> {formatValue(hoverMeta.value, yAxisLabel)}
              </p>
              {yAxisLabel === "收益率" ? (
                <p className={(hoverMeta.returnAmount ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                  <span className="text-slate-400">收益额:</span>{" "}
                  {hoverMeta.returnAmount === null
                    ? "-"
                    : `${hoverMeta.returnAmount.toFixed(2)} USDT`}
                </p>
              ) : (
                hoverMeta.delta !== null && hoverIndex !== null && hoverIndex > 0 && (
                  <p className={hoverMeta.delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    <span className="text-slate-400">变化:</span> {formatChangeText(hoverMeta.delta, yAxisLabel)}
                  </p>
                )
              )}
            </>
          ) : null}
        </div>
      </div>

      {!compact && (
        <div className="mt-1 flex items-center justify-between px-1 text-xs text-slate-500">
          <span>{formatExtrema(chart.minValue, yAxisLabel)}</span>
          <span>{formatExtrema(chart.maxValue, yAxisLabel)}</span>
        </div>
      )}
    </div>
  );
}
