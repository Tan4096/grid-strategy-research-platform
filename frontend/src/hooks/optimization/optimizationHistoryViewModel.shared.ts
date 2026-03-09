import { readPlain, STORAGE_KEYS } from "../../lib/storage";
import type { OptimizationHistoryFailedItem } from "../../types";
import type { OperationLogEntry } from "../../components/optimization/workspace/OptimizationOperationLogPanel";

export const UNKNOWN_FAILURE_MESSAGE = "清空失败，未返回详细原因";
export const FAST_RETRY_REASON_CODES = new Set(["REQUEST_FAILED", "UNKNOWN"]);
export const REFRESH_RETRY_REASON_CODES = new Set(["JOB_NOT_FINISHED"]);
export const OPERATION_LOG_MAX_ITEMS = 100;
export const LOG_HIGHLIGHT_DURATION_MS = 3000;
export const HISTORY_UI_SESSION_KEY = "btc-grid-backtest:optimization-history-ui:v1";

export interface HistoryUiSessionState {
  failureReasonFilter: string;
  failureKeyword: string;
  retryBatchSize: number;
  showFailureDetails: boolean;
  showAdvancedRetry: boolean;
}

export function pruneSelectedMap(
  source: Record<string, true>,
  selectable: Set<string>
): Record<string, true> {
  const next: Record<string, true> = {};
  for (const key of Object.keys(source)) {
    if (selectable.has(key)) {
      next[key] = true;
    }
  }
  return next;
}

export function readHistoryUiSessionState(): HistoryUiSessionState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(HISTORY_UI_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<HistoryUiSessionState>;
    return {
      failureReasonFilter:
        typeof parsed.failureReasonFilter === "string" && parsed.failureReasonFilter.trim()
          ? parsed.failureReasonFilter.trim()
          : "ALL",
      failureKeyword: typeof parsed.failureKeyword === "string" ? parsed.failureKeyword : "",
      retryBatchSize: Number.isFinite(parsed.retryBatchSize)
        ? Math.max(1, Number(parsed.retryBatchSize))
        : 50,
      showFailureDetails: parsed.showFailureDetails !== false,
      showAdvancedRetry: parsed.showAdvancedRetry === true
    };
  } catch {
    return null;
  }
}

export function writeHistoryUiSessionState(state: HistoryUiSessionState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(HISTORY_UI_SESSION_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function toUniqueJobIds(items: string[]): string[] {
  return Array.from(
    new Set(
      items
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    )
  );
}

export function normalizeFailedItems(
  items: OptimizationHistoryFailedItem[],
  fallbackIds: string[]
): OptimizationHistoryFailedItem[] {
  const normalized = items.length
    ? items
    : fallbackIds.map((jobId) => ({
        job_id: jobId,
        reason_code: "UNKNOWN",
        reason_message: UNKNOWN_FAILURE_MESSAGE
      }));
  const seen = new Set<string>();
  const deduped: OptimizationHistoryFailedItem[] = [];
  for (const item of normalized) {
    if (!item?.job_id || seen.has(item.job_id)) {
      continue;
    }
    seen.add(item.job_id);
    deduped.push({
      job_id: item.job_id,
      reason_code: item.reason_code || "UNKNOWN",
      reason_message: item.reason_message || UNKNOWN_FAILURE_MESSAGE
    });
  }
  return deduped;
}

export function mergeFailureQueue(
  previous: OptimizationHistoryFailedItem[],
  retriedIds: string[],
  latestFailedItems: OptimizationHistoryFailedItem[]
): OptimizationHistoryFailedItem[] {
  const retriedSet = new Set(retriedIds);
  const merged = new Map<string, OptimizationHistoryFailedItem>();
  for (const item of previous) {
    if (!retriedSet.has(item.job_id)) {
      merged.set(item.job_id, item);
    }
  }
  for (const item of latestFailedItems) {
    merged.set(item.job_id, item);
  }
  return Array.from(merged.values());
}

export function failureReasonHint(reasonCode: string): string {
  if (reasonCode === "JOB_NOT_FINISHED") {
    return "任务仍在运行，建议先刷新历史后再重试。";
  }
  if (reasonCode === "REQUEST_FAILED") {
    return "请求失败，通常可直接批量重试。";
  }
  if (
    reasonCode === "NOT_FOUND_OR_ALREADY_DELETED" ||
    reasonCode === "NOT_FOUND_OR_NOT_DELETED"
  ) {
    return "任务可能已被清理或已恢复，通常无需重复重试。";
  }
  return "可尝试重试；若持续失败，建议刷新后再试。";
}

export function normalizeOperationLogs(raw: unknown): OperationLogEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const deduped = new Map<string, OperationLogEntry>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<OperationLogEntry>;
    if (typeof candidate.id !== "string" || !candidate.id.trim()) {
      continue;
    }
    const action = candidate.action === "restore" ? "restore" : "clear";
    const requested = Number.isFinite(candidate.requested)
      ? Math.max(0, Number(candidate.requested))
      : 0;
    const success = Number.isFinite(candidate.success)
      ? Math.max(0, Number(candidate.success))
      : 0;
    const failed = Number.isFinite(candidate.failed)
      ? Math.max(0, Number(candidate.failed))
      : 0;
    const at = Number.isFinite(candidate.at) ? Number(candidate.at) : Date.now();
    deduped.set(candidate.id.trim(), {
      id: candidate.id.trim(),
      action,
      requested,
      success,
      failed,
      jobIds: toUniqueJobIds(candidate.jobIds ?? []),
      failedItems: normalizeFailedItems(candidate.failedItems ?? [], []),
      operationId:
        typeof candidate.operationId === "string" && candidate.operationId.trim()
          ? candidate.operationId.trim()
          : undefined,
      undoUntil:
        typeof candidate.undoUntil === "string" && candidate.undoUntil.trim()
          ? candidate.undoUntil.trim()
          : undefined,
      summaryText:
        typeof candidate.summaryText === "string" && candidate.summaryText.trim()
          ? candidate.summaryText.trim()
          : undefined,
      requestId:
        typeof candidate.requestId === "string" && candidate.requestId.trim()
          ? candidate.requestId.trim()
          : undefined,
      retryable:
        typeof candidate.retryable === "boolean" ? candidate.retryable : undefined,
      at
    });
  }
  return Array.from(deduped.values())
    .sort((left, right) => right.at - left.at)
    .slice(0, OPERATION_LOG_MAX_ITEMS);
}

export function readStoredOperationLogs(): OperationLogEntry[] {
  return readPlain(STORAGE_KEYS.optimizationOperationLogs, normalizeOperationLogs) ?? [];
}
