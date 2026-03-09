import type { CurvePoint } from "../lib/api-schema";

export const POSITIVE_CURVE_COLOR = "#22c55e";
export const NEGATIVE_CURVE_COLOR = "#ef4444";
export const NEUTRAL_CURVE_COLOR = "#94a3b8";
export const DRAWDOWN_CURVE_COLOR = "#f59e0b";
export const FUNDING_CURVE_COLOR = "#2563eb";

export function resolveCurveColorByValue(
  value: number | null | undefined,
  positiveColor = POSITIVE_CURVE_COLOR,
  negativeColor = NEGATIVE_CURVE_COLOR,
  neutralColor = NEUTRAL_CURVE_COLOR
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return neutralColor;
  }
  if (value > 0) {
    return positiveColor;
  }
  if (value < 0) {
    return negativeColor;
  }
  return neutralColor;
}

export function resolveCurveColorByLastValue(
  curve: CurvePoint[],
  positiveColor = POSITIVE_CURVE_COLOR,
  negativeColor = NEGATIVE_CURVE_COLOR,
  neutralColor = NEUTRAL_CURVE_COLOR
): string {
  const lastValue = curve.length > 0 ? curve[curve.length - 1]?.value : null;
  return resolveCurveColorByValue(lastValue, positiveColor, negativeColor, neutralColor);
}
