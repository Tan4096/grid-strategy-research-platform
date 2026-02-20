import {
  BacktestStartResponse,
  BacktestStatusResponse,
  BacktestRequest,
  BacktestResponse,
  MarketParamsResponse,
  OptimizationHeatmapResponse,
  OptimizationProgressResponse,
  OptimizationRowsResponse,
  OptimizationRequest,
  OptimizationStartResponse,
  OptimizationStatusResponse,
  SortOrder
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 30_000);

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new Error("request_timeout")), timeoutMs);
  const onAbort = () => controller.abort(new Error("request_aborted"));

  if (signal) {
    if (signal.aborted) {
      controller.abort(new Error("request_aborted"));
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = await response.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      // ignore JSON parse errors for error body
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, retryDelayMs = 400 }: RequestOptions = {}
): Promise<T> {
  let attempt = 0;
  let delayMs = retryDelayMs;

  while (true) {
    const scoped = buildAbortSignal(signal, timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: scoped.signal
      });
      return await parseJsonResponse<T>(response);
    } catch (err) {
      const isAbortError = err instanceof DOMException && err.name === "AbortError";
      const canRetry = attempt < retries && !isAbortError;
      if (!canRetry) {
        if (isAbortError) {
          throw new Error("请求超时或被取消");
        }
        throw err;
      }
      attempt += 1;
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 4000);
    } finally {
      scoped.cleanup();
    }
  }
}

async function requestBlob(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}
): Promise<Blob> {
  const scoped = buildAbortSignal(signal, timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: scoped.signal
    });
    if (!response.ok) {
      let detail = "Request failed";
      try {
        const body = await response.json();
        detail = body.detail ?? JSON.stringify(body);
      } catch {
        // ignore JSON parse errors for error body
      }
      throw new Error(detail);
    }
    return response.blob();
  } catch (err) {
    const isAbortError = err instanceof DOMException && err.name === "AbortError";
    if (isAbortError) {
      throw new Error("请求超时或被取消");
    }
    throw err;
  } finally {
    scoped.cleanup();
  }
}

export async function fetchDefaults(options?: RequestOptions): Promise<BacktestRequest> {
  return requestJson<BacktestRequest>("/api/v1/backtest/defaults", { method: "GET" }, options);
}

export async function runBacktest(payload: BacktestRequest, options?: RequestOptions): Promise<BacktestResponse> {
  return requestJson<BacktestResponse>(
    "/api/v1/backtest/run",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    options
  );
}

export async function startBacktest(payload: BacktestRequest, options?: RequestOptions): Promise<BacktestStartResponse> {
  return requestJson<BacktestStartResponse>(
    "/api/v1/backtest/start",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    options
  );
}

export async function fetchBacktestStatus(jobId: string, options?: RequestOptions): Promise<BacktestStatusResponse> {
  return requestJson<BacktestStatusResponse>(`/api/v1/backtest/${jobId}`, { method: "GET" }, options);
}

export async function cancelBacktest(
  jobId: string,
  options?: RequestOptions
): Promise<{ job_id: string; status: string }> {
  return requestJson<{ job_id: string; status: string }>(
    `/api/v1/backtest/${jobId}/cancel`,
    { method: "POST" },
    options
  );
}

export async function fetchMarketParams(
  source: string,
  symbol: string,
  options?: RequestOptions
): Promise<MarketParamsResponse> {
  const query = new URLSearchParams({
    source,
    symbol
  });
  return requestJson<MarketParamsResponse>(`/api/v1/market/params?${query.toString()}`, { method: "GET" }, options);
}

export async function startOptimization(
  payload: OptimizationRequest,
  options?: RequestOptions
): Promise<OptimizationStartResponse> {
  return requestJson<OptimizationStartResponse>(
    "/api/v1/optimization/start",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    options
  );
}

export async function cancelOptimization(jobId: string, options?: RequestOptions): Promise<{ job_id: string; status: string }> {
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
  return requestJson<OptimizationStartResponse>(`/api/v1/optimization/${jobId}/restart`, { method: "POST" }, options);
}

export async function fetchOptimizationHistory(
  limit = 30,
  options?: RequestOptions
): Promise<OptimizationProgressResponse[]> {
  const query = new URLSearchParams({
    limit: String(limit)
  });
  return requestJson<OptimizationProgressResponse[]>(`/api/v1/optimization-history?${query.toString()}`, { method: "GET" }, options);
}
