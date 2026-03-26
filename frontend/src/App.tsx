import { Suspense, lazy } from "react";
import AppToastNotice from "./components/app/AppToastNotice";
import OperationFeedbackCenter from "./components/app/OperationFeedbackCenter";
import AppTopBar from "./components/app/AppTopBar";
import MobileBottomTabBar from "./components/app/MobileBottomTabBar";
import WorkspaceShell from "./components/app/WorkspaceShell";
import LiveConnectionPanel from "./components/LiveConnectionPanel";
import ParameterForm from "./components/ParameterForm";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import { useAppShellController } from "./hooks/app/useAppShellController";

const BacktestPanel = lazy(() => import("./components/BacktestPanel"));
const LiveTradingPanel = lazy(() => import("./components/LiveTradingPanel"));
const OptimizationPanel = lazy(() => import("./components/OptimizationPanel"));

export default function App() {
  const {
    isMobileViewport,
    mobileShellEnabled,
    mobileMinimalLayoutEnabled,
    mobilePrimaryTab,
    workspaceMode,
    operationFeedbackController,
    workspaceViewModel
  } = useAppShellController();

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
  const liveTradingPanelVisible = mobileMinimalLayoutEnabled
    ? mobilePrimaryTab === "live"
    : workspaceMode === "live";

  const liveTradingPanelNode = (
    <ErrorBoundary
      fallbackMessage="实盘监测面板渲染异常，请先重试监测；如果后端刚升级，请重启后端服务。"
      resetKey={`${workspaceMode}|${workspaceViewModel.liveTradingPanelProps.snapshot?.account.fetched_at ?? "none"}|${workspaceViewModel.liveTradingPanelProps.error ?? ""}`}
    >
      <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载实盘监测面板中...</div>}>
        <LiveTradingPanel
          {...workspaceViewModel.liveTradingPanelProps}
          connectionPanelNode={mobileMinimalLayoutEnabled ? liveConnectionMobileNode : undefined}
          isVisible={liveTradingPanelVisible}
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
