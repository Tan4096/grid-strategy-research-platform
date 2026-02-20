import { MutableRefObject, useEffect } from "react";
import { fetchOptimizationProgress, fetchOptimizationRows, fetchOptimizationStatus } from "../lib/api";
import type { OptimizationResultTab } from "../components/OptimizationPanel";
import { OptimizationStatusResponse, SortOrder } from "../types";

interface Params {
  optimizationJobId: string | null;
  optimizationPage: number;
  optimizationPageSize: number;
  optimizationSortBy: string;
  optimizationSortOrder: SortOrder;
  optimizationResultTab: OptimizationResultTab;
  setOptimizationStatus: (updater: (prev: OptimizationStatusResponse | null) => OptimizationStatusResponse | null) => void;
  setOptimizationEtaSeconds: (value: number | null) => void;
  setOptimizationError: (value: string | null) => void;
  refreshOptimizationHistory: () => Promise<void>;
  showToast: (message: string) => void;
  lastProgressRef: MutableRefObject<{ value: number; ts: number } | null>;
  notifiedTerminalRef: MutableRefObject<string | null>;
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
  refreshOptimizationHistory,
  showToast,
  lastProgressRef,
  notifiedTerminalRef
}: Params): void {
  useEffect(() => {
    if (!optimizationJobId) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let tick = 0;

    const scheduleNext = (running: boolean) => {
      if (cancelled) {
        return;
      }
      const hidden = document.visibilityState !== "visible";
      const nextMs = running ? (hidden ? 8000 : 1500) : hidden ? 15000 : 5000;
      timer = window.setTimeout(pollOnce, nextMs);
    };

    const notifyTerminal = (status: string, jobId: string, message: string | null) => {
      const marker = `${jobId}:${status}`;
      if (notifiedTerminalRef.current === marker) {
        return;
      }
      notifiedTerminalRef.current = marker;

      const prefix = status === "completed" ? "优化完成" : status === "cancelled" ? "优化已取消" : "优化失败";
      const text = `${prefix} · ${jobId.slice(0, 8)}${message ? ` · ${message}` : ""}`;
      showToast(text);

      if ("Notification" in window && document.visibilityState !== "visible") {
        if (Notification.permission === "granted") {
          new Notification("Crypto永续网格回测工具", { body: text });
        } else if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
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
        setOptimizationStatus((prev) =>
          prev
            ? {
                ...prev,
                job: progress.job,
                target: progress.target
              }
            : prev
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

        tick += 1;
        const terminal =
          progress.job.status === "completed" ||
          progress.job.status === "failed" ||
          progress.job.status === "cancelled";
        keepRunning = !terminal;

        const fullFetchEvery = document.visibilityState === "visible" ? 4 : 8;
        const shouldFetchStatus = terminal || tick % fullFetchEvery === 1;
        if (shouldFetchStatus) {
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
              return;
            }
            setOptimizationStatus(() => status);
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
              return;
            }
            setOptimizationStatus((prev) => ({
              job: rowsPayload.job,
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
        }

        if (terminal) {
          setOptimizationEtaSeconds(null);
          await refreshOptimizationHistory();
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "获取优化状态失败";
          setOptimizationError(message);
        }
      } finally {
        progressController.abort();
        if (!cancelled) {
          scheduleNext(keepRunning);
        }
      }
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible" && timer) {
        window.clearTimeout(timer);
        timer = null;
        pollOnce();
      }
    };
    document.addEventListener("visibilitychange", handleVisible);
    pollOnce();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationResultTab,
    setOptimizationStatus,
    setOptimizationEtaSeconds,
    setOptimizationError,
    refreshOptimizationHistory,
    showToast,
    lastProgressRef,
    notifiedTerminalRef
  ]);
}
