import {
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import type { CurvePoint } from "../lib/api-schema";
import { useLayoutCardHeight } from "../hooks/useLayoutCardHeight";
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
  baseReturnAmountBase?: number;
  candidateReturnAmountBase?: number;
}

const WIDTH = 920;

function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 767px)").matches;
}

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
  if (yAxisLabel === "收益率") {
    return `${value.toFixed(2)}%`;
  }
  if (yAxisLabel === "回撤比例") {
    return `${value.toFixed(2)} 百分比`;
  }
  if (yAxisLabel === "%" || yAxisLabel === "百分比") {
    return `${value.toFixed(2)} 百分比`;
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return `${value.toFixed(0)} 格`;
  }
  if (yAxisLabel === "保证金比例") {
    return `${value.toFixed(4)} 比例`;
  }
  return value.toFixed(4);
}

function formatAxisValue(value: number, yAxisLabel?: string): string {
  if (yAxisLabel === "收益率") {
    return value.toFixed(2);
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return value.toFixed(0);
  }
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

function buildAreaPath(
  values: Array<number | null>,
  projectX: (idx: number) => number,
  projectY: (value: number) => number,
  baselineY: number
): string {
  const validIndexes = values
    .map((value, idx) => (value !== null && Number.isFinite(value) ? idx : -1))
    .filter((idx) => idx >= 0);
  if (validIndexes.length === 0) {
    return "";
  }
  const path = buildPath(values, projectX, projectY);
  if (!path) {
    return "";
  }
  const firstIdx = validIndexes[0];
  const lastIdx = validIndexes[validIndexes.length - 1];
  return `${path} L${projectX(lastIdx).toFixed(2)} ${baselineY.toFixed(2)} L${projectX(firstIdx).toFixed(2)} ${baselineY.toFixed(2)} Z`;
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
  height = 330,
  baseReturnAmountBase,
  candidateReturnAmountBase
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const touchLongPressTimerRef = useRef<number | null>(null);
  const touchLockedRef = useRef(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileViewport());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(max-width: 767px)");
    const sync = (matches: boolean) => setIsMobile(matches);
    sync(media.matches);
    const handler = (event: MediaQueryListEvent) => sync(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.onchange = handler;
    return () => {
      media.onchange = null;
    };
  }, []);

  const resolvedHeight = useLayoutCardHeight(containerRef, {
    baseHeight: height,
    minHeight: 190,
    maxHeight: 1400,
    reservedSpacePx: 10,
    headerRef
  });

  const maxLen = Math.max(baseData.length, candidateData.length);
  if (maxLen === 0) {
    return <StateBlock variant="empty" message="暂无对比曲线数据" minHeight={resolvedHeight} />;
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
    return <StateBlock variant="empty" message="暂无有效对比数据" minHeight={resolvedHeight} />;
  }

  const minValue = Math.min(...combined);
  const maxValue = Math.max(...combined);
  const range = Math.max(maxValue - minValue, 1e-9);
  const paddingLeft = isMobile ? 58 : 70;
  const paddingRight = isMobile ? 10 : 16;
  const paddingTop = isMobile ? 14 : 20;
  const xAxisLabelOffset = isMobile ? 15 : 18;
  const bottomSafeGap = isMobile ? 22 : 16;
  const paddingBottom = xAxisLabelOffset + bottomSafeGap;
  const chartLeft = paddingLeft;
  const chartRight = WIDTH - paddingRight;
  const chartWidth = Math.max(chartRight - chartLeft, 60);
  const innerHeight = Math.max(resolvedHeight - paddingTop - paddingBottom, 40);
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

  const clearTouchLongPressTimer = useCallback(() => {
    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTouchLongPressTimer(), [clearTouchLongPressTimer]);

  const updateHoverByClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current || maxLen <= 0) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const scale = Math.min(rect.width / WIDTH, rect.height / resolvedHeight);
      const drawnWidth = WIDTH * scale;
      const offsetX = (rect.width - drawnWidth) / 2;
      const chartLeftPx = offsetX + (chartLeft / WIDTH) * drawnWidth;
      const chartWidthPx = (chartWidth / WIDTH) * drawnWidth;

      const rawX = clamp(clientX - rect.left, 0, rect.width);
      const rawY = clamp(clientY - rect.top, 0, rect.height);
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
    [chartLeft, chartWidth, maxLen, resolvedHeight]
  );

  const handlePointerMove = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      updateHoverByClient(event.clientX, event.clientY);
    },
    [updateHoverByClient]
  );

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<SVGSVGElement>) => {
      if (event.touches.length >= 2) {
        clearTouchLongPressTimer();
        touchLockedRef.current = false;
        setHoverIndex(null);
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      touchLockedRef.current = false;
      clearTouchLongPressTimer();
      updateHoverByClient(touch.clientX, touch.clientY);
      touchLongPressTimerRef.current = window.setTimeout(() => {
        touchLockedRef.current = true;
      }, 220);
    },
    [clearTouchLongPressTimer, updateHoverByClient]
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<SVGSVGElement>) => {
      if (event.touches.length >= 2) {
        clearTouchLongPressTimer();
        touchLockedRef.current = false;
        setHoverIndex(null);
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (touchLockedRef.current) {
        event.preventDefault();
      }
      updateHoverByClient(touch.clientX, touch.clientY);
    },
    [clearTouchLongPressTimer, updateHoverByClient]
  );

  const handleTouchEnd = useCallback((event?: ReactTouchEvent<SVGSVGElement>) => {
    clearTouchLongPressTimer();
    if (event?.touches.length === 1) {
      const touch = event.touches[0];
      if (touch) {
        touchLockedRef.current = false;
        updateHoverByClient(touch.clientX, touch.clientY);
        touchLongPressTimerRef.current = window.setTimeout(() => {
          touchLockedRef.current = true;
        }, 220);
        return;
      }
    }
    touchLockedRef.current = false;
    setHoverIndex(null);
  }, [clearTouchLongPressTimer, updateHoverByClient]);

  const hoverBase = hoverIndex !== null ? baseValues[hoverIndex] : null;
  const hoverCandidate = hoverIndex !== null ? candidateValues[hoverIndex] : null;
  const hoverDelta =
    hoverBase !== null && hoverCandidate !== null ? hoverCandidate - hoverBase : null;
  const normalizedBaseAmountBase =
    Number.isFinite(baseReturnAmountBase) && (baseReturnAmountBase ?? 0) > 0 ? Number(baseReturnAmountBase) : null;
  const normalizedCandidateAmountBase =
    Number.isFinite(candidateReturnAmountBase) && (candidateReturnAmountBase ?? 0) > 0 ? Number(candidateReturnAmountBase) : null;
  const hoverBaseAmount =
    yAxisLabel === "收益率" && normalizedBaseAmountBase !== null && hoverBase !== null
      ? (normalizedBaseAmountBase * hoverBase) / 100
      : null;
  const hoverCandidateAmount =
    yAxisLabel === "收益率" && normalizedCandidateAmountBase !== null && hoverCandidate !== null
      ? (normalizedCandidateAmountBase * hoverCandidate) / 100
      : null;
  const hoverX = hoverIndex !== null ? projectX(hoverIndex) : null;
  const hoverYBase = hoverBase !== null ? projectY(hoverBase) : null;
  const hoverYCandidate = hoverCandidate !== null ? projectY(hoverCandidate) : null;
  const baseAreaPath = buildAreaPath(baseValues, projectX, projectY, baselineY);
  const candidateAreaPath = buildAreaPath(candidateValues, projectX, projectY, baselineY);
  const baseGradientId = useId();
  const candidateGradientId = useId();

  return (
    <div ref={containerRef} className="card fade-up p-3">
      <div ref={headerRef} className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`${isMobile ? "text-sm" : "text-[15px]"} font-semibold text-slate-100`}>{title}</p>
        <div className={`flex flex-wrap items-center ${isMobile ? "gap-2 text-[10px]" : "gap-3 text-[11px]"} text-slate-300`}>
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
          viewBox={`0 0 ${WIDTH} ${resolvedHeight}`}
          className="w-full cursor-crosshair"
          style={{ height: resolvedHeight, touchAction: "pan-y pinch-zoom" }}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <defs>
            <linearGradient id={baseGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={baseColor} stopOpacity="0.24" />
              <stop offset="55%" stopColor={baseColor} stopOpacity="0.1" />
              <stop offset="100%" stopColor={baseColor} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={candidateGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={candidateColor} stopOpacity="0.24" />
              <stop offset="55%" stopColor={candidateColor} stopOpacity="0.1" />
              <stop offset="100%" stopColor={candidateColor} stopOpacity="0" />
            </linearGradient>
          </defs>
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
            <text
              key={`y-${tick.ratio}`}
              x={chartLeft - 8}
              y={tick.y + 4.5}
              textAnchor="end"
              fontSize={isMobile ? "10.5" : "12"}
              fill="#94a3b8"
            >
              {formatAxisValue(tick.value, yAxisLabel)}
            </text>
          ))}
          {xTickIndexes.map((idx) => {
            const x = projectX(idx);
            const anchor = idx === 0 ? "start" : idx === maxLen - 1 ? "end" : "middle";
            return (
              <text
                key={`x-${idx}`}
                x={x}
                y={baselineY + xAxisLabelOffset}
                textAnchor={anchor}
                fontSize={isMobile ? "10.5" : "11.5"}
                fill="#94a3b8"
              >
                {formatTime(timestamps[idx])}
              </text>
            );
          })}

          {baseAreaPath && <path d={baseAreaPath} fill={`url(#${baseGradientId})`} />}
          {candidateAreaPath && <path d={candidateAreaPath} fill={`url(#${candidateGradientId})`} />}
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
            className={`pointer-events-none absolute z-20 rounded border border-slate-600 bg-slate-900 text-slate-100 shadow-lg ${
              isMobile ? "min-w-[160px] px-2 py-1 text-[10px]" : "min-w-[220px] px-3 py-2 text-xs"
            }`}
            style={{ left: 8, top: 8 }}
          >
            <p>时间：{timestamps[hoverIndex] ? new Date(timestamps[hoverIndex]).toLocaleString() : "-"}</p>
            {yAxisLabel === "收益率" ? (
              <>
                <p>收益率：{baseLabel} {formatValue(hoverBase, yAxisLabel)} / {candidateLabel} {formatValue(hoverCandidate, yAxisLabel)}</p>
                <p>
                  收益额：
                  {baseLabel} {hoverBaseAmount === null ? "-" : `${hoverBaseAmount.toFixed(2)} USDT`} /{" "}
                  {candidateLabel} {hoverCandidateAmount === null ? "-" : `${hoverCandidateAmount.toFixed(2)} USDT`}
                </p>
              </>
            ) : (
              <>
                <p>{baseLabel}：{formatValue(hoverBase, yAxisLabel)}</p>
                <p>{candidateLabel}：{formatValue(hoverCandidate, yAxisLabel)}</p>
                <p>差值：{formatValue(hoverDelta, yAxisLabel)}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
