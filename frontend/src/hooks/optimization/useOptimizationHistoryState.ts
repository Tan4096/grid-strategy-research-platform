import { useCallback, useEffect, useState } from "react";
import {
  clearSelectedOptimizationHistory,
  fetchOptimizationHistory,
  getApiErrorInfo,
  restoreSelectedOptimizationHistory
} from "../../lib/api";
import type { OptimizationProgressResponse } from "../../lib/api-schema";
import type { OptimizationHistoryClearResult, OptimizationHistoryRestoreResult } from "../../lib/operation-models";
import { NOTICE_ADVICE, buildNoticeDetail } from "../../lib/notificationCopy";
import type { EmitOperationEventInput } from "../useOperationFeedback";
import { STORAGE_KEYS } from "../../lib/storage";

interface Params {
  notifyCenter: (message: string | EmitOperationEventInput) => void;
  setOptimizationError: (value: string | null) => void;
}

interface Result {
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  optimizationHistoryHasMore: boolean;
  refreshOptimizationHistory: () => Promise<void>;
  loadMoreOptimizationHistory: () => Promise<void>;
  clearOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryClearResult>;
  restoreOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryRestoreResult>;
}

const HISTORY_PAGE_SIZE = 50;
const HISTORY_CURSOR_SESSION_KEY = STORAGE_KEYS.optimizationHistoryCursor;

const EMPTY_CLEAR_RESULT: OptimizationHistoryClearResult = {
  requested: 0,
  deleted: 0,
  failed: 0,
  deleted_job_ids: [],
  failed_job_ids: [],
  failed_items: [],
  skipped: 0,
  skipped_job_ids: [],
  soft_delete_ttl_hours: 48
};

const EMPTY_RESTORE_RESULT: OptimizationHistoryRestoreResult = {
  requested: 0,
  restored: 0,
  failed: 0,
  restored_job_ids: [],
  failed_job_ids: [],
  failed_items: []
};

function normalizeJobIds(jobIds: string[]): string[] {
  return Array.from(
    new Set(
      jobIds
        .map((jobId) => (typeof jobId === "string" ? jobId.trim() : ""))
        .filter((jobId) => jobId.length > 0)
    )
  );
}

function readHistoryCursorFromSession(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(HISTORY_CURSOR_SESSION_KEY);
    if (!raw || !raw.trim()) {
      return null;
    }
    return raw.trim();
  } catch {
    return null;
  }
}

function writeHistoryCursorToSession(cursor: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!cursor) {
      window.sessionStorage.removeItem(HISTORY_CURSOR_SESSION_KEY);
      return;
    }
    window.sessionStorage.setItem(HISTORY_CURSOR_SESSION_KEY, cursor);
  } catch {
    // ignore
  }
}

export function useOptimizationHistoryState({ notifyCenter, setOptimizationError }: Params): Result {
  const [optimizationHistory, setOptimizationHistory] = useState<OptimizationProgressResponse[]>([]);
  const [optimizationHistoryLoading, setOptimizationHistoryLoading] = useState(false);
  const [optimizationHistoryCursor, setOptimizationHistoryCursor] = useState<string | null>(() =>
    readHistoryCursorFromSession()
  );
  const [optimizationHistoryHasMore, setOptimizationHistoryHasMore] = useState(false);

  const refreshOptimizationHistory = useCallback(async () => {
    setOptimizationHistoryLoading(true);
    try {
      const page = await fetchOptimizationHistory(HISTORY_PAGE_SIZE, null, null, {
        timeoutMs: 20_000,
        retries: 1
      });
      setOptimizationHistory(page.items);
      const nextCursor = page.next_cursor ?? null;
      setOptimizationHistoryCursor(nextCursor);
      setOptimizationHistoryHasMore(Boolean(nextCursor));
      writeHistoryCursorToSession(nextCursor);
    } catch {
      // Keep existing history if refresh fails.
    } finally {
      setOptimizationHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOptimizationHistory();
  }, [refreshOptimizationHistory]);

  const loadMoreOptimizationHistory = useCallback(async () => {
    if (!optimizationHistoryCursor || optimizationHistoryLoading) {
      return;
    }
    setOptimizationHistoryLoading(true);
    try {
      const page = await fetchOptimizationHistory(HISTORY_PAGE_SIZE, optimizationHistoryCursor, null, {
        timeoutMs: 20_000,
        retries: 1
      });
      setOptimizationHistory((prev) => {
        const merged = [...prev, ...page.items];
        const seen = new Set<string>();
        const deduped: OptimizationProgressResponse[] = [];
        for (const item of merged) {
          const jobId = item?.job?.job_id;
          if (typeof jobId !== "string" || !jobId.trim()) {
            continue;
          }
          if (seen.has(jobId)) {
            continue;
          }
          seen.add(jobId);
          deduped.push(item);
        }
        return deduped;
      });
      const nextCursor = page.next_cursor ?? null;
      setOptimizationHistoryCursor(nextCursor);
      setOptimizationHistoryHasMore(Boolean(nextCursor));
      writeHistoryCursorToSession(nextCursor);
    } catch {
      // ignore load-more errors and keep current list.
    } finally {
      setOptimizationHistoryLoading(false);
    }
  }, [optimizationHistoryCursor, optimizationHistoryLoading]);

  const clearOptimizationHistory = useCallback(
    async (jobIds: string[]): Promise<OptimizationHistoryClearResult> => {
      const selectedJobIds = normalizeJobIds(jobIds);
      if (!selectedJobIds.length) {
        return EMPTY_CLEAR_RESULT;
      }

      setOptimizationHistoryLoading(true);
      try {
        const result = await clearSelectedOptimizationHistory(selectedJobIds, {
          timeoutMs: 20_000,
          retries: 1
        });

        await refreshOptimizationHistory();

        const failedSet = new Set(result.failed_job_ids);
        const deletedJobIds = result.deleted_job_ids.length
          ? result.deleted_job_ids
          : selectedJobIds.filter((jobId) => !failedSet.has(jobId)).slice(0, result.deleted);

        const normalizedResult: OptimizationHistoryClearResult = {
          requested: result.requested,
          deleted: result.deleted,
          failed: Math.max(result.failed, result.failed_job_ids.length),
          deleted_job_ids: deletedJobIds,
          failed_job_ids: result.failed_job_ids,
          failed_items: result.failed_items,
          skipped: result.skipped ?? 0,
          skipped_job_ids: result.skipped_job_ids ?? [],
          soft_delete_ttl_hours: result.soft_delete_ttl_hours ?? 48,
          operation_id: result.operation_id,
          undo_until: result.undo_until,
          summary_text: result.summary_text
        };

        notifyCenter(
          {
            kind: "history",
            category: normalizedResult.failed > 0 ? "warning" : "success",
            action: "clear_selected",
            title: normalizedResult.failed > 0 ? "历史清理完成" : "历史已清理",
            detail: buildNoticeDetail(
              "优化历史",
              normalizedResult.failed > 0
                ? `已清理 ${normalizedResult.deleted} 条，失败 ${normalizedResult.failed} 条`
                : `已清理 ${normalizedResult.deleted} 条`,
              normalizedResult.failed > 0 ? NOTICE_ADVICE.retryLater : NOTICE_ADVICE.viewResults
            ),
            status: normalizedResult.failed > 0 ? "partial_failed" : "success",
            request_id: normalizedResult.request_id,
            operation_id: normalizedResult.operation_id,
            job_ids: normalizedResult.deleted_job_ids,
            failed_items: normalizedResult.failed_items,
            retryable: normalizedResult.meta?.retryable ?? normalizedResult.failed > 0,
            undo_until: normalizedResult.undo_until ?? null,
            source: "optimization_history"
          }
        );

        return normalizedResult;
      } catch (err) {
        const errorInfo = getApiErrorInfo(err);
        const message = errorInfo.message || "清空优化历史失败";
        setOptimizationError(message);
        notifyCenter({
          kind: "history",
          category: "error",
          action: "clear_selected",
          title: "历史清理失败",
          detail: buildNoticeDetail("优化历史", `清理失败：${message}`, NOTICE_ADVICE.retryLater),
          status: "failed",
          request_id: errorInfo.request_id,
          retryable: errorInfo.retryable,
          source: "optimization_history"
        });
        return {
          requested: selectedJobIds.length,
          deleted: 0,
          failed: selectedJobIds.length,
          deleted_job_ids: [],
          failed_job_ids: selectedJobIds,
          failed_items: selectedJobIds.map((jobId) => ({
            job_id: jobId,
            reason_code: "REQUEST_FAILED",
            reason_message: message
          })),
          skipped: 0,
          skipped_job_ids: [],
          soft_delete_ttl_hours: 48,
          request_id: errorInfo.request_id ?? undefined,
          meta: {
            retryable: errorInfo.retryable ?? true
          }
        };
      } finally {
        setOptimizationHistoryLoading(false);
      }
    },
    [notifyCenter, refreshOptimizationHistory, setOptimizationError]
  );

  const restoreOptimizationHistory = useCallback(
    async (jobIds: string[]): Promise<OptimizationHistoryRestoreResult> => {
      const selectedJobIds = normalizeJobIds(jobIds);
      if (!selectedJobIds.length) {
        return EMPTY_RESTORE_RESULT;
      }

      setOptimizationHistoryLoading(true);
      try {
        const result = await restoreSelectedOptimizationHistory(selectedJobIds, {
          timeoutMs: 20_000,
          retries: 1
        });
        await refreshOptimizationHistory();
        notifyCenter({
          kind: "history",
          category: result.failed > 0 ? "warning" : "success",
          action: "restore_selected",
          title: result.failed > 0 ? "历史恢复完成" : "历史已恢复",
          detail: buildNoticeDetail(
            "优化历史",
            result.failed > 0 ? `已恢复 ${result.restored} 条，失败 ${result.failed} 条` : `已恢复 ${result.restored} 条`,
            result.failed > 0 ? NOTICE_ADVICE.retryLater : NOTICE_ADVICE.viewResults
          ),
          status: result.failed > 0 ? "partial_failed" : "success",
          request_id: result.request_id,
          operation_id: result.operation_id,
          job_ids: result.restored_job_ids,
          failed_items: result.failed_items,
          retryable: result.meta?.retryable ?? result.failed > 0,
          source: "optimization_history"
        });
        return result;
      } catch (err) {
        const errorInfo = getApiErrorInfo(err);
        const message = errorInfo.message || "恢复优化历史失败";
        setOptimizationError(message);
        notifyCenter({
          kind: "history",
          category: "error",
          action: "restore_selected",
          title: "历史恢复失败",
          detail: buildNoticeDetail("优化历史", `恢复失败：${message}`, NOTICE_ADVICE.retryLater),
          status: "failed",
          request_id: errorInfo.request_id,
          retryable: errorInfo.retryable,
          source: "optimization_history"
        });
        return {
          requested: selectedJobIds.length,
          restored: 0,
          failed: selectedJobIds.length,
          restored_job_ids: [],
          failed_job_ids: selectedJobIds,
          failed_items: selectedJobIds.map((jobId) => ({
            job_id: jobId,
            reason_code: "REQUEST_FAILED",
            reason_message: message
          })),
          request_id: errorInfo.request_id ?? undefined,
          meta: {
            retryable: errorInfo.retryable ?? true
          }
        };
      } finally {
        setOptimizationHistoryLoading(false);
      }
    },
    [notifyCenter, refreshOptimizationHistory, setOptimizationError]
  );

  return {
    optimizationHistory,
    optimizationHistoryLoading,
    optimizationHistoryHasMore,
    refreshOptimizationHistory,
    loadMoreOptimizationHistory,
    clearOptimizationHistory,
    restoreOptimizationHistory
  };
}
