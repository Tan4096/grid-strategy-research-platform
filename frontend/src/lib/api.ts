import {
  BacktestRequest,
  BacktestResponse,
  OptimizationRequest,
  OptimizationStartResponse,
  OptimizationStatusResponse,
  SortOrder
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = await response.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      // no-op
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function fetchDefaults(): Promise<BacktestRequest> {
  const response = await fetch(`${API_BASE}/api/v1/backtest/defaults`);
  return parseResponse<BacktestRequest>(response);
}

export async function runBacktest(payload: BacktestRequest): Promise<BacktestResponse> {
  const response = await fetch(`${API_BASE}/api/v1/backtest/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseResponse<BacktestResponse>(response);
}

export async function startOptimization(payload: OptimizationRequest): Promise<OptimizationStartResponse> {
  const response = await fetch(`${API_BASE}/api/v1/optimization/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseResponse<OptimizationStartResponse>(response);
}

export async function fetchOptimizationStatus(
  jobId: string,
  page: number,
  pageSize: number,
  sortBy: string,
  sortOrder: SortOrder
): Promise<OptimizationStatusResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    sort_by: sortBy,
    sort_order: sortOrder
  });
  const response = await fetch(`${API_BASE}/api/v1/optimization/${jobId}?${query.toString()}`);
  return parseResponse<OptimizationStatusResponse>(response);
}

export async function exportOptimizationCsv(jobId: string, sortBy: string, sortOrder: SortOrder): Promise<Blob> {
  const query = new URLSearchParams({
    sort_by: sortBy,
    sort_order: sortOrder
  });
  const response = await fetch(`${API_BASE}/api/v1/optimization/${jobId}/export?${query.toString()}`);
  if (!response.ok) {
    let detail = "Export failed";
    try {
      const body = await response.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      // no-op
    }
    throw new Error(detail);
  }
  return response.blob();
}
