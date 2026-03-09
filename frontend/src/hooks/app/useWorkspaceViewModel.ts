import { useCallback, useMemo } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ExecutionWorkspaceController } from "./useExecutionWorkspaceController";
import type { LiveWorkspaceController } from "./useLiveWorkspaceController";
import type { MobileWorkspaceState } from "./useMobileWorkspaceState";
import type { ThemeLayoutController } from "./useThemeLayoutController";
import type { OperationFeedbackController } from "./useOperationFeedbackController";
import type {
  AnchorMode,
  AppWorkspaceMode,
  BacktestRequest,
  LiveConnectionDraft,
  OptimizationConfig
} from "../../types";
import type { ThemeSettings } from "../../lib/appTheme";

interface TopBarProps {
  mode: AppWorkspaceMode;
  onModeChange: (mode: AppWorkspaceMode) => void;
  mobileStatusText?: string;
  isMobileViewport: boolean;
  currentMobilePrimaryTab?: "params" | "backtest" | "optimize" | "live";
  onOpenOperationFeedback?: () => void;
  operationFeedbackCount?: number;
  themePickerOpen: boolean;
  onToggleThemePicker: () => void;
  themePickerRef: RefObject<HTMLDivElement>;
  themeSettings: ThemeSettings;
  onThemeSettingsChange: Dispatch<SetStateAction<ThemeSettings>>;
  onSaveAsDefault: () => void;
  onRestoreDefault: () => void;
}

interface Params {
  request: BacktestRequest;
  requestReady: boolean;
  setRequest: Dispatch<SetStateAction<BacktestRequest>>;
  optimizationConfig: OptimizationConfig;
  setOptimizationConfig: (next: OptimizationConfig) => void;
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  syncMarketParams: () => void | Promise<void>;
  backtestRiskAnchorMode: AnchorMode;
  setBacktestRiskAnchorMode: (mode: AnchorMode) => void;
  backtestRiskCustomAnchorPrice: number | null;
  setBacktestRiskCustomAnchorPrice: (value: number | null) => void;
  riskAnchorPriceForPanel: number | null;
  riskAnchorTimeForPanel: string | null;
  riskAnchorLoadingForPanel: boolean;
  riskAnchorLabelForPanel: string;
  isMobileViewport: boolean;
  mobileMinimalLayoutEnabled: boolean;
  mobileWorkspace: MobileWorkspaceState;
  executionController: ExecutionWorkspaceController;
  liveController: LiveWorkspaceController;
  liveConnectionDraft: LiveConnectionDraft;
  setLiveConnectionDraft: Dispatch<SetStateAction<LiveConnectionDraft>>;
  livePersistCredentialsEnabled: boolean;
  setLivePersistCredentialsEnabled: Dispatch<SetStateAction<boolean>>;
  themeLayout: ThemeLayoutController;
  operationFeedback: OperationFeedbackController;
}

export function useWorkspaceViewModel({
  request,
  requestReady,
  setRequest,
  optimizationConfig,
  setOptimizationConfig,
  marketParamsSyncing,
  marketParamsNote,
  syncMarketParams,
  backtestRiskAnchorMode,
  setBacktestRiskAnchorMode,
  backtestRiskCustomAnchorPrice,
  setBacktestRiskCustomAnchorPrice,
  riskAnchorPriceForPanel,
  riskAnchorTimeForPanel,
  riskAnchorLoadingForPanel,
  riskAnchorLabelForPanel,
  isMobileViewport,
  mobileMinimalLayoutEnabled,
  mobileWorkspace,
  executionController,
  liveController,
  liveConnectionDraft,
  setLiveConnectionDraft,
  livePersistCredentialsEnabled,
  setLivePersistCredentialsEnabled,
  themeLayout,
  operationFeedback
}: Params) {
  const {
    workspaceMode,
    parameterMode,
    mobilePrimaryTab,
    handleWorkspaceModeChange,
    handleParameterModeChange,
    handleMobilePrimaryTabChange,
    setOptimizationWorkspaceTab
  } = mobileWorkspace;
  const {
    themePickerOpen,
    setThemePickerOpen,
    confirmLayoutScopeSwitch,
    themePickerRef,
    themeSettings,
    setThemeSettings,
    handleSaveDefaultThemeAndLayout,
    handleRestoreDefaultThemeAndLayout
  } = themeLayout;
  const {
    handleRunBacktest,
    handleStartOptimization
  } = executionController;
  const { refreshLiveSnapshot } = liveController;

  const handleWorkspaceModeChangeWithLayoutGuard = useCallback(
    (nextMode: AppWorkspaceMode) => {
      confirmLayoutScopeSwitch(nextMode, () => handleWorkspaceModeChange(nextMode));
    },
    [confirmLayoutScopeSwitch, handleWorkspaceModeChange]
  );

  const mobileStatusText = useMemo(() => {
    if (mobilePrimaryTab === "params") {
      return parameterMode === "optimize" ? "参数 · 优化" : "参数 · 回测";
    }
    if (mobilePrimaryTab === "backtest") {
      return executionController.backtest.loading ? "回测中" : "回测";
    }
    if (mobilePrimaryTab === "optimize") {
      return executionController.optimizationState.optimizationRunning ? "优化中" : "参数优化";
    }
    return liveController.liveMonitoringActive || liveController.liveLoading
      ? "实盘监测中"
      : "实盘监测";
  }, [
    executionController.backtest.loading,
    executionController.optimizationState.optimizationRunning,
    liveController.liveLoading,
    liveController.liveMonitoringActive,
    mobilePrimaryTab,
    parameterMode
  ]);

  const handleParameterRun = useCallback(() => {
    if (workspaceMode === "live") {
      void refreshLiveSnapshot();
      return;
    }
    if (parameterMode === "optimize") {
      void handleStartOptimization();
      return;
    }
    void handleRunBacktest();
  }, [handleRunBacktest, handleStartOptimization, parameterMode, refreshLiveSnapshot, workspaceMode]);

  const parameterFormProps = {
    mode: parameterMode,
    onModeChange: handleParameterModeChange,
    request,
    requestReady,
    onChange: setRequest,
    optimizationConfig,
    onOptimizationConfigChange: setOptimizationConfig,
    onRun: handleParameterRun,
    loading:
      workspaceMode === "live"
        ? liveController.liveMonitoringActive || liveController.liveLoading
        : parameterMode === "backtest"
          ? executionController.backtest.loading
          : executionController.optimizationState.optimizationRunning,
    runBlockedReason:
      workspaceMode === "live"
        ? liveController.liveRunBlockedReason
        : parameterMode === "backtest"
          ? executionController.backtestRunBlockedReason
          : executionController.optimizationRunBlockedReason,
    marketParamsSyncing,
    marketParamsNote,
    onSyncMarketParams: () => void syncMarketParams(),
    runLabel:
      workspaceMode === "live"
        ? "开始监测"
        : parameterMode === "backtest"
          ? "开始回测"
          : "开始参数优化",
    runningLabel:
      workspaceMode === "live"
        ? "监测中..."
        : parameterMode === "backtest"
          ? "回测中..."
          : "优化中...",
    onSecondaryAction:
      workspaceMode === "live" ? liveController.handleStopLiveMonitoring : null,
    secondaryActionLabel: "停止监测",
    secondaryActionDisabled:
      workspaceMode !== "live" ||
      (!liveController.liveMonitoringActive && !liveController.liveLoading),
    onExport:
      workspaceMode === "live"
        ? undefined
        : parameterMode === "backtest"
          ? executionController.handleExportBacktest
          : executionController.optimizationActions.exportOptimizationResult,
    canExport:
      workspaceMode === "live"
        ? false
        : parameterMode === "backtest"
          ? executionController.canExportBacktest
          : executionController.canExportOptimization,
    exportLabel:
      workspaceMode === "live"
        ? ""
        : parameterMode === "backtest"
          ? "导出回测 CSV"
          : "导出优化 CSV",
    hideRunButton: false,
    mobileMinimalLayoutEnabled,
    backtestRiskAnchorMode,
    onBacktestRiskAnchorModeChange: setBacktestRiskAnchorMode,
    backtestRiskCustomAnchorPrice,
    onBacktestRiskCustomAnchorPriceChange: setBacktestRiskCustomAnchorPrice,
    maxLossAnchorPrice: riskAnchorPriceForPanel,
    maxLossAnchorTime: riskAnchorTimeForPanel,
    maxLossAnchorLoading: riskAnchorLoadingForPanel,
    maxLossAnchorLabel: riskAnchorLabelForPanel
  } as const;

  const backtestPanelProps = {
    error: executionController.backtest.error,
    result: executionController.backtest.result,
    loading: executionController.backtest.loading,
    transportMode: executionController.backtest.transportMode,
    symbol: request.data.symbol
  } as const;

  const optimizationPanelProps = {
    config: optimizationConfig,
    initialMargin: request.strategy.margin,
    isMobileViewport,
    onChangeConfig: setOptimizationConfig,
    optimizationError: executionController.optimizationState.optimizationError,
    optimizationStatus: executionController.optimizationState.optimizationStatus,
    optimizationEtaSeconds: executionController.optimizationState.optimizationEtaSeconds,
    optimizationTransportMode:
      executionController.optimizationState.optimizationTransportMode,
    optimizationHistory: executionController.optimizationState.optimizationHistory,
    optimizationHistoryLoading:
      executionController.optimizationState.optimizationHistoryLoading,
    optimizationHistoryHasMore:
      executionController.optimizationState.optimizationHistoryHasMore,
    onRefreshOptimizationHistory:
      executionController.optimizationActions.refreshOptimizationHistory,
    onLoadMoreOptimizationHistory:
      executionController.optimizationActions.loadMoreOptimizationHistory,
    onClearOptimizationHistory:
      executionController.optimizationActions.clearOptimizationHistory,
    onRestoreOptimizationHistory:
      executionController.optimizationActions.restoreOptimizationHistory,
    onLoadOptimizationHistoryJob:
      executionController.optimizationActions.loadOptimizationJob,
    onRestartOptimizationHistoryJob:
      executionController.optimizationActions.restartOptimizationJob,
    onCancelOptimization:
      executionController.optimizationActions.cancelOptimizationRun,
    onApplyOptimizationRow: executionController.handleApplyOptimizationRow,
    onCopyLiveParams: executionController.handleCopyLiveParams,
    optimizationSortBy: executionController.optimizationState.optimizationSortBy,
    onOptimizationSortByChange: (value: string) => {
      executionController.optimizationActions.setOptimizationSortBy(value);
      executionController.optimizationActions.setOptimizationPage(1);
    },
    optimizationSortOrder: executionController.optimizationState.optimizationSortOrder,
    onOptimizationSortOrderChange: (value: "asc" | "desc") => {
      executionController.optimizationActions.setOptimizationSortOrder(value);
      executionController.optimizationActions.setOptimizationPage(1);
    },
    optimizationPageSize: executionController.optimizationState.optimizationPageSize,
    onOptimizationPageSizeChange: (value: number) => {
      executionController.optimizationActions.setOptimizationPageSize(value);
      executionController.optimizationActions.setOptimizationPage(1);
    },
    optimizationPage: executionController.optimizationState.optimizationPage,
    totalOptimizationPages:
      executionController.optimizationState.totalOptimizationPages,
    onPrevPage: () =>
      executionController.optimizationActions.setOptimizationPage((page) =>
        Math.max(1, page - 1)
      ),
    onNextPage: () =>
      executionController.optimizationActions.setOptimizationPage((page) =>
        Math.min(
          executionController.optimizationState.totalOptimizationPages,
          page + 1
        )
      ),
    optimizationResultTab:
      executionController.optimizationState.optimizationResultTab,
    onOptimizationResultTabChange:
      executionController.optimizationActions.setOptimizationResultTab,
    onWorkspaceTabChange: setOptimizationWorkspaceTab
  } as const;

  const liveConnectionPanelProps = {
    draft: liveConnectionDraft,
    onChange: setLiveConnectionDraft,
    persistCredentialsEnabled: livePersistCredentialsEnabled,
    onPersistCredentialsEnabledChange: setLivePersistCredentialsEnabled,
    exchange: liveController.liveEnvironmentExchange,
    symbol: liveController.liveEnvironmentSymbol,
    strategyStartedAt: liveController.liveEnvironmentStartTime,
    loading: liveController.liveLoading,
    monitoringActive: liveController.liveMonitoringActive,
    autoRefreshPaused: liveController.liveAutoRefreshPaused,
    autoRefreshPausedReason: liveController.liveAutoRefreshPausedReason,
    error: liveController.liveError,
    robotItems: liveController.liveRobotItems,
    robotListLoading: liveController.liveRobotListLoading,
    robotListError: liveController.liveRobotListError,
    selectedScope: liveController.liveMonitoringPreference.selected_scope,
    onSelectedScopeChange: liveController.handleLiveScopeChange,
    pollIntervalSec: liveController.liveMonitoringPreference.poll_interval_sec,
    onPollIntervalChange: liveController.handleLivePollIntervalChange,
    selectedRobotMissing: liveController.liveSelectedRobotMissing,
    onSelectRecentRobot: liveController.handleSelectRecentLiveRobot,
    onRefreshRobots: () => void liveController.refreshLiveRobotList(),
    onClearCredentials: liveController.handleClearLiveCredentials,
    primaryBlockingReason: liveController.liveRunBlockedReason
  } as const;

  const liveTradingPanelProps = {
    request: executionController.baselineRequest ?? request,
    backtestResult: executionController.backtest.result,
    snapshot: liveController.liveSnapshot,
    loading: liveController.liveLoading,
    error: liveController.liveError,
    monitoringActive: liveController.liveMonitoringActive,
    autoRefreshPaused: liveController.liveAutoRefreshPaused,
    autoRefreshPausedReason: liveController.liveAutoRefreshPausedReason,
    nextRefreshAt: liveController.liveNextRefreshAt,
    trend: liveController.liveTrend,
    onRefresh: () => void liveController.refreshLiveSnapshot(),
    onApplyParameters: liveController.handleApplyLiveParameters,
    onApplyEnvironment: liveController.handleApplyLiveEnvironment,
    onApplyInferredGrid: liveController.handleApplyLiveInferredGrid,
    onRunBacktest: liveController.handleRunLiveBacktest,
    onApplySuggestedWindow: liveController.handleApplySuggestedLiveWindow,
    onStopMonitoring: liveController.handleStopLiveMonitoring
  } as const;

  const mobileTopBarProps: TopBarProps = {
    mode: workspaceMode,
    mobileStatusText,
    onModeChange: handleWorkspaceModeChangeWithLayoutGuard,
    isMobileViewport,
    currentMobilePrimaryTab: mobilePrimaryTab,
    onOpenOperationFeedback: operationFeedback.openOperationFeedbackDrawer,
    operationFeedbackCount: operationFeedback.activeOperationFeedbackCount,
    themePickerOpen,
    onToggleThemePicker: () => setThemePickerOpen((prev) => !prev),
    themePickerRef,
    themeSettings,
    onThemeSettingsChange: setThemeSettings,
    onSaveAsDefault: handleSaveDefaultThemeAndLayout,
    onRestoreDefault: handleRestoreDefaultThemeAndLayout
  };

  const desktopTopBarProps: TopBarProps = {
    mode: workspaceMode,
    onModeChange: handleWorkspaceModeChangeWithLayoutGuard,
    isMobileViewport,
    themePickerOpen,
    onToggleThemePicker: () => setThemePickerOpen((prev) => !prev),
    themePickerRef,
    themeSettings,
    onThemeSettingsChange: setThemeSettings,
    onSaveAsDefault: handleSaveDefaultThemeAndLayout,
    onRestoreDefault: handleRestoreDefaultThemeAndLayout
  };

  const mobileBottomTabBarProps = {
    activeTab: mobilePrimaryTab,
    onTabChange: handleMobilePrimaryTabChange,
    backtestRunning: executionController.backtest.loading,
    optimizeRunning: executionController.optimizationState.optimizationRunning,
    liveRunning: liveController.liveLoading
  } as const;

  return {
    mobileStatusText,
    parameterFormProps,
    backtestPanelProps,
    optimizationPanelProps,
    liveConnectionPanelProps,
    liveTradingPanelProps,
    mobileTopBarProps,
    desktopTopBarProps,
    mobileBottomTabBarProps
  };
}
