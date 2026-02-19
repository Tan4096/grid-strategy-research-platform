import ReactECharts from "echarts-for-react";
import { OptimizationHeatmapCell } from "../types";

interface Props {
  data: OptimizationHeatmapCell[];
}

export default function OptimizationHeatmap({ data }: Props) {
  if (!data.length) {
    return (
      <div className="card p-4">
        <p className="text-sm text-slate-300">暂无热力图数据</p>
      </div>
    );
  }

  const leverageValues = Array.from(new Set(data.map((d) => d.leverage))).sort((a, b) => a - b);
  const gridValues = Array.from(new Set(data.map((d) => d.grids))).sort((a, b) => a - b);

  const seriesData = data.map((d) => [
    leverageValues.indexOf(d.leverage),
    gridValues.indexOf(d.grids),
    d.value,
    d.use_base_position ? 1 : 0,
    d.base_grid_count,
    d.initial_position_size,
    d.anchor_price,
    d.lower_price,
    d.upper_price,
    d.stop_price
  ]);

  const option = {
    title: {
      text: "热力图 (杠杆 × 网格数)",
      left: 10,
      top: 8,
      textStyle: {
        color: "#dbeafe",
        fontSize: 13,
        fontWeight: 500
      }
    },
    tooltip: {
      position: "top",
      formatter: (params: { value: [number, number, number, number, number, number, number, number, number, number] }) => {
        const [x, y, score, useBasePosition, baseGridCount, initialPositionSize, anchorPrice, lowerPrice, upperPrice, stopPrice] =
          params.value;
        return [
          `杠杆: ${leverageValues[x]}`,
          `网格: ${gridValues[y]}`,
          `稳健评分: ${score.toFixed(4)}`,
          `开底仓: ${useBasePosition > 0 ? "是" : "否"}`,
          `底仓格数: ${baseGridCount}`,
          `底仓规模: ${initialPositionSize.toFixed(2)}`,
          `Anchor: ${anchorPrice.toFixed(2)}`,
          `LOWER: ${lowerPrice.toFixed(2)}`,
          `UPPER: ${upperPrice.toFixed(2)}`,
          `STOP: ${stopPrice.toFixed(2)}`
        ].join("<br/>");
      }
    },
    grid: {
      left: 60,
      right: 18,
      top: 45,
      bottom: 45
    },
    xAxis: {
      type: "category",
      data: leverageValues.map((x) => String(x)),
      name: "杠杆",
      nameLocation: "middle",
      nameGap: 30,
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8" }
    },
    yAxis: {
      type: "category",
      data: gridValues.map((x) => String(x)),
      name: "网格数",
      nameLocation: "middle",
      nameGap: 40,
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8" }
    },
    visualMap: {
      min: Math.min(...data.map((d) => d.value)),
      max: Math.max(...data.map((d) => d.value)),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: "#94a3b8" },
      inRange: {
        color: ["#1f2937", "#0ea5e9", "#22c55e", "#fde047"]
      }
    },
    series: [
      {
        type: "heatmap",
        data: seriesData,
        label: {
          show: false
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.4)"
          }
        }
      }
    ]
  };

  return (
    <div className="card fade-up p-2">
      <ReactECharts option={option} style={{ width: "100%", height: 360 }} notMerge lazyUpdate />
    </div>
  );
}
