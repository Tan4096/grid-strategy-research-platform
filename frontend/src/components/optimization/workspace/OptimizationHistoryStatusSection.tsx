import ConfirmDialog from "../../ui/ConfirmDialog";
import OptimizationOperationLogPanel from "./OptimizationOperationLogPanel";
import type { OptimizationHistoryViewModel } from "../../../hooks/optimization/useOptimizationHistoryViewModel";

interface Props {
  viewModel: OptimizationHistoryViewModel;
}

export default function OptimizationHistoryStatusSection({ viewModel }: Props) {
  const {
    clearFeedback,
    restoringHistory,
    clearingHistory,
    restoreDeletedJobs,
    operationLog,
    setOperationLog,
    undoingLogId,
    highlightOperationLogId,
    confirmClearOpen,
    setConfirmClearOpen,
    selectedCount,
    clearHistory
  } = viewModel as OptimizationHistoryViewModel & {
    restoreDeletedJobs: (jobIds: string[], sourceLogId?: string) => Promise<void>;
    clearHistory: () => Promise<void>;
  };

  return (
    <>
      {clearFeedback && (
        <section
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            clearFeedback.failed > 0
              ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
          }`}
        >
          <p className="text-[11px] font-semibold opacity-95">当前操作状态</p>
          <p>
            {clearFeedback.summaryText ??
              `最近一次清空：请求 ${clearFeedback.requested} 条，成功 ${clearFeedback.deleted} 条，失败 ${clearFeedback.failed} 条${
                clearFeedback.skipped > 0 ? `，跳过 ${clearFeedback.skipped} 条` : ""
              }。`}
          </p>
          <p className="mt-1 text-[11px] opacity-80">
            {new Date(clearFeedback.at).toLocaleString()}
            {clearFeedback.operationId ? ` · operation_id: ${clearFeedback.operationId}` : ""}
            {clearFeedback.undoUntil ? ` · 可撤销至 ${new Date(clearFeedback.undoUntil).toLocaleString()}` : ""}
            {clearFeedback.requestId ? ` · request_id: ${clearFeedback.requestId}` : ""}
            {typeof clearFeedback.retryable === "boolean" ? ` · retryable: ${clearFeedback.retryable ? "yes" : "no"}` : ""}
          </p>
          {clearFeedback.deletedJobIds.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                disabled={restoringHistory || clearingHistory}
                onClick={() => void restoreDeletedJobs(clearFeedback.deletedJobIds)}
              >
                {restoringHistory ? "撤销中..." : "撤销本次清空（软撤销）"}
              </button>
            </div>
          )}
        </section>
      )}

      <OptimizationOperationLogPanel
        entries={operationLog}
        restoringHistory={restoringHistory}
        undoingLogId={undoingLogId}
        highlightEntryId={highlightOperationLogId}
        onClear={() => setOperationLog([])}
        onUndo={(entry) => void restoreDeletedJobs(entry.jobIds, entry.id)}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title="确认清空历史任务"
        message={`确认清空已选 ${selectedCount} 条历史任务？可在软撤销窗口（${clearFeedback?.softDeleteTtlHours ?? 48} 小时）内恢复，超时后不可恢复。`}
        confirmLabel="确认清空"
        confirmTone="danger"
        loading={clearingHistory}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => void clearHistory()}
      />
    </>
  );
}
