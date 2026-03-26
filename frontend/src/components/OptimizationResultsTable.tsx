import { useEffect, useMemo, useRef, useState } from "react";
import type { OptimizationRow } from "../lib/api-schema";
import StateBlock from "./ui/StateBlock";
import { humanizeConstraintList } from "./optimization/constraints";

interface Props {
  rows: OptimizationRow[];
  onApply: (row: OptimizationRow) => void;
  applyLabel?: string;
  viewMode: "table" | "cards";
  columnPreset: "core" | "full";
  visibleColumns?: Partial<Record<OptimizationResultsColumnKey, boolean>>;
}

export type OptimizationResultsColumnKey =
  | "leverage"
  | "grids"
  | "use_base_position"
  | "base_grid_count"
  | "initial_position_size"
  | "anchor_price"
  | "lower_price"
  | "upper_price"
  | "stop_price"
  | "band_width_pct"
  | "stop_loss_ratio_pct"
  | "max_possible_loss_usdt"
  | "total_return_usdt"
  | "max_drawdown_pct"
  | "sharpe_ratio"
  | "win_rate"
  | "score"
  | "validation_score"
  | "robust_score"
  | "overfit_penalty"
  | "passes_constraints"
  | "total_closed_trades"
  | "validation_total_closed_trades"
  | "actions";

export const OPTIMIZATION_RESULTS_COLUMN_LABEL: Record<OptimizationResultsColumnKey, string> = {
  leverage: "杠杆",
  grids: "网格",
  use_base_position: "开底仓",
  base_grid_count: "底仓格数",
  initial_position_size: "底仓规模",
  anchor_price: "Anchor",
  lower_price: "下边界",
  upper_price: "上边界",
  stop_price: "止损价",
  band_width_pct: "区间宽度%",
  stop_loss_ratio_pct: "止损%",
  max_possible_loss_usdt: "最大可能亏损",
  total_return_usdt: "总收益",
  max_drawdown_pct: "最大回撤%",
  sharpe_ratio: "夏普",
  win_rate: "胜率%",
  score: "评分",
  validation_score: "验证评分",
  robust_score: "稳健评分",
  overfit_penalty: "过拟合惩罚",
  passes_constraints: "约束",
  total_closed_trades: "交易数",
  validation_total_closed_trades: "验证交易数",
  actions: "操作"
};

const CORE_COLUMNS: OptimizationResultsColumnKey[] = [
  "leverage",
  "grids",
  "use_base_position",
  "lower_price",
  "upper_price",
  "stop_price",
  "total_return_usdt",
  "max_drawdown_pct",
  "score",
  "robust_score",
  "passes_constraints",
  "total_closed_trades",
  "actions"
];

const FULL_COLUMNS: OptimizationResultsColumnKey[] = [
  "leverage",
  "grids",
  "use_base_position",
  "base_grid_count",
  "initial_position_size",
  "anchor_price",
  "lower_price",
  "upper_price",
  "stop_price",
  "band_width_pct",
  "stop_loss_ratio_pct",
  "max_possible_loss_usdt",
  "total_return_usdt",
  "max_drawdown_pct",
  "sharpe_ratio",
  "win_rate",
  "score",
  "validation_score",
  "robust_score",
  "overfit_penalty",
  "passes_constraints",
  "total_closed_trades",
  "validation_total_closed_trades",
  "actions"
];

export function buildResultsColumnVisibility(
  preset: "core" | "full"
): Record<OptimizationResultsColumnKey, boolean> {
  const visibleSet = new Set(preset === "full" ? FULL_COLUMNS : CORE_COLUMNS);
  const next = {} as Record<OptimizationResultsColumnKey, boolean>;
  (Object.keys(OPTIMIZATION_RESULTS_COLUMN_LABEL) as OptimizationResultsColumnKey[]).forEach((key) => {
    next[key] = visibleSet.has(key);
  });
  next.actions = true;
  return next;
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

function renderConstraintCell(row: OptimizationRow) {
  if (row.passes_constraints) {
    return "通过";
  }
  const humanized = humanizeConstraintList(safeConstraintViolations(row.constraint_violations));
  return `未通过 (${humanized.join(" / ")})`;
}

export default function OptimizationResultsTable({
  rows,
  onApply,
  applyLabel = "应用到回测模块",
  viewMode,
  columnPreset,
  visibleColumns
}: Props) {
  if (!rows.length) {
    return <StateBlock variant="empty" message="暂无优化结果" minHeight={160} />;
  }

  if (viewMode === "cards") {
    return (
      <div className="mobile-two-col-grid grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rows.map((row) => (
          <div key={row.row_id} className="card p-3 text-xs text-slate-200">
            <p className="font-semibold text-slate-100">
              组合 #{row.row_id} · 杠杆 {fmt(row.leverage, 2)} 倍 · 网格 {row.grids}
            </p>
            <p className="mt-1">
              下边界 {fmt(row.lower_price, 2)} / 上边界 {fmt(row.upper_price, 2)} / 止损价 {fmt(row.stop_price, 2)}
            </p>
            <p className="mt-1">
              收益 <span className={row.total_return_usdt >= 0 ? "text-slate-100" : "text-rose-300"}>{fmt(row.total_return_usdt, 3)}</span>{" "}
              · 回撤 {fmt(row.max_drawdown_pct, 3)}% · 最大可能亏损 {fmt(row.max_possible_loss_usdt, 2)} USDT · 稳健评分 {fmt(row.robust_score, 4)}
            </p>
            <p className="mt-1 text-slate-300">约束: {renderConstraintCell(row)}</p>
            <div className="mobile-two-col-grid mt-2 grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:items-center min-[420px]:gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-xs w-full min-[420px]:w-auto"
                onClick={() => onApply(row)}
              >
                {applyLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const showFull = columnPreset === "full";
  const defaultVisibility = useMemo(
    () => buildResultsColumnVisibility(showFull ? "full" : "core"),
    [showFull]
  );
  const visibility = useMemo(
    () => ({
      ...defaultVisibility,
      ...(visibleColumns ?? {}),
      actions: true
    }),
    [defaultVisibility, visibleColumns]
  );
  const rowHeight = 36;
  const viewportHeight = 520;
  const overscan = 10;
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [rows, showFull, visibility]);

  const totalColumns = useMemo(() => {
    return (Object.keys(visibility) as OptimizationResultsColumnKey[]).reduce(
      (count, key) => count + (visibility[key] ? 1 : 0),
      0
    );
  }, [visibility]);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (rows.length - endIndex) * rowHeight);

  return (
    <div className="card fade-up w-full max-w-full p-2">
      <div className="mb-2 text-xs text-slate-400">虚拟渲染: {rows.length.toLocaleString()} 组</div>
      <p className="mb-2 text-[11px] text-slate-400 sm:hidden">可左右滑动查看完整列</p>
      <div className="overflow-x-auto">
        <div
          ref={scrollRef}
          className="max-h-[520px] overflow-y-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="w-max min-w-full border-collapse whitespace-nowrap text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900/95">
              <tr className="text-slate-300">
                {visibility.leverage && <th className="px-2 py-2 text-right">杠杆</th>}
                {visibility.grids && <th className="px-2 py-2 text-right">网格</th>}
                {visibility.use_base_position && <th className="px-2 py-2 text-right">开底仓</th>}
                {visibility.base_grid_count && <th className="px-2 py-2 text-right">底仓格数</th>}
                {visibility.initial_position_size && <th className="px-2 py-2 text-right">底仓规模</th>}
                {visibility.anchor_price && <th className="px-2 py-2 text-right">Anchor</th>}
                {visibility.lower_price && <th className="px-2 py-2 text-right">下边界</th>}
                {visibility.upper_price && <th className="px-2 py-2 text-right">上边界</th>}
                {visibility.stop_price && <th className="px-2 py-2 text-right">止损价</th>}
                {visibility.band_width_pct && <th className="px-2 py-2 text-right">区间宽度%</th>}
                {visibility.stop_loss_ratio_pct && <th className="px-2 py-2 text-right">止损%</th>}
                {visibility.max_possible_loss_usdt && <th className="px-2 py-2 text-right">最大可能亏损</th>}
                {visibility.total_return_usdt && <th className="px-2 py-2 text-right">总收益</th>}
                {visibility.max_drawdown_pct && <th className="px-2 py-2 text-right">最大回撤%</th>}
                {visibility.sharpe_ratio && <th className="px-2 py-2 text-right">夏普</th>}
                {visibility.win_rate && <th className="px-2 py-2 text-right">胜率%</th>}
                {visibility.score && <th className="px-2 py-2 text-right">评分</th>}
                {visibility.validation_score && <th className="px-2 py-2 text-right">验证评分</th>}
                {visibility.robust_score && <th className="px-2 py-2 text-right">稳健评分</th>}
                {visibility.overfit_penalty && <th className="px-2 py-2 text-right">过拟合惩罚</th>}
                {visibility.passes_constraints && <th className="px-2 py-2 text-right">约束</th>}
                {visibility.total_closed_trades && <th className="px-2 py-2 text-right">交易数</th>}
                {visibility.validation_total_closed_trades && <th className="px-2 py-2 text-right">验证交易数</th>}
                {visibility.actions && <th className="px-2 py-2 text-right">操作</th>}
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
                  {visibility.leverage && <td className="mono px-2 py-2 text-right">{fmt(row.leverage, 2)}</td>}
                  {visibility.grids && <td className="mono px-2 py-2 text-right">{row.grids}</td>}
                  {visibility.use_base_position && (
                    <td className="mono px-2 py-2 text-right">{row.use_base_position ? "是" : "否"}</td>
                  )}
                  {visibility.base_grid_count && <td className="mono px-2 py-2 text-right">{row.base_grid_count}</td>}
                  {visibility.initial_position_size && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.initial_position_size, 2)}</td>
                  )}
                  {visibility.anchor_price && <td className="mono px-2 py-2 text-right">{fmt(row.anchor_price, 2)}</td>}
                  {visibility.lower_price && <td className="mono px-2 py-2 text-right">{fmt(row.lower_price, 2)}</td>}
                  {visibility.upper_price && <td className="mono px-2 py-2 text-right">{fmt(row.upper_price, 2)}</td>}
                  {visibility.stop_price && <td className="mono px-2 py-2 text-right">{fmt(row.stop_price, 2)}</td>}
                  {visibility.band_width_pct && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.band_width_pct, 2)}</td>
                  )}
                  {visibility.stop_loss_ratio_pct && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.stop_loss_ratio_pct, 2)}</td>
                  )}
                  {visibility.max_possible_loss_usdt && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.max_possible_loss_usdt, 2)}</td>
                  )}
                  {visibility.total_return_usdt && (
                    <td
                      className={`mono px-2 py-2 text-right ${
                        row.total_return_usdt >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {fmt(row.total_return_usdt, 3)}
                    </td>
                  )}
                  {visibility.max_drawdown_pct && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.max_drawdown_pct, 3)}</td>
                  )}
                  {visibility.sharpe_ratio && <td className="mono px-2 py-2 text-right">{fmt(row.sharpe_ratio, 3)}</td>}
                  {visibility.win_rate && <td className="mono px-2 py-2 text-right">{fmt(row.win_rate * 100, 2)}</td>}
                  {visibility.score && <td className="mono px-2 py-2 text-right">{fmt(row.score, 4)}</td>}
                  {visibility.validation_score && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.validation_score, 4)}</td>
                  )}
                  {visibility.robust_score && <td className="mono px-2 py-2 text-right">{fmt(row.robust_score, 4)}</td>}
                  {visibility.overfit_penalty && (
                    <td className="mono px-2 py-2 text-right">{fmt(row.overfit_penalty, 4)}</td>
                  )}
                  {visibility.passes_constraints && (
                    <td
                      className={`mono px-2 py-2 text-right ${
                        row.passes_constraints ? "text-emerald-300" : "text-rose-300"
                      }`}
                      title={humanizeConstraintList(safeConstraintViolations(row.constraint_violations)).join(" / ")}
                    >
                      {row.passes_constraints ? "通过" : "未通过"}
                    </td>
                  )}
                  {visibility.total_closed_trades && (
                    <td className="mono px-2 py-2 text-right">{row.total_closed_trades}</td>
                  )}
                  {visibility.validation_total_closed_trades && (
                    <td className="mono px-2 py-2 text-right">{row.validation_total_closed_trades ?? "-"}</td>
                  )}
                  {visibility.actions && (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-xs"
                        onClick={() => onApply(row)}
                      >
                        {applyLabel}
                      </button>
                    </td>
                  )}
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
