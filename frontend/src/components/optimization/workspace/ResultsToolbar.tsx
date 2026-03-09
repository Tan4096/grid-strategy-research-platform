import type { SortOrder } from "../../../lib/api-schema";
import {
  OptimizationResultsColumnKey,
  OPTIMIZATION_RESULTS_COLUMN_LABEL
} from "../../OptimizationResultsTable";
import { TablePreset, TableViewMode } from "./useResultWorkspaceState";

interface Props {
  isMobile: boolean;
  optimizationSortBy: string;
  onOptimizationSortByChange: (value: string) => void;
  optimizationSortOrder: SortOrder;
  onOptimizationSortOrderChange: (value: SortOrder) => void;
  optimizationPageSize: number;
  onOptimizationPageSizeChange: (value: number) => void;
  tableViewMode: TableViewMode;
  onTableViewPreferenceChange: (value: TableViewMode) => void;
  tablePreset: TablePreset;
  applyColumnPreset: (preset: TablePreset) => void;
  safeTotalResults: number;
  safePage: number;
  safeTotalPages: number;
  showPassedOnly: boolean;
  onShowPassedOnlyChange: (next: boolean) => void;
  showPositiveOnly: boolean;
  onShowPositiveOnlyChange: (next: boolean) => void;
  diagnosticMode: boolean;
  onDiagnosticModeChange: (next: boolean) => void;
  columnKeys: OptimizationResultsColumnKey[];
  columnVisibility: Partial<Record<OptimizationResultsColumnKey, boolean>>;
  toggleColumnVisibility: (key: OptimizationResultsColumnKey, checked: boolean) => void;
}

export default function ResultsToolbar({
  isMobile,
  optimizationSortBy,
  onOptimizationSortByChange,
  optimizationSortOrder,
  onOptimizationSortOrderChange,
  optimizationPageSize,
  onOptimizationPageSizeChange,
  tableViewMode,
  onTableViewPreferenceChange,
  tablePreset,
  applyColumnPreset,
  safeTotalResults,
  safePage,
  safeTotalPages,
  showPassedOnly,
  onShowPassedOnlyChange,
  showPositiveOnly,
  onShowPositiveOnlyChange,
  diagnosticMode,
  onDiagnosticModeChange,
  columnKeys,
  columnVisibility,
  toggleColumnVisibility
}: Props) {
  const basicControls = (
    <div className="mobile-two-col-grid grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]">
      <div>
        <label className="mb-1 block text-xs text-slate-400">排序字段</label>
        <select className="ui-input" value={optimizationSortBy} onChange={(e) => onOptimizationSortByChange(e.target.value)}>
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
          className="ui-input"
          value={optimizationSortOrder}
          onChange={(e) => onOptimizationSortOrderChange(e.target.value as SortOrder)}
        >
          <option value="desc">DESC</option>
          <option value="asc">ASC</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">每页</label>
        <select className="ui-input" value={optimizationPageSize} onChange={(e) => onOptimizationPageSizeChange(Number(e.target.value))}>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <div className="flex items-end">
        <p className="text-xs text-slate-400">
          {safeTotalResults} 组 · 第 {safePage}/{safeTotalPages} 页
        </p>
      </div>
    </div>
  );

  const advancedControls = (
    <>
      <div className="mobile-two-col-grid grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-[auto_auto]">
        <div>
          <label className="mb-1 block text-xs text-slate-400">视图</label>
          <select
            className="ui-input"
            value={tableViewMode}
            disabled={isMobile}
            onChange={(e) => onTableViewPreferenceChange(e.target.value as TableViewMode)}
          >
            <option value="table">表格</option>
            <option value="cards">卡片</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">列预设</label>
          <select className="ui-input" value={tablePreset} onChange={(e) => applyColumnPreset(e.target.value as TablePreset)}>
            <option value="core">核心</option>
            <option value="full">诊断</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showPassedOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPassedOnlyChange(e.target.checked)}
          />
          仅显示通过约束
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showPositiveOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPositiveOnlyChange(e.target.checked)}
          />
          仅显示正收益
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={diagnosticMode} onChange={(e) => onDiagnosticModeChange(e.target.checked)} />
          诊断模式
        </label>
      </div>

      <details className="rounded border border-slate-700/60 bg-slate-950/35 px-2.5 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-200">列配置（持久化）</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={() => applyColumnPreset("core")}>重置为核心列</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={() => applyColumnPreset("full")}>重置为诊断列</button>
          </div>
          <div className="mobile-two-col-grid grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {columnKeys
              .filter((key) => key !== "actions")
              .map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={columnVisibility[key] !== false}
                    onChange={(event) => toggleColumnVisibility(key, event.target.checked)}
                  />
                  {OPTIMIZATION_RESULTS_COLUMN_LABEL[key]}
                </label>
              ))}
          </div>
        </div>
      </details>
    </>
  );

  if (isMobile) {
    return (
      <div className="space-y-2">
        {basicControls}
        <details className="card-sub p-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">筛选与诊断</summary>
          <div className="mt-2 space-y-3">{advancedControls}</div>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {basicControls}
      {advancedControls}
    </div>
  );
}
