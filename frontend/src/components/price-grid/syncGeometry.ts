import { MutableRefObject } from "react";
import { Candle } from "../../types";
import { calculateAlignedBodyWidth, clamp } from "./chartUtils";

export interface MarkerGeometry {
  openCloseSize: number;
  offset: number;
}

interface SyncGeometryRefs {
  lastWidthRef: MutableRefObject<number>;
  lastBarMinWidthRef: MutableRefObject<number>;
  lastMarkerGeometryRef: MutableRefObject<MarkerGeometry | null>;
  fullRangeMarkerBaselineRef: MutableRefObject<MarkerGeometry | null>;
  pendingMarkerBaselineCaptureRef: MutableRefObject<boolean>;
  lastMarkerLabelVisibleRef: MutableRefObject<boolean | null>;
  lastVisibleCountRef: MutableRefObject<number | null>;
  lastHairlineModeRef: MutableRefObject<boolean | null>;
  lastYAxisRef: MutableRefObject<{ min: number; max: number } | null>;
}

interface SyncGeometryArgs {
  chart: any;
  candleCount: number;
  candles: Candle[];
  boundaryGridMin: number;
  boundaryGridMax: number;
  isMobileChart: boolean;
  showMarkers: boolean;
  refs: SyncGeometryRefs;
}

export function syncPriceGridChartGeometry({
  chart,
  candleCount,
  candles,
  boundaryGridMin,
  boundaryGridMax,
  isMobileChart,
  showMarkers,
  refs
}: SyncGeometryArgs): void {
  if (!chart || candleCount < 1) {
    return;
  }
  const {
    lastWidthRef,
    lastBarMinWidthRef,
    lastMarkerGeometryRef,
    fullRangeMarkerBaselineRef,
    pendingMarkerBaselineCaptureRef,
    lastMarkerLabelVisibleRef,
    lastVisibleCountRef,
    lastHairlineModeRef,
    lastYAxisRef
  } = refs;

  const option = chart.getOption();
  const firstZoom = Array.isArray(option.dataZoom) ? option.dataZoom[0] : undefined;
  const rawStart = Number((firstZoom as { start?: unknown } | undefined)?.start ?? 0);
  const rawEnd = Number((firstZoom as { end?: unknown } | undefined)?.end ?? 100);
  const startPct = clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 100);
  const endPct = clamp(Number.isFinite(rawEnd) ? rawEnd : 100, 0, 100);
  const leftPct = Math.min(startPct, endPct);
  const rightPct = Math.max(startPct, endPct);
  const startIndex = clamp(Math.floor((leftPct / 100) * (candleCount - 1)), 0, candleCount - 1);
  const endIndex = clamp(Math.ceil((rightPct / 100) * (candleCount - 1)), 0, candleCount - 1);
  const visibleCount = Math.max(1, endIndex - startIndex + 1);
  const isFullRange = leftPct <= 0.5 && rightPct >= 99.5;
  const dpr =
    typeof (chart as unknown as { getDevicePixelRatio?: () => number }).getDevicePixelRatio === "function"
      ? (chart as unknown as { getDevicePixelRatio: () => number }).getDevicePixelRatio()
      : window.devicePixelRatio || 1;

  let categoryWidth = Number.NaN;
  if (candleCount >= 2 && endIndex > startIndex) {
    const visibleStartPx = Number(chart.convertToPixel({ xAxisIndex: 0 }, startIndex));
    const visibleEndPx = Number(chart.convertToPixel({ xAxisIndex: 0 }, endIndex));
    if (Number.isFinite(visibleStartPx) && Number.isFinite(visibleEndPx)) {
      const slotCount = Math.max(1, endIndex - startIndex);
      categoryWidth = Math.abs(visibleEndPx - visibleStartPx) / slotCount;
    }
  }
  if ((!Number.isFinite(categoryWidth) || categoryWidth <= 0) && candleCount >= 2) {
    const probeIndex = startIndex;
    const adjacentIndex = probeIndex < candleCount - 1 ? probeIndex + 1 : probeIndex - 1;
    if (adjacentIndex >= 0 && adjacentIndex < candleCount) {
      const p0 = Number(chart.convertToPixel({ xAxisIndex: 0 }, probeIndex));
      const p1 = Number(chart.convertToPixel({ xAxisIndex: 0 }, adjacentIndex));
      const fallbackWidth = Math.abs(p1 - p0);
      if (Number.isFinite(fallbackWidth) && fallbackWidth > 0) {
        categoryWidth = fallbackWidth;
      }
    }
  }

  const denseByCount = isFullRange && visibleCount >= 260;
  const denseByPixel = Number.isFinite(categoryWidth) && categoryWidth <= 5.8;
  const forceHairlineBody = denseByCount || denseByPixel;
  const targetMinBodyWidth = forceHairlineBody ? 1 : 3;
  const nextShowMarkerGridLabels = false;
  const prevLabelVisible = lastMarkerLabelVisibleRef.current;
  const markerLabelVisibilityChanged = prevLabelVisible === null || prevLabelVisible !== nextShowMarkerGridLabels;

  let resolvedWidth: number | null = null;
  if (forceHairlineBody) {
    resolvedWidth = 1;
  } else if (Number.isFinite(categoryWidth) && categoryWidth > 0) {
    resolvedWidth = calculateAlignedBodyWidth(categoryWidth, dpr, targetMinBodyWidth);
  }
  if (!Number.isFinite(resolvedWidth ?? Number.NaN) || (resolvedWidth ?? 0) <= 0) {
    if (Number.isFinite(lastWidthRef.current) && lastWidthRef.current > 0) {
      resolvedWidth = lastWidthRef.current;
    } else {
      resolvedWidth = targetMinBodyWidth;
    }
  }
  const finalWidth = Number(resolvedWidth ?? targetMinBodyWidth);
  const widthChanged = Math.abs(lastWidthRef.current - finalWidth) >= 1e-4;
  const minWidthChanged = lastBarMinWidthRef.current !== targetMinBodyWidth;
  let nextOpenCloseMarkerSize = Number(clamp(finalWidth * 0.9, 1, 18).toFixed(3));
  const prevVisibleCount = lastVisibleCountRef.current;
  const zoomingIn = prevVisibleCount !== null && visibleCount < prevVisibleCount;
  const justSwitchedFromHairline =
    lastHairlineModeRef.current === true && forceHairlineBody === false && lastMarkerGeometryRef.current !== null;
  if (justSwitchedFromHairline && lastMarkerGeometryRef.current) {
    nextOpenCloseMarkerSize = lastMarkerGeometryRef.current.openCloseSize;
  }
  if (zoomingIn && lastMarkerGeometryRef.current) {
    nextOpenCloseMarkerSize = Math.max(nextOpenCloseMarkerSize, lastMarkerGeometryRef.current.openCloseSize);
  }

  const hairlineMinOpenCloseSize = isMobileChart ? 6.5 : 7.5;
  const minVisibleOpenCloseSize = hairlineMinOpenCloseSize;
  const maxVisibleOpenCloseSize = forceHairlineBody
    ? isMobileChart
      ? 8
      : 10
    : Math.max(minVisibleOpenCloseSize, finalWidth);
  nextOpenCloseMarkerSize = Number(clamp(nextOpenCloseMarkerSize, minVisibleOpenCloseSize, maxVisibleOpenCloseSize).toFixed(3));
  let nextMarkerOffset = Math.max(1, Math.round(nextOpenCloseMarkerSize * 0.24));
  if (showMarkers && isFullRange) {
    const baseline = fullRangeMarkerBaselineRef.current;
    if (pendingMarkerBaselineCaptureRef.current || !baseline) {
      fullRangeMarkerBaselineRef.current = {
        openCloseSize: nextOpenCloseMarkerSize,
        offset: nextMarkerOffset
      };
      pendingMarkerBaselineCaptureRef.current = false;
    } else {
      nextOpenCloseMarkerSize = baseline.openCloseSize;
      nextMarkerOffset = baseline.offset;
    }
  }
  const prevMarkerGeometry = lastMarkerGeometryRef.current;
  const markerGeometryChanged =
    !prevMarkerGeometry ||
    Math.abs(prevMarkerGeometry.openCloseSize - nextOpenCloseMarkerSize) > 1e-3 ||
    prevMarkerGeometry.offset !== nextMarkerOffset;

  let visibleLow = Number.POSITIVE_INFINITY;
  let visibleHigh = Number.NEGATIVE_INFINITY;
  for (let i = startIndex; i <= endIndex; i += 1) {
    const candle = candles[i];
    if (!candle) {
      continue;
    }
    if (candle.low < visibleLow) {
      visibleLow = candle.low;
    }
    if (candle.high > visibleHigh) {
      visibleHigh = candle.high;
    }
  }
  if (!Number.isFinite(visibleLow) || !Number.isFinite(visibleHigh)) {
    return;
  }
  const scopedLow = isFullRange && Number.isFinite(boundaryGridMin) ? Math.min(visibleLow, boundaryGridMin) : visibleLow;
  const scopedHigh = isFullRange && Number.isFinite(boundaryGridMax) ? Math.max(visibleHigh, boundaryGridMax) : visibleHigh;
  const rawSpan = Math.max(scopedHigh - scopedLow, Math.max(Math.abs(scopedHigh), 1) * 0.0001);
  const pad = rawSpan * 0.08;
  const axisMin = Number((scopedLow - pad).toFixed(2));
  const axisMax = Number((scopedHigh + pad).toFixed(2));
  const prevYAxis = lastYAxisRef.current;
  const yAxisChanged = !prevYAxis || Math.abs(prevYAxis.min - axisMin) > 1e-6 || Math.abs(prevYAxis.max - axisMax) > 1e-6;

  if (!widthChanged && !minWidthChanged && !markerGeometryChanged && !markerLabelVisibilityChanged && !yAxisChanged) {
    lastVisibleCountRef.current = visibleCount;
    return;
  }

  const partial: {
    series?: Array<{
      id: string;
      barWidth?: number;
      barMinWidth?: number;
      symbolSize?: number;
      symbolOffset?: [number, number];
      label?: { show?: boolean };
    }>;
    yAxis?: Array<{ min: number; max: number }>;
  } = {};

  const partialSeries: NonNullable<typeof partial.series> = [];
  if (widthChanged || minWidthChanged) {
    partialSeries.push({
      id: "kline-main",
      barWidth: finalWidth,
      barMinWidth: targetMinBodyWidth
    });
    lastWidthRef.current = finalWidth;
    lastBarMinWidthRef.current = targetMinBodyWidth;
  }
  if (markerGeometryChanged || markerLabelVisibilityChanged) {
    partialSeries.push(
      {
        id: "trade-marker-open",
        symbolSize: nextOpenCloseMarkerSize,
        symbolOffset: [0, -nextMarkerOffset],
        label: { show: false }
      },
      {
        id: "trade-marker-close",
        symbolSize: nextOpenCloseMarkerSize,
        symbolOffset: [0, nextMarkerOffset],
        label: { show: false }
      }
    );
    lastMarkerGeometryRef.current = {
      openCloseSize: nextOpenCloseMarkerSize,
      offset: nextMarkerOffset
    };
    lastMarkerLabelVisibleRef.current = nextShowMarkerGridLabels;
  }
  if (partialSeries.length > 0) {
    partial.series = partialSeries;
  }
  if (yAxisChanged) {
    partial.yAxis = [{ min: axisMin, max: axisMax }];
    lastYAxisRef.current = { min: axisMin, max: axisMax };
  }

  chart.setOption(partial, { silent: true, lazyUpdate: true, notMerge: false });
  lastVisibleCountRef.current = visibleCount;
  lastHairlineModeRef.current = forceHairlineBody;
}
