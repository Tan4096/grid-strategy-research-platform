import { nowIso, nowMs } from "../time";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
export const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 30_000);
const CLIENT_SESSION_STORAGE_KEY = "btc-grid-backtest:client-session:v1";

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
  detail?: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly request_id?: string;
  readonly meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      request_id?: string;
      meta?: {
        retryable?: boolean;
        [key: string]: unknown;
      };
    }
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.request_id = options.request_id;
    this.meta = options.meta;
  }
}

export function getApiErrorInfo(error: unknown): {
  message: string;
  code?: string;
  request_id?: string;
  retryable?: boolean;
} {
  if (error instanceof ApiRequestError) {
    return {
      message: error.message,
      code: error.code,
      request_id: error.request_id,
      retryable: error.meta?.retryable
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message
    };
  }
  return {
    message: "请求失败"
  };
}

export function getClientSessionId(): string {
  if (typeof window === "undefined") {
    return "server-runtime";
  }
  try {
    const existing = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${nowMs()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "session-storage-unavailable";
  }
}

function withRuntimeHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  merged.set("X-Client-Session", getClientSessionId());
  return merged;
}

function buildErrorMessage(body: ApiErrorBody | null, response: Response): string {
  const baseMessage = body?.message ?? body?.detail ?? "Request failed";
  const requestId = body?.request_id ?? response.headers.get("X-Request-Id") ?? "";
  if (!requestId) {
    return baseMessage;
  }
  return `${baseMessage} (request_id: ${requestId})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${nowMs()}-${Math.random().toString(16).slice(2)}`;
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
    let errorBody: ApiErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // ignore JSON parse errors for error body
    }
    throw new ApiRequestError(buildErrorMessage(errorBody, response), {
      status: response.status,
      code: errorBody?.code,
      request_id: errorBody?.request_id ?? response.headers.get("X-Request-Id") ?? undefined,
      meta: errorBody?.meta
    });
  }
  return response.json() as Promise<T>;
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, retryDelayMs = 400 }: RequestOptions = {}
): Promise<T> {
  let attempt = 0;
  let delayMs = retryDelayMs;

  while (true) {
    const scoped = buildAbortSignal(signal, timeoutMs);
    try {
      const { headers, ...restInit } = init;
      const response = await fetch(`${API_BASE}${path}`, {
        ...restInit,
        headers: withRuntimeHeaders(headers),
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
      delayMs = Math.min(delayMs * 2, 4_000);
    } finally {
      scoped.cleanup();
    }
  }
}

export async function requestBlob(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}
): Promise<Blob> {
  const scoped = buildAbortSignal(signal, timeoutMs);
  try {
    const { headers, ...restInit } = init;
    const response = await fetch(`${API_BASE}${path}`, {
      ...restInit,
      headers: withRuntimeHeaders(headers),
      signal: scoped.signal
    });
    if (!response.ok) {
      let errorBody: ApiErrorBody | null = null;
      try {
        errorBody = (await response.json()) as ApiErrorBody;
      } catch {
        // ignore JSON parse errors for error body
      }
      throw new ApiRequestError(buildErrorMessage(errorBody, response), {
        status: response.status,
        code: errorBody?.code,
        request_id: errorBody?.request_id ?? response.headers.get("X-Request-Id") ?? undefined,
        meta: errorBody?.meta
      });
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asNumber(value: unknown, fallback = 0): number {
  return coerceNumber(value) ?? fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function asNullableNumber(value: unknown): number | null {
  return coerceNumber(value);
}

export function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function floorIsoToMinute(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return `${nowIso().slice(0, 16)}:00.000Z`;
  }
  parsed.setSeconds(0, 0);
  return parsed.toISOString();
}
