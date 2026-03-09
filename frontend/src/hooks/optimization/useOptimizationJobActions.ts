import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { OptimizationResultTab } from "../../components/OptimizationPanel";
import {
  cancelOptimization,
  exportOptimizationCsv,
  fetchOptimizationStatus,
  getApiErrorInfo,
  restartOptimization,
  startOptimization
} from "../../lib/api";
import { persistLastRunOptimizationTemplate } from "../../lib/exampleTemplateResolver";
import {
  BacktestRequest,
  OptimizationConfig,
  OptimizationRequest,
  OptimizationStatusResponse,
  SortOrder
} from "../../types";
import { NOTICE_ADVICE, buildJobLabel, buildNoticeDetail } from "../../lib/notificationCopy";
import type { EmitOperationEventInput } from "../useOperationFeedback";

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
  showToast: (message: string | EmitOperationEventInput) => void;
  onEnterOptimize: () => void;
  optimizationJobId: string | null;
  optimizationPage: number;
  optimizationPageSize: number;
  optimizationSortBy: string;
  optimizationSortOrder: SortOrder;
  refreshOptimizationHistory: () => Promise<void>;
  setOptimizationJobId: Dispatch<SetStateAction<string | null>>;
  setOptimizationStatus: Dispatch<SetStateAction<OptimizationStatusResponse | null>>;
  setOptimizationPage: Dispatch<SetStateAction<number>>;
  setOptimizationResultTab: Dispatch<SetStateAction<OptimizationResultTab>>;
  setOptimizationEtaSeconds: (value: number | null) => void;
  setOptimizationError: (value: string | null) => void;
  lastProgressRef: MutableRefObject<{ value: number; ts: number } | null>;
  notifiedTerminalRef: MutableRefObject<string | null>;
  refetchedRowsForJobRef: MutableRefObject<string | null>;
}

interface Result {
  optimizationStarting: boolean;
  startOptimizationRun: (overrideRequest?: BacktestRequest) => Promise<void>;
  cancelOptimizationRun: () => Promise<void>;
  exportOptimizationResult: () => Promise<void>;
  loadOptimizationJob: (jobId: string) => Promise<void>;
  restartOptimizationJob: (jobId: string) => Promise<void>;
}

export function useOptimizationJobActions({
  request,
  requestReady,
  optimizationConfig,
  optimizationConfigReady,
  optimizationPrecheck,
  showToast,
  onEnterOptimize,
  optimizationJobId,
  optimizationPage,
  optimizationPageSize,
  optimizationSortBy,
  optimizationSortOrder,
  refreshOptimizationHistory,
  setOptimizationJobId,
  setOptimizationStatus,
  setOptimizationPage,
  setOptimizationResultTab,
  setOptimizationEtaSeconds,
  setOptimizationError,
  lastProgressRef,
  notifiedTerminalRef,
  refetchedRowsForJobRef
}: Params): Result {
  const [optimizationStarting, setOptimizationStarting] = useState(false);
  const optimizationStartControllerRef = useRef<AbortController | null>(null);
  const optimizationExportControllerRef = useRef<AbortController | null>(null);

  const startOptimizationRun = useCallback(async (overrideRequest?: BacktestRequest) => {
    const effectiveRequest = overrideRequest ?? request;
    if (!requestReady || !optimizationConfigReady) {
      // Allow default params/config to run during initial hydration.
    }
    if (optimizationPrecheck.errors.length > 0) {
      setOptimizationError(optimizationPrecheck.errors[0]);
      return;
    }

    setOptimizationStarting(true);
    setOptimizationError(null);
    setOptimizationEtaSeconds(null);
    lastProgressRef.current = null;
    persistLastRunOptimizationTemplate(optimizationConfig);

    optimizationStartControllerRef.current?.abort();
    optimizationStartControllerRef.current = new AbortController();

    try {
      const payload: OptimizationRequest = {
        base_strategy: effectiveRequest.strategy,
        data: effectiveRequest.data,
        optimization: optimizationConfig
      };

      const started = await startOptimization(payload, {
        signal: optimizationStartControllerRef.current.signal,
        timeoutMs: 60_000
      });
      if (started.idempotency_reused) {
        showToast({
          category: "info",
          action: "optimization_start",
          title: "已复用优化任务",
          detail: buildNoticeDetail(buildJobLabel("优化任务", started.job_id), "已复用现有任务", NOTICE_ADVICE.watchRuntime),
          status: "success",
          job_ids: [started.job_id],
          source: "optimization_runner"
        });
      } else {
        showToast({
          category: "info",
          action: "optimization_start",
          title: "优化已启动",
          detail: buildNoticeDetail(buildJobLabel("优化任务", started.job_id), "已启动", NOTICE_ADVICE.watchRuntime),
          status: "queued",
          job_ids: [started.job_id],
          source: "optimization_runner"
        });
      }

      notifiedTerminalRef.current = null;
      refetchedRowsForJobRef.current = null;
      setOptimizationJobId(started.job_id);
      setOptimizationStatus({
        job: {
          job_id: started.job_id,
          status: started.status,
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
          progress: 0,
          total_steps: 0,
          completed_steps: 0,
          message: "优化任务已启动，等待进度更新",
          error: null,
          total_combinations: Number(started.total_combinations) || 0,
          trials_completed: 0,
          trials_pruned: 0,
          pruning_ratio: 0
        },
        target: optimizationConfig.target,
        sort_by: optimizationSortBy,
        sort_order: optimizationSortOrder,
        page: 1,
        page_size: optimizationPageSize,
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
      });
      setOptimizationPage(1);
      setOptimizationResultTab("table");
      await refreshOptimizationHistory();
      onEnterOptimize();
    } catch (err) {
      const errorInfo = getApiErrorInfo(err);
      const message = errorInfo.message || "启动优化失败";
      setOptimizationError(message);
      showToast({
        category: "error",
        action: "optimization_start",
        title: "优化启动异常",
        detail: buildNoticeDetail("优化任务", `启动失败：${message}`, NOTICE_ADVICE.reviewParams),
        status: "failed",
        request_id: errorInfo.request_id,
        retryable: errorInfo.retryable,
        source: "optimization_runner"
      });
    } finally {
      setOptimizationStarting(false);
      optimizationStartControllerRef.current = null;
    }
  }, [
    lastProgressRef,
    onEnterOptimize,
    optimizationConfig,
    optimizationConfigReady,
    optimizationPrecheck.errors,
    refetchedRowsForJobRef,
    refreshOptimizationHistory,
    request,
    requestReady,
    setOptimizationError,
    setOptimizationEtaSeconds,
    setOptimizationJobId,
    optimizationPageSize,
    setOptimizationPage,
    setOptimizationResultTab,
    setOptimizationStatus,
    optimizationSortBy,
    optimizationSortOrder,
    notifiedTerminalRef,
    showToast
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
      showToast({
        category: "info",
        action: "optimization_cancel",
        title: "优化已终止",
        detail: buildNoticeDetail(buildJobLabel("优化任务", optimizationJobId), "已终止", NOTICE_ADVICE.viewResults),
        status: "success",
        job_ids: [optimizationJobId],
        source: "optimization_runner"
      });
    } catch (err) {
      const errorInfo = getApiErrorInfo(err);
      const message = errorInfo.message || "取消优化失败";
      setOptimizationError(message);
      showToast({
        category: "error",
        action: "optimization_cancel",
        title: "优化终止失败",
        detail: buildNoticeDetail(buildJobLabel("优化任务", optimizationJobId), `终止失败：${message}`, NOTICE_ADVICE.retryLater),
        status: "failed",
        request_id: errorInfo.request_id,
        retryable: errorInfo.retryable,
        source: "optimization_runner"
      });
    }
  }, [
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    refreshOptimizationHistory,
    setOptimizationError,
    setOptimizationEtaSeconds,
    setOptimizationStatus,
    showToast
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
      showToast({
        category: "success",
        action: "optimization_export",
        title: "结果已导出",
        detail: buildNoticeDetail("优化结果", "CSV 已导出", NOTICE_ADVICE.viewResults),
        status: "success",
        job_ids: [optimizationJobId],
        source: "optimization_runner"
      });
    } catch (err) {
      const errorInfo = getApiErrorInfo(err);
      const message = errorInfo.message || "导出优化结果失败";
      setOptimizationError(message);
      showToast({
        category: "error",
        action: "optimization_export",
        title: "结果导出失败",
        detail: buildNoticeDetail("优化结果", `导出失败：${message}`, NOTICE_ADVICE.retryLater),
        status: "failed",
        request_id: errorInfo.request_id,
        retryable: errorInfo.retryable,
        source: "optimization_runner"
      });
    } finally {
      optimizationExportControllerRef.current = null;
    }
  }, [optimizationJobId, optimizationSortBy, optimizationSortOrder, setOptimizationError, showToast]);

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
        showToast({
          category: "info",
          action: "optimization_load_history",
          title: "历史任务已载入",
          detail: buildNoticeDetail(buildJobLabel("优化任务", jobId), "已载入工作区", NOTICE_ADVICE.viewResults),
          status: "success",
          job_ids: [jobId],
          source: "optimization_runner"
        });
        const terminal =
          status.job.status === "completed" ||
          status.job.status === "failed" ||
          status.job.status === "cancelled";
        if (terminal) {
          setOptimizationEtaSeconds(null);
        }
      } catch (err) {
        const errorInfo = getApiErrorInfo(err);
        const message = errorInfo.message || "加载历史任务失败";
        setOptimizationError(message);
        showToast({
          category: "error",
          action: "optimization_load_history",
          title: "历史任务载入失败",
          detail: buildNoticeDetail(buildJobLabel("优化任务", jobId), `载入失败：${message}`, NOTICE_ADVICE.retryLater),
          status: "failed",
          request_id: errorInfo.request_id,
          retryable: errorInfo.retryable,
          source: "optimization_runner"
        });
      }
    },
    [
      onEnterOptimize,
      optimizationPage,
      optimizationPageSize,
      optimizationSortBy,
      optimizationSortOrder,
      setOptimizationError,
      setOptimizationEtaSeconds,
      setOptimizationJobId,
      setOptimizationResultTab,
      setOptimizationStatus,
      showToast
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
        showToast({
          category: "info",
          action: "optimization_restart",
          title: `优化已重启 · ${started.job_id.slice(0, 8)}`,
          detail: buildNoticeDetail(buildJobLabel("优化任务", started.job_id), "已重启", NOTICE_ADVICE.watchRuntime),
          status: "queued",
          job_ids: [started.job_id],
          source: "optimization_runner"
        });
        await refreshOptimizationHistory();
        onEnterOptimize();
      } catch (err) {
        const errorInfo = getApiErrorInfo(err);
        const message = errorInfo.message || "重启优化失败";
        setOptimizationError(message);
        showToast({
          category: "error",
          action: "optimization_restart",
          title: "优化重启失败",
          detail: buildNoticeDetail(buildJobLabel("优化任务", jobId), `重启失败：${message}`, NOTICE_ADVICE.retryLater),
          status: "failed",
          request_id: errorInfo.request_id,
          retryable: errorInfo.retryable,
          source: "optimization_runner"
        });
      }
    },
    [
      lastProgressRef,
      notifiedTerminalRef,
      onEnterOptimize,
      refreshOptimizationHistory,
      setOptimizationError,
      setOptimizationEtaSeconds,
      setOptimizationJobId,
      setOptimizationPage,
      setOptimizationResultTab,
      setOptimizationStatus,
      showToast
    ]
  );

  useEffect(
    () => () => {
      optimizationStartControllerRef.current?.abort();
      optimizationExportControllerRef.current?.abort();
    },
    []
  );

  return {
    optimizationStarting,
    startOptimizationRun,
    cancelOptimizationRun,
    exportOptimizationResult,
    loadOptimizationJob,
    restartOptimizationJob
  };
}
