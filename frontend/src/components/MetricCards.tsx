import { BacktestSummary } from "../types";

interface Props {
  summary: BacktestSummary;
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function pct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(digits)}%`;
}

function riskLevel(summary: BacktestSummary): "低" | "中" | "高" {
  if (summary.liquidation_count > 0 || summary.max_drawdown_pct >= 35) {
    return "高";
  }
  if (summary.max_drawdown_pct >= 18 || summary.stop_loss_count >= 3) {
    return "中";
  }
  return "低";
}

export default function MetricCards({ summary }: Props) {
  const level = riskLevel(summary);
  const cards = [
    { label: "总收益", value: `${fmt(summary.total_return_usdt)} USDT` },
    { label: "最大回撤", value: pct(summary.max_drawdown_pct) },
    { label: "最终权益", value: `${fmt(summary.final_equity)} USDT` },
    { label: "胜率", value: pct(summary.win_rate * 100) },
    { label: "止损次数", value: `${summary.stop_loss_count}` },
    { label: "风险等级", value: level }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className="card fade-up p-3">
          <p className="text-xs text-slate-400">{card.label}</p>
          <p className="mono mt-1 text-sm font-semibold text-slate-100">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
