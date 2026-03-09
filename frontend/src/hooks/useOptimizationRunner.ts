import { useEffect, useRef, useState } from "react";
import type { OptimizationResultTab } from "../components/OptimizationPanel";
import {
  BacktestRequest,
  OptimizationConfig,
  OptimizationHistoryClearResult,
  OptimizationHistoryRestoreResult,
  JobTransportMode,
  OptimizationProgressResponse,
  OptimizationStatusResponse,
  SortOrder
} from "../types";
import { useOptimizationHistoryState } from "./optimization/useOptimizationHistoryState";
import { useOptimizationJobActions } from "./optimization/useOptimizationJobActions";
import { useOptimizationResultData } from "./optimization/useOptimizationResultData";
import { useOptimizationPolling } from "./useOptimizationPolling";
import type { EmitOperationEventInput } from "./useOperationFeedback";

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
  notifyCenter: (message: string | EmitOperationEventInput) => void;
  onEnterOptimize: () => void;
}

export interface OptimizationRunnerState {
  optimizationJobId: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  optimizationHistoryHasMore: boolean;
  optimizationTransportMode: JobTransportMode;
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
  loadMoreOptimizationHistory: () => Promise<void>;
  startOptimizationRun: (overrideRequest?: BacktestRequest) => Promise<void>;
  cancelOptimizationRun: () => Promise<void>;
  exportOptimizationResult: () => Promise<void>;
  loadOptimizationJob: (jobId: string) => Promise<void>;
  restartOptimizationJob: (jobId: string) => Promise<void>;
  clearOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryClearResult>;
  restoreOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryRestoreResult>;
}

const OPTIMIZATION_ACTIVE_JOB_STORAGE_KEY = "optimization_active_job_v1";
const OPTIMIZATION_RESUME_ENABLED = (import.meta.env.VITE_JOB_RESUME_ENABLED ?? "1") !== "0";

interface PersistedOptimizationJobContext {
  job_id: string;
  page: number;
  page_size: number;
  sort_by: string;
  sort_order: SortOrder;
  result_tab: OptimizationResultTab;
  saved_at: number;
}

function normalizePersistedContext(raw: unknown): PersistedOptimizationJobContext | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = raw as Partial<PersistedOptimizationJobContext>;
  if (typeof payload.job_id !== "string" || !payload.job_id.trim()) {
    return null;
  }
  const page = Number(payload.page);
  const pageSize = Number(payload.page_size);
  const sortBy = typeof payload.sort_by === "string" && payload.sort_by.trim() ? payload.sort_by.trim() : "robust_score";
  const sortOrder = payload.sort_order === "asc" ? "asc" : "desc";
  const resultTab: OptimizationResultTab =
    payload.result_tab === "table" ||
    payload.result_tab === "heatmap" ||
    payload.result_tab === "curves" ||
    payload.result_tab === "robustness"
      ? payload.result_tab
      : "table";
  return {
    job_id: payload.job_id.trim(),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    page_size: Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 20,
    sort_by: sortBy,
    sort_order: sortOrder,
    result_tab: resultTab,
    saved_at: Number.isFinite(Number(payload.saved_at)) ? Number(payload.saved_at) : Date.now()
  };
}

function readPersistedOptimizationContext(): PersistedOptimizationJobContext | null {
  if (!OPTIMIZATION_RESUME_ENABLED || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(OPTIMIZATION_ACTIVE_JOB_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizePersistedContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writePersistedOptimizationContext(context: PersistedOptimizationJobContext): void {
  if (!OPTIMIZATION_RESUME_ENABLED || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(OPTIMIZATION_ACTIVE_JOB_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // ignore storage failures
  }
}

function clearPersistedOptimizationContext(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(OPTIMIZATION_ACTIVE_JOB_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function useOptimizationRunner({
  request,
  requestReady,
  optimizationConfig,
  optimizationConfigReady,
  optimizationPrecheck,
  showToast,
  notifyCenter,
  onEnterOptimize
}: Params): [OptimizationRunnerState, OptimizationRunnerActions] {
  const [optimizationJobId, setOptimizationJobId] = useState<string | null>(null);
  const [optimizationStatus, setOptimizationStatus] = useState<OptimizationStatusResponse | null>(null);
  const [optimizationTransportMode, setOptimizationTransportMode] = useState<JobTransportMode>("idle");
  const [optimizationEtaSeconds, setOptimizationEtaSeconds] = useState<number | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);

  const [optimizationPage, setOptimizationPage] = useState(1);
  const [optimizationPageSize, setOptimizationPageSize] = useState(20);
  const [optimizationSortBy, setOptimizationSortBy] = useState("robust_score");
  const [optimizationSortOrder, setOptimizationSortOrder] = useState<SortOrder>("desc");
  const [optimizationResultTab, setOptimizationResultTab] = useState<OptimizationResultTab>("table");

  const lastProgressRef = useRef<{ value: number; ts: number } | null>(null);
  const notifiedTerminalRef = useRef<string | null>(null);
  const refetchedRowsForJobRef = useRef<string | null>(null);
  const resumeAttemptedRef = useRef(false);

  const {
    optimizationHistory,
    optimizationHistoryLoading,
    optimizationHistoryHasMore,
    refreshOptimizationHistory,
    loadMoreOptimizationHistory,
    clearOptimizationHistory,
    restoreOptimizationHistory
  } = useOptimizationHistoryState({
    notifyCenter,
    setOptimizationError
  });

  useOptimizationPolling({
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
  });

  useOptimizationResultData({
    optimizationJobId,
    optimizationStatus,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationResultTab,
    setOptimizationStatus,
    setOptimizationError,
    refetchedRowsForJobRef
  });

  const {
    optimizationStarting,
    startOptimizationRun,
    cancelOptimizationRun,
    exportOptimizationResult,
    loadOptimizationJob,
    restartOptimizationJob
  } = useOptimizationJobActions({
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
  });

  const optimizationRunning =
    optimizationStarting ||
    (optimizationStatus?.job.status !== "completed" &&
      optimizationStatus?.job.status !== "failed" &&
      optimizationStatus?.job.status !== "cancelled" &&
      !!optimizationJobId);

  const totalOptimizationPages = optimizationStatus
    ? Math.max(1, Math.ceil(optimizationStatus.total_results / optimizationStatus.page_size))
    : 1;

  useEffect(() => {
    if (!OPTIMIZATION_RESUME_ENABLED || resumeAttemptedRef.current) {
      return;
    }
    resumeAttemptedRef.current = true;
    const persisted = readPersistedOptimizationContext();
    if (!persisted) {
      return;
    }
    setOptimizationJobId(persisted.job_id);
    setOptimizationPage(persisted.page);
    setOptimizationPageSize(persisted.page_size);
    setOptimizationSortBy(persisted.sort_by);
    setOptimizationSortOrder(persisted.sort_order);
    setOptimizationResultTab(persisted.result_tab);
    showToast(`已恢复优化跟踪 · ${persisted.job_id.slice(0, 8)}`);
  }, [showToast]);

  useEffect(() => {
    if (!OPTIMIZATION_RESUME_ENABLED) {
      return;
    }
    if (!optimizationJobId) {
      clearPersistedOptimizationContext();
      return;
    }
    const status = optimizationStatus?.job.status ?? null;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      clearPersistedOptimizationContext();
      return;
    }
    writePersistedOptimizationContext({
      job_id: optimizationJobId,
      page: optimizationPage,
      page_size: optimizationPageSize,
      sort_by: optimizationSortBy,
      sort_order: optimizationSortOrder,
      result_tab: optimizationResultTab,
      saved_at: Date.now()
    });
  }, [
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationResultTab,
    optimizationStatus?.job.status
  ]);

  return [
    {
      optimizationJobId,
      optimizationStatus,
      optimizationHistory,
      optimizationHistoryLoading,
      optimizationHistoryHasMore,
      optimizationTransportMode,
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
      loadMoreOptimizationHistory,
      startOptimizationRun,
      cancelOptimizationRun,
      exportOptimizationResult,
      loadOptimizationJob,
      restartOptimizationJob,
      clearOptimizationHistory,
      restoreOptimizationHistory
    }
  ];
}
