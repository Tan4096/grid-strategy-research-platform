import { CurvePoint } from "../../types";

export interface LineChartPoint {
  x: number;
  y: number;
}

export interface LineChartYTick {
  y: number;
  ratio: number;
  value: number;
}

export interface BuildLineChartOptionInput {
  data: CurvePoint[];
  yAxisLabel?: string;
  svgWidth: number;
  resolvedHeight: number;
  compact: boolean;
  tight: boolean;
  isMobileChart: boolean;
}

export interface LineChartOption {
  values: number[];
  minValue: number;
  maxValue: number;
  latest: number;
  chartLeft: number;
  chartRight: number;
  chartWidth: number;
  paddingTop: number;
  baselineY: number;
  xAxisLabelOffset: number;
  points: LineChartPoint[];
  path: string;
  areaPath: string;
  yTicks: LineChartYTick[];
  xTickIndexes: number[];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isPercentLikeLabel(yAxisLabel?: string): boolean {
  return yAxisLabel === "收益率" || yAxisLabel === "%" || yAxisLabel === "百分比" || yAxisLabel === "回撤比例";
}

export function formatValue(value: number, yAxisLabel?: string): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (yAxisLabel === "price" || yAxisLabel === "价格") {
    return value.toFixed(2);
  }
  if (yAxisLabel === "收益率") {
    return `${value.toFixed(2)}%`;
  }
  if (isPercentLikeLabel(yAxisLabel)) {
    return `${value.toFixed(2)} 百分比`;
  }
  if (yAxisLabel === "USDT") {
    return `${value.toFixed(4)} USDT`;
  }
  if (yAxisLabel === "x" || yAxisLabel === "杠杆倍数" || yAxisLabel === "倍数") {
    return `${value.toFixed(2)} 倍`;
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return `${Math.round(value)} 格`;
  }
  return `${value.toFixed(4)}${yAxisLabel ? ` ${yAxisLabel}` : ""}`;
}

function formatDelta(value: number, yAxisLabel?: string): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (yAxisLabel === "price" || yAxisLabel === "价格") {
    return value.toFixed(2);
  }
  if (yAxisLabel === "收益率") {
    return `${value.toFixed(2)}%`;
  }
  if (isPercentLikeLabel(yAxisLabel)) {
    return `${value.toFixed(2)} 百分比`;
  }
  if (yAxisLabel === "USDT") {
    return `${value.toFixed(2)} USDT`;
  }
  if (yAxisLabel === "x" || yAxisLabel === "杠杆倍数" || yAxisLabel === "倍数") {
    return `${value.toFixed(2)} 倍`;
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return `${value.toFixed(0)} 格`;
  }
  return `${value.toFixed(2)}${yAxisLabel ? ` ${yAxisLabel}` : ""}`;
}

export function formatChangeText(value: number, yAxisLabel?: string): string {
  if (!Number.isFinite(value)) {
    return "无";
  }
  const absText = formatDelta(Math.abs(value), yAxisLabel);
  if (Math.abs(value) < 1e-12) {
    return `持平 ${absText}`;
  }
  return value > 0 ? `上升 ${absText}` : `下降 ${absText}`;
}

export function formatAxisValue(value: number, yAxisLabel?: string): string {
  if (yAxisLabel === "price" || yAxisLabel === "价格") {
    return value.toFixed(2);
  }
  if (yAxisLabel === "收益率" || isPercentLikeLabel(yAxisLabel)) {
    return `${value.toFixed(2)}%`;
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return value.toFixed(0);
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(2);
  }
  if (abs >= 1) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

export function formatAxisTimeShort(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    return timestamp;
  }
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function formatExtrema(value: number, yAxisLabel?: string): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (yAxisLabel === "price" || yAxisLabel === "价格") {
    return value.toFixed(2);
  }
  if (yAxisLabel === "收益率" || isPercentLikeLabel(yAxisLabel)) {
    return `${value.toFixed(2)}%`;
  }
  if (yAxisLabel === "持仓格数" || yAxisLabel === "格数") {
    return value.toFixed(0);
  }
  return value.toFixed(4);
}

export function buildLineChartOption({
  data,
  yAxisLabel,
  svgWidth,
  resolvedHeight,
  compact,
  tight,
  isMobileChart
}: BuildLineChartOptionInput): LineChartOption {
  const values = data.map((point) => Number(point.value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(maxValue - minValue, 1e-9);

  const yLabelMaxLen = Math.max(
    formatAxisValue(minValue, yAxisLabel).length,
    formatAxisValue(maxValue, yAxisLabel).length
  );
  const boundaryLabelMaxLen = Math.max(
    formatAxisValue(values[0], yAxisLabel).length + 2,
    formatAxisValue(values[values.length - 1], yAxisLabel).length + 2
  );
  const dynamicLabelPad = clamp(24 + Math.max(yLabelMaxLen, boundaryLabelMaxLen) * 7, 68, 124);
  const basePaddingLeft = tight
    ? isMobileChart
      ? 44
      : 50
    : compact
      ? isMobileChart
        ? 50
        : 56
      : isMobileChart
        ? 58
        : 70;
  const paddingLeft = Math.max(basePaddingLeft, Math.round(dynamicLabelPad));
  const paddingRight = tight ? 8 : compact ? (isMobileChart ? 10 : 12) : isMobileChart ? 12 : 16;
  const paddingTop = tight ? (isMobileChart ? 3 : 4) : compact ? (isMobileChart ? 6 : 8) : isMobileChart ? 12 : 20;
  const xAxisLabelOffset = tight ? (isMobileChart ? 14 : 16) : compact ? (isMobileChart ? 15 : 17) : isMobileChart ? 16 : 18;
  const bottomSafeGap = tight ? (isMobileChart ? 9 : 12) : compact ? (isMobileChart ? 10 : 14) : isMobileChart ? 12 : 16;
  const paddingBottom = xAxisLabelOffset + bottomSafeGap;
  const chartLeft = paddingLeft;
  const chartRight = svgWidth - paddingRight;
  const chartWidth = Math.max(chartRight - chartLeft, 60);
  const innerHeight = Math.max(resolvedHeight - paddingTop - paddingBottom, 40);

  const points = values.map((value, idx) => {
    const x = data.length > 1 ? chartLeft + (idx / (data.length - 1)) * chartWidth : chartLeft + chartWidth / 2;
    const normalized = (value - minValue) / range;
    const y = paddingTop + (1 - normalized) * innerHeight;
    return { x, y };
  });

  const path = points.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
  const baselineY = paddingTop + innerHeight;
  const areaPath = `${path} L${chartRight} ${baselineY.toFixed(2)} L${chartLeft} ${baselineY.toFixed(2)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = paddingTop + ratio * innerHeight;
    const value = maxValue - ratio * range;
    return { y, ratio, value };
  });

  const xTickIndexes = Array.from(
    new Set([0, Math.round((data.length - 1) * 0.33), Math.round((data.length - 1) * 0.66), data.length - 1])
  ).sort((a, b) => a - b);

  return {
    values,
    minValue,
    maxValue,
    latest: values[values.length - 1],
    chartLeft,
    chartRight,
    chartWidth,
    paddingTop,
    baselineY,
    xAxisLabelOffset,
    points,
    path,
    areaPath,
    yTicks,
    xTickIndexes
  };
}
