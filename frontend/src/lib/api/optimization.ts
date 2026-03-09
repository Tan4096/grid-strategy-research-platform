import {
  OptimizationHeatmapResponse,
  OptimizationHistoryClearResult,
  OptimizationHistoryFailedItem,
  OptimizationHistoryRestoreResult,
  OptimizationHistoryPageResponse,
  OptimizationJobStatus,
  OptimizationProgressResponse,
  OptimizationRowsResponse,
  OptimizationRequest,
  OptimizationStartResponse,
  OptimizationStatusResponse,
  SortOrder
} from "../../types";
import {
  ApiOptimizationStartRequest,
  ApiOptimizationStartResponse,
  normalizeJobIds,
  normalizeOptimizationHistoryClearResponse,
  normalizeOptimizationStartResponse
} from "../api-contract";
import {
  generateIdempotencyKey,
  requestBlob,
  requestJson,
  type RequestOptions
} from "./core";

export async function startOptimization(
  payload: OptimizationRequest,
  options?: RequestOptions
): Promise<OptimizationStartResponse> {
  const response = await requestJson<ApiOptimizationStartResponse>(
    "/api/v1/optimization/start",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": generateIdempotencyKey()
      },
      body: JSON.stringify(payload as ApiOptimizationStartRequest)
    },
    options
  );
  return normalizeOptimizationStartResponse(response);
}

export async function cancelOptimization(
  jobId: string,
  options?: RequestOptions
): Promise<{ job_id: string; status: string }> {
  return requestJson<{ job_id: string; status: string }>(
    `/api/v1/optimization/${jobId}/cancel`,
    { method: "POST" },
    options
  );
}

export async function fetchOptimizationStatus(
  jobId: string,
  page: number,
  pageSize: number,
  sortBy: string,
  sortOrder: SortOrder,
  options?: RequestOptions
): Promise<OptimizationStatusResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    sort_by: sortBy,
    sort_order: sortOrder
  });
  return requestJson<OptimizationStatusResponse>(
    `/api/v1/optimization/${jobId}?${query.toString()}`,
    { method: "GET" },
    { ...options, retries: options?.retries ?? 2 }
  );
}

export async function fetchOptimizationRows(
  jobId: string,
  page: number,
  pageSize: number,
  sortBy: string,
  sortOrder: SortOrder,
  options?: RequestOptions
): Promise<OptimizationRowsResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    sort_by: sortBy,
    sort_order: sortOrder
  });
  return requestJson<OptimizationRowsResponse>(
    `/api/v1/optimization/${jobId}/rows?${query.toString()}`,
    { method: "GET" },
    { ...options, retries: options?.retries ?? 2 }
  );
}

export async function fetchOptimizationHeatmap(
  jobId: string,
  options?: RequestOptions
): Promise<OptimizationHeatmapResponse> {
  return requestJson<OptimizationHeatmapResponse>(
    `/api/v1/optimization/${jobId}/heatmap`,
    { method: "GET" },
    { ...options, retries: options?.retries ?? 1 }
  );
}

export async function fetchOptimizationProgress(
  jobId: string,
  options?: RequestOptions
): Promise<OptimizationProgressResponse> {
  return requestJson<OptimizationProgressResponse>(
    `/api/v1/optimization/${jobId}/progress`,
    { method: "GET" },
    { ...options, retries: options?.retries ?? 2 }
  );
}

export async function exportOptimizationCsv(
  jobId: string,
  sortBy: string,
  sortOrder: SortOrder,
  options?: RequestOptions
): Promise<Blob> {
  const query = new URLSearchParams({
    sort_by: sortBy,
    sort_order: sortOrder
  });
  return requestBlob(`/api/v1/optimization/${jobId}/export?${query.toString()}`, { method: "GET" }, options);
}

export async function restartOptimization(
  jobId: string,
  options?: RequestOptions
): Promise<OptimizationStartResponse> {
  return requestJson<OptimizationStartResponse>(
    `/api/v1/optimization/${jobId}/restart`,
    { method: "POST" },
    options
  );
}

export async function fetchOptimizationHistory(
  limit = 30,
  cursor?: string | null,
  status?: OptimizationJobStatus | null,
  options?: RequestOptions
): Promise<OptimizationHistoryPageResponse> {
  const query = new URLSearchParams({
    limit: String(limit)
  });
  if (cursor && cursor.trim()) {
    query.set("cursor", cursor.trim());
  }
  if (status) {
    query.set("status", status);
  }
  return requestJson<OptimizationHistoryPageResponse>(
    `/api/v1/optimization-history?${query.toString()}`,
    { method: "GET" },
    options
  );
}

export async function clearOptimizationHistory(
  options?: RequestOptions
): Promise<OptimizationHistoryClearResult> {
  const payload = await requestJson<unknown>(
    "/api/v1/optimization-history",
    {
      method: "DELETE",
      headers: {
        "X-Confirm-Action": "CLEAR_ALL_OPTIMIZATION_HISTORY"
      }
    },
    options
  );
  return normalizeOptimizationHistoryClearResponse(payload, []);
}

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

interface RawOptimizationHistoryRestorePayload {
  requested?: number;
  restored?: number;
  failed?: number;
  restored_job_ids?: unknown;
  failed_job_ids?: unknown;
  failed_items?: unknown;
  operation_id?: unknown;
  summary_text?: unknown;
  request_id?: unknown;
  meta?: unknown;
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

function normalizeHistoryRestoreResult(
  raw: RawOptimizationHistoryRestorePayload,
  requestedJobIds: string[]
): OptimizationHistoryRestoreResult {
  const requested = Number.isFinite(raw.requested) ? Math.max(0, Number(raw.requested)) : requestedJobIds.length;
  const restored = Number.isFinite(raw.restored) ? Math.max(0, Number(raw.restored)) : 0;
  const failed = Number.isFinite(raw.failed) ? Math.max(0, Number(raw.failed)) : Math.max(0, requested - restored);

  const failedJobIds = normalizeJobIdList(raw.failed_job_ids);
  const failedItems = normalizeFailedItems(raw.failed_items);
  const failedSet = new Set(failedJobIds);
  let restoredJobIds = normalizeJobIdList(raw.restored_job_ids);
  if (!restoredJobIds.length && restored > 0) {
    restoredJobIds = requestedJobIds.filter((jobId) => !failedSet.has(jobId)).slice(0, restored);
  }
  return {
    requested,
    restored,
    failed: Math.max(failed, failedJobIds.length, failedItems.length),
    restored_job_ids: restoredJobIds,
    failed_job_ids: failedJobIds,
    failed_items: failedItems,
    operation_id:
      typeof raw.operation_id === "string" && raw.operation_id.trim() ? raw.operation_id.trim() : undefined,
    summary_text:
      typeof raw.summary_text === "string" && raw.summary_text.trim() ? raw.summary_text.trim() : undefined,
    request_id:
      typeof raw.request_id === "string" && raw.request_id.trim() ? raw.request_id.trim() : undefined,
    meta: normalizeMeta(raw.meta)
  };
}

export async function clearSelectedOptimizationHistory(
  jobIds: string[],
  options?: RequestOptions
): Promise<OptimizationHistoryClearResult> {
  const normalizedIds = normalizeJobIds(jobIds);
  if (!normalizedIds.length) {
    return {
      requested: 0,
      deleted: 0,
      failed: 0,
      deleted_job_ids: [],
      failed_job_ids: [],
      failed_items: []
    };
  }

  const query = new URLSearchParams();
  for (const jobId of normalizedIds) {
    query.append("job_id", jobId);
  }

  const payload = await requestJson<unknown>(
    `/api/v1/optimization-history/selected?${query.toString()}`,
    {
      method: "DELETE",
      headers: {
        "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
        "X-Confirm-Count": String(normalizedIds.length)
      }
    },
    options
  );
  return normalizeOptimizationHistoryClearResponse(payload, normalizedIds);
}

export async function restoreSelectedOptimizationHistory(
  jobIds: string[],
  options?: RequestOptions
): Promise<OptimizationHistoryRestoreResult> {
  const normalizedIds = normalizeJobIds(jobIds);
  if (!normalizedIds.length) {
    return {
      requested: 0,
      restored: 0,
      failed: 0,
      restored_job_ids: [],
      failed_job_ids: [],
      failed_items: []
    };
  }

  const query = new URLSearchParams();
  for (const jobId of normalizedIds) {
    query.append("job_id", jobId);
  }

  const payload = await requestJson<RawOptimizationHistoryRestorePayload>(
    `/api/v1/optimization-history/restore-selected?${query.toString()}`,
    { method: "POST" },
    options
  );
  return normalizeHistoryRestoreResult(payload, normalizedIds);
}
