import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildJobStreamUrl,
  cancelBacktest,
  fetchBacktestStatus,
  getApiErrorInfo,
  parseJobStreamUpdate,
  startBacktest
} from "../lib/api";
import { persistLastRunStrategyTemplate } from "../lib/exampleTemplateResolver";
import { NOTICE_ADVICE, buildJobLabel, buildNoticeDetail } from "../lib/notificationCopy";
import { BacktestRequest, BacktestResponse, BacktestStatusResponse, JobTransportMode } from "../types";
import type { EmitOperationEventInput } from "./useOperationFeedback";

interface Precheck {
  errors: string[];
  warnings: string[];
}

interface Params {
  request: BacktestRequest;
  requestReady: boolean;
  precheck: Precheck;
  onJobResumed?: (jobId: string) => void;
  showToast?: (message: string | EmitOperationEventInput) => void;
  notifyCenter?: (message: string | EmitOperationEventInput) => void;
}

interface Result {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  transportMode: JobTransportMode;
  runBacktest: (overrideRequest?: BacktestRequest) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

const BACKTEST_ACTIVE_JOB_STORAGE_KEY = "backtest_active_job_v1";
const BACKTEST_RESUME_ENABLED = (import.meta.env.VITE_JOB_RESUME_ENABLED ?? "1") !== "0";

interface PersistedBacktestJob {
  job_id: string;
  started_at: number;
}

function normalizePersistedBacktestJob(raw: unknown): PersistedBacktestJob | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = raw as Partial<PersistedBacktestJob>;
  if (typeof payload.job_id !== "string" || !payload.job_id.trim()) {
    return null;
  }
  const startedAt = Number(payload.started_at);
  return {
    job_id: payload.job_id.trim(),
    started_at: Number.isFinite(startedAt) ? startedAt : Date.now()
  };
}

function readPersistedBacktestJob(): PersistedBacktestJob | null {
  if (!BACKTEST_RESUME_ENABLED || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(BACKTEST_ACTIVE_JOB_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizePersistedBacktestJob(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writePersistedBacktestJob(jobId: string): void {
  if (!BACKTEST_RESUME_ENABLED || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      BACKTEST_ACTIVE_JOB_STORAGE_KEY,
      JSON.stringify({
        job_id: jobId,
        started_at: Date.now()
      } satisfies PersistedBacktestJob)
    );
  } catch {
    // ignore storage failures
  }
}

function clearPersistedBacktestJob(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(BACKTEST_ACTIVE_JOB_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function backtestSyncNoticeId(jobId: string): string {
  return `backtest-sync:${jobId}`;
}

export function useBacktestRunner({ request, requestReady, precheck, onJobResumed, showToast, notifyCenter }: Params): Result {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transportMode, setTransportMode] = useState<JobTransportMode>("idle");
  const runNonceRef = useRef(0);
  const resumeAttemptedRef = useRef(false);

  const canRun = useMemo(() => precheck.errors.length === 0, [precheck.errors.length]);

  const applyBacktestStatus = useCallback((status: BacktestStatusResponse): boolean => {
    notifyCenter?.({
      id: backtestSyncNoticeId(status.job.job_id),
      dismiss: true,
      kind: "state",
      title: "",
      action: "backtest_status_poll",
      source: "backtest_runner"
    });
    if (status.job.status === "completed") {
      setResult(status.result);
      setError(null);
      setLoading(false);
      setJobId(null);
      setTransportMode("idle");
      clearPersistedBacktestJob();
      notifyCenter?.({
        kind: "history",
        category: "success",
        action: "backtest_terminal",
        title: "回测结束",
        detail: buildNoticeDetail(buildJobLabel("回测任务", status.job.job_id), status.job.message?.trim() || "已完成", NOTICE_ADVICE.viewResults),
        status: "success",
        job_ids: [status.job.job_id],
        source: "backtest_runner"
      });
      return true;
    }
    if (status.job.status === "failed") {
      setError(status.job.error ?? status.job.message ?? "回测失败");
      setLoading(false);
      setJobId(null);
      setTransportMode("idle");
      clearPersistedBacktestJob();
      notifyCenter?.({
        kind: "history",
        category: "error",
        action: "backtest_terminal",
        title: "回测异常结束",
        detail: buildNoticeDetail(buildJobLabel("回测任务", status.job.job_id), `异常结束：${status.job.error ?? status.job.message ?? "未返回原因"}`, NOTICE_ADVICE.retryLater),
        status: "failed",
        job_ids: [status.job.job_id],
        source: "backtest_runner"
      });
      return true;
    }
    if (status.job.status === "cancelled") {
      setError(status.job.message ?? "回测已取消");
      setLoading(false);
      setJobId(null);
      setTransportMode("idle");
      clearPersistedBacktestJob();
      notifyCenter?.({
        kind: "history",
        category: "warning",
        action: "backtest_terminal",
        title: "回测已终止",
        detail: buildNoticeDetail(buildJobLabel("回测任务", status.job.job_id), status.job.message?.trim() || "已取消", NOTICE_ADVICE.viewResults),
        status: "failed",
        job_ids: [status.job.job_id],
        source: "backtest_runner"
      });
      return true;
    }
    return false;
  }, [notifyCenter]);

  const runBacktest = useCallback(async (overrideRequest?: BacktestRequest) => {
    const effectiveRequest = overrideRequest ?? request;
    if (!requestReady) {
      // Allow fallback/default params to run during initial hydration.
    }
    if (!canRun) {
      setError(precheck.errors[0] ?? "参数校验失败");
      return;
    }
    const runNonce = runNonceRef.current + 1;
    runNonceRef.current = runNonce;
    setLoading(true);
    setTransportMode("connecting");
    setError(null);
    setResult(null);
    persistLastRunStrategyTemplate(effectiveRequest);

    if (jobId) {
      try {
        await cancelBacktest(jobId, { timeoutMs: 5_000 });
      } catch {
        // Ignore cancellation errors of stale jobs.
      }
    }

    try {
      const started = await startBacktest(effectiveRequest, { timeoutMs: 30_000 });
      if (runNonce !== runNonceRef.current) {
        return;
      }
      setJobId(started.job_id);
      writePersistedBacktestJob(started.job_id);
      showToast?.({
        category: "info",
        action: "backtest_start",
        title: started.idempotency_reused ? "已复用回测任务" : "回测已启动",
        detail: buildNoticeDetail(buildJobLabel("回测任务", started.job_id), started.idempotency_reused ? "已复用现有任务" : "已启动", NOTICE_ADVICE.watchRuntime),
        status: started.idempotency_reused ? "success" : "queued",
        job_ids: [started.job_id],
        source: "backtest_runner"
      });
    } catch (err) {
      if (runNonce !== runNonceRef.current) {
        return;
      }
      const errorInfo = getApiErrorInfo(err);
      const message = errorInfo.message || "回测失败";
      setError(message);
      setLoading(false);
      setTransportMode("idle");
      showToast?.({
        category: "error",
        action: "backtest_start",
        title: "回测启动异常",
        detail: buildNoticeDetail("回测任务", `启动失败：${message}`, NOTICE_ADVICE.reviewParams),
        status: "failed",
        request_id: errorInfo.request_id,
        retryable: errorInfo.retryable,
        source: "backtest_runner"
      });
    }
  }, [canRun, jobId, precheck.errors, request, requestReady, showToast]);

  useEffect(() => {
    if (!BACKTEST_RESUME_ENABLED || resumeAttemptedRef.current || loading || jobId || result) {
      return;
    }
    resumeAttemptedRef.current = true;
    const persisted = readPersistedBacktestJob();
    if (!persisted) {
      return;
    }
    setError(null);
    setLoading(true);
    setTransportMode("connecting");
    setJobId(persisted.job_id);
    onJobResumed?.(persisted.job_id);
  }, [jobId, loading, onJobResumed, result]);

  useEffect(() => {
    if (!jobId || !loading) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let connectingTimer: number | null = null;
    let stream: EventSource | null = null;
    let pollingStarted = false;
    let terminalReached = false;
    let reportedPollingFallback = false;

    const poll = async () => {
      try {
        const status = await fetchBacktestStatus(jobId, {
          timeoutMs: 20_000,
          retries: 1
        });
        if (cancelled) {
          return;
        }
        setError(null);
        notifyCenter?.({
          id: backtestSyncNoticeId(jobId),
          dismiss: true,
          kind: "state",
          title: "",
          action: "backtest_status_poll",
          source: "backtest_runner"
        });
        if (applyBacktestStatus(status)) {
          terminalReached = true;
          return;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const errorInfo = getApiErrorInfo(err);
        const message = errorInfo.message || "回测状态获取失败";
        setError(message);
        notifyCenter?.({
          id: backtestSyncNoticeId(jobId),
          kind: "state",
          category: "error",
          action: "backtest_status_poll",
          title: "回测跟踪异常",
          detail: buildNoticeDetail(buildJobLabel("回测任务", jobId), `状态拉取失败：${message}`, NOTICE_ADVICE.retryLater),
          status: "failed",
          request_id: errorInfo.request_id,
          retryable: errorInfo.retryable,
          source: "backtest_runner"
        });
        const hidden = document.visibilityState !== "visible";
        timer = window.setTimeout(poll, hidden ? 3000 : 1200);
        return;
      }

      const hidden = document.visibilityState !== "visible";
      timer = window.setTimeout(poll, hidden ? 3000 : 1200);
    };

    const startPollingFallback = () => {
      if (pollingStarted || cancelled || terminalReached) {
        return;
      }
      if (connectingTimer) {
        window.clearTimeout(connectingTimer);
        connectingTimer = null;
      }
      pollingStarted = true;
      setTransportMode("polling");
      if (!reportedPollingFallback) {
        reportedPollingFallback = true;
        showToast?.({
          category: "info",
          action: "backtest_transport_downgrade",
          title: "实时连接已降级为轮询",
          detail: buildNoticeDetail(buildJobLabel("回测任务", jobId), "实时流已切换为轮询", NOTICE_ADVICE.watchRuntime),
          status: "running",
          job_ids: jobId ? [jobId] : [],
          source: "backtest_runner"
        });
      }
      void poll();
    };

    const setupSse = () => {
      if (typeof EventSource === "undefined") {
        startPollingFallback();
        return;
      }
      try {
        setTransportMode("connecting");
        stream = new EventSource(buildJobStreamUrl(jobId, "backtest"));
        connectingTimer = window.setTimeout(() => {
          if (cancelled || terminalReached || pollingStarted) {
            return;
          }
          stream?.close();
          stream = null;
          startPollingFallback();
        }, 5000);
      } catch {
        startPollingFallback();
        return;
      }
      stream.addEventListener("open", () => {
        if (!cancelled) {
          if (connectingTimer) {
            window.clearTimeout(connectingTimer);
            connectingTimer = null;
          }
          setTransportMode("sse");
        }
      });
      stream.addEventListener("update", (event) => {
        if (cancelled) {
          return;
        }
        const parsed = parseJobStreamUpdate<BacktestStatusResponse>((event as MessageEvent<string>).data);
        if (!parsed || parsed.job_type !== "backtest" || parsed.job_id !== jobId || !parsed.payload) {
          return;
        }
        setError(null);
        notifyCenter?.({
          id: backtestSyncNoticeId(jobId),
          dismiss: true,
          kind: "state",
          title: "",
          action: "backtest_status_poll",
          source: "backtest_runner"
        });
        terminalReached = applyBacktestStatus(parsed.payload);
        if (terminalReached) {
          stream?.close();
          stream = null;
        }
      });
      stream.addEventListener("error", () => {
        if (cancelled || terminalReached) {
          return;
        }
        if (connectingTimer) {
          window.clearTimeout(connectingTimer);
          connectingTimer = null;
        }
        stream?.close();
        stream = null;
        startPollingFallback();
      });
    };

    setupSse();

    return () => {
      cancelled = true;
      setTransportMode("idle");
      stream?.close();
      if (timer) {
        window.clearTimeout(timer);
      }
      if (connectingTimer) {
        window.clearTimeout(connectingTimer);
      }
    };
  }, [applyBacktestStatus, jobId, loading, notifyCenter, showToast]);

  return {
    result,
    loading,
    error,
    transportMode,
    runBacktest,
    clearError: () => setError(null),
    reset: () => {
      runNonceRef.current += 1;
      setResult(null);
      setError(null);
      setLoading(false);
      setTransportMode("idle");
      clearPersistedBacktestJob();
      setJobId((currentJob) => {
        if (currentJob) {
          notifyCenter?.({
            id: backtestSyncNoticeId(currentJob),
            dismiss: true,
            kind: "state",
            title: "",
            action: "backtest_status_poll",
            source: "backtest_runner"
          });
          void cancelBacktest(currentJob, { timeoutMs: 5_000 }).catch(() => undefined);
        }
        return null;
      });
    }
  };
}
