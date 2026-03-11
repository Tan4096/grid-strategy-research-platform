import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import { usePollingLifecycle } from "./usePollingLifecycle";
import { createSsePollingFallbackController } from "./createSsePollingFallbackController";
import {
  buildJobStreamUrl,
  fetchOptimizationProgress,
  fetchOptimizationRows,
  fetchOptimizationStatus,
  getApiErrorInfo,
  parseJobStreamUpdate
} from "../lib/api";
import type { OptimizationResultTab } from "../components/OptimizationPanel";
import type { JobTransportMode } from "../types";
import type { OptimizationJobMeta, OptimizationProgressResponse, OptimizationStatusResponse, SortOrder } from "../lib/api-schema";
import { NOTICE_ADVICE, buildJobLabel, buildNoticeDetail } from "../lib/notificationCopy";
import type { EmitOperationEventInput } from "./useOperationFeedback";

interface Params {
  optimizationJobId: string | null;
  optimizationPage: number;
  optimizationPageSize: number;
  optimizationSortBy: string;
  optimizationSortOrder: SortOrder;
  optimizationResultTab: OptimizationResultTab;
  setOptimizationStatus: Dispatch<SetStateAction<OptimizationStatusResponse | null>>;
  setOptimizationEtaSeconds: (value: number | null) => void;
  setOptimizationError: (value: string | null) => void;
  setOptimizationTransportMode: (mode: JobTransportMode) => void;
  refreshOptimizationHistory: () => Promise<void>;
  showToast: (message: string | EmitOperationEventInput) => void;
  notifyCenter: (message: string | EmitOperationEventInput) => void;
  lastProgressRef: MutableRefObject<{ value: number; ts: number } | null>;
  notifiedTerminalRef: MutableRefObject<string | null>;
}

interface StatusShellOptions {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: SortOrder;
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

function optimizationSyncNoticeId(jobId: string): string {
  return `optimization-sync:${jobId}`;
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function mergeOptimizationJobMeta(
  previous: OptimizationJobMeta | null | undefined,
  incoming: OptimizationJobMeta
): OptimizationJobMeta {
  if (!previous) {
    return incoming;
  }

  const previousTerminal = TERMINAL_JOB_STATUSES.has(previous.status);
  const incomingTerminal = TERMINAL_JOB_STATUSES.has(incoming.status);
  if (incomingTerminal) {
    return incoming;
  }
  if (previousTerminal && !incomingTerminal) {
    return previous;
  }

  const previousCompleted = toFiniteNumber(previous.completed_steps);
  const incomingCompleted = toFiniteNumber(incoming.completed_steps);
  const previousProgress = toFiniteNumber(previous.progress);
  const incomingProgress = toFiniteNumber(incoming.progress);
  const incomingAhead =
    incomingCompleted > previousCompleted || incomingProgress > previousProgress + 1e-6;

  if (incomingAhead) {
    return incoming;
  }

  return {
    ...incoming,
    status: previous.status === "running" && incoming.status === "pending" ? previous.status : incoming.status,
    started_at: incoming.started_at ?? previous.started_at,
    finished_at: incoming.finished_at ?? previous.finished_at,
    progress: previousProgress,
    total_steps: Math.max(toFiniteNumber(incoming.total_steps), toFiniteNumber(previous.total_steps)),
    completed_steps: previousCompleted,
    message: incoming.message ?? previous.message,
    error: incoming.error ?? previous.error,
    total_combinations: Math.max(
      toFiniteNumber(incoming.total_combinations),
      toFiniteNumber(previous.total_combinations)
    ),
    trials_completed: Math.max(
      toFiniteNumber(incoming.trials_completed),
      toFiniteNumber(previous.trials_completed)
    ),
    trials_pruned: Math.max(
      toFiniteNumber(incoming.trials_pruned),
      toFiniteNumber(previous.trials_pruned)
    ),
    pruning_ratio: Math.max(
      toFiniteNumber(incoming.pruning_ratio),
      toFiniteNumber(previous.pruning_ratio)
    )
  };
}

export function mergeOptimizationProgressStatus(
  prev: OptimizationStatusResponse | null,
  progress: OptimizationProgressResponse,
  options: StatusShellOptions
): OptimizationStatusResponse {
  if (prev) {
    return {
      ...prev,
      job: mergeOptimizationJobMeta(prev.job, progress.job),
      target: progress.target
    };
  }

  return {
    job: progress.job,
    target: progress.target,
    sort_by: options.sortBy,
    sort_order: options.sortOrder,
    page: options.page,
    page_size: options.pageSize,
    total_results: 0,
    rows: [],
    best_row: null,
    best_validation_row: null,
    best_equity_curve: [],
    best_score_progression: [],
    convergence_curve_data: [],
    heatmap: [],
    train_window: null,
    validation_window: null
  };
}

export function useOptimizationPolling({
  optimizationJobId,
  optimizationPage,
  optimizationPageSize,
  optimizationSortBy,
  optimizationSortOrder,
  optimizationResultTab,
  setOptimizationStatus,
  setOptimizationEtaSeconds,
  setOptimizationError,
  setOptimizationTransportMode,
  refreshOptimizationHistory,
  showToast,
  notifyCenter,
  lastProgressRef,
  notifiedTerminalRef
}: Params): void {
  const resumePollingRef = useRef<() => void>(() => undefined);
  const { clear: clearPollingTimer, isPageVisible, schedule: schedulePolling } = usePollingLifecycle({
    enabled: Boolean(optimizationJobId),
    onResume: () => resumePollingRef.current()
  });

  useEffect(() => {
    if (!optimizationJobId) {
      setOptimizationTransportMode("idle");
      return;
    }

    let cancelled = false;
    let sseProbeTimer: number | null = null;
    let tick = 0;
    let terminalReached = false;
    let pollingStarted = false;
    let statusFetchInFlight = false;
    let reportedPollingFallback = false;

    const isTerminalStatus = (status: string) =>
      status === "completed" || status === "failed" || status === "cancelled";

    const scheduleNextFallback = (running: boolean) => {
      if (cancelled) {
        return;
      }
      const nextMs = running ? (isPageVisible() ? 1500 : 8000) : isPageVisible() ? 5000 : 15000;
      schedulePolling(nextMs, () => {
        void pollOnce();
      });
    };

    const clearSseProbe = () => {
      if (sseProbeTimer !== null) {
        window.clearInterval(sseProbeTimer);
        sseProbeTimer = null;
      }
    };

    const notifyTerminal = (status: string, jobId: string, message: string | null) => {
      const marker = `${jobId}:${status}`;
      if (notifiedTerminalRef.current === marker) {
        return;
      }
      notifiedTerminalRef.current = marker;

      const prefix = status === "completed" ? "优化结束" : status === "cancelled" ? "优化已终止" : "优化异常结束";
      const text = `${prefix} · ${jobId.slice(0, 8)}${message ? ` · ${message}` : ""}`;
      notifyCenter({
        kind: "history",
        category: status === "completed" ? "success" : status === "cancelled" ? "warning" : "error",
        action: "optimization_terminal",
        title: text,
        detail: buildNoticeDetail(
          buildJobLabel("优化任务", jobId),
          `${prefix}${message ? `：${message}` : ""}`,
          status === "completed" ? NOTICE_ADVICE.viewResults : NOTICE_ADVICE.retryLater
        ),
        status: status === "completed" ? "success" : "failed",
        job_ids: [jobId],
        source: "optimization_polling"
      });

      if ("Notification" in window && document.visibilityState !== "visible") {
        if (Notification.permission === "granted") {
          new Notification("Grid Strategy Research Platform", { body: text });
        } else if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
      }
    };

    const applyProgressPayload = (progress: OptimizationProgressResponse): boolean => {
      const terminal = isTerminalStatus(progress.job.status);
      setOptimizationStatus((prev) =>
        mergeOptimizationProgressStatus(prev, progress, {
          page: optimizationPage,
          pageSize: optimizationPageSize,
          sortBy: optimizationSortBy,
          sortOrder: optimizationSortOrder
        })
      );

      const now = performance.now();
      const progressValue = Math.max(0, Math.min(100, progress.job.progress || 0));
      const prevProgress = lastProgressRef.current;
      if (prevProgress && progressValue > prevProgress.value + 0.01) {
        const dt = (now - prevProgress.ts) / 1000;
        const dp = progressValue - prevProgress.value;
        if (dt > 0 && dp > 0) {
          const speed = dp / dt;
          const eta = Math.round((100 - progressValue) / speed);
          setOptimizationEtaSeconds(Number.isFinite(eta) && eta > 0 ? eta : null);
        }
      }
      lastProgressRef.current = { value: progressValue, ts: now };
      return terminal;
    };

    const fetchStatusSnapshot = async (terminal: boolean): Promise<boolean> => {
      if (cancelled || statusFetchInFlight) {
        return false;
      }
      statusFetchInFlight = true;
      try {
        const needsHeavyPayload = terminal || optimizationResultTab !== "table";
        if (needsHeavyPayload) {
          const status = await fetchOptimizationStatus(
            optimizationJobId,
            optimizationPage,
            optimizationPageSize,
            optimizationSortBy,
            optimizationSortOrder,
            { timeoutMs: 20_000, retries: 2 }
          );
          if (cancelled) {
            return false;
          }
          const missingRows =
            terminal &&
            (status?.total_results ?? 0) > 0 &&
            !(Array.isArray(status?.rows) && status.rows.length > 0);
          if (missingRows) {
            const retryStatus = await fetchOptimizationStatus(
              optimizationJobId,
              optimizationPage,
              optimizationPageSize,
              optimizationSortBy,
              optimizationSortOrder,
              { timeoutMs: 20_000, retries: 2 }
            );
            if (!cancelled) {
              setOptimizationStatus((prev) =>
                prev
                  ? {
                      ...retryStatus,
                      job: mergeOptimizationJobMeta(prev.job, retryStatus.job)
                    }
                  : retryStatus
              );
            }
          } else {
            setOptimizationStatus((prev) =>
              prev
                ? {
                    ...status,
                    job: mergeOptimizationJobMeta(prev.job, status.job)
                  }
                : status
            );
          }
          if (terminal) {
            notifyTerminal(status.job.status, optimizationJobId, status.job.message);
          }
        } else {
          const rowsPayload = await fetchOptimizationRows(
            optimizationJobId,
            optimizationPage,
            optimizationPageSize,
            optimizationSortBy,
            optimizationSortOrder,
            { timeoutMs: 20_000, retries: 2 }
          );
          if (cancelled) {
            return false;
          }
          setOptimizationStatus((prev) => ({
            job: mergeOptimizationJobMeta(prev?.job, rowsPayload.job),
            target: rowsPayload.target,
            sort_by: rowsPayload.sort_by,
            sort_order: rowsPayload.sort_order,
            page: rowsPayload.page,
            page_size: rowsPayload.page_size,
            total_results: rowsPayload.total_results,
            rows: rowsPayload.rows,
            best_row: rowsPayload.best_row,
            best_validation_row: rowsPayload.best_validation_row,
            best_equity_curve: prev?.best_equity_curve ?? [],
            best_score_progression: prev?.best_score_progression ?? [],
            convergence_curve_data: prev?.convergence_curve_data ?? [],
            heatmap: prev?.heatmap ?? [],
            train_window: prev?.train_window ?? null,
            validation_window: prev?.validation_window ?? null
          }));
          if (terminal) {
            notifyTerminal(rowsPayload.job.status, optimizationJobId, rowsPayload.job.message);
          }
        }

        if (terminal) {
          setOptimizationTransportMode("idle");
          setOptimizationEtaSeconds(null);
          await refreshOptimizationHistory();
        }
        return true;
      } catch (err) {
        if (!cancelled) {
          const errorInfo = getApiErrorInfo(err);
          const message = errorInfo.message || "获取优化状态失败";
          setOptimizationError(message);
          notifyCenter({
            id: optimizationSyncNoticeId(optimizationJobId),
            kind: "state",
            category: "error",
            action: "optimization_status_snapshot",
            title: "优化跟踪异常",
            detail: buildNoticeDetail(buildJobLabel("优化任务", optimizationJobId), `状态拉取失败：${message}`, NOTICE_ADVICE.retryLater),
            status: "failed",
            request_id: errorInfo.request_id,
            retryable: errorInfo.retryable,
            source: "optimization_polling"
          });
        }
        return false;
      } finally {
        statusFetchInFlight = false;
      }
    };

    const pollOnce = async () => {
      const progressController = new AbortController();
      let keepRunning = true;
      try {
        const progress = await fetchOptimizationProgress(optimizationJobId, {
          signal: progressController.signal,
          timeoutMs: 20_000,
          retries: 2
        });
        if (cancelled) {
          return;
        }
        const terminal = applyProgressPayload(progress);

        tick += 1;
        keepRunning = !terminal;

        const fullFetchEvery = isPageVisible() ? 4 : 8;
        const shouldFetchStatus = terminal || tick % fullFetchEvery === 1;
        let statusFetchSucceeded = true;
        if (shouldFetchStatus) {
          statusFetchSucceeded = await fetchStatusSnapshot(terminal);
        }
        if (statusFetchSucceeded) {
          notifyCenter({
            id: optimizationSyncNoticeId(optimizationJobId),
            dismiss: true,
            kind: "state",
            title: "",
            action: "optimization_progress_poll",
            source: "optimization_polling"
          });
          setOptimizationError(null);
        }
        if (terminal) {
          terminalReached = true;
        }
      } catch (err) {
        if (!cancelled) {
          const errorInfo = getApiErrorInfo(err);
          const message = errorInfo.message || "获取优化状态失败";
          setOptimizationError(message);
          notifyCenter({
            id: optimizationSyncNoticeId(optimizationJobId),
            kind: "state",
            category: "error",
            action: "optimization_progress_poll",
            title: "优化跟踪异常",
            detail: buildNoticeDetail(buildJobLabel("优化任务", optimizationJobId), `进度拉取失败：${message}`, NOTICE_ADVICE.retryLater),
            status: "failed",
            request_id: errorInfo.request_id,
            retryable: errorInfo.retryable,
            source: "optimization_polling"
          });
        }
      } finally {
        progressController.abort();
        if (!cancelled) {
          scheduleNextFallback(keepRunning);
        }
      }
    };

    const probeWhileSseConnected = async () => {
      if (cancelled || terminalReached || pollingStarted) {
        return;
      }
      const progressController = new AbortController();
      try {
        const progress = await fetchOptimizationProgress(optimizationJobId, {
          signal: progressController.signal,
          timeoutMs: 20_000,
          retries: 1
        });
        if (cancelled || terminalReached || pollingStarted) {
          return;
        }
        const terminal = applyProgressPayload(progress);
        tick += 1;
        const fullFetchEvery = isPageVisible() ? 4 : 8;
        const shouldFetchStatus = terminal || tick % fullFetchEvery === 1;
        let statusFetchSucceeded = true;
        if (shouldFetchStatus) {
          statusFetchSucceeded = await fetchStatusSnapshot(terminal);
        }
        if (statusFetchSucceeded) {
          notifyCenter({
            id: optimizationSyncNoticeId(optimizationJobId),
            dismiss: true,
            kind: "state",
            title: "",
            action: "optimization_progress_poll",
            source: "optimization_polling"
          });
          setOptimizationError(null);
        }
        if (terminal) {
          terminalReached = true;
          setOptimizationTransportMode("idle");
          clearSseProbe();
          sseController.cleanup();
        }
      } catch {
        // Keep SSE mode as source of truth; periodic probe is best-effort only.
      } finally {
        progressController.abort();
      }
    };

    const startPollingFallback = () => {
      if (pollingStarted || cancelled || terminalReached) {
        return;
      }
      clearSseProbe();
      pollingStarted = true;
      setOptimizationTransportMode("polling");
      if (!reportedPollingFallback) {
        reportedPollingFallback = true;
        showToast({
          category: "info",
          action: "optimization_transport_downgrade",
          title: "实时连接已降级为轮询",
          detail: buildNoticeDetail(buildJobLabel("优化任务", optimizationJobId), "实时流已切换为轮询", NOTICE_ADVICE.watchRuntime),
          status: "running",
          job_ids: optimizationJobId ? [optimizationJobId] : [],
          source: "optimization_polling"
        });
      }
      void pollOnce();
    };

    const sseController = createSsePollingFallbackController({
      streamUrl: buildJobStreamUrl(optimizationJobId, "optimization"),
      setTransportMode: setOptimizationTransportMode,
      isStopped: () => cancelled || terminalReached,
      isPollingActive: () => pollingStarted,
      onStartPollingFallback: startPollingFallback,
      onOpen: () => {
        if (sseProbeTimer === null) {
          const intervalMs = isPageVisible() ? 2000 : 6000;
          sseProbeTimer = window.setInterval(() => {
            void probeWhileSseConnected();
          }, intervalMs);
        }
      },
      onUpdate: (event) => {
        if (cancelled || terminalReached) {
          return;
        }
        const parsed = parseJobStreamUpdate<OptimizationProgressResponse>(event.data);
        if (
          !parsed ||
          parsed.job_type !== "optimization" ||
          parsed.job_id !== optimizationJobId ||
          !parsed.payload
        ) {
          return;
        }
        tick += 1;
        const terminal = applyProgressPayload(parsed.payload);
        const fullFetchEvery = isPageVisible() ? 4 : 8;
        const shouldFetchStatus = terminal || tick % fullFetchEvery === 1;
        if (shouldFetchStatus) {
          void fetchStatusSnapshot(terminal);
        }
        if (terminal) {
          terminalReached = true;
          setOptimizationTransportMode("idle");
          clearSseProbe();
          sseController.cleanup();
        }
      },
      onStreamError: clearSseProbe,
      onResumePolling: () => {
        if (pollingStarted && !terminalReached) {
          void pollOnce();
        }
      },
      onResumeStreaming: () => {
        void probeWhileSseConnected();
      }
    });

    resumePollingRef.current = () => {
      if (pollingStarted && !terminalReached) {
        void pollOnce();
        return;
      }
      void probeWhileSseConnected();
    };
    sseController.start();

    return () => {
      cancelled = true;
      setOptimizationTransportMode("idle");
      clearPollingTimer();
      sseController.cleanup();
      clearSseProbe();
      resumePollingRef.current = () => undefined;
    };
  }, [
    clearPollingTimer,
    isPageVisible,
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationResultTab,
    setOptimizationStatus,
    setOptimizationEtaSeconds,
    setOptimizationError,
    setOptimizationTransportMode,
    refreshOptimizationHistory,
    notifyCenter,
    schedulePolling,
    showToast,
    lastProgressRef,
    notifiedTerminalRef
  ]);
}
