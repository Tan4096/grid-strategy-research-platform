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
  const compactLabelClass = "mb-0.5 block text-[11px] leading-4 text-slate-400";
  const compactInputClass = "ui-input ui-input-sm !py-1.5";
  const inlineLabelClass = "shrink-0 text-[11px] leading-4 text-slate-400";
  const inlineInputClass = "ui-input ui-input-sm h-8 !py-1";

  const basicControls = (
    <div className="mobile-two-col-grid grid grid-cols-1 gap-x-2.5 gap-y-1.5 min-[520px]:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]">
      <div>
        <label className={compactLabelClass}>排序字段</label>
        <select className={compactInputClass} value={optimizationSortBy} onChange={(e) => onOptimizationSortByChange(e.target.value)}>
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
        <label className={compactLabelClass}>排序方向</label>
        <select
          className={compactInputClass}
          value={optimizationSortOrder}
          onChange={(e) => onOptimizationSortOrderChange(e.target.value as SortOrder)}
        >
          <option value="desc">↓</option>
          <option value="asc">↑</option>
        </select>
      </div>
      <div>
        <label className={compactLabelClass}>每页</label>
        <select
          className={`${compactInputClass} min-w-[5.5rem]`}
          value={optimizationPageSize}
          onChange={(e) => onOptimizationPageSizeChange(Number(e.target.value))}
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <div className="flex items-end pb-1">
        <p className="text-xs text-slate-400">
          {safeTotalResults} 组 · 第 {safePage}/{safeTotalPages} 页
        </p>
      </div>
    </div>
  );

  const advancedControls = (
    <>
      <div className="mobile-two-col-grid grid grid-cols-1 gap-x-2.5 gap-y-1.5 min-[520px]:grid-cols-2 xl:grid-cols-[auto_auto]">
        <div>
          <label className={compactLabelClass}>视图</label>
          <select
            className={compactInputClass}
            value={tableViewMode}
            disabled={isMobile}
            onChange={(e) => onTableViewPreferenceChange(e.target.value as TableViewMode)}
          >
            <option value="table">表格</option>
            <option value="cards">卡片</option>
          </select>
        </div>
        <div>
          <label className={compactLabelClass}>列预设</label>
          <select className={compactInputClass} value={tablePreset} onChange={(e) => applyColumnPreset(e.target.value as TablePreset)}>
            <option value="core">核心</option>
            <option value="full">诊断</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-slate-300">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPassedOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPassedOnlyChange(e.target.checked)}
          />
          仅显示通过约束
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPositiveOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPositiveOnlyChange(e.target.checked)}
          />
          仅显示正收益
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={diagnosticMode} onChange={(e) => onDiagnosticModeChange(e.target.checked)} />
          诊断模式
        </label>
      </div>

      <details className="rounded border border-slate-700/60 bg-slate-950/35 px-2 py-1.5">
        <summary className="cursor-pointer text-[11px] font-semibold text-slate-200">列配置</summary>
        <div className="mt-1.5 space-y-1.5">
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

  const desktopCompactControls = (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex min-w-[18rem] flex-1 items-center gap-1.5">
          <label className={inlineLabelClass}>排序字段</label>
          <select className={`${inlineInputClass} min-w-[10rem] flex-1`} value={optimizationSortBy} onChange={(e) => onOptimizationSortByChange(e.target.value)}>
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
        <div className="flex items-center gap-1.5">
          <label className={inlineLabelClass}>排序</label>
          <select
            className={`${inlineInputClass} w-[6.5rem]`}
            value={optimizationSortOrder}
            onChange={(e) => onOptimizationSortOrderChange(e.target.value as SortOrder)}
          >
            <option value="desc">↓</option>
            <option value="asc">↑</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className={inlineLabelClass}>每页</label>
          <select className={`${inlineInputClass} w-[5.25rem]`} value={optimizationPageSize} onChange={(e) => onOptimizationPageSizeChange(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className={inlineLabelClass}>视图</label>
          <select
            className={`${inlineInputClass} w-[6.5rem]`}
            value={tableViewMode}
            disabled={isMobile}
            onChange={(e) => onTableViewPreferenceChange(e.target.value as TableViewMode)}
          >
            <option value="table">表格</option>
            <option value="cards">卡片</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className={inlineLabelClass}>列预设</label>
          <select className={`${inlineInputClass} w-[6.5rem]`} value={tablePreset} onChange={(e) => applyColumnPreset(e.target.value as TablePreset)}>
            <option value="core">核心</option>
            <option value="full">诊断</option>
          </select>
        </div>
        <p className="ml-auto whitespace-nowrap text-xs text-slate-400">
          {safeTotalResults} 组 · 第 {safePage}/{safeTotalPages} 页
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPassedOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPassedOnlyChange(e.target.checked)}
          />
          仅显示通过约束
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showPositiveOnly}
            disabled={diagnosticMode}
            onChange={(e) => onShowPositiveOnlyChange(e.target.checked)}
          />
          仅显示正收益
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={diagnosticMode} onChange={(e) => onDiagnosticModeChange(e.target.checked)} />
          诊断模式
        </label>

        <details className="ml-auto rounded border border-slate-700/60 bg-slate-950/35 px-2 py-1">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-200">列配置</summary>
          <div className="mt-1.5 space-y-1.5">
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
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="space-y-1.5">
        {basicControls}
        <details className="card-sub p-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">筛选与诊断</summary>
          <div className="mt-1.5 space-y-2">{advancedControls}</div>
        </details>
      </div>
    );
  }

  return desktopCompactControls;
}
