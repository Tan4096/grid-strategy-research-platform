import type { OptimizationRow } from "../../../lib/api-schema";
import { humanizeConstraintList } from "../constraints";

interface Props {
  bestRow: OptimizationRow | null;
  onApplyOptimizationRow: (row: OptimizationRow) => void;
  onCopyLiveParams: (row: OptimizationRow) => void;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function safeConstraintViolations(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

export default function OptimizationBestSummaryCard({
  bestRow,
  onApplyOptimizationRow,
  onCopyLiveParams
}: Props) {
  if (!bestRow) {
    return null;
  }

  return (
    <div className="card p-3 text-xs text-slate-200">
      <p className="font-semibold text-slate-100">最优参数摘要</p>
      <p className="mt-1">
        杠杆 {fmt(bestRow.leverage, 2)} 倍 · 网格 {bestRow.grids} · 下边界 {fmt(bestRow.lower_price, 2)} · 上边界{" "}
        {fmt(bestRow.upper_price, 2)} · 止损价 {fmt(bestRow.stop_price, 2)}
      </p>
      <p className="mt-1">
        收益 {fmt(bestRow.total_return_usdt, 2)} · 回撤 {fmt(bestRow.max_drawdown_pct, 2)}% · 最大可能亏损{" "}
        {fmt(bestRow.max_possible_loss_usdt, 2)} USDT · 稳健评分 {fmt(bestRow.robust_score, 4)}
      </p>
      {!bestRow.passes_constraints && (
        <p className="mt-1 text-slate-300">
          未通过约束: {humanizeConstraintList(safeConstraintViolations(bestRow.constraint_violations)).join(" / ")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs"
          onClick={() => onApplyOptimizationRow(bestRow)}
        >
          应用到回测模块
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs"
          onClick={() => onCopyLiveParams(bestRow)}
        >
          复制 JSON 参数
        </button>
      </div>
    </div>
  );
}
