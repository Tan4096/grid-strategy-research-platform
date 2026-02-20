import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OptimizationResultTab } from "../components/OptimizationPanel";
import {
  cancelOptimization,
  exportOptimizationCsv,
  fetchOptimizationHeatmap,
  fetchOptimizationHistory,
  fetchOptimizationStatus,
  restartOptimization,
  startOptimization
} from "../lib/api";
import { useOptimizationPolling } from "./useOptimizationPolling";
import {
  BacktestRequest,
  OptimizationConfig,
  OptimizationProgressResponse,
  OptimizationRequest,
  OptimizationStatusResponse,
  SortOrder
} from "../types";

interface Precheck {
  errors: string[];
  warnings: string[];
}

interface Params {
  request: BacktestRequest;
  requestReady: boolean;
  optimizationConfig: OptimizationConfig;
  optimizationConfigReady: boolean;
  optimizationPrecheck: Precheck;
  showToast: (message: string) => void;
  onEnterOptimize: () => void;
}

export interface OptimizationRunnerState {
  optimizationJobId: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  optimizationEtaSeconds: number | null;
  optimizationError: string | null;
  optimizationStarting: boolean;
  optimizationPage: number;
  optimizationPageSize: number;
  optimizationSortBy: string;
  optimizationSortOrder: SortOrder;
  optimizationResultTab: OptimizationResultTab;
  optimizationRunning: boolean;
  totalOptimizationPages: number;
}

export interface OptimizationRunnerActions {
  setOptimizationPage: (value: number | ((prev: number) => number)) => void;
  setOptimizationPageSize: (value: number) => void;
  setOptimizationSortBy: (value: string) => void;
  setOptimizationSortOrder: (value: SortOrder) => void;
  setOptimizationResultTab: (value: OptimizationResultTab) => void;
  setOptimizationError: (value: string | null) => void;
  refreshOptimizationHistory: () => Promise<void>;
  startOptimizationRun: () => Promise<void>;
  cancelOptimizationRun: () => Promise<void>;
  exportOptimizationResult: () => Promise<void>;
  loadOptimizationJob: (jobId: string) => Promise<void>;
  restartOptimizationJob: (jobId: string) => Promise<void>;
  fetchHistoryJobStatus: (jobId: string) => Promise<OptimizationStatusResponse>;
}

export function useOptimizationRunner({
  request,
  requestReady,
  optimizationConfig,
  optimizationConfigReady,
  optimizationPrecheck,
  showToast,
  onEnterOptimize
}: Params): [OptimizationRunnerState, OptimizationRunnerActions] {
  const [optimizationJobId, setOptimizationJobId] = useState<string | null>(null);
  const [optimizationStatus, setOptimizationStatus] = useState<OptimizationStatusResponse | null>(null);
  const [optimizationHistory, setOptimizationHistory] = useState<OptimizationProgressResponse[]>([]);
  const [optimizationHistoryLoading, setOptimizationHistoryLoading] = useState(false);
  const [optimizationEtaSeconds, setOptimizationEtaSeconds] = useState<number | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [optimizationStarting, setOptimizationStarting] = useState(false);

  const [optimizationPage, setOptimizationPage] = useState(1);
  const [optimizationPageSize, setOptimizationPageSize] = useState(20);
  const [optimizationSortBy, setOptimizationSortBy] = useState("robust_score");
  const [optimizationSortOrder, setOptimizationSortOrder] = useState<SortOrder>("desc");
  const [optimizationResultTab, setOptimizationResultTab] = useState<OptimizationResultTab>("table");

  const optimizationStartControllerRef = useRef<AbortController | null>(null);
  const optimizationExportControllerRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef<{ value: number; ts: number } | null>(null);
  const notifiedTerminalRef = useRef<string | null>(null);

  const refreshOptimizationHistory = useCallback(async () => {
    setOptimizationHistoryLoading(true);
    try {
      const rows = await fetchOptimizationHistory(50, { timeoutMs: 20_000, retries: 1 });
      setOptimizationHistory(rows);
    } catch {
      // Keep existing history if refresh fails.
    } finally {
      setOptimizationHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshOptimizationHistory();
  }, [refreshOptimizationHistory]);

  useOptimizationPolling({
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationResultTab,
    setOptimizationStatus: (updater) => setOptimizationStatus(updater),
    setOptimizationEtaSeconds,
    setOptimizationError,
    refreshOptimizationHistory,
    showToast,
    lastProgressRef,
    notifiedTerminalRef
  });

  useEffect(() => {
    if (!optimizationJobId || optimizationResultTab !== "heatmap") {
      return;
    }
    let cancelled = false;
    fetchOptimizationHeatmap(optimizationJobId, { timeoutMs: 20_000, retries: 1 })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setOptimizationStatus((prev) => {
          if (!prev) {
            return null;
          }
          return {
            ...prev,
            job: payload.job,
            target: payload.target,
            heatmap: payload.heatmap,
            best_row: payload.best_row ?? prev.best_row
          };
        });
      })
      .catch(() => {
        // keep previous status when heatmap refresh fails
      });

    return () => {
      cancelled = true;
    };
  }, [optimizationJobId, optimizationResultTab]);

  const startOptimizationRun = useCallback(async () => {
    if (!requestReady || !optimizationConfigReady) {
      setOptimizationError("参数仍在初始化，请稍后重试。");
      return;
    }
    if (optimizationPrecheck.errors.length > 0) {
      setOptimizationError(optimizationPrecheck.errors[0]);
      return;
    }
    if (request.data.source === "csv" && !request.data.csv_content) {
      setOptimizationError("已选择 CSV 数据源，但尚未上传 CSV 内容。");
      return;
    }
    setOptimizationStarting(true);
    setOptimizationError(null);
    setOptimizationEtaSeconds(null);
    lastProgressRef.current = null;
    optimizationStartControllerRef.current?.abort();
    optimizationStartControllerRef.current = new AbortController();

    try {
      const payload: OptimizationRequest = {
        base_strategy: request.strategy,
        data: request.data,
        optimization: optimizationConfig
      };

      const started = await startOptimization(payload, {
        signal: optimizationStartControllerRef.current.signal,
        timeoutMs: 60_000
      });
      notifiedTerminalRef.current = null;
      setOptimizationJobId(started.job_id);
      setOptimizationStatus(null);
      setOptimizationPage(1);
      setOptimizationResultTab("table");
      await refreshOptimizationHistory();
      onEnterOptimize();
    } catch (err) {
      const message = err instanceof Error ? err.message : "启动优化失败";
      setOptimizationError(message);
    } finally {
      setOptimizationStarting(false);
      optimizationStartControllerRef.current = null;
    }
  }, [
    onEnterOptimize,
    optimizationConfig,
    optimizationConfigReady,
    optimizationPrecheck.errors,
    optimizationPrecheck.warnings,
    refreshOptimizationHistory,
    request,
    requestReady
  ]);

  const cancelOptimizationRun = useCallback(async () => {
    if (!optimizationJobId) {
      return;
    }
    try {
      await cancelOptimization(optimizationJobId, { timeoutMs: 20_000 });
      const status = await fetchOptimizationStatus(
        optimizationJobId,
        optimizationPage,
        optimizationPageSize,
        optimizationSortBy,
        optimizationSortOrder,
        { timeoutMs: 20_000, retries: 1 }
      );
      setOptimizationStatus(status);
      setOptimizationEtaSeconds(null);
      await refreshOptimizationHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : "取消优化失败";
      setOptimizationError(message);
    }
  }, [
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    refreshOptimizationHistory
  ]);

  const exportOptimizationResult = useCallback(async () => {
    if (!optimizationJobId) {
      return;
    }
    optimizationExportControllerRef.current?.abort();
    optimizationExportControllerRef.current = new AbortController();

    try {
      const blob = await exportOptimizationCsv(optimizationJobId, optimizationSortBy, optimizationSortOrder, {
        signal: optimizationExportControllerRef.current.signal,
        timeoutMs: 60_000
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `optimization-${optimizationJobId}.csv`);
      link.click();
      URL.revokeObjectURL(url);
      showToast("优化结果 CSV 已导出。");
    } catch (err) {
      const message = err instanceof Error ? err.message : "导出优化结果失败";
      setOptimizationError(message);
    } finally {
      optimizationExportControllerRef.current = null;
    }
  }, [optimizationJobId, optimizationSortBy, optimizationSortOrder, showToast]);

  const loadOptimizationJob = useCallback(
    async (jobId: string) => {
      try {
        const status = await fetchOptimizationStatus(
          jobId,
          optimizationPage,
          optimizationPageSize,
          optimizationSortBy,
          optimizationSortOrder,
          { timeoutMs: 30_000, retries: 1 }
        );
        setOptimizationJobId(jobId);
        setOptimizationStatus(status);
        setOptimizationError(null);
        setOptimizationResultTab("table");
        onEnterOptimize();
        const terminal =
          status.job.status === "completed" ||
          status.job.status === "failed" ||
          status.job.status === "cancelled";
        if (terminal) {
          setOptimizationEtaSeconds(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "加载历史任务失败";
        setOptimizationError(message);
      }
    },
    [
      onEnterOptimize,
      optimizationPage,
      optimizationPageSize,
      optimizationSortBy,
      optimizationSortOrder
    ]
  );

  const restartOptimizationJob = useCallback(
    async (jobId: string) => {
      try {
        const started = await restartOptimization(jobId, { timeoutMs: 60_000 });
        setOptimizationJobId(started.job_id);
        setOptimizationStatus(null);
        setOptimizationError(null);
        setOptimizationPage(1);
        setOptimizationResultTab("table");
        setOptimizationEtaSeconds(null);
        lastProgressRef.current = null;
        notifiedTerminalRef.current = null;
        showToast(`已重启优化任务，新任务ID: ${started.job_id.slice(0, 8)}`);
        await refreshOptimizationHistory();
        onEnterOptimize();
      } catch (err) {
        const message = err instanceof Error ? err.message : "重启优化失败";
        setOptimizationError(message);
      }
    },
    [onEnterOptimize, refreshOptimizationHistory, showToast]
  );

  const fetchHistoryJobStatus = useCallback(async (jobId: string): Promise<OptimizationStatusResponse> => {
    return fetchOptimizationStatus(jobId, 1, 100, "robust_score", "desc", {
      timeoutMs: 30_000,
      retries: 1
    });
  }, []);

  useEffect(
    () => () => {
      optimizationStartControllerRef.current?.abort();
      optimizationExportControllerRef.current?.abort();
    },
    []
  );

  const optimizationRunning =
    optimizationStarting ||
    (optimizationStatus?.job.status !== "completed" &&
      optimizationStatus?.job.status !== "failed" &&
      optimizationStatus?.job.status !== "cancelled" &&
      !!optimizationJobId);
  const totalOptimizationPages = optimizationStatus
    ? Math.max(1, Math.ceil(optimizationStatus.total_results / optimizationStatus.page_size))
    : 1;

  return [
    {
      optimizationJobId,
      optimizationStatus,
      optimizationHistory,
      optimizationHistoryLoading,
      optimizationEtaSeconds,
      optimizationError,
      optimizationStarting,
      optimizationPage,
      optimizationPageSize,
      optimizationSortBy,
      optimizationSortOrder,
      optimizationResultTab,
      optimizationRunning,
      totalOptimizationPages
    },
    {
      setOptimizationPage,
      setOptimizationPageSize,
      setOptimizationSortBy,
      setOptimizationSortOrder,
      setOptimizationResultTab,
      setOptimizationError,
      refreshOptimizationHistory,
      startOptimizationRun,
      cancelOptimizationRun,
      exportOptimizationResult,
      loadOptimizationJob,
      restartOptimizationJob,
      fetchHistoryJobStatus
    }
  ];
}
