import type { Candle } from "../../lib/api-schema";
import {
  formatChartTimeFull,
  formatPercent,
  formatPrice,
  parseOhlc,
  TradeMarkerPoint,
  MarkerSummary
} from "./chartUtils";

interface BuildPriceGridOptionParams {
  isMobileChart: boolean;
  isNarrowChart: boolean;
  symbol: string;
  titleColor: string;
  minorTextColor: string;
  axisLineColor: string;
  splitLineColor: string;
  axisPointerLabelBg: string;
  axisPointerLabelText: string;
  axisPointerLabelBorder: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipTextColor: string;
  valueColor: string;
  xData: string[];
  xDataCompact: string[];
  candles: Candle[];
  markerSummaryByCandle: Map<number, MarkerSummary>;
  chartGridTop: number;
  chartGridBottom: number;
  candleCount: number;
  zoomBorderColor: string;
  zoomFillerColor: string;
  zoomBackgroundColor: string;
  zoomDataLineColor: string;
  zoomDataAreaColor: string;
  zoomSelectedLineColor: string;
  zoomSelectedAreaColor: string;
  kData: Array<[number, number, number, number]>;
  openMarkerData: TradeMarkerPoint[];
  closeMarkerData: TradeMarkerPoint[];
  gridSeries: Array<Record<string, unknown>>;
  legendSelected: {
    "K线": boolean;
    "网格线": boolean;
    "成交标注": boolean;
  };
}

export function buildPriceGridChartOption({
  isMobileChart,
  isNarrowChart,
  symbol,
  titleColor,
  minorTextColor,
  axisLineColor,
  splitLineColor,
  axisPointerLabelBg,
  axisPointerLabelText,
  axisPointerLabelBorder,
  tooltipBackground,
  tooltipBorder,
  tooltipTextColor,
  valueColor,
  xData,
  xDataCompact,
  candles,
  markerSummaryByCandle,
  chartGridTop,
  chartGridBottom,
  candleCount,
  zoomBorderColor,
  zoomFillerColor,
  zoomBackgroundColor,
  zoomDataLineColor,
  zoomDataAreaColor,
  zoomSelectedLineColor,
  zoomSelectedAreaColor,
  kData,
  openMarkerData,
  closeMarkerData,
  gridSeries,
  legendSelected
}: BuildPriceGridOptionParams) {
  return {
    animation: false,
    title: {
      text: isMobileChart ? `${symbol} K线` : `${symbol} K线 + 网格区间`,
      left: isMobileChart ? 8 : 10,
      top: 8,
      textStyle: {
        color: titleColor,
        fontSize: isMobileChart ? 12 : 14,
        fontWeight: 600
      }
    },
    legend: {
      top: isMobileChart ? 32 : 10,
      right: isMobileChart ? (isNarrowChart ? 8 : 10) : 320,
      itemWidth: isMobileChart ? 14 : 22,
      itemHeight: isMobileChart ? 9 : 13,
      textStyle: { color: minorTextColor, fontSize: isMobileChart ? 11 : 12 },
      data: ["K线", "网格线", "成交标注"],
      selected: legendSelected
    },
    grid: {
      left: isMobileChart ? 44 : 52,
      right: isMobileChart ? 14 : 24,
      top: chartGridTop,
      bottom: chartGridBottom,
      containLabel: true
    },
    tooltip: {
      trigger: "axis",
      triggerOn: isMobileChart ? "mousemove|click" : "mousemove",
      axisPointer: {
        type: "cross",
        snap: true,
        label: {
          backgroundColor: axisPointerLabelBg,
          color: axisPointerLabelText,
          borderColor: axisPointerLabelBorder,
          borderWidth: 1
        }
      },
      backgroundColor: tooltipBackground,
      borderColor: tooltipBorder,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {
        color: tooltipTextColor,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12
      },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const candleItem = list.find(
          (item) =>
            item &&
            typeof item === "object" &&
            "seriesType" in item &&
            (item as { seriesType: string }).seriesType === "candlestick"
        ) as
          | {
              axisValueLabel?: string;
              value?: unknown;
            }
          | undefined;

        if (!candleItem) {
          return "";
        }

        const parsed = parseOhlc(candleItem.value);
        if (!parsed) {
          return "";
        }
        const [open, close, low, high] = parsed;
        const changePct = open !== 0 ? ((close - open) / open) * 100 : 0;
        const changeColor = changePct >= 0 ? "#34d399" : "#f87171";

        const dataIndex = Number(
          (candleItem as { dataIndex?: unknown }).dataIndex ??
            (candleItem as { dataIndexInside?: unknown }).dataIndexInside
        );
        const timeLabel =
          Number.isFinite(dataIndex) && dataIndex >= 0 && dataIndex < candles.length
            ? formatChartTimeFull(candles[Math.round(dataIndex)].timestamp)
            : (candleItem.axisValueLabel ?? "");
        const markerSummary =
          Number.isFinite(dataIndex) && dataIndex >= 0
            ? markerSummaryByCandle.get(Math.round(dataIndex))
            : undefined;
        const markerText = markerSummary
          ? [markerSummary.open > 0 ? `开仓 ${markerSummary.open}` : "", markerSummary.close > 0 ? `平仓 ${markerSummary.close}` : ""]
              .filter(Boolean)
              .join(" / ")
          : "";

        return [
          `<div style="font-weight:600;margin-bottom:4px;">${timeLabel}</div>`,
          `<div>O <span style="color:${valueColor}">${formatPrice(open)}</span></div>`,
          `<div>H <span style="color:${valueColor}">${formatPrice(high)}</span></div>`,
          `<div>L <span style="color:${valueColor}">${formatPrice(low)}</span></div>`,
          `<div>C <span style="color:${valueColor}">${formatPrice(close)}</span></div>`,
          `<div>Δ <span style="color:${changeColor}">${formatPercent(changePct)}</span></div>`,
          markerText ? `<div style="margin-top:2px;color:${minorTextColor}">${markerText}</div>` : ""
        ].join("");
      }
    },
    xAxis: {
      type: "category",
      data: isMobileChart ? xDataCompact : xData,
      boundaryGap: true,
      axisLine: { lineStyle: { color: axisLineColor } },
      axisTick: { alignWithLabel: true },
      axisLabel: { color: minorTextColor, fontSize: isMobileChart ? 10 : 12, hideOverlap: true, margin: isMobileChart ? 8 : 10 }
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: axisLineColor } },
      splitLine: { lineStyle: { color: splitLineColor } },
      axisLabel: { color: minorTextColor, fontSize: isMobileChart ? 11 : 12, margin: isMobileChart ? 6 : 8 }
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        preventDefaultMouseMove: true,
        minSpan: candleCount > 1 ? 1 : undefined
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: isMobileChart ? 20 : 24,
        bottom: isMobileChart ? 14 : 20,
        borderColor: zoomBorderColor,
        fillerColor: zoomFillerColor,
        backgroundColor: zoomBackgroundColor,
        dataBackground: {
          lineStyle: { color: zoomDataLineColor },
          areaStyle: { color: zoomDataAreaColor }
        },
        selectedDataBackground: {
          lineStyle: { color: zoomSelectedLineColor },
          areaStyle: { color: zoomSelectedAreaColor }
        },
        textStyle: { color: minorTextColor, fontSize: isMobileChart ? 10 : 11 }
      }
    ],
    series: [
      {
        id: "kline-main",
        name: "K线",
        type: "candlestick" as const,
        data: kData,
        large: false,
        largeThreshold: 20000,
        barWidth: candleCount >= 260 ? 1 : "56%",
        barMinWidth: candleCount >= 260 ? 1 : 3,
        barMaxWidth: 64,
        progressive: 0,
        itemStyle: {
          color: "#10b981",
          color0: "#f43f5e",
          borderColor: "#059669",
          borderColor0: "#e11d48",
          borderWidth: 1
        }
      },
      {
        id: "trade-marker-open",
        name: "成交标注",
        type: "scatter" as const,
        data: openMarkerData,
        symbol: "triangle",
        symbolSize: isMobileChart ? 6.5 : 7.5,
        symbolOffset: [0, -2],
        silent: true,
        z: 55,
        itemStyle: {
          color: "#0369a1",
          borderColor: "#f8fafc",
          borderWidth: 1
        },
        label: {
          show: false
        },
        tooltip: { show: false }
      },
      {
        id: "trade-marker-close",
        name: "成交标注",
        type: "scatter" as const,
        data: closeMarkerData,
        symbol: "triangle",
        symbolRotate: 180,
        symbolSize: isMobileChart ? 6.5 : 7.5,
        symbolOffset: [0, 2],
        silent: true,
        z: 55,
        itemStyle: {
          color: "#b45309",
          borderColor: "#f8fafc",
          borderWidth: 1
        },
        label: {
          show: false
        },
        tooltip: { show: false }
      },
      ...gridSeries
    ]
  };
}
