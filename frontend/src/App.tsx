import { Suspense, lazy, useState } from "react";
import AppToastNotice from "./components/app/AppToastNotice";
import OperationFeedbackCenter from "./components/app/OperationFeedbackCenter";
import AppTopBar from "./components/app/AppTopBar";
import MobileBottomTabBar from "./components/app/MobileBottomTabBar";
import WorkspaceShell from "./components/app/WorkspaceShell";
import LiveConnectionPanel from "./components/LiveConnectionPanel";
import ParameterForm from "./components/ParameterForm";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import { useMobileWorkspaceState } from "./hooks/app/useMobileWorkspaceState";
import { useOperationFeedbackController } from "./hooks/app/useOperationFeedbackController";
import { useThemeLayoutController } from "./hooks/app/useThemeLayoutController";
import { useWorkspaceViewModel } from "./hooks/app/useWorkspaceViewModel";
import { useMarketSync } from "./hooks/useMarketSync";
import { useExecutionWorkspaceController } from "./hooks/app/useExecutionWorkspaceController";
import { useLiveWorkspaceController } from "./hooks/app/useLiveWorkspaceController";
import { usePersistedBacktestRequest } from "./hooks/usePersistedBacktestRequest";
import { usePersistedLiveTradingConfig } from "./hooks/usePersistedLiveTradingConfig";
import { usePersistedOptimizationConfig } from "./hooks/usePersistedOptimizationConfig";
import { useMobileBottomInset } from "./hooks/responsive/useMobileBottomInset";
import { useRiskAnchorAndPrechecks } from "./hooks/useRiskAnchorAndPrechecks";
import {
  AnchorMode
} from "./types";
import { useIsMobile } from "./hooks/responsive/useIsMobile";

const BacktestPanel = lazy(() => import("./components/BacktestPanel"));
const LiveTradingPanel = lazy(() => import("./components/LiveTradingPanel"));
const OptimizationPanel = lazy(() => import("./components/OptimizationPanel"));
const BACKTEST_DEFAULT_RISK_ANCHOR_MODE: AnchorMode = "BACKTEST_START_PRICE";
const MOBILE_REACHABILITY_ENABLED = (import.meta.env.VITE_MOBILE_REACHABILITY_V1 ?? "1") !== "0";
const MOBILE_APP_SHELL_ENABLED = (import.meta.env.VITE_MOBILE_APP_SHELL_V2 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V1 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_V2_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V2 ?? "1") !== "0";
const MOBILE_MINIMAL_LAYOUT_V3_ENABLED = (import.meta.env.VITE_MOBILE_MINIMAL_LAYOUT_V3 ?? "1") !== "0";

export default function App() {
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

  const parameterPanelNode = <ParameterForm {...workspaceViewModel.parameterFormProps} />;

  const backtestPanelNode = (
    <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载回测面板中...</div>}>
      <BacktestPanel {...workspaceViewModel.backtestPanelProps} />
    </Suspense>
  );

  const optimizationPanelNode = (
    <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载优化面板中...</div>}>
      <OptimizationPanel {...workspaceViewModel.optimizationPanelProps} />
    </Suspense>
  );

  const liveConnectionDesktopNode = (
    <LiveConnectionPanel {...workspaceViewModel.liveConnectionPanelProps} />
  );

  const liveConnectionMobileNode = (
    <LiveConnectionPanel {...workspaceViewModel.liveConnectionPanelProps} compact />
  );

  const liveTradingPanelNode = (
    <ErrorBoundary
      fallbackMessage="实盘监测面板渲染异常，请先重试监测；如果后端刚升级，请重启后端服务。"
      resetKey={`${workspaceMode}|${workspaceViewModel.liveTradingPanelProps.snapshot?.account.fetched_at ?? "none"}|${workspaceViewModel.liveTradingPanelProps.error ?? ""}`}
    >
      <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载实盘监测面板中...</div>}>
        <LiveTradingPanel
          {...workspaceViewModel.liveTradingPanelProps}
          connectionPanelNode={mobileMinimalLayoutEnabled ? liveConnectionMobileNode : undefined}
        />
      </Suspense>
    </ErrorBoundary>
  );

  const operationFeedbackNode = (
    <>
      <AppToastNotice
        item={operationFeedbackController.toastNotice}
        isMobileViewport={isMobileViewport}
        onClose={operationFeedbackController.dismissToast}
      />
      <OperationFeedbackCenter
        items={operationFeedbackController.operationFeedbackItems}
        latestItem={null}
        isMobileViewport={isMobileViewport}
        mobileEntryMode={isMobileViewport ? "external" : "floating"}
        externalOpenSignal={operationFeedbackController.operationFeedbackOpenSignal}
        onDismiss={operationFeedbackController.dismissOperationFeedback}
        onDismissNotice={operationFeedbackController.dismissLatestNotice}
        onClear={operationFeedbackController.clearOperationFeedback}
        onDrawerOpenChange={operationFeedbackController.setOperationDrawerOpen}
        onLoadOperationDetail={operationFeedbackController.handleLoadOperationDetail}
      />
    </>
  );

  const mobileTopBarNode = (
    <AppTopBar {...workspaceViewModel.mobileTopBarProps} />
  );

  const desktopTopBarNode = (
    <AppTopBar {...workspaceViewModel.desktopTopBarProps} />
  );

  const mobileBottomTabBarNode = (
    <MobileBottomTabBar {...workspaceViewModel.mobileBottomTabBarProps} />
  );

  return (
    <WorkspaceShell
      mobileShellEnabled={mobileShellEnabled}
      mobileMinimalLayoutEnabled={mobileMinimalLayoutEnabled}
      mobilePrimaryTab={mobilePrimaryTab}
      workspaceMode={workspaceMode}
      operationFeedbackNode={operationFeedbackNode}
      mobileTopBarNode={mobileTopBarNode}
      desktopTopBarNode={desktopTopBarNode}
      parameterPanelNode={parameterPanelNode}
      backtestPanelNode={backtestPanelNode}
      optimizationPanelNode={optimizationPanelNode}
      liveConnectionDesktopNode={liveConnectionDesktopNode}
      liveTradingPanelNode={liveTradingPanelNode}
      mobileBottomTabBarNode={mobileBottomTabBarNode}
    />
  );
}
