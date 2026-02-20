import ReactEChartsCore from "echarts-for-react/lib/core";
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

export default function StrategyRadarChart({ scoring }: Props) {
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
        color: "#dbeafe",
        fontSize: 14,
        fontWeight: 600
      }
    },
    tooltip: {
      trigger: "item",
      backgroundColor: "#0f172a",
      borderColor: "#475569",
      borderWidth: 1,
      textStyle: {
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12
      }
    },
    radar: {
      center: ["50%", "55%"],
      radius: "62%",
      indicator: [
        { name: "Profit", max: 100 },
        { name: "Risk", max: 100 },
        { name: "Stability", max: 100 },
        { name: "Robustness", max: 100 },
        { name: "Behavior", max: 100 }
      ],
      axisName: { color: "#cbd5e1", fontSize: 12 },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.22)" } },
      splitArea: { areaStyle: { color: ["rgba(15,23,42,0.25)", "rgba(2,6,23,0.35)"] } },
      axisLine: { lineStyle: { color: "rgba(148,163,184,0.28)" } }
    },
    series: [
      {
        name: "Score",
        type: "radar",
        data: [
          {
            value: values,
            name: "Strategy Score",
            areaStyle: { color: "rgba(34,197,94,0.18)" },
            lineStyle: { color: "#22c55e", width: 2 },
            itemStyle: { color: "#22c55e" },
            symbolSize: 4
          }
        ]
      }
    ]
  };

  return (
    <div className="card p-3">
      <ReactEChartsCore echarts={echarts} option={option} style={{ width: "100%", height: 360 }} notMerge lazyUpdate />
    </div>
  );
}
