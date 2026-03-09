import {
  BacktestJobStatus,
  BacktestStartResponse,
  JobStreamUpdate,
  OptimizationHistoryClearResult,
  OptimizationHistoryFailedItem,
  OptimizationJobStatus,
  OptimizationStartResponse
} from "../types";
import type { operations } from "./api.generated";

export type ApiBacktestStartRequest =
  operations["start_backtest_api_api_v1_backtest_start_post"]["requestBody"]["content"]["application/json"];
export type ApiBacktestStartResponse =
  operations["start_backtest_api_api_v1_backtest_start_post"]["responses"]["200"]["content"]["application/json"];

export type ApiOptimizationStartRequest =
  operations["start_optimization_api_api_v1_optimization_start_post"]["requestBody"]["content"]["application/json"];
export type ApiOptimizationStartResponse =
  operations["start_optimization_api_api_v1_optimization_start_post"]["responses"]["200"]["content"]["application/json"];

const BACKTEST_JOB_STATUSES = new Set<BacktestJobStatus>([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

const OPTIMIZATION_JOB_STATUSES = new Set<OptimizationJobStatus>([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

function normalizeBacktestStatus(raw: unknown): BacktestJobStatus {
  const status = String(raw ?? "").trim().toLowerCase();
  return BACKTEST_JOB_STATUSES.has(status as BacktestJobStatus)
    ? (status as BacktestJobStatus)
    : "pending";
}

function normalizeOptimizationStatus(raw: unknown): OptimizationJobStatus {
  const status = String(raw ?? "").trim().toLowerCase();
  return OPTIMIZATION_JOB_STATUSES.has(status as OptimizationJobStatus)
    ? (status as OptimizationJobStatus)
    : "pending";
}

interface RawOptimizationHistoryClearPayload {
  requested?: number;
  deleted?: number;
  failed?: number;
  deleted_job_ids?: unknown;
  failed_job_ids?: unknown;
  failed_items?: unknown;
  skipped?: unknown;
  skipped_job_ids?: unknown;
  soft_delete_ttl_hours?: unknown;
  operation_id?: unknown;
  undo_until?: unknown;
  summary_text?: unknown;
  request_id?: unknown;
  meta?: unknown;
}

export function normalizeBacktestStartResponse(raw: ApiBacktestStartResponse): BacktestStartResponse {
  return {
    job_id: String(raw.job_id),
    status: normalizeBacktestStatus(raw.status),
    idempotency_reused: raw.idempotency_reused === true
  };
}

export function normalizeOptimizationStartResponse(
  raw: ApiOptimizationStartResponse
): OptimizationStartResponse {
  return {
    job_id: String(raw.job_id),
    status: normalizeOptimizationStatus(raw.status),
    total_combinations: Number.isFinite(raw.total_combinations) ? Number(raw.total_combinations) : 0,
    idempotency_reused: raw.idempotency_reused === true
  };
}

export function normalizeJobIds(jobIds: string[]): string[] {
  return Array.from(
    new Set(
      jobIds
        .map((jobId) => (typeof jobId === "string" ? jobId.trim() : ""))
        .filter((jobId) => jobId.length > 0)
    )
  );
}

function normalizeJobIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))
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
      reason_code: typeof reasonCodeRaw === "string" && reasonCodeRaw.trim() ? reasonCodeRaw.trim() : "UNKNOWN",
      reason_message:
        typeof reasonMessageRaw === "string" && reasonMessageRaw.trim()
          ? reasonMessageRaw.trim()
          : "清空失败，未返回详细原因"
    });
  }
  return items;
}

function asFiniteNumber(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeMeta(raw: unknown): { retryable?: boolean; [key: string]: unknown } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const meta = { ...(raw as Record<string, unknown>) };
  if ("retryable" in meta && typeof meta.retryable !== "boolean") {
    delete meta.retryable;
  }
  return meta;
}

export function normalizeOptimizationHistoryClearResponse(
  raw: unknown,
  requestedJobIds: string[]
): OptimizationHistoryClearResult {
  const payload = (raw ?? {}) as RawOptimizationHistoryClearPayload;
  const requested = asFiniteNumber(payload.requested, requestedJobIds.length);
  const deleted = asFiniteNumber(payload.deleted, 0);
  const failed = asFiniteNumber(payload.failed, Math.max(0, requested - deleted));

  const failedJobIds = normalizeJobIdList(payload.failed_job_ids);
  const failedItems = normalizeFailedItems(payload.failed_items);
  const skippedJobIds = normalizeJobIdList(payload.skipped_job_ids);
  const failedSet = new Set(failedJobIds);
  let deletedJobIds = normalizeJobIdList(payload.deleted_job_ids);
  if (!deletedJobIds.length && deleted > 0) {
    deletedJobIds = requestedJobIds.filter((jobId) => !failedSet.has(jobId)).slice(0, deleted);
  }

  return {
    requested,
    deleted,
    failed: Math.max(failed, failedJobIds.length, failedItems.length),
    deleted_job_ids: deletedJobIds,
    failed_job_ids: failedJobIds,
    failed_items: failedItems,
    skipped: asFiniteNumber(payload.skipped, skippedJobIds.length),
    skipped_job_ids: skippedJobIds,
    soft_delete_ttl_hours: asFiniteNumber(payload.soft_delete_ttl_hours, 48),
    operation_id:
      typeof payload.operation_id === "string" && payload.operation_id.trim()
        ? payload.operation_id.trim()
        : undefined,
    undo_until:
      typeof payload.undo_until === "string" && payload.undo_until.trim()
        ? payload.undo_until.trim()
        : undefined,
    summary_text:
      typeof payload.summary_text === "string" && payload.summary_text.trim()
        ? payload.summary_text.trim()
        : undefined,
    request_id:
      typeof payload.request_id === "string" && payload.request_id.trim()
        ? payload.request_id.trim()
        : undefined,
    meta: normalizeMeta(payload.meta)
  };
}

export function normalizeJobStreamUpdate<TPayload>(raw: unknown): JobStreamUpdate<TPayload> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = raw as Partial<JobStreamUpdate<TPayload>>;
  if (typeof payload.job_id !== "string" || !payload.job_id.trim()) {
    return null;
  }
  if (payload.job_type !== "backtest" && payload.job_type !== "optimization") {
    return null;
  }
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (!status) {
    return null;
  }
  return {
    job_id: payload.job_id.trim(),
    job_type: payload.job_type,
    status,
    progress: Number.isFinite(payload.progress) ? Number(payload.progress) : 0,
    terminal: payload.terminal === true,
    payload: (payload.payload ?? null) as TPayload
  };
}
