import ReactECharts from "echarts-for-react";
import { OptimizationProgressPoint } from "../types";

interface Props {
  title: string;
  data: OptimizationProgressPoint[];
  color: string;
  yAxisLabel?: string;
  area?: boolean;
  height?: number;
}

export default function OptimizationProgressChart({
  title,
  data,
  color,
  yAxisLabel,
  area = false,
  height = 280
}: Props) {
  const xData = data.map((p) => p.step);
  const yData = data.map((p) => Number(p.value.toFixed(6)));

  const option = {
    animation: true,
    title: {
      text: title,
      left: 10,
      top: 8,
      textStyle: {
        color: "#dbeafe",
        fontSize: 13,
        fontWeight: 500
      }
    },
    grid: {
      left: 50,
      right: 18,
      top: 38,
      bottom: 35
    },
    tooltip: {
      trigger: "axis"
    },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", hideOverlap: true }
    },
    yAxis: {
      type: "value",
      name: yAxisLabel,
      nameTextStyle: { color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#334155" } },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.14)" } },
      axisLabel: { color: "#94a3b8" }
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: yData,
        showSymbol: false,
        lineStyle: { color, width: 2 },
        areaStyle: area
          ? {
              color,
              opacity: 0.15
            }
          : undefined
      }
    ]
  };

  return (
    <div className="card fade-up p-2">
      <ReactECharts option={option} style={{ height, width: "100%" }} notMerge lazyUpdate />
    </div>
  );
}

