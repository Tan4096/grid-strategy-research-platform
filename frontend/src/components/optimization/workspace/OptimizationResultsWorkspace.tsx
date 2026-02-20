import { Suspense, lazy, useMemo, useState } from "react";
import { OptimizationRow, OptimizationStatusResponse, SortOrder } from "../../../types";
import OptimizationResultsTable from "../../OptimizationResultsTable";
import StateBlock from "../../ui/StateBlock";
import { humanizeConstraintList } from "../constraints";

const LineChart = lazy(() => import("../../LineChart"));
const OptimizationHeatmap = lazy(() => import("../../OptimizationHeatmap"));
const OptimizationProgressChart = lazy(() => import("../../OptimizationProgressChart"));
const OptimizationRobustnessReport = lazy(() => import("../../OptimizationRobustnessReport"));

export type OptimizationResultTab = "table" | "heatmap" | "curves" | "robustness";
type TableViewMode = "table" | "cards";
type TablePreset = "core" | "full";

interface Props {
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationResultTab: OptimizationResultTab;
  onOptimizationResultTabChange: (tab: OptimizationResultTab) => void;
  onApplyOptimizationRow: (row: OptimizationRow) => void;
  onCompareOptimizationRow: (row: OptimizationRow) => void;
  onCopyLiveParams: (row: OptimizationRow) => void;
  optimizationSortBy: string;
  onOptimizationSortByChange: (value: string) => void;
  optimizationSortOrder: SortOrder;
  onOptimizationSortOrderChange: (value: SortOrder) => void;
  optimizationPageSize: number;
  onOptimizationPageSizeChange: (value: number) => void;
  optimizationPage: number;
  totalOptimizationPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}

const OPTIMIZATION_RESULT_TABS: Array<{ id: OptimizationResultTab; label: string }> = [
  { id: "table", label: "结果表格" },
  { id: "heatmap", label: "热力图" },
  { id: "curves", label: "曲线分析" },
  { id: "robustness", label: "稳健性报告" }
];

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function ChartFallback({ minHeight = "220px" }: { minHeight?: string }) {
  return (
    <div className="card flex items-center justify-center p-4 text-sm text-slate-400" style={{ minHeight }}>
      图表加载中...
    </div>
  );
}

export default function OptimizationResultsWorkspace({
  optimizationStatus,
  optimizationResultTab,
  onOptimizationResultTabChange,
  onApplyOptimizationRow,
  onCompareOptimizationRow,
  onCopyLiveParams,
  optimizationSortBy,
  onOptimizationSortByChange,
  optimizationSortOrder,
  onOptimizationSortOrderChange,
  optimizationPageSize,
  onOptimizationPageSizeChange,
  optimizationPage,
  totalOptimizationPages,
  onPrevPage,
  onNextPage
}: Props) {
  const [showPassedOnly, setShowPassedOnly] = useState(true);
  const [showPositiveOnly, setShowPositiveOnly] = useState(true);
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>("table");
  const [tablePreset, setTablePreset] = useState<TablePreset>("core");

  const filteredRows = useMemo(() => {
    if (!optimizationStatus) {
      return [];
    }
    let rows = optimizationStatus.rows;
    if (diagnosticMode) {
      return rows;
    }
    if (showPassedOnly) {
      rows = rows.filter((row) => row.passes_constraints);
    }
    if (showPositiveOnly) {
      rows = rows.filter((row) => row.total_return_usdt > 0);
    }
    return rows;
  }, [optimizationStatus, showPassedOnly, showPositiveOnly, diagnosticMode]);

  if (!optimizationStatus) {
    return <StateBlock variant="empty" message="暂无优化结果。" minHeight={160} />;
  }

  const bestRow = optimizationStatus.best_row;

  return (
    <>
      {bestRow && (
        <div className="card p-3 text-xs text-slate-200">
          <p className="font-semibold text-slate-100">最优参数摘要</p>
          <p className="mt-1">
            杠杆 {fmt(bestRow.leverage, 2)}x · 网格 {bestRow.grids} · LOWER {fmt(bestRow.lower_price, 2)} · UPPER {fmt(bestRow.upper_price, 2)} · STOP{" "}
            {fmt(bestRow.stop_price, 2)}
          </p>
          <p className="mt-1">
            收益 {fmt(bestRow.total_return_usdt, 2)} · 回撤 {fmt(bestRow.max_drawdown_pct, 2)}% · 稳健评分 {fmt(bestRow.robust_score, 4)}
          </p>
          {!bestRow.passes_constraints && (
            <p className="mt-1 text-slate-300">未通过约束: {humanizeConstraintList(bestRow.constraint_violations).join(" / ")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-slate-700"
              onClick={() => onApplyOptimizationRow(bestRow)}
            >
              应用到回测模块
            </button>
            <button
              type="button"
              className="rounded border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
              onClick={() => onCompareOptimizationRow(bestRow)}
            >
              对比回测
            </button>
            <button
              type="button"
              className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
              onClick={() => onCopyLiveParams(bestRow)}
            >
              复制 JSON 参数
            </button>
          </div>
        </div>
      )}

      <div className="card p-3">
        <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-slate-700/70 bg-slate-950/40 p-1">
          {OPTIMIZATION_RESULT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                optimizationResultTab === tab.id
                  ? "border border-slate-300/70 bg-slate-200/20 text-slate-100"
                  : "border border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80"
              }`}
              onClick={() => onOptimizationResultTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {optimizationResultTab === "table" && (
        <>
          <div className="card p-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto_auto_auto_auto]">
              <div>
                <label className="mb-1 block text-xs text-slate-400">排序字段</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                  value={optimizationSortBy}
                  onChange={(e) => onOptimizationSortByChange(e.target.value)}
                >
                  <option value="robust_score">robust_score</option>
                  <option value="score">score</option>
                  <option value="overfit_penalty">overfit_penalty</option>
                  <option value="total_return_usdt">total_return_usdt</option>
                  <option value="max_drawdown_pct">max_drawdown_pct</option>
                  <option value="sharpe_ratio">sharpe_ratio</option>
                  <option value="return_drawdown_ratio">return_drawdown_ratio</option>
                  <option value="validation_score">validation_score</option>
                  <option value="validation_total_return_usdt">validation_total_return_usdt</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">排序方向</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                  value={optimizationSortOrder}
                  onChange={(e) => onOptimizationSortOrderChange(e.target.value as SortOrder)}
                >
                  <option value="desc">DESC</option>
                  <option value="asc">ASC</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">每页</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                  value={optimizationPageSize}
                  onChange={(e) => onOptimizationPageSizeChange(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">视图</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                  value={tableViewMode}
                  onChange={(e) => setTableViewMode(e.target.value as TableViewMode)}
                >
                  <option value="table">表格</option>
                  <option value="cards">卡片</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">列预设</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                  value={tablePreset}
                  onChange={(e) => setTablePreset(e.target.value as TablePreset)}
                >
                  <option value="core">核心</option>
                  <option value="full">诊断</option>
                </select>
              </div>
              <div className="flex items-end">
                <p className="text-xs text-slate-400">
                  {optimizationStatus.total_results} 组 · 第 {optimizationPage}/{totalOptimizationPages} 页
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPassedOnly}
                  disabled={diagnosticMode}
                  onChange={(e) => setShowPassedOnly(e.target.checked)}
                />
                仅显示通过约束
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPositiveOnly}
                  disabled={diagnosticMode}
                  onChange={(e) => setShowPositiveOnly(e.target.checked)}
                />
                仅显示正收益
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={diagnosticMode}
                  onChange={(e) => setDiagnosticMode(e.target.checked)}
                />
                诊断模式
              </label>
            </div>
          </div>

          {filteredRows.length > 0 ? (
            <OptimizationResultsTable
              rows={filteredRows}
              onApply={onApplyOptimizationRow}
              onCompare={onCompareOptimizationRow}
              viewMode={tableViewMode}
              columnPreset={tablePreset}
            />
          ) : (
            <StateBlock variant="empty" message="当前筛选条件下暂无结果。" minHeight={120} />
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
              disabled={optimizationPage <= 1}
              onClick={onPrevPage}
            >
              上一页
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
              disabled={optimizationPage >= totalOptimizationPages}
              onClick={onNextPage}
            >
              下一页
            </button>
          </div>
        </>
      )}

      {optimizationResultTab === "heatmap" && (
        <Suspense fallback={<ChartFallback minHeight="400px" />}>
          <OptimizationHeatmap data={optimizationStatus.heatmap} />
        </Suspense>
      )}

      {optimizationResultTab === "curves" && (
        <div className="space-y-4">
          {(optimizationStatus.best_score_progression.length > 0 || optimizationStatus.convergence_curve_data.length > 0) && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {optimizationStatus.best_score_progression.length > 0 && (
                <Suspense fallback={<ChartFallback minHeight="320px" />}>
                  <OptimizationProgressChart
                    title="Best Score Progression"
                    data={optimizationStatus.best_score_progression}
                    color="#22c55e"
                    yAxisLabel="score"
                  />
                </Suspense>
              )}
              {optimizationStatus.convergence_curve_data.length > 0 && (
                <Suspense fallback={<ChartFallback minHeight="320px" />}>
                  <OptimizationProgressChart
                    title="Convergence Curve"
                    data={optimizationStatus.convergence_curve_data}
                    color="#38bdf8"
                    yAxisLabel="score"
                    area
                  />
                </Suspense>
              )}
            </div>
          )}

          {optimizationStatus.best_equity_curve.length > 0 ? (
            <Suspense fallback={<ChartFallback minHeight="340px" />}>
              <LineChart
                title="最优参数收益曲线"
                data={optimizationStatus.best_equity_curve}
                color="#22c55e"
                yAxisLabel="USDT"
                area
              />
            </Suspense>
          ) : (
            <StateBlock variant="empty" message="暂无最优参数收益曲线" minHeight={140} />
          )}
        </div>
      )}

      {optimizationResultTab === "robustness" && (
        <Suspense fallback={<ChartFallback minHeight="400px" />}>
          <OptimizationRobustnessReport rows={optimizationStatus.rows} bestRow={optimizationStatus.best_row} />
        </Suspense>
      )}
    </>
  );
}
