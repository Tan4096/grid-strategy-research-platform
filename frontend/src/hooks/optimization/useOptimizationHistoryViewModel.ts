import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "../responsive/useIsMobile";
import { STORAGE_KEYS, writePlain } from "../../lib/storage";
import type {
  OptimizationHistoryClearResult,
  OptimizationHistoryFailedItem,
  OptimizationHistoryRestoreResult,
  OptimizationProgressResponse,
  OptimizationRow,
  OptimizationStatusResponse
} from "../../types";
import type { OperationLogEntry } from "../../components/optimization/workspace/OptimizationOperationLogPanel";
import {
  FAST_RETRY_REASON_CODES,
  LOG_HIGHLIGHT_DURATION_MS,
  OPERATION_LOG_MAX_ITEMS,
  REFRESH_RETRY_REASON_CODES,
  failureReasonHint,
  mergeFailureQueue,
  normalizeFailedItems,
  pruneSelectedMap,
  readHistoryUiSessionState,
  readStoredOperationLogs,
  toUniqueJobIds,
  writeHistoryUiSessionState
} from "./optimizationHistoryViewModel.shared";

interface Params {
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

export interface ClearFeedback {
  requested: number;
  deleted: number;
  deletedJobIds: string[];
  failed: number;
  failedJobIds: string[];
  failedItems: OptimizationHistoryFailedItem[];
  skipped: number;
  softDeleteTtlHours: number;
  operationId: string | null;
  undoUntil: string | null;
  summaryText: string | null;
  requestId: string | null;
  retryable: boolean | null;
  at: number;
}

export function useOptimizationHistoryViewModel({
  optimizationStatus,
  optimizationHistory,
  optimizationHistoryLoading,
  optimizationHistoryHasMore,
  onRefreshOptimizationHistory,
  onLoadMoreOptimizationHistory,
  onClearOptimizationHistory,
  onRestoreOptimizationHistory,
  onLoadOptimizationHistoryJob,
  onRestartOptimizationHistoryJob,
  onApplyOptimizationRow,
  onCopyLiveParams
}: Params) {
  const historyUiSession = useMemo(() => readHistoryUiSessionState(), []);
  const [selectedByJobId, setSelectedByJobId] = useState<Record<string, true>>({});
  const [undoSelectionSnapshot, setUndoSelectionSnapshot] = useState<Record<string, true> | null>(
    null
  );
  const [clearingHistory, setClearingHistory] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [operationLog, setOperationLog] = useState<OperationLogEntry[]>(() =>
    readStoredOperationLogs()
  );
  const [undoingLogId, setUndoingLogId] = useState<string | null>(null);
  const [highlightOperationLogId, setHighlightOperationLogId] = useState<string | null>(null);
  const [clearFeedback, setClearFeedback] = useState<ClearFeedback | null>(null);
  const [failureQueueItems, setFailureQueueItems] = useState<OptimizationHistoryFailedItem[]>([]);
  const [failureReasonFilter, setFailureReasonFilter] = useState<string>(
    historyUiSession?.failureReasonFilter ?? "ALL"
  );
  const [failureKeyword, setFailureKeyword] = useState(historyUiSession?.failureKeyword ?? "");
  const [retryBatchSize, setRetryBatchSize] = useState(historyUiSession?.retryBatchSize ?? 50);
  const [retryingTag, setRetryingTag] = useState<string | null>(null);
  const [completedRetryTag, setCompletedRetryTag] = useState<string | null>(null);
  const [copiedFailedList, setCopiedFailedList] = useState(false);
  const [showFailureDetails, setShowFailureDetails] = useState(
    historyUiSession?.showFailureDetails ?? true
  );
  const [showAdvancedRetry, setShowAdvancedRetry] = useState(
    historyUiSession?.showAdvancedRetry ?? false
  );
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const isMobile = useIsMobile();

  const visibleHistory = optimizationHistory;
  const allJobIds = useMemo(
    () => Array.from(new Set(visibleHistory.map((item) => item.job.job_id))),
    [visibleHistory]
  );
  const visibleJobIdSet = useMemo(() => new Set(allJobIds), [allJobIds]);
  const selectedCount = allJobIds.reduce(
    (count, jobId) => count + (selectedByJobId[jobId] ? 1 : 0),
    0
  );
  const allSelected = allJobIds.length > 0 && selectedCount === allJobIds.length;

  useEffect(() => {
    writePlain(
      STORAGE_KEYS.optimizationOperationLogs,
      operationLog.slice(0, OPERATION_LOG_MAX_ITEMS)
    );
  }, [operationLog]);

  useEffect(() => {
    if (!highlightOperationLogId) {
      return;
    }
    const timer = window.setTimeout(
      () => setHighlightOperationLogId(null),
      LOG_HIGHLIGHT_DURATION_MS
    );
    return () => window.clearTimeout(timer);
  }, [highlightOperationLogId]);

  useEffect(() => {
    if (!completedRetryTag) {
      return;
    }
    const timer = window.setTimeout(() => setCompletedRetryTag(null), 1500);
    return () => window.clearTimeout(timer);
  }, [completedRetryTag]);

  useEffect(() => {
    if (!copiedFailedList) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedFailedList(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedFailedList]);

  useEffect(() => {
    writeHistoryUiSessionState({
      failureReasonFilter,
      failureKeyword,
      retryBatchSize,
      showFailureDetails,
      showAdvancedRetry
    });
  }, [
    failureKeyword,
    failureReasonFilter,
    retryBatchSize,
    showAdvancedRetry,
    showFailureDetails
  ]);

  const failureReasonGroups = useMemo(() => {
    const grouped = new Map<string, OptimizationHistoryFailedItem[]>();
    for (const item of failureQueueItems) {
      const reason = item.reason_code || "UNKNOWN";
      const prev = grouped.get(reason);
      if (prev) {
        prev.push(item);
      } else {
        grouped.set(reason, [item]);
      }
    }
    return Array.from(grouped.entries())
      .map(([reasonCode, items]) => ({
        reasonCode,
        count: items.length,
        items
      }))
      .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode));
  }, [failureQueueItems]);

  const filteredFailureItems = useMemo(() => {
    const keyword = failureKeyword.trim().toLowerCase();
    return failureQueueItems.filter((item) => {
      if (failureReasonFilter !== "ALL" && item.reason_code !== failureReasonFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        item.job_id.toLowerCase().includes(keyword) ||
        item.reason_code.toLowerCase().includes(keyword) ||
        item.reason_message.toLowerCase().includes(keyword)
      );
    });
  }, [failureKeyword, failureQueueItems, failureReasonFilter]);

  const filteredFailureIds = useMemo(
    () => toUniqueJobIds(filteredFailureItems.map((item) => item.job_id)),
    [filteredFailureItems]
  );
  const fastRetryIds = useMemo(
    () =>
      toUniqueJobIds(
        failureQueueItems
          .filter((item) => FAST_RETRY_REASON_CODES.has(item.reason_code))
          .map((item) => item.job_id)
      ),
    [failureQueueItems]
  );
  const refreshRetryIds = useMemo(
    () =>
      toUniqueJobIds(
        failureQueueItems
          .filter((item) => REFRESH_RETRY_REASON_CODES.has(item.reason_code))
          .map((item) => item.job_id)
      ),
    [failureQueueItems]
  );

  const toggleSelectJob = (jobId: string) => {
    setSelectedByJobId((prev) => {
      if (prev[jobId]) {
        const next = { ...prev };
        delete next[jobId];
        return next;
      }
      return {
        ...prev,
        [jobId]: true
      };
    });
  };

  useEffect(() => {
    const selectable = new Set(allJobIds);
    setSelectedByJobId((prev) => {
      const next = pruneSelectedMap(prev, selectable);
      const changed = Object.keys(next).length !== Object.keys(prev).length;
      return changed ? next : prev;
    });
    setUndoSelectionSnapshot((prev) => {
      if (!prev) {
        return prev;
      }
      const next = pruneSelectedMap(prev, selectable);
      const changed = Object.keys(next).length !== Object.keys(prev).length;
      return changed ? next : prev;
    });
  }, [allJobIds]);

  const toggleSelectAll = () => {
    if (!allJobIds.length) {
      return;
    }
    if (allSelected) {
      setSelectedByJobId((prev) => {
        const next = { ...prev };
        for (const jobId of allJobIds) {
          delete next[jobId];
        }
        return next;
      });
      return;
    }
    setSelectedByJobId((prev) => {
      const next = { ...prev };
      for (const jobId of allJobIds) {
        next[jobId] = true;
      }
      return next;
    });
  };

  const undoLastSelection = () => {
    if (!undoSelectionSnapshot) {
      return;
    }
    const selectable = new Set(allJobIds);
    setSelectedByJobId(pruneSelectedMap(undoSelectionSnapshot, selectable));
    setUndoSelectionSnapshot(null);
  };

  const appendOperationLog = (
    entry: Omit<OperationLogEntry, "id" | "at"> & { at?: number }
  ): string => {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nextEntry: OperationLogEntry = {
      ...entry,
      id,
      at: entry.at ?? Date.now()
    };
    setOperationLog((prev) => [nextEntry, ...prev].slice(0, OPERATION_LOG_MAX_ITEMS));
    setHighlightOperationLogId(id);
    return id;
  };

  const retryButtonLabel = (tag: string, idleLabel: string): string => {
    if (retryingTag === tag) {
      return "重试中...";
    }
    if (completedRetryTag === tag) {
      return "已完成";
    }
    return idleLabel;
  };

  const requestClearHistory = () => {
    if (!selectedCount || clearingHistory) {
      return;
    }
    setConfirmClearOpen(true);
  };

  const clearHistory = async () => {
    if (!selectedCount || clearingHistory) {
      return;
    }
    setConfirmClearOpen(false);
    const selectedJobIds = allJobIds.filter((jobId) => selectedByJobId[jobId]);
    const selectionSnapshot = { ...selectedByJobId };
    setClearingHistory(true);
    try {
      const result = await onClearOptimizationHistory(selectedJobIds);
      const normalized = normalizeFailedItems(result.failed_items, result.failed_job_ids);
      setUndoSelectionSnapshot(selectionSnapshot);
      if (result.failed > 0) {
        if (result.failed_job_ids.length > 0) {
          const failedSet = new Set(result.failed_job_ids);
          const next: Record<string, true> = {};
          for (const jobId of selectedJobIds) {
            if (failedSet.has(jobId)) {
              next[jobId] = true;
            }
          }
          setSelectedByJobId(next);
        } else {
          setSelectedByJobId(selectionSnapshot);
        }
      } else {
        setSelectedByJobId({});
      }

      setClearFeedback({
        requested: result.requested,
        deleted: result.deleted,
        deletedJobIds: result.deleted_job_ids,
        failed: result.failed,
        failedJobIds: result.failed_job_ids,
        failedItems: normalized,
        skipped: result.skipped ?? 0,
        softDeleteTtlHours: result.soft_delete_ttl_hours ?? 48,
        operationId: result.operation_id ?? null,
        undoUntil: result.undo_until ?? null,
        summaryText: result.summary_text ?? null,
        requestId: result.request_id ?? null,
        retryable: typeof result.meta?.retryable === "boolean" ? result.meta.retryable : null,
        at: Date.now()
      });
      setFailureQueueItems(normalized);
      setFailureReasonFilter("ALL");
      setFailureKeyword("");
      setCopiedFailedList(false);
      setCompletedRetryTag(null);
      setShowFailureDetails(result.failed > 0);
      appendOperationLog({
        action: "clear",
        requested: result.requested,
        success: result.deleted,
        failed: result.failed,
        jobIds: result.deleted_job_ids,
        failedItems: normalized,
        operationId: result.operation_id,
        undoUntil: result.undo_until,
        summaryText: result.summary_text,
        requestId: result.request_id,
        retryable: result.meta?.retryable
      });
    } finally {
      setClearingHistory(false);
    }
  };

  const focusHistoryRows = (jobIds: string[]) => {
    const focusIds = toUniqueJobIds(jobIds).filter((jobId) => visibleJobIdSet.has(jobId));
    if (!focusIds.length) {
      return;
    }
    const nextSelection: Record<string, true> = {};
    for (const jobId of focusIds) {
      nextSelection[jobId] = true;
    }
    setSelectedByJobId(nextSelection);
    const firstJobId = focusIds[0];
    const safeSelectorId = firstJobId.replace(/"/g, '\\"');
    window.requestAnimationFrame(() => {
      const target = document.querySelector(
        `[data-history-job-id="${safeSelectorId}"]`
      ) as HTMLElement | null;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const retryFailedClear = async (
    jobIds: string[],
    options: { tag: string; refreshBefore?: boolean } = { tag: "retry" }
  ) => {
    if (retryingFailed || clearingHistory) {
      return;
    }
    const retryIds = toUniqueJobIds(jobIds).slice(0, Math.max(1, retryBatchSize));
    if (!retryIds.length) {
      return;
    }

    setRetryingFailed(true);
    setRetryingTag(options.tag);
    try {
      if (options.refreshBefore) {
        await Promise.resolve(onRefreshOptimizationHistory());
      }
      const result = await onClearOptimizationHistory(retryIds);
      const normalized = normalizeFailedItems(result.failed_items, result.failed_job_ids);
      setClearFeedback({
        requested: result.requested,
        deleted: result.deleted,
        deletedJobIds: result.deleted_job_ids,
        failed: result.failed,
        failedJobIds: result.failed_job_ids,
        failedItems: normalized,
        skipped: result.skipped ?? 0,
        softDeleteTtlHours: result.soft_delete_ttl_hours ?? 48,
        operationId: result.operation_id ?? null,
        undoUntil: result.undo_until ?? null,
        summaryText: result.summary_text ?? null,
        requestId: result.request_id ?? null,
        retryable: typeof result.meta?.retryable === "boolean" ? result.meta.retryable : null,
        at: Date.now()
      });
      appendOperationLog({
        action: "clear",
        requested: result.requested,
        success: result.deleted,
        failed: result.failed,
        jobIds: result.deleted_job_ids,
        failedItems: normalized,
        operationId: result.operation_id,
        undoUntil: result.undo_until,
        summaryText: result.summary_text,
        requestId: result.request_id,
        retryable: result.meta?.retryable
      });

      let nextQueue: OptimizationHistoryFailedItem[] = [];
      setFailureQueueItems((prev) => {
        nextQueue = mergeFailureQueue(prev, retryIds, normalized);
        return nextQueue;
      });

      if (nextQueue.length > 0) {
        setShowFailureDetails(true);
        focusHistoryRows(nextQueue.map((item) => item.job_id));
      } else {
        setShowFailureDetails(false);
        setSelectedByJobId({});
      }
    } finally {
      setCompletedRetryTag(options.tag);
      setRetryingTag(null);
      setRetryingFailed(false);
    }
  };

  const retryFilteredFailures = async () => {
    await retryFailedClear(filteredFailureIds, { tag: "filtered-retry" });
  };

  const retryFastFailures = async () => {
    await retryFailedClear(fastRetryIds, { tag: "fast-retry" });
  };

  const retryRefreshFailures = async () => {
    await retryFailedClear(refreshRetryIds, {
      tag: "refresh-retry",
      refreshBefore: true
    });
  };

  const retryFailuresByReason = async (reasonCode: string) => {
    const ids = toUniqueJobIds(
      failureQueueItems
        .filter((item) => item.reason_code === reasonCode)
        .map((item) => item.job_id)
    );
    if (!ids.length) {
      return;
    }
    await retryFailedClear(ids, {
      tag: `reason-${reasonCode}`,
      refreshBefore: REFRESH_RETRY_REASON_CODES.has(reasonCode)
    });
  };

  const restoreDeletedJobs = async (jobIds: string[], sourceLogId?: string) => {
    const uniqueIds = Array.from(
      new Set(jobIds.filter((item) => typeof item === "string" && item.trim().length > 0))
    );
    if (!uniqueIds.length || restoringHistory) {
      return;
    }
    setRestoringHistory(true);
    if (sourceLogId) {
      setUndoingLogId(sourceLogId);
    }
    try {
      const result = await onRestoreOptimizationHistory(uniqueIds);
      const restoreLogId = appendOperationLog({
        action: "restore",
        requested: result.requested,
        success: result.restored,
        failed: result.failed,
        jobIds: result.restored_job_ids,
        failedItems: result.failed_items,
        operationId: result.operation_id,
        summaryText: result.summary_text,
        requestId: result.request_id,
        retryable: result.meta?.retryable
      });
      setHighlightOperationLogId(restoreLogId);
      if (clearFeedback?.deletedJobIds.length && result.restored > 0) {
        const restoredSet = new Set(result.restored_job_ids);
        const remainingDeleted = clearFeedback.deletedJobIds.filter(
          (jobId) => !restoredSet.has(jobId)
        );
        setClearFeedback((prev) =>
          prev
            ? {
                ...prev,
                deletedJobIds: remainingDeleted,
                deleted: Math.max(0, prev.deleted - result.restored)
              }
            : prev
        );
      }
    } finally {
      setRestoringHistory(false);
      setUndoingLogId(null);
    }
  };

  const copyFailureList = async () => {
    if (!filteredFailureItems.length) {
      return;
    }
    const payload = filteredFailureItems
      .map((item) => `${item.job_id}\t${item.reason_code}\t${item.reason_message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedFailedList(true);
    } catch {
      setCopiedFailedList(false);
    }
  };

  return {
    optimizationStatus,
    optimizationHistoryLoading,
    optimizationHistoryHasMore,
    onRefreshOptimizationHistory,
    onLoadMoreOptimizationHistory,
    onLoadOptimizationHistoryJob,
    onRestartOptimizationHistoryJob,
    onApplyOptimizationRow,
    onCopyLiveParams,
    isMobile,
    visibleHistory,
    allJobIds,
    selectedByJobId,
    selectedCount,
    allSelected,
    undoSelectionSnapshot,
    clearingHistory,
    retryingFailed,
    restoringHistory,
    operationLog,
    setOperationLog,
    undoingLogId,
    highlightOperationLogId,
    clearFeedback,
    failureQueueItems,
    failureReasonFilter,
    setFailureReasonFilter,
    failureKeyword,
    setFailureKeyword,
    retryBatchSize,
    setRetryBatchSize,
    retryingTag,
    completedRetryTag,
    copiedFailedList,
    showFailureDetails,
    setShowFailureDetails,
    showAdvancedRetry,
    setShowAdvancedRetry,
    confirmClearOpen,
    setConfirmClearOpen,
    failureReasonGroups,
    filteredFailureItems,
    filteredFailureIds,
    fastRetryIds,
    refreshRetryIds,
    toggleSelectJob,
    toggleSelectAll,
    undoLastSelection,
    retryButtonLabel,
    requestClearHistory,
    clearHistory,
    focusHistoryRows,
    retryFilteredFailures,
    retryFastFailures,
    retryRefreshFailures,
    retryFailuresByReason,
    restoreDeletedJobs,
    copyFailureList,
    failureReasonHint
  };
}

export type OptimizationHistoryViewModel = ReturnType<typeof useOptimizationHistoryViewModel>;
