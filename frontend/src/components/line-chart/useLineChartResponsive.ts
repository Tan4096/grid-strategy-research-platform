import { RefObject, useEffect, useMemo, useState } from "react";
import { useLayoutCardHeight } from "../../hooks/useLayoutCardHeight";
import { clamp } from "./buildLineChartOption";
import { useIsMobile } from "../../hooks/responsive/useIsMobile";

export const DEFAULT_LINE_CHART_WIDTH = 920;

interface UseLineChartResponsiveParams {
  containerRef: RefObject<HTMLDivElement>;
  headerRef: RefObject<HTMLDivElement>;
  height: number;
  autoHeight: boolean;
  compact: boolean;
  tight: boolean;
  dataLength: number;
}

export interface LineChartResponsiveState {
  svgWidth: number;
  isMobileChart: boolean;
  isNarrowChart: boolean;
  resolvedHeight: number;
}

export function useLineChartResponsive({
  containerRef,
  headerRef,
  height,
  autoHeight,
  compact,
  tight,
  dataLength
}: UseLineChartResponsiveParams): LineChartResponsiveState {
  const [svgWidth, setSvgWidth] = useState(DEFAULT_LINE_CHART_WIDTH);
  const isMobileViewport = useIsMobile();
  const isMobileChart = svgWidth < 560 || isMobileViewport;
  const isNarrowChart = svgWidth < 390;

  const baseHeight = useMemo(() => {
    if (!autoHeight) {
      return isMobileChart ? Math.min(height, 300) : height;
    }
    const base = compact ? (isMobileChart ? 240 : 300) : isMobileChart ? 230 : 280;
    const growth = Math.log2(Math.max(2, dataLength)) * (compact ? (isMobileChart ? 10 : 16) : isMobileChart ? 9 : 14);
    return Math.round(
      clamp(
        base + growth,
        compact ? (isMobileChart ? 230 : 300) : isMobileChart ? 220 : 280,
        compact ? (isMobileChart ? 320 : 420) : isMobileChart ? 300 : 380
      )
    );
  }, [autoHeight, compact, dataLength, height, isMobileChart]);

  const resolvedHeight = useLayoutCardHeight(containerRef, {
    baseHeight,
    minHeight: compact ? (isMobileChart ? 160 : 180) : isMobileChart ? 170 : 190,
    maxHeight: 1500,
    reservedSpacePx: tight ? 6 : compact ? (isMobileChart ? 6 : 8) : isMobileChart ? 8 : 10,
    headerRef
  });

  useEffect(() => {
    const target = containerRef.current;
    if (!target) {
      return;
    }

    const syncWidth = () => {
      const next = Math.max(320, Math.round(target.clientWidth || DEFAULT_LINE_CHART_WIDTH));
      setSvgWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };

    syncWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncWidth);
      return () => window.removeEventListener("resize", syncWidth);
    }

    const observer = new ResizeObserver(() => syncWidth());
    observer.observe(target);
    return () => observer.disconnect();
  }, [containerRef]);

  return {
    svgWidth,
    isMobileChart,
    isNarrowChart,
    resolvedHeight
  };
}
