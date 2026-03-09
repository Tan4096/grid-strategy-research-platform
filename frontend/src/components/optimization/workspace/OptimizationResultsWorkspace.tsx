import { Suspense, lazy, useMemo, useState } from "react";
import type { OptimizationRow, OptimizationStatusResponse, SortOrder } from "../../../lib/api-schema";
import OptimizationBestSummaryCard from "./OptimizationBestSummaryCard";
import MobileAnalysisSheet from "./MobileAnalysisSheet";
import MobileResultsTableSheet from "./MobileResultsTableSheet";
import ResultsCurvesPanel from "./ResultsCurvesPanel";
import ResultsTablePanel from "./ResultsTablePanel";
import {
  filterOptimizationRows,
  OptimizationResultTab,
  useResultWorkspaceState
} from "./useResultWorkspaceState";
export type { OptimizationResultTab } from "./useResultWorkspaceState";

const OptimizationHeatmap = lazy(() => import("../../OptimizationHeatmap"));
const OptimizationRobustnessReport = lazy(() => import("../../OptimizationRobustnessReport"));

interface Props {
  optimizationStatus: OptimizationStatusResponse | null;
  initialMargin: number;
  optimizationResultTab: OptimizationResultTab;
  onOptimizationResultTabChange: (tab: OptimizationResultTab) => void;
  onApplyOptimizationRow: (row: OptimizationRow) => void;
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
  isMobileViewport?: boolean;
  onOpenHistory?: () => void;
}

const OPTIMIZATION_RESULT_TABS: Array<{ id: OptimizationResultTab; label: string; mobileLabel: string }> = [
  { id: "table", label: "结果表格", mobileLabel: "表格" },
  { id: "heatmap", label: "热力图", mobileLabel: "热力" },
  { id: "curves", label: "曲线分析", mobileLabel: "曲线" },
  { id: "robustness", label: "稳健性报告", mobileLabel: "报告" }
];
function ChartFallback({ minHeight = "220px" }: { minHeight?: string }) {
  return (
    <div className="card flex items-center justify-center p-4 text-sm text-slate-400" style={{ minHeight }}>
      图表加载中...
    </div>
  );
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export default function OptimizationResultsWorkspace({
  optimizationStatus,
  initialMargin,
  optimizationResultTab,
  onOptimizationResultTabChange,
  onApplyOptimizationRow,
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
  onNextPage,
  isMobileViewport = false,
  onOpenHistory
}: Props) {
  const [mobileResultsTableOpen, setMobileResultsTableOpen] = useState(false);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const {
    isMobile,
    showPassedOnly,
    setShowPassedOnly,
    showPositiveOnly,
    setShowPositiveOnly,
    diagnosticMode,
    setDiagnosticMode,
    tableViewMode,
    setTableViewPreference,
    tablePreset,
    columnVisibility,
    applyColumnPreset,
    toggleColumnVisibility,
    curveHoverRatio,
    setCurveHoverRatio,
    columnKeys
  } = useResultWorkspaceState({ optimizationResultTab });

  const allRows = useMemo(
    () => (optimizationStatus && Array.isArray(optimizationStatus.rows) ? optimizationStatus.rows : []),
    [optimizationStatus]
  );

  const filteredRows = useMemo(() => {
    if (!optimizationStatus) {
      return [];
    }
    return filterOptimizationRows(allRows, { showPassedOnly, showPositiveOnly, diagnosticMode });
  }, [optimizationStatus, allRows, showPassedOnly, showPositiveOnly, diagnosticMode]);

  const hasStatus = Boolean(optimizationStatus);
  const bestRow = optimizationStatus?.best_row ?? null;
  const bestEquityCurve = Array.isArray(optimizationStatus?.best_equity_curve)
    ? optimizationStatus.best_equity_curve
    : [];
  const bestScoreProgression = Array.isArray(optimizationStatus?.best_score_progression)
    ? optimizationStatus.best_score_progression
    : [];
  const convergenceCurveData = Array.isArray(optimizationStatus?.convergence_curve_data)
    ? optimizationStatus.convergence_curve_data
    : [];
  const bestScoreCurve = bestScoreProgression.map((point) => ({
    timestamp: `步骤 ${point.step}`,
    value: point.value
  }));
  const convergenceCurve = convergenceCurveData.map((point) => ({
    timestamp: `步骤 ${point.step}`,
    value: point.value
  }));
  const heatmap = Array.isArray(optimizationStatus?.heatmap) ? optimizationStatus.heatmap : [];
  const safeTotalResults =
    typeof optimizationStatus?.total_results === "number" && Number.isFinite(optimizationStatus.total_results)
      ? optimizationStatus.total_results
      : allRows.length;
  const safeTotalPages = Math.max(1, Number.isFinite(totalOptimizationPages) ? totalOptimizationPages : 1);
  const safePage = Math.min(Math.max(1, optimizationPage), safeTotalPages);
  const mobilePreviewRows = filteredRows.slice(0, 5);
  const showMobileRunningHint =
    optimizationStatus?.job.status === "running" || optimizationStatus?.job.status === "pending";

  const tableContent = hasStatus ? (
    <ResultsTablePanel
      isMobile={isMobile}
      filteredRowsCount={filteredRows.length}
      filteredRows={filteredRows}
      onApplyOptimizationRow={onApplyOptimizationRow}
      optimizationSortBy={optimizationSortBy}
      onOptimizationSortByChange={onOptimizationSortByChange}
      optimizationSortOrder={optimizationSortOrder}
      onOptimizationSortOrderChange={onOptimizationSortOrderChange}
      optimizationPageSize={optimizationPageSize}
      onOptimizationPageSizeChange={onOptimizationPageSizeChange}
      tableViewMode={tableViewMode}
      onTableViewPreferenceChange={setTableViewPreference}
      tablePreset={tablePreset}
      applyColumnPreset={applyColumnPreset}
      safeTotalResults={safeTotalResults}
      safePage={safePage}
      safeTotalPages={safeTotalPages}
      showPassedOnly={showPassedOnly}
      onShowPassedOnlyChange={setShowPassedOnly}
      showPositiveOnly={showPositiveOnly}
      onShowPositiveOnlyChange={setShowPositiveOnly}
      diagnosticMode={diagnosticMode}
      onDiagnosticModeChange={setDiagnosticMode}
      columnKeys={columnKeys}
      columnVisibility={columnVisibility}
      toggleColumnVisibility={toggleColumnVisibility}
      optimizationPage={optimizationPage}
      onPrevPage={onPrevPage}
      onNextPage={onNextPage}
    />
  ) : (
    <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-slate-700/70 p-4 text-sm text-slate-300">
      暂无优化结果。
    </div>
  );

  let advancedContent;
  if (!hasStatus) {
    advancedContent = (
      <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-slate-700/70 p-4 text-sm text-slate-300">
        暂无可分析数据。
      </div>
    );
  } else if (optimizationResultTab === "heatmap") {
    advancedContent = (
      <Suspense fallback={<ChartFallback minHeight="340px" />}>
        <OptimizationHeatmap data={heatmap} />
      </Suspense>
    );
  } else if (optimizationResultTab === "curves") {
    advancedContent = (
      <ResultsCurvesPanel
        bestScoreCurve={bestScoreCurve}
        initialMargin={initialMargin}
        convergenceCurve={convergenceCurve}
        bestEquityCurve={bestEquityCurve}
        curveHoverRatio={curveHoverRatio}
        onCurveHoverRatioChange={setCurveHoverRatio}
      />
    );
  } else if (optimizationResultTab === "robustness") {
    advancedContent = (
      <Suspense fallback={<ChartFallback minHeight="340px" />}>
        <OptimizationRobustnessReport rows={allRows} bestRow={bestRow} />
      </Suspense>
    );
  } else {
    advancedContent = (
      <p className="rounded border border-slate-700/70 bg-slate-900/25 p-2 text-xs text-slate-400">
        默认展示核心表格。需要更深入分析时，选择热力图/曲线/报告。
      </p>
    );
  }

  let desktopContent;
  if (optimizationResultTab === "table") {
    desktopContent = tableContent;
  } else {
    desktopContent = advancedContent;
  }

  if (isMobileViewport) {
    return (
      <div className="space-y-3">
        {showMobileRunningHint && (
          <div className="card-sub border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            当前任务仍在运行，可先查看已有结果，完成后会自动刷新。
          </div>
        )}
        <OptimizationBestSummaryCard
          bestRow={bestRow}
          onApplyOptimizationRow={onApplyOptimizationRow}
          onCopyLiveParams={onCopyLiveParams}
        />
        <section className="card space-y-3 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-200">核心结果</p>
            <p className="text-[11px] text-slate-400">首屏仅保留前 5 条</p>
          </div>
          {mobilePreviewRows.length > 0 ? (
            <div className="space-y-2">
              {mobilePreviewRows.map((row) => (
                <article key={row.row_id} className="card-sub space-y-2 border border-slate-700/60 bg-slate-900/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">组合 #{row.row_id}</p>
                      <p className="mt-1 text-xs text-slate-300">
                        稳健评分 {fmt(row.robust_score, 3)} · 总收益 {fmt(row.total_return_usdt, 2)} USDT
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        回撤 {fmt(row.max_drawdown_pct, 2)}% · 杠杆 {fmt(row.leverage, 2)} 倍 · 网格 {row.grids}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        row.passes_constraints
                          ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-400/35 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {row.passes_constraints ? "通过" : "未通过"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs w-full"
                      onClick={() => onApplyOptimizationRow(row)}
                    >
                      应用
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs w-full"
                      onClick={() => onCopyLiveParams(row)}
                    >
                      复制
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-slate-700/70 p-4 text-sm text-slate-300">
              暂无优化结果。
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary w-full"
              onClick={() => setMobileResultsTableOpen(true)}
            >
              查看全部结果
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary w-full"
              onClick={() => {
                if (optimizationResultTab === "table") {
                  onOptimizationResultTabChange("curves");
                }
                setMobileAnalysisOpen(true);
              }}
            >
              更多分析
            </button>
            {onOpenHistory && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary w-full"
                onClick={onOpenHistory}
                data-tour-id="optimization-history-entry"
              >
                查看历史
              </button>
            )}
          </div>
        </section>
        <MobileResultsTableSheet
          open={mobileResultsTableOpen}
          onClose={() => setMobileResultsTableOpen(false)}
        >
          {tableContent}
        </MobileResultsTableSheet>
        <MobileAnalysisSheet
          open={mobileAnalysisOpen}
          onClose={() => setMobileAnalysisOpen(false)}
          activeTab={optimizationResultTab === "table" ? "curves" : optimizationResultTab}
          onTabChange={onOptimizationResultTabChange}
        >
          {advancedContent}
        </MobileAnalysisSheet>
      </div>
    );
  }

  return (
    <div className={isMobileViewport ? "space-y-3" : "space-y-5 sm:space-y-6"}>
      <OptimizationBestSummaryCard
        bestRow={bestRow}
        onApplyOptimizationRow={onApplyOptimizationRow}
        onCopyLiveParams={onCopyLiveParams}
      />

      <section className="card space-y-3 p-3">
        {isMobileViewport && onOpenHistory && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs"
              onClick={onOpenHistory}
              data-tour-id="optimization-history-entry"
            >
              查看历史
            </button>
          </div>
        )}
        <div className="ui-tab-group">
          {OPTIMIZATION_RESULT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`ui-tab ${optimizationResultTab === tab.id ? "is-active" : ""}`}
              onClick={() => onOptimizationResultTabChange(tab.id)}
            >
              {isMobile ? tab.mobileLabel : tab.label}
            </button>
          ))}
        </div>
        {desktopContent}
      </section>
    </div>
  );
}
