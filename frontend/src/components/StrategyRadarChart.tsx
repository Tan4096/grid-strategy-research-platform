import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useRef, useState } from "react";
import { useLayoutCardHeight } from "../hooks/useLayoutCardHeight";
import { echarts, type RadarChartOption } from "../lib/echarts-radar";
import { StrategyScoring } from "../types";

interface Props {
  scoring: StrategyScoring;
}

function metric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(2));
}

function parseRgbTuple(value: string): [number, number, number] | null {
  const parts = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  if (parts.length !== 3) {
    return null;
  }
  return [parts[0], parts[1], parts[2]];
}

function rgba(tuple: [number, number, number], alpha: number): string {
  return `rgba(${tuple[0]},${tuple[1]},${tuple[2]},${alpha})`;
}

function resolveRadarPalette() {
  if (typeof window === "undefined") {
    return {
      isLight: false,
      accent: [59, 130, 246] as [number, number, number]
    };
  }
  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const accent = parseRgbTuple(styles.getPropertyValue("--accent-rgb")) ?? [59, 130, 246];
  const isLight = root.classList.contains("theme-light");
  return { isLight, accent };
}

export default function StrategyRadarChart({ scoring }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const defaultMobileViewport =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false;
  const isMobileChart = containerWidth > 0 ? containerWidth < 640 : defaultMobileViewport;
  const isNarrowChart = containerWidth > 0 ? containerWidth < 420 : false;

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
    baseHeight: isMobileChart ? 300 : 360,
    minHeight: isMobileChart ? 200 : 220,
    maxHeight: 1400,
    reservedSpacePx: 8
  });
  const palette = resolveRadarPalette();
  const lineColor = rgba(palette.accent, 1);
  const areaColor = rgba(palette.accent, palette.isLight ? 0.22 : 0.18);
  const titleColor = palette.isLight ? "#0f172a" : "#dbeafe";
  const textColor = palette.isLight ? "#334155" : "#cbd5e1";
  const tooltipBg = palette.isLight ? "rgba(255,255,255,0.96)" : "#0f172a";
  const tooltipBorder = palette.isLight ? "rgba(15,23,42,0.26)" : "#475569";
  const tooltipText = palette.isLight ? "#0f172a" : "#e2e8f0";

  const values = [
    metric(scoring.profit_score),
    metric(scoring.risk_score),
    metric(scoring.stability_score),
    metric(scoring.robustness_score),
    metric(scoring.behavior_score)
  ];

  const option: RadarChartOption = {
    title: {
      text: "策略五维雷达图",
      left: 10,
      top: 8,
      textStyle: {
        color: titleColor,
        fontSize: isMobileChart ? 12 : 14,
        fontWeight: 600
      }
    },
    tooltip: {
      trigger: "item",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: {
        color: tooltipText,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: isMobileChart ? 11 : 12
      }
    },
    radar: {
      center: ["50%", isMobileChart ? "56%" : "55%"],
      radius: isNarrowChart ? "56%" : isMobileChart ? "60%" : "62%",
      indicator: [
        { name: "收益", max: 100 },
        { name: "风险", max: 100 },
        { name: "稳定", max: 100 },
        { name: "鲁棒", max: 100 },
        { name: "行为", max: 100 }
      ],
      axisName: { color: textColor, fontSize: isMobileChart ? 10 : 12 },
      splitLine: { lineStyle: { color: palette.isLight ? "rgba(15,23,42,0.18)" : "rgba(148,163,184,0.22)" } },
      splitArea: {
        areaStyle: {
          color: palette.isLight ? ["rgba(255,255,255,0.7)", "rgba(226,232,240,0.5)"] : ["rgba(15,23,42,0.25)", "rgba(2,6,23,0.35)"]
        }
      },
      axisLine: { lineStyle: { color: palette.isLight ? "rgba(15,23,42,0.22)" : "rgba(148,163,184,0.28)" } }
    },
    series: [
      {
        name: "Score",
        type: "radar",
        data: [
          {
            value: values,
            name: "Strategy Score",
            areaStyle: { color: areaColor },
            lineStyle: { color: lineColor, width: 2 },
            itemStyle: { color: lineColor },
            symbolSize: 4
          }
        ]
      }
    ]
  };

  return (
    <div ref={containerRef} className="card p-3">
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ width: "100%", height: chartHeight, touchAction: "pan-y pinch-zoom" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
