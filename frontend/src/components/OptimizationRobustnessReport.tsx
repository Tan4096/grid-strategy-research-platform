import ReactEChartsCore from "echarts-for-react/lib/core";
import { echarts, type RadarChartOption } from "../lib/echarts-radar";
import { OptimizationRow } from "../types";

interface Props {
  rows: OptimizationRow[];
  bestRow: OptimizationRow | null;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function percentile(values: number[], p: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function normalizeByScale(value: number | null, scale: number): number {
  if (value === null || !Number.isFinite(value) || scale <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / scale));
}

export default function OptimizationRobustnessReport({ rows, bestRow }: Props) {
  if (!bestRow || rows.length === 0) {
    return <div className="card p-4 text-sm text-slate-300">暂无可计算的稳健性数据</div>;
  }

  const neighbors = rows.filter(
    (row) =>
      Math.abs(row.leverage - bestRow.leverage) <= 1 &&
      Math.abs(row.grids - bestRow.grids) <= 1 &&
      Math.abs(row.band_width_pct - bestRow.band_width_pct) <= 1 &&
      Math.abs(row.stop_loss_ratio_pct - bestRow.stop_loss_ratio_pct) <= 0.5
  );
  const scores = neighbors.map((row) => row.robust_score ?? row.score).filter((v) => Number.isFinite(v));
  const mean = scores.length ? scores.reduce((acc, cur) => acc + cur, 0) / scores.length : 0;
  const variance = scores.length
    ? scores.reduce((acc, cur) => acc + (cur - mean) * (cur - mean), 0) / scores.length
    : 0;
  const std = Math.sqrt(Math.max(variance, 0));

  const scaleReturn = Math.max(1, percentile(rows.map((r) => Math.abs(r.total_return_usdt)), 0.95));
  const scaleDrawdown = Math.max(1, percentile(rows.map((r) => Math.max(r.max_drawdown_pct, 0)), 0.95));
  const scaleSharpe = Math.max(0.5, percentile(rows.map((r) => Math.max(r.sharpe_ratio, 0)), 0.95));
  const scaleRatio = Math.max(0.5, percentile(rows.map((r) => Math.max(r.return_drawdown_ratio, 0)), 0.95));

  const trainRadar = [
    normalizeByScale(bestRow.total_return_usdt, scaleReturn),
    1 - normalizeByScale(bestRow.max_drawdown_pct, scaleDrawdown),
    normalizeByScale(bestRow.sharpe_ratio, scaleSharpe),
    normalizeByScale(bestRow.return_drawdown_ratio, scaleRatio),
    Math.max(0, Math.min(1, bestRow.win_rate))
  ];
  const validationRadar = [
    normalizeByScale(bestRow.validation_total_return_usdt, scaleReturn),
    1 - normalizeByScale(bestRow.validation_max_drawdown_pct, scaleDrawdown),
    normalizeByScale(bestRow.validation_sharpe_ratio, scaleSharpe),
    normalizeByScale(bestRow.validation_return_drawdown_ratio, scaleRatio),
    Math.max(0, Math.min(1, bestRow.validation_win_rate ?? 0))
  ];

  const radarOption: RadarChartOption = {
    title: {
      text: "训练期 vs 验证期 稳健性雷达",
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
      data: ["训练期", "验证期"]
    },
    tooltip: {
      trigger: "item"
    },
    radar: {
      center: ["50%", "58%"],
      radius: "62%",
      axisName: { color: "#94a3b8" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.25)" } },
      indicator: [
        { name: "收益", max: 1 },
        { name: "抗回撤", max: 1 },
        { name: "夏普", max: 1 },
        { name: "收益回撤比", max: 1 },
        { name: "胜率", max: 1 }
      ]
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: trainRadar,
            name: "训练期",
            areaStyle: { color: "rgba(34,197,94,0.15)" },
            lineStyle: { color: "#22c55e" },
            itemStyle: { color: "#22c55e" }
          },
          {
            value: validationRadar,
            name: "验证期",
            areaStyle: { color: "rgba(56,189,248,0.15)" },
            lineStyle: { color: "#38bdf8" },
            itemStyle: { color: "#38bdf8" }
          }
        ]
      }
    ]
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="card p-3 text-xs text-slate-200">
          <p className="font-semibold text-cyan-200">参数稳定岛</p>
          <p className="mt-1">邻域样本数: {neighbors.length}</p>
          <p className="mt-1">邻域均值评分: {fmt(mean, 4)}</p>
          <p className="mt-1">邻域评分波动(σ): {fmt(std, 4)}</p>
        </div>
        <div className="card p-3 text-xs text-slate-200">
          <p className="font-semibold text-emerald-300">训练期核心指标</p>
          <p className="mt-1">收益: {fmt(bestRow.total_return_usdt, 2)} USDT</p>
          <p className="mt-1">回撤: {fmt(bestRow.max_drawdown_pct, 2)}%</p>
          <p className="mt-1">夏普: {fmt(bestRow.sharpe_ratio, 3)}</p>
        </div>
        <div className="card p-3 text-xs text-slate-200">
          <p className="font-semibold text-amber-300">验证期核心指标</p>
          <p className="mt-1">收益: {fmt(bestRow.validation_total_return_usdt, 2)} USDT</p>
          <p className="mt-1">回撤: {fmt(bestRow.validation_max_drawdown_pct, 2)}%</p>
          <p className="mt-1">夏普: {fmt(bestRow.validation_sharpe_ratio, 3)}</p>
        </div>
      </div>

      <div className="card fade-up p-2">
        <ReactEChartsCore echarts={echarts} option={radarOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
      </div>
    </div>
  );
}
