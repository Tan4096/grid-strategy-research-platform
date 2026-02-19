import { OptimizationRow } from "../types";

interface Props {
  rows: OptimizationRow[];
  onApply: (row: OptimizationRow) => void;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export default function OptimizationResultsTable({ rows, onApply }: Props) {
  if (!rows.length) {
    return (
      <div className="card p-4">
        <p className="text-sm text-slate-300">暂无优化结果</p>
      </div>
    );
  }

  return (
    <div className="card fade-up w-full max-w-full overflow-x-auto p-2">
      <table className="w-max min-w-full border-collapse whitespace-nowrap text-xs">
        <thead>
          <tr className="text-slate-300">
            <th className="px-2 py-2 text-right">杠杆</th>
            <th className="px-2 py-2 text-right">网格</th>
            <th className="px-2 py-2 text-right">开底仓</th>
            <th className="px-2 py-2 text-right">底仓格数</th>
            <th className="px-2 py-2 text-right">底仓规模</th>
            <th className="px-2 py-2 text-right">Anchor</th>
            <th className="px-2 py-2 text-right">LOWER</th>
            <th className="px-2 py-2 text-right">UPPER</th>
            <th className="px-2 py-2 text-right">STOP_PRICE</th>
            <th className="px-2 py-2 text-right">区间宽度%</th>
            <th className="px-2 py-2 text-right">止损%</th>
            <th className="px-2 py-2 text-right">总收益</th>
            <th className="px-2 py-2 text-right">最大回撤%</th>
            <th className="px-2 py-2 text-right">夏普</th>
            <th className="px-2 py-2 text-right">胜率%</th>
            <th className="px-2 py-2 text-right">评分</th>
            <th className="px-2 py-2 text-right">验证评分</th>
            <th className="px-2 py-2 text-right">稳健评分</th>
            <th className="px-2 py-2 text-right">过拟合惩罚</th>
            <th className="px-2 py-2 text-right">约束</th>
            <th className="px-2 py-2 text-right">交易数</th>
            <th className="px-2 py-2 text-right">验证交易数</th>
            <th className="px-2 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row_id} className="border-t border-slate-700/50 text-slate-100">
              <td className="mono px-2 py-2 text-right">{fmt(row.leverage, 2)}</td>
              <td className="mono px-2 py-2 text-right">{row.grids}</td>
              <td className="mono px-2 py-2 text-right">{row.use_base_position ? "是" : "否"}</td>
              <td className="mono px-2 py-2 text-right">{row.base_grid_count}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.initial_position_size, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.anchor_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.lower_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.upper_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.stop_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.band_width_pct, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.stop_loss_ratio_pct, 2)}</td>
              <td
                className={`mono px-2 py-2 text-right ${
                  row.total_return_usdt >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {fmt(row.total_return_usdt, 3)}
              </td>
              <td className="mono px-2 py-2 text-right">{fmt(row.max_drawdown_pct, 3)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.sharpe_ratio, 3)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.win_rate * 100, 2)}</td>
              <td className="mono px-2 py-2 text-right text-cyan-300">{fmt(row.score, 4)}</td>
              <td className="mono px-2 py-2 text-right text-amber-300">{fmt(row.validation_score, 4)}</td>
              <td className="mono px-2 py-2 text-right text-emerald-300">{fmt(row.robust_score, 4)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.overfit_penalty, 4)}</td>
              <td
                className={`mono px-2 py-2 text-right ${row.passes_constraints ? "text-emerald-300" : "text-rose-300"}`}
                title={row.constraint_violations.join(", ")}
              >
                {row.passes_constraints ? "通过" : "未通过"}
              </td>
              <td className="mono px-2 py-2 text-right">{row.total_closed_trades}</td>
              <td className="mono px-2 py-2 text-right">{row.validation_total_closed_trades ?? "-"}</td>
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  className="rounded border border-cyan-400/60 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                  onClick={() => onApply(row)}
                >
                  应用到回测模块
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
