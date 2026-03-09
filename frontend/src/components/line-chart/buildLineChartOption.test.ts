import { describe, expect, it } from "vitest";
import {
  buildLineChartOption,
  formatAxisTimeShort,
  formatChangeText,
  formatValue
} from "./buildLineChartOption";

describe("buildLineChartOption", () => {
  it("builds geometry and ticks from input points", () => {
    const option = buildLineChartOption({
      data: [
        { timestamp: "2026-02-01T00:00:00Z", value: 100 },
        { timestamp: "2026-02-01T01:00:00Z", value: 120 },
        { timestamp: "2026-02-01T02:00:00Z", value: 80 }
      ],
      svgWidth: 900,
      resolvedHeight: 320,
      compact: false,
      tight: false,
      isMobileChart: false,
      yAxisLabel: "USDT"
    });

    expect(option.values).toEqual([100, 120, 80]);
    expect(option.minValue).toBe(80);
    expect(option.maxValue).toBe(120);
    expect(option.points).toHaveLength(3);
    expect(option.yTicks).toHaveLength(5);
    expect(option.path.startsWith("M")).toBe(true);
  });

  it("formats value by label conventions", () => {
    expect(formatValue(12.3456, "USDT")).toBe("12.3456 USDT");
    expect(formatValue(1.2, "持仓格数")).toBe("1 格");
    expect(formatValue(2.34, "倍数")).toBe("2.34 倍");
    expect(formatValue(12.34, "收益率")).toBe("12.34%");
  });

  it("formats change text with direction", () => {
    expect(formatChangeText(0, "USDT")).toContain("持平");
    expect(formatChangeText(2.1, "USDT")).toContain("上升");
    expect(formatChangeText(-2.1, "USDT")).toContain("下降");
  });

  it("formats axis timestamp to short text", () => {
    expect(formatAxisTimeShort("2026-02-01T01:02:00Z")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
