import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useRef, useState } from "react";
import { CurvePoint } from "../types";
import StateBlock from "./ui/StateBlock";

interface Props {
  title: string;
  baseData: CurvePoint[];
  candidateData: CurvePoint[];
  baseLabel?: string;
  candidateLabel?: string;
  baseColor?: string;
  candidateColor?: string;
  yAxisLabel?: string;
  height?: number;
}

const WIDTH = 920;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatValue(value: number | null, yAxisLabel?: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  if (yAxisLabel === "USDT") {
    return `${value.toFixed(2)} USDT`;
  }
  if (yAxisLabel === "回撤比例") {
    return `${value.toFixed(2)} 百分比`;
  }
  if (yAxisLabel === "保证金比例") {
    return `${value.toFixed(4)} 比例`;
  }
  return value.toFixed(4);
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function buildPath(
  values: Array<number | null>,
  projectX: (idx: number) => number,
  projectY: (value: number) => number
): string {
  const parts: string[] = [];
  let started = false;
  values.forEach((value, idx) => {
    if (value === null || !Number.isFinite(value)) {
      started = false;
      return;
    }
    const x = projectX(idx);
    const y = projectY(value);
    if (!started) {
      parts.push(`M${x.toFixed(2)} ${y.toFixed(2)}`);
      started = true;
    } else {
      parts.push(`L${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  });
  return parts.join(" ");
}

export default function ComparisonLineChart({
  title,
  baseData,
  candidateData,
  baseLabel = "当前参数",
  candidateLabel = "优化参数",
  baseColor = "#38bdf8",
  candidateColor = "#22c55e",
  yAxisLabel,
  height = 330
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxLen = Math.max(baseData.length, candidateData.length);
  if (maxLen === 0) {
    return <StateBlock variant="empty" message="暂无对比曲线数据" minHeight={height} />;
  }

  const timestamps = Array.from({ length: maxLen }, (_, idx) => {
    return baseData[idx]?.timestamp ?? candidateData[idx]?.timestamp ?? "";
  });
  const baseValues = Array.from({ length: maxLen }, (_, idx) => {
    const value = baseData[idx]?.value;
    return Number.isFinite(value) ? Number(value) : null;
  });
  const candidateValues = Array.from({ length: maxLen }, (_, idx) => {
    const value = candidateData[idx]?.value;
    return Number.isFinite(value) ? Number(value) : null;
  });
  const combined = [...baseValues, ...candidateValues].filter((value): value is number => value !== null);
  if (combined.length === 0) {
    return <StateBlock variant="empty" message="暂无有效对比数据" minHeight={height} />;
  }

  const minValue = Math.min(...combined);
  const maxValue = Math.max(...combined);
  const range = Math.max(maxValue - minValue, 1e-9);
  const paddingLeft = 70;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartLeft = paddingLeft;
  const chartRight = WIDTH - paddingRight;
  const chartWidth = Math.max(chartRight - chartLeft, 60);
  const innerHeight = Math.max(height - paddingTop - paddingBottom, 40);
  const baselineY = paddingTop + innerHeight;

  const projectX = (idx: number) => {
    if (maxLen <= 1) {
      return chartLeft + chartWidth / 2;
    }
    return chartLeft + (idx / (maxLen - 1)) * chartWidth;
  };
  const projectY = (value: number) => {
    const normalized = (value - minValue) / range;
    return paddingTop + (1 - normalized) * innerHeight;
  };

  const basePath = buildPath(baseValues, projectX, projectY);
  const candidatePath = buildPath(candidateValues, projectX, projectY);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = paddingTop + ratio * innerHeight;
    const value = maxValue - ratio * range;
    return { ratio, y, value };
  });
  const xTickIndexes = useMemo(
    () =>
      Array.from(new Set([0, Math.round((maxLen - 1) * 0.33), Math.round((maxLen - 1) * 0.66), maxLen - 1])).sort(
        (a, b) => a - b
      ),
    [maxLen]
  );

  const handlePointerMove = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || maxLen <= 0) {
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

      const rawX = clamp(event.clientX - rect.left, 0, rect.width);
      const rawY = clamp(event.clientY - rect.top, 0, rect.height);
      const x = clamp(rawX, chartLeftPx, chartLeftPx + chartWidthPx);
      const ratio = chartWidthPx > 0 ? (x - chartLeftPx) / chartWidthPx : 0;
      const idx = clamp(Math.round(ratio * Math.max(maxLen - 1, 1)), 0, maxLen - 1);
      const tooltip = tooltipRef.current;
      if (tooltip) {
        const tipW = tooltip.offsetWidth || 240;
        const tipH = tooltip.offsetHeight || 110;
        const offset = 10;
        let targetX = rawX + offset;
        let targetY = rawY + offset;
        if (targetX + tipW > rect.width - 6) {
          targetX = rawX - tipW - offset;
        }
        if (targetY + tipH > rect.height - 6) {
          targetY = rawY - tipH - offset;
        }
        targetX = clamp(targetX, 6, Math.max(6, rect.width - tipW - 6));
        targetY = clamp(targetY, 6, Math.max(6, rect.height - tipH - 6));
        tooltip.style.left = `${targetX}px`;
        tooltip.style.top = `${targetY}px`;
      }
      setHoverIndex((prev) => (prev === idx ? prev : idx));
    },
    [chartLeft, chartWidth, height, maxLen]
  );

  const hoverBase = hoverIndex !== null ? baseValues[hoverIndex] : null;
  const hoverCandidate = hoverIndex !== null ? candidateValues[hoverIndex] : null;
  const hoverDelta =
    hoverBase !== null && hoverCandidate !== null ? hoverCandidate - hoverBase : null;
  const hoverX = hoverIndex !== null ? projectX(hoverIndex) : null;
  const hoverYBase = hoverBase !== null ? projectY(hoverBase) : null;
  const hoverYCandidate = hoverCandidate !== null ? projectY(hoverCandidate) : null;

  return (
    <div className="card fade-up p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold text-slate-100">{title}</p>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: baseColor }} />
            {baseLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: candidateColor }} />
            {candidateLabel}
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="w-full cursor-crosshair"
          style={{ height }}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {yTicks.map((tick) => (
            <line
              key={`grid-${tick.ratio}`}
              x1={chartLeft}
              x2={chartRight}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(148,163,184,0.16)"
              strokeWidth={1}
            />
          ))}
          <line x1={chartLeft} x2={chartLeft} y1={paddingTop} y2={baselineY} stroke="#334155" strokeWidth={1} />
          <line x1={chartLeft} x2={chartRight} y1={baselineY} y2={baselineY} stroke="#334155" strokeWidth={1} />

          {yTicks.map((tick) => (
            <text key={`y-${tick.ratio}`} x={chartLeft - 8} y={tick.y + 4.5} textAnchor="end" fontSize="12" fill="#94a3b8">
              {formatAxisValue(tick.value)}
            </text>
          ))}
          {xTickIndexes.map((idx) => {
            const x = projectX(idx);
            const anchor = idx === 0 ? "start" : idx === maxLen - 1 ? "end" : "middle";
            return (
              <text key={`x-${idx}`} x={x} y={baselineY + 18} textAnchor={anchor} fontSize="11.5" fill="#94a3b8">
                {formatTime(timestamps[idx])}
              </text>
            );
          })}

          {basePath && <path d={basePath} fill="none" stroke={baseColor} strokeWidth={2} />}
          {candidatePath && <path d={candidatePath} fill="none" stroke={candidateColor} strokeWidth={2} />}

          {hoverX !== null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={paddingTop}
              y2={baselineY}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {hoverX !== null && hoverYBase !== null && <circle cx={hoverX} cy={hoverYBase} r={3.2} fill={baseColor} />}
          {hoverX !== null && hoverYCandidate !== null && <circle cx={hoverX} cy={hoverYCandidate} r={3.2} fill={candidateColor} />}
        </svg>

        {hoverIndex !== null && (
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute z-20 min-w-[220px] rounded border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg"
            style={{ left: 8, top: 8 }}
          >
            <p>时间：{timestamps[hoverIndex] ? new Date(timestamps[hoverIndex]).toLocaleString() : "-"}</p>
            <p>{baseLabel}：{formatValue(hoverBase, yAxisLabel)}</p>
            <p>{candidateLabel}：{formatValue(hoverCandidate, yAxisLabel)}</p>
            <p>差值：{formatValue(hoverDelta, yAxisLabel)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
