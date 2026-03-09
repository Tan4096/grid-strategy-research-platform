import type { SortOrder } from "../../../lib/api-schema";
import OptimizationResultsTable, {
  OptimizationResultsColumnKey
} from "../../OptimizationResultsTable";
import ResultsToolbar from "./ResultsToolbar";
import { TablePreset, TableViewMode } from "./useResultWorkspaceState";

interface Props {
  isMobile: boolean;
  filteredRowsCount: number;
  filteredRows: Parameters<typeof OptimizationResultsTable>[0]["rows"];
  onApplyOptimizationRow: Parameters<typeof OptimizationResultsTable>[0]["onApply"];
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
  optimizationPage: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export default function ResultsTablePanel({
  isMobile,
  filteredRowsCount,
  filteredRows,
  onApplyOptimizationRow,
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
  toggleColumnVisibility,
  optimizationPage,
  onPrevPage,
  onNextPage
}: Props) {
  return (
    <div className="space-y-3">
      <ResultsToolbar
        isMobile={isMobile}
        optimizationSortBy={optimizationSortBy}
        onOptimizationSortByChange={onOptimizationSortByChange}
        optimizationSortOrder={optimizationSortOrder}
        onOptimizationSortOrderChange={onOptimizationSortOrderChange}
        optimizationPageSize={optimizationPageSize}
        onOptimizationPageSizeChange={onOptimizationPageSizeChange}
        tableViewMode={tableViewMode}
        onTableViewPreferenceChange={onTableViewPreferenceChange}
        tablePreset={tablePreset}
        applyColumnPreset={applyColumnPreset}
        safeTotalResults={safeTotalResults}
        safePage={safePage}
        safeTotalPages={safeTotalPages}
        showPassedOnly={showPassedOnly}
        onShowPassedOnlyChange={onShowPassedOnlyChange}
        showPositiveOnly={showPositiveOnly}
        onShowPositiveOnlyChange={onShowPositiveOnlyChange}
        diagnosticMode={diagnosticMode}
        onDiagnosticModeChange={onDiagnosticModeChange}
        columnKeys={columnKeys}
        columnVisibility={columnVisibility}
        toggleColumnVisibility={toggleColumnVisibility}
      />

      {filteredRowsCount > 0 ? (
        <OptimizationResultsTable
          rows={filteredRows}
          onApply={onApplyOptimizationRow}
          viewMode={tableViewMode}
          columnPreset={tablePreset}
          visibleColumns={columnVisibility}
        />
      ) : (
        <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-slate-700/70 p-4 text-sm text-slate-300">
          当前筛选条件下暂无结果。
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
          disabled={optimizationPage <= 1}
          onClick={onPrevPage}
        >
          上一页
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
          disabled={optimizationPage >= safeTotalPages}
          onClick={onNextPage}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
