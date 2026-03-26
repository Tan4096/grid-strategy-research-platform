import { useCallback, useEffect, useMemo, useState } from "react";
import type { OperationEvent, OperationEventCategory, OperationEventKind, OperationEventStatus, OperationRecord, OptimizationHistoryFailedItem } from "../lib/operation-models";
import { NOTICE_ADVICE, buildNoticeDetail } from "../lib/notificationCopy";
import { STORAGE_KEYS } from "../lib/storage";
import { nowIso, nowMs } from "../lib/time";

export const OPERATION_FEEDBACK_STORAGE_KEY = "btc-grid-backtest:operation-feedback:v1";
export const OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY = STORAGE_KEYS.operationFeedbackClearedAt;
const FEEDBACK_MAX_ITEMS = 200;
const FEEDBACK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 2000;

type LegacyOperationStatus = "idle" | "done";

export interface EmitOperationEventInput {
  id?: string;
  dismiss?: boolean;
  kind?: OperationEventKind;
  category?: OperationEventCategory;
  type?: OperationEventCategory;
  action?: string;
  title: string;
  detail?: string | null;
  status?: OperationEventStatus | LegacyOperationStatus;
  request_id?: string | null;
  operation_id?: string | null;
  job_ids?: string[];
  failed_items?: OptimizationHistoryFailedItem[];
  retryable?: boolean | null;
  undo_until?: string | null;
  source?: string | null;
}

function actionLabel(action: string): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === "clear_selected") {
    return "清空已选";
  }
  if (normalized === "clear_all") {
    return "全量清空";
  }
  if (normalized === "restore_selected") {
    return "恢复已选";
  }
  if (normalized === "optimization_start") {
    return "启动优化";
  }
  if (normalized === "optimization_restart") {
    return "重启优化";
  }
  if (normalized === "optimization_cancel") {
    return "取消优化";
  }
  if (normalized === "backtest_start") {
    return "启动回测";
  }
  if (normalized === "backtest_terminal" || normalized === "optimization_terminal") {
    return "任务结束";
  }
  return normalized || "系统操作";
}

function normalizeJobIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    )
  );
}

function isExpired(createdAt: string, nowMs: number): boolean {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return true;
  }
  return nowMs - createdMs > FEEDBACK_TTL_MS;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventSortTimeMs(item: OperationEvent): number {
  const updatedAtMs = parseTimestampMs(item.updated_at);
  if (updatedAtMs !== null) {
    return updatedAtMs;
  }
  const createdAtMs = parseTimestampMs(item.created_at);
  return createdAtMs ?? 0;
}

function normalizeStatus(raw: unknown): OperationEventStatus {
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (status) {
    case "queued":
    case "running":
    case "success":
    case "partial_failed":
    case "failed":
    case "undone":
    case "expired":
      return status;
    case "idle":
      return "queued";
    case "done":
      return "success";
    default:
      return "success";
  }
}

function normalizeCategory(rawCategory: unknown, rawType?: unknown): OperationEventCategory {
  const source = typeof rawCategory === "string" && rawCategory.trim() ? rawCategory : rawType;
  const category = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (category === "success" || category === "warning" || category === "error") {
    return category;
  }
  return "info";
}

function normalizeKind(raw: unknown): OperationEventKind {
  return raw === "state" ? "state" : "history";
}

function categoryFromStatus(status: OperationEventStatus): OperationEventCategory {
  if (status === "failed") {
    return "error";
  }
  if (status === "partial_failed" || status === "undone" || status === "expired") {
    return "warning";
  }
  if (status === "success") {
    return "success";
  }
  return "info";
}

function normalizeFailedItems(raw: unknown): OptimizationHistoryFailedItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const items: OptimizationHistoryFailedItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const jobIdRaw = (item as { job_id?: unknown }).job_id;
    if (typeof jobIdRaw !== "string" || !jobIdRaw.trim()) {
      continue;
    }
    const jobId = jobIdRaw.trim();
    if (seen.has(jobId)) {
      continue;
    }
    seen.add(jobId);
    const reasonCodeRaw = (item as { reason_code?: unknown }).reason_code;
    const reasonMessageRaw = (item as { reason_message?: unknown }).reason_message;
    items.push({
      job_id: jobId,
      reason_code:
        typeof reasonCodeRaw === "string" && reasonCodeRaw.trim() ? reasonCodeRaw.trim() : "UNKNOWN",
      reason_message:
        typeof reasonMessageRaw === "string" && reasonMessageRaw.trim()
          ? reasonMessageRaw.trim()
          : "未返回失败原因"
    });
  }
  return items;
}

function normalizeFeedbackItem(raw: unknown): OperationEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<OperationEvent> & { type?: OperationEventCategory };
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const createdAt = typeof item.created_at === "string" ? item.created_at.trim() : "";
  if (!title || !createdAt) {
    return null;
  }
  return {
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `${createdAt}-${Math.random().toString(16).slice(2)}`,
    kind: normalizeKind(item.kind),
    category: normalizeCategory(item.category, item.type),
    action:
      typeof item.action === "string" && item.action.trim() ? item.action.trim() : "unknown",
    status: normalizeStatus(item.status),
    title,
    detail: typeof item.detail === "string" ? item.detail : null,
    created_at: createdAt,
    updated_at:
      typeof item.updated_at === "string" && item.updated_at.trim() ? item.updated_at.trim() : createdAt,
    request_id:
      typeof item.request_id === "string" && item.request_id.trim()
        ? item.request_id.trim()
        : undefined,
    operation_id:
      typeof item.operation_id === "string" && item.operation_id.trim()
        ? item.operation_id.trim()
        : undefined,
    job_ids: normalizeJobIds(item.job_ids),
    failed_items: normalizeFailedItems(item.failed_items),
    retryable: typeof item.retryable === "boolean" ? item.retryable : undefined,
    undo_until:
      typeof item.undo_until === "string" && item.undo_until.trim()
        ? item.undo_until.trim()
        : undefined,
    source:
      typeof item.source === "string" && item.source.trim() ? item.source.trim() : undefined
  };
}

export function mapOperationRecordToEvent(record: OperationRecord): OperationEvent {
  const status = normalizeStatus(record.status);
  const summaryText =
    typeof record.summary_text === "string" && record.summary_text.trim()
      ? record.summary_text.trim()
      : `${actionLabel(record.action)}：请求 ${record.requested} 条，成功 ${record.success} 条，失败 ${record.failed} 条${record.skipped > 0 ? `，跳过 ${record.skipped} 条` : ""}。`;
  const title =
    record.action === "clear_selected" || record.action === "clear_all"
      ? record.failed > 0
        ? "历史清理完成"
        : "历史已清理"
      : record.action === "restore_selected"
        ? record.failed > 0
          ? "历史恢复完成"
          : "历史已恢复"
        : actionLabel(record.action);
  const subject =
    record.action === "clear_selected" || record.action === "clear_all" || record.action === "restore_selected"
      ? "优化历史"
      : actionLabel(record.action);
  const advice =
    record.failed > 0
      ? NOTICE_ADVICE.retryLater
      : record.action === "clear_selected" || record.action === "clear_all"
        ? NOTICE_ADVICE.viewResults
        : record.action === "restore_selected"
          ? NOTICE_ADVICE.viewResults
          : NOTICE_ADVICE.watchRuntime;
  return {
    id: `operation:${record.operation_id}`,
    kind: "history",
    category: categoryFromStatus(status),
    action: record.action,
    status,
    title,
    detail: buildNoticeDetail(subject, summaryText, advice),
    created_at: record.created_at,
    updated_at: record.updated_at,
    request_id: record.request_id ?? undefined,
    operation_id: record.operation_id,
    job_ids: normalizeJobIds(record.job_ids),
    failed_items: normalizeFailedItems(record.failed_items),
    retryable: typeof record.meta?.retryable === "boolean" ? record.meta.retryable : undefined,
    undo_until: record.undo_until ?? undefined,
    source: "server_replay"
  };
}

export function pruneOperationFeedbackItems(
  items: OperationEvent[],
  currentNowMs: number = nowMs()
): OperationEvent[] {
  const seen = new Set<string>();
  const normalized: OperationEvent[] = [];
  for (const raw of items) {
    const item = normalizeFeedbackItem(raw);
    if (!item || isExpired(item.created_at, currentNowMs) || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    normalized.push(item);
  }
  normalized.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return normalized.slice(0, FEEDBACK_MAX_ITEMS);
}

function pruneByClearedAt(items: OperationEvent[], clearedAtMs: number | null): OperationEvent[] {
  if (clearedAtMs === null) {
    return items;
  }
  return items.filter((item) => eventSortTimeMs(item) > clearedAtMs);
}

export function readOperationFeedbackClearedAtFromStorage(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function readOperationFeedbackFromStorage(clearedAtMs: number | null = null): OperationEvent[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(OPERATION_FEEDBACK_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return pruneByClearedAt(pruneOperationFeedbackItems(parsed as OperationEvent[]), clearedAtMs);
  } catch {
    return [];
  }
}

function writeOperationFeedbackToStorage(items: OperationEvent[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(OPERATION_FEEDBACK_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota or unavailable errors.
  }
}

function writeOperationFeedbackClearedAtToStorage(clearedAtMs: number | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (clearedAtMs === null) {
      window.localStorage.removeItem(OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY, String(clearedAtMs));
  } catch {
    // Ignore storage quota or unavailable errors.
  }
}

function buildFeedbackItem(input: EmitOperationEventInput, existing: OperationEvent | null = null): OperationEvent {
  const nowIsoText = nowIso();
  const normalizedStatus = normalizeStatus(input.status);
  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : `${nowMs()}-${Math.random().toString(16).slice(2)}`,
    kind: existing?.kind ?? normalizeKind(input.kind ?? (input.id ? "state" : "history")),
    category: normalizeCategory(input.category, input.type),
    action: input.action?.trim() || "ui_notice",
    title: input.title.trim(),
    detail: input.detail?.trim() || null,
    status: normalizedStatus,
    created_at: existing?.created_at ?? nowIsoText,
    updated_at: nowIsoText,
    request_id: input.request_id?.trim() || undefined,
    operation_id: input.operation_id?.trim() || undefined,
    job_ids: normalizeJobIds(input.job_ids),
    failed_items: normalizeFailedItems(input.failed_items),
    retryable: typeof input.retryable === "boolean" ? input.retryable : undefined,
    undo_until: input.undo_until?.trim() || undefined,
    source: input.source?.trim() || undefined
  };
}

function sameFailedItems(
  left: OptimizationHistoryFailedItem[] | undefined,
  right: OptimizationHistoryFailedItem[] | undefined
): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) => {
    const other = normalizedRight[index];
    return (
      item.job_id === other?.job_id &&
      item.reason_code === other?.reason_code &&
      item.reason_message === other?.reason_message
    );
  });
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
}

function sameFeedbackContent(existing: OperationEvent, next: OperationEvent): boolean {
  return (
    (existing.kind ?? "history") === (next.kind ?? "history") &&
    existing.category === next.category &&
    existing.action === next.action &&
    existing.status === next.status &&
    existing.title === next.title &&
    (existing.detail ?? null) === (next.detail ?? null) &&
    (existing.request_id ?? null) === (next.request_id ?? null) &&
    (existing.operation_id ?? null) === (next.operation_id ?? null) &&
    sameStringArray(existing.job_ids, next.job_ids) &&
    sameFailedItems(existing.failed_items, next.failed_items) &&
    (existing.retryable ?? null) === (next.retryable ?? null) &&
    (existing.undo_until ?? null) === (next.undo_until ?? null) &&
    (existing.source ?? null) === (next.source ?? null)
  );
}

export function useOperationFeedback() {
  const [clearedAtMs, setClearedAtMs] = useState<number | null>(() =>
    readOperationFeedbackClearedAtFromStorage()
  );
  const [items, setItems] = useState<OperationEvent[]>(() =>
    readOperationFeedbackFromStorage(readOperationFeedbackClearedAtFromStorage())
  );
  const [latestNoticeId, setLatestNoticeId] = useState<string | null>(null);

  useEffect(() => {
    writeOperationFeedbackToStorage(items);
  }, [items]);

  useEffect(() => {
    writeOperationFeedbackClearedAtToStorage(clearedAtMs);
  }, [clearedAtMs]);

  const emitOperationEvent = useCallback((input: EmitOperationEventInput) => {
    const normalizedId = typeof input.id === "string" && input.id.trim() ? input.id.trim() : null;
    if (input.dismiss && normalizedId) {
      setItems((prev) => prev.filter((item) => item.id !== normalizedId));
      setLatestNoticeId((current) => (current === normalizedId ? null : current));
      return;
    }
    const title = input.title.trim();
    if (!title) {
      return;
    }
    if (normalizedId) {
      setItems((prev) => {
        const existing = prev.find((item) => item.id === normalizedId) ?? null;
        const nextItem = buildFeedbackItem({ ...input, id: normalizedId, title }, existing);
        if (existing && sameFeedbackContent(existing, nextItem)) {
          return prev;
        }
        const rest = prev.filter((item) => item.id !== normalizedId);
        return pruneOperationFeedbackItems([nextItem, ...rest]);
      });
      setLatestNoticeId(normalizedId);
      return;
    }
    const nextItem = buildFeedbackItem({ ...input, id: normalizedId ?? undefined, title });
    setItems((prev) => {
      const deduped = prev.filter((existing) => {
        const sameTitle = existing.title === nextItem.title;
        const sameDetail = (existing.detail ?? "") === (nextItem.detail ?? "");
        const sameStatus = existing.status === nextItem.status;
        const sameAction = existing.action === nextItem.action;
        if (!sameTitle || !sameDetail || !sameStatus || !sameAction) {
          return true;
        }
        const existingMs = Date.parse(existing.created_at);
        const nextMs = Date.parse(nextItem.created_at);
        if (!Number.isFinite(existingMs) || !Number.isFinite(nextMs)) {
          return true;
        }
        return Math.abs(nextMs - existingMs) > DEDUPE_WINDOW_MS;
      });
      return pruneOperationFeedbackItems([nextItem, ...deduped]);
    });
    setLatestNoticeId(nextItem.id);
  }, []);

  const dismissOperationFeedback = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setLatestNoticeId((current) => (current === id ? null : current));
  }, []);

  const dismissLatestNotice = useCallback((id: string) => {
    setLatestNoticeId((current) => (current === id ? null : current));
  }, []);

  const clearOperationFeedback = useCallback(() => {
    setClearedAtMs(nowMs());
    setItems([]);
    setLatestNoticeId(null);
  }, []);

  const clearCompletedOperationFeedback = useCallback(() => {
    setItems((prev) =>
      prev.filter((item) => item.status === "queued" || item.status === "running")
    );
  }, []);

  const mergeOperationRecords = useCallback((records: OperationRecord[]) => {
    if (!records.length) {
      return;
    }
    const normalized = records
      .map((record) => mapOperationRecordToEvent(record))
      .filter((event) => Boolean(event.operation_id))
      .filter((event) => eventSortTimeMs(event) > (clearedAtMs ?? -1));
    if (!normalized.length) {
      return;
    }
    const operationIdSet = new Set(
      normalized
        .map((item) => item.operation_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    setItems((prev) => {
      const rest = prev.filter((item) => !item.operation_id || !operationIdSet.has(item.operation_id));
      return pruneOperationFeedbackItems([...normalized, ...rest]);
    });
  }, [clearedAtMs]);

  const upsertOperationRecord = useCallback((record: OperationRecord) => {
    mergeOperationRecords([record]);
  }, [mergeOperationRecords]);

  const latestItem = useMemo(
    () => items.find((item) => item.id === latestNoticeId) ?? null,
    [items, latestNoticeId]
  );

  return {
    operationFeedbackItems: items,
    latestOperationFeedback: latestItem,
    emitOperationEvent,
    emitOperationFeedback: emitOperationEvent,
    dismissOperationFeedback,
    dismissLatestNotice,
    clearOperationFeedback,
    clearCompletedOperationFeedback,
    mergeOperationRecords,
    upsertOperationRecord
  };
}
