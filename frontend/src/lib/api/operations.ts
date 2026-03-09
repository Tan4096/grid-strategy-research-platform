import type { OperationRecord, OperationRecordPageResponse, OptimizationHistoryFailedItem } from "../../lib/operation-models";
import { requestJson, type RequestOptions } from "./core";

function normalizeJobIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    )
  );
}

function normalizeFailedItems(raw: unknown): OptimizationHistoryFailedItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const items: OptimizationHistoryFailedItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const jobIdRaw = (entry as { job_id?: unknown }).job_id;
    const reasonCodeRaw = (entry as { reason_code?: unknown }).reason_code;
    const reasonMessageRaw = (entry as { reason_message?: unknown }).reason_message;
    if (typeof jobIdRaw !== "string" || !jobIdRaw.trim()) {
      continue;
    }
    const jobId = jobIdRaw.trim();
    if (seen.has(jobId)) {
      continue;
    }
    seen.add(jobId);
    items.push({
      job_id: jobId,
      reason_code:
        typeof reasonCodeRaw === "string" && reasonCodeRaw.trim() ? reasonCodeRaw.trim() : "UNKNOWN",
      reason_message:
        typeof reasonMessageRaw === "string" && reasonMessageRaw.trim()
          ? reasonMessageRaw.trim()
          : "清空失败，未返回详细原因"
    });
  }
  return items;
}

function normalizeMeta(raw: unknown): { retryable?: boolean; [key: string]: unknown } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const payload = { ...(raw as Record<string, unknown>) };
  if ("retryable" in payload && typeof payload.retryable !== "boolean") {
    delete payload.retryable;
  }
  return payload;
}

interface RawOperationRecord {
  operation_id?: unknown;
  action?: unknown;
  status?: unknown;
  requested?: unknown;
  success?: unknown;
  failed?: unknown;
  skipped?: unknown;
  job_ids?: unknown;
  failed_items?: unknown;
  undo_until?: unknown;
  summary_text?: unknown;
  request_id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  meta?: unknown;
}

function normalizeOperationRecord(raw: RawOperationRecord): OperationRecord {
  return {
    operation_id:
      typeof raw.operation_id === "string" && raw.operation_id.trim() ? raw.operation_id.trim() : "",
    action: typeof raw.action === "string" && raw.action.trim() ? raw.action.trim() : "unknown",
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : "unknown",
    requested: Number.isFinite(raw.requested) ? Math.max(0, Number(raw.requested)) : 0,
    success: Number.isFinite(raw.success) ? Math.max(0, Number(raw.success)) : 0,
    failed: Number.isFinite(raw.failed) ? Math.max(0, Number(raw.failed)) : 0,
    skipped: Number.isFinite(raw.skipped) ? Math.max(0, Number(raw.skipped)) : 0,
    job_ids: normalizeJobIdList(raw.job_ids),
    failed_items: normalizeFailedItems(raw.failed_items),
    undo_until:
      typeof raw.undo_until === "string" && raw.undo_until.trim() ? raw.undo_until.trim() : undefined,
    summary_text:
      typeof raw.summary_text === "string" && raw.summary_text.trim()
        ? raw.summary_text.trim()
        : undefined,
    request_id:
      typeof raw.request_id === "string" && raw.request_id.trim() ? raw.request_id.trim() : undefined,
    created_at:
      typeof raw.created_at === "string" && raw.created_at.trim()
        ? raw.created_at.trim()
        : new Date().toISOString(),
    updated_at:
      typeof raw.updated_at === "string" && raw.updated_at.trim()
        ? raw.updated_at.trim()
        : new Date().toISOString(),
    meta: normalizeMeta(raw.meta)
  };
}

interface RawOperationRecordPage {
  items?: unknown;
  next_cursor?: unknown;
}

export async function fetchOperation(
  operationId: string,
  options?: RequestOptions
): Promise<OperationRecord> {
  const payload = await requestJson<RawOperationRecord>(
    `/api/v1/operations/${encodeURIComponent(operationId)}`,
    { method: "GET" },
    options
  );
  return normalizeOperationRecord(payload);
}

export async function fetchOperations(
  limit = 30,
  cursor?: string | null,
  action?: string | null,
  status?: string | null,
  options?: RequestOptions
): Promise<OperationRecordPageResponse> {
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, limit)))
  });
  if (cursor && cursor.trim()) {
    query.set("cursor", cursor.trim());
  }
  if (action && action.trim()) {
    query.set("action", action.trim());
  }
  if (status && status.trim()) {
    query.set("status", status.trim());
  }
  const payload = await requestJson<RawOperationRecordPage>(
    `/api/v1/operations?${query.toString()}`,
    { method: "GET" },
    options
  );
  const items = Array.isArray(payload.items)
    ? payload.items
        .filter((item): item is RawOperationRecord => Boolean(item) && typeof item === "object")
        .map((item) => normalizeOperationRecord(item))
        .filter((item) => item.operation_id.length > 0)
    : [];
  return {
    items,
    next_cursor:
      typeof payload.next_cursor === "string" && payload.next_cursor.trim()
        ? payload.next_cursor.trim()
        : null
  };
}
