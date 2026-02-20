import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from "react";
import { OptimizationProgressPoint } from "../types";
import StateBlock from "./ui/StateBlock";

interface Props {
  title: string;
  data: OptimizationProgressPoint[];
  color: string;
  yAxisLabel?: string;
  area?: boolean;
  height?: number;
}

interface HoverState {
  index: number;
  mouseXPx: number;
  mouseYPx: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
}

const WIDTH = 920;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(2);
  }
  if (abs >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
}

export default function OptimizationProgressChart({
  title,
  data,
  color,
  yAxisLabel,
  area = false,
  height = 320
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);

  if (!data.length) {
    return <StateBlock variant="empty" message="暂无进度曲线数据" minHeight={height} />;
  }

  const values = data.map((p) => Number(p.value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1e-9);
  const paddingLeft = 70;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 38;
  const chartLeft = paddingLeft;
  const chartRight = WIDTH - paddingRight;
  const chartWidth = Math.max(chartRight - chartLeft, 60);
  const innerHeight = Math.max(height - paddingTop - paddingBottom, 40);

  const points = values.map((value, idx) => {
    const x = data.length > 1 ? chartLeft + (idx / (data.length - 1)) * chartWidth : chartLeft + chartWidth / 2;
    const normalized = (value - minValue) / range;
    const y = paddingTop + (1 - normalized) * innerHeight;
    return { x, y };
  });

  const path = points.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
  const baselineY = paddingTop + innerHeight;
  const areaPath = `${path} L${chartRight} ${baselineY.toFixed(2)} L${chartLeft} ${baselineY.toFixed(2)} Z`;
  const startStep = data[0].step;
  const endStep = data[data.length - 1].step;
  const latest = values[values.length - 1];

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = paddingTop + ratio * innerHeight;
    const value = maxValue - ratio * range;
    return { y, ratio, value };
  });
  const xTickIndexes = Array.from(
    new Set([0, Math.round((data.length - 1) * 0.33), Math.round((data.length - 1) * 0.66), data.length - 1])
  ).sort((a, b) => a - b);

  const hoverIndex = hoverState?.index ?? null;
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverValue = hoverIndex !== null ? values[hoverIndex] : null;
  const hoverStep = hoverIndex !== null ? data[hoverIndex].step : null;
  const tooltipWidthPx = 210;
  const tooltipHeightPx = 72;
  const tooltipOffsetPx = 12;
  const tooltipXPx = hoverState
    ? Math.max(
        8,
        Math.min(hoverState.viewportWidthPx - tooltipWidthPx - 8, hoverState.mouseXPx + tooltipOffsetPx)
      )
    : 0;
  const tooltipYPx = hoverState
    ? Math.max(
        8,
        Math.min(hoverState.viewportHeightPx - tooltipHeightPx - 8, hoverState.mouseYPx + tooltipOffsetPx)
      )
    : 0;

  const handlePointerMove = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const scale = Math.min(rect.width / WIDTH, rect.height / height);
      const drawnWidth = WIDTH * scale;
      const offsetX = (rect.width - drawnWidth) / 2;
      const chartLeftPx = offsetX + (chartLeft / WIDTH) * drawnWidth;
      const chartWidthPx = (chartWidth / WIDTH) * drawnWidth;
      const x = clamp(event.clientX - rect.left, chartLeftPx, chartLeftPx + chartWidthPx);
      const ratio = chartWidthPx > 0 ? (x - chartLeftPx) / chartWidthPx : 0;
      const rawIndex = ratio * (data.length - 1);
      const idx = clamp(Math.round(rawIndex), 0, data.length - 1);
      const rawX = clamp(event.clientX - rect.left, 0, rect.width);
      const rawY = clamp(event.clientY - rect.top, 0, rect.height);
      setHoverState((prev) => {
        if (
          prev &&
          prev.index === idx &&
          Math.abs(prev.mouseXPx - rawX) < 0.1 &&
          Math.abs(prev.mouseYPx - rawY) < 0.1
        ) {
          return prev;
        }
        return {
          index: idx,
          mouseXPx: rawX,
          mouseYPx: rawY,
          viewportWidthPx: rect.width,
          viewportHeightPx: rect.height
        };
      });
    },
    [chartLeft, chartWidth, data.length, height]
  );

  return (
    <div className="card fade-up p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <p className="text-[15px] font-semibold text-slate-100">{title}</p>
          <p className="text-xs text-slate-400">起始步数: {startStep}，结束步数: {endStep}</p>
        </div>
        <p className="text-xs text-slate-300">
          {yAxisLabel ?? "分数"}: {latest.toFixed(6)}
        </p>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="w-full cursor-crosshair"
          style={{ height }}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverState(null)}
        >
          {yTicks.map((line) => (
            <line
              key={line.ratio}
              x1={chartLeft}
              x2={chartRight}
              y1={line.y}
              y2={line.y}
              stroke="rgba(148,163,184,0.16)"
              strokeWidth={1}
            />
          ))}

          <line x1={chartLeft} x2={chartLeft} y1={paddingTop} y2={baselineY} stroke="#334155" strokeWidth={1} />
          <line x1={chartLeft} x2={chartRight} y1={baselineY} y2={baselineY} stroke="#334155" strokeWidth={1} />

          {yTicks.map((tick) => (
            <g key={`y-${tick.ratio}`}>
              <line x1={chartLeft - 4} x2={chartLeft} y1={tick.y} y2={tick.y} stroke="#475569" strokeWidth={1} />
              <text x={chartLeft - 8} y={tick.y + 4.5} textAnchor="end" fontSize="12" fill="#94a3b8">
                {formatAxisValue(tick.value)}
              </text>
            </g>
          ))}

          {xTickIndexes.map((idx) => {
            const point = points[idx];
            const label = `#${data[idx].step}`;
            const anchor = idx === 0 ? "start" : idx === data.length - 1 ? "end" : "middle";
            return (
              <g key={`x-${idx}`}>
                <line x1={point.x} x2={point.x} y1={baselineY} y2={baselineY + 4} stroke="#475569" strokeWidth={1} />
                <text x={point.x} y={baselineY + 17} textAnchor={anchor} fontSize="11.5" fill="#94a3b8">
                  {label}
                </text>
              </g>
            );
          })}

          {area && <path d={areaPath} fill={color} fillOpacity={0.12} />}
          <path d={path} fill="none" stroke={color} strokeWidth={2.2} />

          {hoverPoint && (
            <>
              <line
                x1={hoverPoint.x}
                x2={hoverPoint.x}
                y1={paddingTop}
                y2={baselineY}
                stroke="rgba(148,163,184,0.45)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <line
                x1={chartLeft}
                x2={chartRight}
                y1={hoverPoint.y}
                y2={hoverPoint.y}
                stroke="rgba(148,163,184,0.32)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <circle cx={hoverPoint.x} cy={hoverPoint.y} r={4} fill={color} stroke="#e2e8f0" strokeWidth={1.5} />
            </>
          )}

          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
        </svg>

        {hoverPoint && hoverValue !== null && hoverStep !== null && (
          <div
            className="pointer-events-none absolute rounded border border-slate-600 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 shadow-lg"
            style={{
              left: `${tooltipXPx}px`,
              top: `${tooltipYPx}px`
            }}
          >
            <p>
              <span className="text-slate-400">步骤序号:</span>{" "}
              <span className="mono text-slate-100">{hoverStep}</span>
            </p>
            <p>
              <span className="text-slate-400">{yAxisLabel ?? "分数"}:</span> {hoverValue.toFixed(6)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between px-1 text-xs text-slate-500">
        <span>{minValue.toFixed(6)}</span>
        <span>{maxValue.toFixed(6)}</span>
      </div>
    </div>
  );
}
