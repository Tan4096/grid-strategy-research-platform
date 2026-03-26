import { useState } from "react";
import { useMobileWorkspaceState } from "./useMobileWorkspaceState";
import { useOperationFeedbackController } from "./useOperationFeedbackController";
import { useThemeLayoutController } from "./useThemeLayoutController";
import { useWorkspaceViewModel } from "./useWorkspaceViewModel";
import { useExecutionWorkspaceController } from "./useExecutionWorkspaceController";
import { useLiveWorkspaceController } from "./useLiveWorkspaceController";
import { useMarketSync } from "../useMarketSync";
import { usePersistedBacktestRequest } from "../usePersistedBacktestRequest";
import { usePersistedLiveTradingConfig } from "../usePersistedLiveTradingConfig";
import { usePersistedOptimizationConfig } from "../usePersistedOptimizationConfig";
import { useRiskAnchorAndPrechecks } from "../useRiskAnchorAndPrechecks";
import { useMobileBottomInset } from "../responsive/useMobileBottomInset";
import { useIsMobile } from "../responsive/useIsMobile";
import type { AnchorMode } from "../../lib/api-schema";

const BACKTEST_DEFAULT_RISK_ANCHOR_MODE: AnchorMode = "BACKTEST_START_PRICE";
const MOBILE_REACHABILITY_ENABLED = (import.meta.env.VITE_MOBILE_REACHABILITY_V1 ?? "1") !== "0";
const MOBILE_APP_SHELL_ENABLED = (import.meta.env.VITE_MOBILE_APP_SHELL_V2 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V1 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_V2_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V2 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_V3_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V3 ?? "1") !== "0";

export function useAppShellController() {
  const isMobileViewport = useIsMobile();
  const mobileShellEnabled = isMobileViewport && MOBILE_APP_SHELL_ENABLED;
  const mobileMinimalLayoutEnabled =
    mobileShellEnabled &&
    MOBILE_MINIMAL_LAYOUT_ENABLED &&
    MOBILE_MINIMAL_LAYOUT_V2_ENABLED &&
    MOBILE_MINIMAL_LAYOUT_V3_ENABLED;
  const {
    workspaceMode,
    parameterMode,
    mobilePrimaryTab,
    optimizationWorkspaceTab,
    setWorkspaceMode,
    setParameterMode,
    setMobilePrimaryTab,
    setOptimizationWorkspaceTab,
    handleWorkspaceModeChange,
    handleParameterModeChange,
    handleMobilePrimaryTabChange
  } = useMobileWorkspaceState({
    mobileShellEnabled,
    mobileMinimalLayoutEnabled
  });

  const { request, setRequest, requestReady } = usePersistedBacktestRequest();
  const {
    draft: liveConnectionDraft,
    setDraft: setLiveConnectionDraft,
    ready: liveConnectionReady,
    persistCredentialsEnabled: livePersistCredentialsEnabled,
    setPersistCredentialsEnabled: setLivePersistCredentialsEnabled,
    getMonitoringPreference,
    updateMonitoringPreference
  } = usePersistedLiveTradingConfig();
  const { optimizationConfig, setOptimizationConfig, optimizationConfigReady } =
    usePersistedOptimizationConfig();

  const [backtestRiskAnchorMode, setBacktestRiskAnchorMode] = useState<AnchorMode>(
    BACKTEST_DEFAULT_RISK_ANCHOR_MODE
  );
  const [backtestRiskCustomAnchorPrice, setBacktestRiskCustomAnchorPrice] = useState<number | null>(
    null
  );
  const operationFeedbackController = useOperationFeedbackController();
  const { showToast } = operationFeedbackController;
  const themeLayout = useThemeLayoutController({
    isMobileViewport,
    workspaceMode,
    showToast
  });

  useMobileBottomInset({
    enabled: MOBILE_REACHABILITY_ENABLED && isMobileViewport,
    stickyActionVisible: true,
    floatingEntryVisible: false,
    bottomTabVisible: mobileMinimalLayoutEnabled
  });

  const {
    backtestPrecheck,
    optimizationConfigWithRiskCap,
    optimizationPrecheck,
    riskAnchorPriceForPanel,
    riskAnchorTimeForPanel,
    riskAnchorLoadingForPanel,
    riskAnchorLabelForPanel
  } = useRiskAnchorAndPrechecks({
    mode: parameterMode,
    request,
    requestReady,
    optimizationConfig,
    backtestRiskAnchorMode,
    backtestRiskCustomAnchorPrice
  });

  const { marketParamsSyncing, marketParamsNote, syncMarketParams } = useMarketSync({
    request,
    setRequest
  });

  const executionController = useExecutionWorkspaceController({
    request,
    setRequest,
    requestReady,
    optimizationConfigReady,
    optimizationConfigWithRiskCap,
    backtestPrecheck,
    optimizationPrecheck,
    mobileShellEnabled,
    showToast,
    notifyCenter: operationFeedbackController.notifyCenter,
    setMobilePrimaryTab,
    setParameterMode,
    setWorkspaceMode,
    setOptimizationWorkspaceTab
  });

  const liveController = useLiveWorkspaceController({
    request,
    setRequest,
    setParameterMode,
    workspaceMode,
    mobileMinimalLayoutEnabled,
    mobilePrimaryTab,
    liveConnectionDraft,
    setLiveConnectionDraft,
    liveConnectionReady,
    getMonitoringPreference,
    updateMonitoringPreference,
    showToast,
    notifyCenter: operationFeedbackController.notifyCenter,
    runBacktest: executionController.handleRunBacktest
  });
  const workspaceViewModel = useWorkspaceViewModel({
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
    mobileWorkspace: {
      workspaceMode,
      parameterMode,
      mobilePrimaryTab,
      optimizationWorkspaceTab,
      setWorkspaceMode,
      setParameterMode,
      setMobilePrimaryTab,
      setOptimizationWorkspaceTab,
      handleWorkspaceModeChange,
      handleParameterModeChange,
      handleMobilePrimaryTabChange
    },
    executionController,
    liveController,
    liveConnectionDraft,
    setLiveConnectionDraft,
    livePersistCredentialsEnabled,
    setLivePersistCredentialsEnabled,
    themeLayout,
    operationFeedback: operationFeedbackController
  });

  return {
    isMobileViewport,
    mobileShellEnabled,
    mobileMinimalLayoutEnabled,
    mobilePrimaryTab,
    workspaceMode,
    operationFeedbackController,
    workspaceViewModel
  } as const;
}
