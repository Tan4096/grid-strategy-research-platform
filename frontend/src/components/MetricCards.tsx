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

export default function MetricCards({ summary }: Props) {
  const cards = [
    { label: "总收益", value: `${fmt(summary.total_return_usdt)} USDT` },
    { label: "年化收益率", value: pct(summary.annualized_return_pct) },
    { label: "最大回撤", value: pct(summary.max_drawdown_pct) },
    { label: "最大单次亏损", value: `${fmt(summary.max_single_loss)} USDT` },
    { label: "胜率", value: pct(summary.win_rate * 100) },
    { label: "平均持仓", value: `${fmt(summary.average_holding_hours)} h` },
    { label: "止损次数", value: `${summary.stop_loss_count}` },
    { label: "完整网格盈利次数", value: `${summary.full_grid_profit_count}` },
    { label: "总平仓次数", value: `${summary.total_closed_trades}` },
    { label: "开底仓", value: summary.use_base_position ? "是" : "否" },
    { label: "初始底仓格数", value: `${summary.base_grid_count}` },
    { label: "初始仓位规模", value: `${fmt(summary.initial_position_size)} USDT` },
    { label: "手续费总计", value: `${fmt(summary.fees_paid)} USDT` },
    { label: "最终权益", value: `${fmt(summary.final_equity)} USDT` },
    { label: "状态", value: summary.status }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="card fade-up p-3">
          <p className="text-xs text-slate-400">{card.label}</p>
          <p className="mono mt-1 text-sm font-semibold text-slate-100">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
