import { describe, expect, it } from "vitest";
import {
  DRAWDOWN_CURVE_COLOR,
  FUNDING_CURVE_COLOR,
  NEGATIVE_CURVE_COLOR,
  NEUTRAL_CURVE_COLOR,
  POSITIVE_CURVE_COLOR,
  resolveCurveColorByLastValue
} from "./curveColors";

describe("curveColors", () => {
  it("returns green when the ending value is positive", () => {
    expect(
      resolveCurveColorByLastValue([
        { timestamp: "2026-03-01T00:00:00Z", value: -3 },
        { timestamp: "2026-03-01T01:00:00Z", value: 8 }
      ])
    ).toBe(POSITIVE_CURVE_COLOR);
  });

  it("returns red when the ending value is negative", () => {
    expect(
      resolveCurveColorByLastValue([
        { timestamp: "2026-03-01T00:00:00Z", value: 10 },
        { timestamp: "2026-03-01T01:00:00Z", value: -2 }
      ])
    ).toBe(NEGATIVE_CURVE_COLOR);
  });

  it("returns neutral when the ending value is zero or missing", () => {
    expect(
      resolveCurveColorByLastValue([
        { timestamp: "2026-03-01T00:00:00Z", value: 1 },
        { timestamp: "2026-03-01T01:00:00Z", value: 0 }
      ])
    ).toBe(NEUTRAL_CURVE_COLOR);
    expect(resolveCurveColorByLastValue([])).toBe(NEUTRAL_CURVE_COLOR);
  });

  it("keeps drawdown and funding colors visually distinct", () => {
    expect(DRAWDOWN_CURVE_COLOR).toBe("#f59e0b");
    expect(FUNDING_CURVE_COLOR).toBe("#2563eb");
    expect(new Set([POSITIVE_CURVE_COLOR, NEGATIVE_CURVE_COLOR, DRAWDOWN_CURVE_COLOR, FUNDING_CURVE_COLOR]).size).toBe(4);
  });
});
