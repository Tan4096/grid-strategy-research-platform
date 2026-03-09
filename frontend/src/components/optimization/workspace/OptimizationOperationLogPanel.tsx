import { useEffect, useRef } from "react";
import type { OptimizationHistoryFailedItem } from "../../../lib/operation-models";

export interface OperationLogEntry {
  id: string;
  action: "clear" | "restore";
  requested: number;
  success: number;
  failed: number;
  jobIds: string[];
  failedItems: OptimizationHistoryFailedItem[];
  operationId?: string;
  undoUntil?: string;
  summaryText?: string;
  requestId?: string;
  retryable?: boolean;
  at: number;
}

interface Props {
  entries: OperationLogEntry[];
  restoringHistory: boolean;
  undoingLogId: string | null;
  highlightEntryId?: string | null;
  onClear: () => void;
  onUndo: (entry: OperationLogEntry) => void;
}

export default function OptimizationOperationLogPanel({
  entries,
  restoringHistory,
  undoingLogId,
  highlightEntryId = null,
  onClear,
  onUndo
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightEntryId) {
      return;
    }
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const target = root.querySelector(`[data-op-log-id="${highlightEntryId}"]`) as HTMLElement | null;
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlightEntryId]);

  return (
    <div className="mt-3 rounded border border-slate-700/60 bg-slate-950/35 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-200">历史操作记录</p>
        {entries.length > 0 && (
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs"
            onClick={onClear}
            disabled={restoringHistory}
          >
            清空日志
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-slate-400">暂无批量操作记录。</p>
      ) : (
        <div ref={containerRef} className="max-h-40 space-y-2 overflow-auto pr-1">
          {entries.map((entry) => {
            const canUndo = entry.action === "clear" && entry.jobIds.length > 0;
            const highlighted = highlightEntryId === entry.id;
            return (
              <div
                key={entry.id}
                data-op-log-id={entry.id}
                className={`rounded border px-2 py-2 text-[11px] text-slate-200 transition ${
                  highlighted
                    ? "border-cyan-400/70 bg-cyan-500/10"
                    : "border-slate-700/60"
                }`}
              >
                <p className="text-slate-300">
                  {entry.summaryText ??
                    `${entry.action === "clear" ? "清空" : "恢复"} · 请求 ${entry.requested} · 成功 ${entry.success} · 失败 ${entry.failed}`}
                </p>
                <p className="mt-0.5 text-slate-500">
                  {new Date(entry.at).toLocaleString()}
                  {entry.operationId ? ` · operation_id: ${entry.operationId}` : ""}
                  {entry.undoUntil ? ` · 可撤销至 ${new Date(entry.undoUntil).toLocaleString()}` : ""}
                </p>
                {entry.requestId && (
                  <p className="mt-0.5 text-slate-500">
                    request_id: {entry.requestId}
                    {typeof entry.retryable === "boolean" ? ` · retryable: ${entry.retryable ? "yes" : "no"}` : ""}
                  </p>
                )}
                {entry.failedItems.length > 0 && (
                  <p className="mt-1 line-clamp-2 text-rose-300">
                    失败示例：{entry.failedItems[0].job_id} · {entry.failedItems[0].reason_code}
                  </p>
                )}
                {canUndo && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                      disabled={restoringHistory || undoingLogId === entry.id}
                      onClick={() => onUndo(entry)}
                    >
                      {undoingLogId === entry.id ? "撤销中..." : "撤销本条清空"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
