import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceTab } from "../../components/OptimizationPanel";
import { cloneBacktestRequest, exportBacktestResultCsv } from "../../lib/backtestAppHelpers";
import { resolveMobilePrimaryTabAfterRun } from "../../lib/mobileShell";
import type { AppWorkspaceMode, MobilePrimaryTab, ParameterMode } from "../../types";
import type { BacktestRequest, OptimizationConfig, OptimizationRow } from "../../lib/api-schema";
import { useBacktestRunner } from "../useBacktestRunner";
import {
  type OptimizationRunnerActions,
  type OptimizationRunnerState,
  useOptimizationRunner
} from "../useOptimizationRunner";
import type { EmitOperationEventInput } from "../useOperationFeedback";

interface Precheck {
  errors: string[];
  warnings: string[];
}

type NotifyFn = (message: string | EmitOperationEventInput) => void;
type SetRequest = Dispatch<SetStateAction<BacktestRequest>>;

interface Params {
  request: BacktestRequest;
  setRequest: SetRequest;
  requestReady: boolean;
  optimizationConfigReady: boolean;
  optimizationConfigWithRiskCap: OptimizationConfig;
  backtestPrecheck: Precheck;
  optimizationPrecheck: Precheck;
  mobileShellEnabled: boolean;
  showToast: NotifyFn;
  notifyCenter: NotifyFn;
  setMobilePrimaryTab: Dispatch<SetStateAction<MobilePrimaryTab>>;
  setParameterMode: Dispatch<SetStateAction<ParameterMode>>;
  setWorkspaceMode: Dispatch<SetStateAction<AppWorkspaceMode>>;
  setOptimizationWorkspaceTab: Dispatch<SetStateAction<WorkspaceTab>>;
}

export interface ExecutionWorkspaceController {
  baselineRequest: BacktestRequest | null;
  handleRunBacktest: (requestOverride?: BacktestRequest) => Promise<void>;
  handleStartOptimization: (requestOverride?: BacktestRequest) => Promise<void>;
  handleApplyOptimizationRow: (row: OptimizationRow) => void;
  handleCopyLiveParams: (row: OptimizationRow) => Promise<void>;
  handleExportBacktest: () => void;
  canExportBacktest: boolean;
  canExportOptimization: boolean;
  backtestRunBlockedReason: string | null;
  optimizationRunBlockedReason: string | null;
  backtest: ReturnType<typeof useBacktestRunner>;
  optimizationState: OptimizationRunnerState;
  optimizationActions: OptimizationRunnerActions;
}

export function useExecutionWorkspaceController({
  request,
  setRequest,
  requestReady,
  optimizationConfigReady,
  optimizationConfigWithRiskCap,
  backtestPrecheck,
  optimizationPrecheck,
  mobileShellEnabled,
  showToast,
  notifyCenter,
  setMobilePrimaryTab,
  setParameterMode,
  setWorkspaceMode,
  setOptimizationWorkspaceTab
}: Params): ExecutionWorkspaceController {
  const [baselineRequest, setBaselineRequest] = useState<BacktestRequest | null>(null);

  const backtest = useBacktestRunner({
    request,
    requestReady,
    precheck: backtestPrecheck,
    onJobResumed: (jobId) => showToast(`已恢复回测跟踪 · ${jobId.slice(0, 8)}`),
    showToast,
    notifyCenter
  });

  const [optimizationState, optimizationActions] = useOptimizationRunner({
  request,
  requestReady,
  optimizationConfig: optimizationConfigWithRiskCap,
    optimizationConfigReady,
    optimizationPrecheck,
    showToast,
    notifyCenter,
    onEnterOptimize: () => {
      setParameterMode("optimize");
      setWorkspaceMode("optimize");
      if (mobileShellEnabled) {
        setMobilePrimaryTab("optimize");
      }
    }
  });

  const canExportBacktest = useMemo(() => Boolean(backtest.result), [backtest.result]);
  const canExportOptimization = useMemo(
    () => Boolean(optimizationState.optimizationStatus?.job.status === "completed"),
    [optimizationState.optimizationStatus]
  );
  const backtestRunBlockedReason = useMemo(
    () => backtestPrecheck.errors[0] ?? null,
    [backtestPrecheck.errors]
  );
  const optimizationRunBlockedReason = useMemo(
    () => optimizationPrecheck.errors[0] ?? null,
    [optimizationPrecheck.errors]
  );


  const handleApplyOptimizationRow = useCallback((row: OptimizationRow) => {
    setRequest((prev) => ({
      ...prev,
      strategy: {
        ...prev.strategy,
        lower: row.lower_price,
        upper: row.upper_price,
        stop_loss: row.stop_price,
        leverage: row.leverage,
        grids: row.grids,
        use_base_position: row.use_base_position
      }
    }));
    setParameterMode("backtest");
    setWorkspaceMode("backtest");
    showToast("优化参数已回填。");
  }, [setParameterMode, setRequest, setWorkspaceMode, showToast]);

  const handleRunBacktest = useCallback(
    async (requestOverride?: BacktestRequest) => {
      const effectiveRequest = requestOverride ?? request;
      setBaselineRequest(cloneBacktestRequest(effectiveRequest));
      setParameterMode("backtest");
      setWorkspaceMode("backtest");
      if (mobileShellEnabled) {
        setMobilePrimaryTab(resolveMobilePrimaryTabAfterRun("backtest"));
      }
      await backtest.runBacktest(effectiveRequest);
    },
    [
      backtest,
      mobileShellEnabled,
      request,
      setMobilePrimaryTab,
      setParameterMode,
      setWorkspaceMode
    ]
  );

  const handleStartOptimization = useCallback(
    async (requestOverride?: BacktestRequest) => {
      setOptimizationWorkspaceTab("runtime");
      setParameterMode("optimize");
      setWorkspaceMode("optimize");
      if (mobileShellEnabled) {
        setMobilePrimaryTab(resolveMobilePrimaryTabAfterRun("optimize"));
      }
      await optimizationActions.startOptimizationRun(requestOverride);
    },
    [
      mobileShellEnabled,
      optimizationActions,
      setMobilePrimaryTab,
      setOptimizationWorkspaceTab,
      setParameterMode,
      setWorkspaceMode
    ]
  );

  const handleCopyLiveParams = useCallback(async (row: OptimizationRow) => {
    const payload = {
      lower: row.lower_price,
      upper: row.upper_price,
      stop_loss: row.stop_price,
      leverage: row.leverage,
      grids: row.grids,
      use_base_position: row.use_base_position,
      base_grid_count: row.base_grid_count,
      initial_position_size: row.initial_position_size,
      anchor_price: row.anchor_price,
      band_width_pct: row.band_width_pct,
      stop_loss_ratio_pct: row.stop_loss_ratio_pct
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showToast("参数已复制。");
    } catch {
      optimizationActions.setOptimizationError("复制参数 JSON 失败，请检查浏览器剪贴板权限。");
    }
  }, [optimizationActions, showToast]);

  const handleExportBacktest = useCallback(() => {
    if (backtest.result) {
      exportBacktestResultCsv(backtest.result, baselineRequest ?? request);
    }
  }, [backtest.result, baselineRequest, request]);

  return {
    baselineRequest,
    handleRunBacktest,
    handleStartOptimization,
    handleApplyOptimizationRow,
    handleCopyLiveParams,
    handleExportBacktest,
    canExportBacktest,
    canExportOptimization,
    backtestRunBlockedReason,
    optimizationRunBlockedReason,
    backtest,
    optimizationState,
    optimizationActions
  };
}
