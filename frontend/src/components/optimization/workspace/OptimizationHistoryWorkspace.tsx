import type { OptimizationProgressResponse, OptimizationRow, OptimizationStatusResponse } from "../../../lib/api-schema";
import type { OptimizationHistoryClearResult, OptimizationHistoryRestoreResult } from "../../../lib/operation-models";
import { useOptimizationHistoryViewModel } from "../../../hooks/optimization/useOptimizationHistoryViewModel";
import OptimizationBestSummaryCard from "./OptimizationBestSummaryCard";
import OptimizationHistoryFailureSection from "./OptimizationHistoryFailureSection";
import OptimizationHistoryListSection from "./OptimizationHistoryListSection";
import OptimizationHistoryStatusSection from "./OptimizationHistoryStatusSection";

interface Props {
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  optimizationHistoryHasMore: boolean;
  onRefreshOptimizationHistory: () => void;
  onLoadMoreOptimizationHistory: () => void;
  onClearOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryClearResult>;
  onRestoreOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryRestoreResult>;
  onLoadOptimizationHistoryJob: (jobId: string) => void;
  onRestartOptimizationHistoryJob: (jobId: string) => void;
  onApplyOptimizationRow: (row: OptimizationRow) => void;
  onCopyLiveParams: (row: OptimizationRow) => void;
}

export default function OptimizationHistoryWorkspace(props: Props) {
  const viewModel = useOptimizationHistoryViewModel(props);

  return (
    <>
      <OptimizationBestSummaryCard
        bestRow={props.optimizationStatus?.best_row ?? null}
        onApplyOptimizationRow={props.onApplyOptimizationRow}
        onCopyLiveParams={props.onCopyLiveParams}
      />
      <OptimizationHistoryListSection viewModel={viewModel} />
      <OptimizationHistoryStatusSection viewModel={viewModel} />
      <OptimizationHistoryFailureSection viewModel={viewModel} />
    </>
  );
}
