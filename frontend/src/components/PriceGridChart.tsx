import ReactECharts from "echarts-for-react";
import { Candle } from "../types";

interface Props {
  candles: Candle[];
  gridLines: number[];
}

export default function PriceGridChart({ candles, gridLines }: Props) {
  const xData = candles.map((c) => new Date(c.timestamp).toLocaleString());
  const kData = candles.map((c) => [c.open, c.close, c.low, c.high]);

  const gridSeries = gridLines.map((line, index) => ({
    name: `Grid-${index}`,
    type: "line",
    data: candles.map(() => Number(line.toFixed(4))),
    showSymbol: false,
    silent: true,
    lineStyle: {
      color: index === 0 || index === gridLines.length - 1 ? "#0ea5e9" : "rgba(148,163,184,0.35)",
      width: index === 0 || index === gridLines.length - 1 ? 1.5 : 1,
      type: index === 0 || index === gridLines.length - 1 ? "solid" : "dashed"
    }
  }));

  const option = {
    animation: true,
    title: {
      text: "BTC K线 + 网格区间",
      left: 10,
      top: 8,
      textStyle: {
        color: "#dbeafe",
        fontSize: 13,
        fontWeight: 500
      }
    },
    legend: {
      top: 8,
      right: 10,
      textStyle: { color: "#94a3b8" },
      data: ["K线", "网格线"]
    },
    grid: {
      left: 52,
      right: 20,
      top: 40,
      bottom: 40
    },
    tooltip: {
      trigger: "axis"
    },
    xAxis: {
      type: "category",
      data: xData,
      boundaryGap: true,
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", hideOverlap: true }
    },
    yAxis: {
      scale: true,
      axisLine: { lineStyle: { color: "#334155" } },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.14)" } },
      axisLabel: { color: "#94a3b8" }
    },
    series: [
      {
        name: "K线",
        type: "candlestick",
        data: kData,
        itemStyle: {
          color: "#10b981",
          color0: "#f43f5e",
          borderColor: "#10b981",
          borderColor0: "#f43f5e"
        }
      },
      ...gridSeries,
      {
        name: "网格线",
        type: "line",
        data: candles.map(() => null),
        lineStyle: { opacity: 0 }
      }
    ]
  };

  return (
    <div className="card fade-up p-2">
      <ReactECharts option={option} style={{ width: "100%", height: 380 }} notMerge lazyUpdate />
    </div>
  );
}
