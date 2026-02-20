import { useState } from "react";
import {
  OptimizationConfig,
  OptimizationProgressResponse,
  OptimizationRow,
  OptimizationStatusResponse,
  SortOrder
} from "../types";
import OptimizationHistoryWorkspace from "./optimization/workspace/OptimizationHistoryWorkspace";
import OptimizationResultsWorkspace, { OptimizationResultTab } from "./optimization/workspace/OptimizationResultsWorkspace";
import OptimizationRuntimeWorkspace from "./optimization/workspace/OptimizationRuntimeWorkspace";

type WorkspaceTab = "runtime" | "results" | "history";

interface Props {
  config: OptimizationConfig;
  onChangeConfig: (next: OptimizationConfig) => void;
  optimizationError: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationEtaSeconds: number | null;
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  onRefreshOptimizationHistory: () => void;
  onLoadOptimizationHistoryJob: (jobId: string) => void;
  onRestartOptimizationHistoryJob: (jobId: string) => void;
  onFetchOptimizationHistoryJobStatus: (jobId: string) => Promise<OptimizationStatusResponse>;
  onCancelOptimization: () => void;
  onExportOptimization: () => void;
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
  optimizationResultTab: OptimizationResultTab;
  onOptimizationResultTabChange: (tab: OptimizationResultTab) => void;
}

export type { OptimizationResultTab };

export default function OptimizationPanel({
  config,
  onChangeConfig,
  optimizationError,
  optimizationStatus,
  optimizationEtaSeconds,
  optimizationHistory,
  optimizationHistoryLoading,
  onRefreshOptimizationHistory,
  onLoadOptimizationHistoryJob,
  onRestartOptimizationHistoryJob,
  onFetchOptimizationHistoryJobStatus,
  onCancelOptimization,
  onExportOptimization,
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
  onNextPage,
  optimizationResultTab,
  onOptimizationResultTabChange
}: Props) {
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("runtime");

  return (
    <>
      <div className="card p-3">
        <div className="inline-flex rounded-md border border-slate-700/70 bg-slate-950/40 p-1">
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              workspaceTab === "runtime" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => setWorkspaceTab("runtime")}
          >
            运行
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              workspaceTab === "results" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => setWorkspaceTab("results")}
          >
            结果
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
              workspaceTab === "history" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => setWorkspaceTab("history")}
          >
            历史
          </button>
        </div>
      </div>

      {workspaceTab === "runtime" && (
        <OptimizationRuntimeWorkspace
          config={config}
          onChangeConfig={onChangeConfig}
          optimizationError={optimizationError}
          optimizationStatus={optimizationStatus}
          optimizationEtaSeconds={optimizationEtaSeconds}
          onCancelOptimization={onCancelOptimization}
          onExportOptimization={onExportOptimization}
        />
      )}

      {workspaceTab === "results" && (
        <OptimizationResultsWorkspace
          optimizationStatus={optimizationStatus}
          optimizationResultTab={optimizationResultTab}
          onOptimizationResultTabChange={onOptimizationResultTabChange}
          onApplyOptimizationRow={onApplyOptimizationRow}
          onCompareOptimizationRow={onCompareOptimizationRow}
          onCopyLiveParams={onCopyLiveParams}
          optimizationSortBy={optimizationSortBy}
          onOptimizationSortByChange={onOptimizationSortByChange}
          optimizationSortOrder={optimizationSortOrder}
          onOptimizationSortOrderChange={onOptimizationSortOrderChange}
          optimizationPageSize={optimizationPageSize}
          onOptimizationPageSizeChange={onOptimizationPageSizeChange}
          optimizationPage={optimizationPage}
          totalOptimizationPages={totalOptimizationPages}
          onPrevPage={onPrevPage}
          onNextPage={onNextPage}
        />
      )}

      {workspaceTab === "history" && (
        <OptimizationHistoryWorkspace
          optimizationHistory={optimizationHistory}
          optimizationHistoryLoading={optimizationHistoryLoading}
          onRefreshOptimizationHistory={onRefreshOptimizationHistory}
          onLoadOptimizationHistoryJob={onLoadOptimizationHistoryJob}
          onRestartOptimizationHistoryJob={onRestartOptimizationHistoryJob}
          onFetchOptimizationHistoryJobStatus={onFetchOptimizationHistoryJobStatus}
        />
      )}
    </>
  );
}
