import ReactEChartsCore from "echarts-for-react/lib/core";
import { echarts, type HeatmapChartOption } from "../lib/echarts-heatmap";
import { OptimizationHeatmapCell } from "../types";

interface Props {
  data: OptimizationHeatmapCell[];
}

function toNumberTuple(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.map((item) => Number(item));
  if (parsed.some((item) => !Number.isFinite(item))) {
    return null;
  }
  return parsed;
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

  const option: HeatmapChartOption = {
    title: {
      text: "热力图 (杠杆 × 网格数)",
      left: 10,
      top: 8,
      textStyle: {
        color: "#dbeafe",
        fontSize: 14,
        fontWeight: 600
      }
    },
    tooltip: {
      position: "top",
      backgroundColor: "#0f172a",
      borderColor: "#475569",
      borderWidth: 1,
      textStyle: {
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12
      },
      formatter: (params: unknown) => {
        const candidate = params as { value?: unknown };
        const values = toNumberTuple(candidate?.value);
        if (!values || values.length < 10) {
          return "数据不可用";
        }
        const [x, y, score, useBasePosition, baseGridCount, initialPositionSize, anchorPrice, lowerPrice, upperPrice, stopPrice] =
          values;
        const leverage = leverageValues[Math.max(0, Math.min(leverageValues.length - 1, Math.round(x)))];
        const grids = gridValues[Math.max(0, Math.min(gridValues.length - 1, Math.round(y)))];
        return [
          `杠杆: ${leverage}`,
          `网格: ${grids}`,
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
      top: 50,
      bottom: 52
    },
    xAxis: {
      type: "category",
      data: leverageValues.map((x) => String(x)),
      name: "杠杆",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: "#94a3b8", fontSize: 12 },
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", fontSize: 12 }
    },
    yAxis: {
      type: "category",
      data: gridValues.map((x) => String(x)),
      name: "网格数",
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { color: "#94a3b8", fontSize: 12 },
      axisLine: { lineStyle: { color: "#334155" } },
      axisLabel: { color: "#94a3b8", fontSize: 12 }
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
    <div className="card fade-up p-3">
      <ReactEChartsCore echarts={echarts} option={option} style={{ width: "100%", height: 400 }} notMerge lazyUpdate />
    </div>
  );
}
