import { useMemo, useState } from "react";
import { OptimizationRow } from "../types";
import StateBlock from "./ui/StateBlock";
import { humanizeConstraintList } from "./optimization/constraints";

interface Props {
  rows: OptimizationRow[];
  onApply: (row: OptimizationRow) => void;
  onCompare: (row: OptimizationRow) => void;
  viewMode: "table" | "cards";
  columnPreset: "core" | "full";
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function renderConstraintCell(row: OptimizationRow) {
  if (row.passes_constraints) {
    return "通过";
  }
  const humanized = humanizeConstraintList(row.constraint_violations);
  return `未通过 (${humanized.join(" / ")})`;
}

export default function OptimizationResultsTable({ rows, onApply, onCompare, viewMode, columnPreset }: Props) {
  if (!rows.length) {
    return <StateBlock variant="empty" message="暂无优化结果" minHeight={160} />;
  }

  if (viewMode === "cards") {
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rows.map((row) => (
          <div key={row.row_id} className="card p-3 text-xs text-slate-200">
            <p className="font-semibold text-slate-100">
              组合 #{row.row_id} · 杠杆 {fmt(row.leverage, 2)}x · 网格 {row.grids}
            </p>
            <p className="mt-1">
              LOWER {fmt(row.lower_price, 2)} / UPPER {fmt(row.upper_price, 2)} / STOP {fmt(row.stop_price, 2)}
            </p>
            <p className="mt-1">
              收益 <span className={row.total_return_usdt >= 0 ? "text-slate-100" : "text-rose-300"}>{fmt(row.total_return_usdt, 3)}</span>{" "}
              · 回撤 {fmt(row.max_drawdown_pct, 3)}% · 稳健评分 {fmt(row.robust_score, 4)}
            </p>
            <p className="mt-1 text-slate-300">约束: {renderConstraintCell(row)}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-slate-700"
                onClick={() => onApply(row)}
              >
                应用到回测模块
              </button>
              <button
                type="button"
                className="rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                onClick={() => onCompare(row)}
              >
                对比回测
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const showFull = columnPreset === "full";
  const rowHeight = 36;
  const viewportHeight = 520;
  const overscan = 10;
  const [scrollTop, setScrollTop] = useState(0);

  const totalColumns = useMemo(() => {
    const base = 13;
    return showFull ? base + 10 : base;
  }, [showFull]);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (rows.length - endIndex) * rowHeight);

  return (
    <div className="card fade-up w-full max-w-full p-2">
      <div className="mb-2 text-xs text-slate-400">虚拟渲染: {rows.length.toLocaleString()} 组</div>
      <div className="overflow-x-auto">
        <div
          className="max-h-[520px] overflow-y-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="w-max min-w-full border-collapse whitespace-nowrap text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900/95">
          <tr className="text-slate-300">
            <th className="px-2 py-2 text-right">杠杆</th>
            <th className="px-2 py-2 text-right">网格</th>
            <th className="px-2 py-2 text-right">开底仓</th>
            {showFull && <th className="px-2 py-2 text-right">底仓格数</th>}
            {showFull && <th className="px-2 py-2 text-right">底仓规模</th>}
            {showFull && <th className="px-2 py-2 text-right">Anchor</th>}
            <th className="px-2 py-2 text-right">LOWER</th>
            <th className="px-2 py-2 text-right">UPPER</th>
            <th className="px-2 py-2 text-right">STOP_PRICE</th>
            {showFull && <th className="px-2 py-2 text-right">区间宽度%</th>}
            {showFull && <th className="px-2 py-2 text-right">止损%</th>}
            <th className="px-2 py-2 text-right">总收益</th>
            <th className="px-2 py-2 text-right">最大回撤%</th>
            {showFull && <th className="px-2 py-2 text-right">夏普</th>}
            {showFull && <th className="px-2 py-2 text-right">胜率%</th>}
            <th className="px-2 py-2 text-right">评分</th>
            {showFull && <th className="px-2 py-2 text-right">验证评分</th>}
            <th className="px-2 py-2 text-right">稳健评分</th>
            {showFull && <th className="px-2 py-2 text-right">过拟合惩罚</th>}
            <th className="px-2 py-2 text-right">约束</th>
            <th className="px-2 py-2 text-right">交易数</th>
            {showFull && <th className="px-2 py-2 text-right">验证交易数</th>}
            <th className="px-2 py-2 text-right">操作</th>
          </tr>
            </thead>
            <tbody>
              {topPad > 0 && (
                <tr>
                  <td style={{ height: topPad }} colSpan={totalColumns} />
                </tr>
              )}

              {visibleRows.map((row) => (
            <tr key={row.row_id} className="border-t border-slate-700/50 text-slate-100">
              <td className="mono px-2 py-2 text-right">{fmt(row.leverage, 2)}</td>
              <td className="mono px-2 py-2 text-right">{row.grids}</td>
              <td className="mono px-2 py-2 text-right">{row.use_base_position ? "是" : "否"}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{row.base_grid_count}</td>}
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.initial_position_size, 2)}</td>}
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.anchor_price, 2)}</td>}
              <td className="mono px-2 py-2 text-right">{fmt(row.lower_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.upper_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(row.stop_price, 2)}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.band_width_pct, 2)}</td>}
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.stop_loss_ratio_pct, 2)}</td>}
              <td
                className={`mono px-2 py-2 text-right ${
                  row.total_return_usdt >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {fmt(row.total_return_usdt, 3)}
              </td>
              <td className="mono px-2 py-2 text-right">{fmt(row.max_drawdown_pct, 3)}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.sharpe_ratio, 3)}</td>}
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.win_rate * 100, 2)}</td>}
              <td className="mono px-2 py-2 text-right">{fmt(row.score, 4)}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.validation_score, 4)}</td>}
              <td className="mono px-2 py-2 text-right">{fmt(row.robust_score, 4)}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{fmt(row.overfit_penalty, 4)}</td>}
              <td
                className={`mono px-2 py-2 text-right ${row.passes_constraints ? "text-emerald-300" : "text-rose-300"}`}
                title={humanizeConstraintList(row.constraint_violations).join(" / ")}
              >
                {row.passes_constraints ? "通过" : "未通过"}
              </td>
              <td className="mono px-2 py-2 text-right">{row.total_closed_trades}</td>
              {showFull && <td className="mono px-2 py-2 text-right">{row.validation_total_closed_trades ?? "-"}</td>}
              <td className="px-2 py-2 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-slate-700"
                    onClick={() => onApply(row)}
                  >
                    应用
                  </button>
                  <button
                    type="button"
                    className="rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                    onClick={() => onCompare(row)}
                  >
                    对比
                  </button>
                </div>
              </td>
            </tr>
              ))}

              {bottomPad > 0 && (
                <tr>
                  <td style={{ height: bottomPad }} colSpan={totalColumns} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
