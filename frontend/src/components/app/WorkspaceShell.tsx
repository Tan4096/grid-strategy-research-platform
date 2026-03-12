import type { ReactNode } from "react";
import type { AppWorkspaceMode, MobilePrimaryTab } from "../../types";

interface Props {
  mobileShellEnabled: boolean;
  mobileMinimalLayoutEnabled: boolean;
  mobilePrimaryTab: MobilePrimaryTab;
  workspaceMode: AppWorkspaceMode;
  operationFeedbackNode: ReactNode;
  mobileTopBarNode: ReactNode;
  desktopTopBarNode: ReactNode;
  parameterPanelNode: ReactNode;
  backtestPanelNode: ReactNode;
  optimizationPanelNode: ReactNode;
  liveConnectionDesktopNode: ReactNode;
  liveTradingPanelNode: ReactNode;
  mobileBottomTabBarNode?: ReactNode;
}

export default function WorkspaceShell({
  mobileShellEnabled,
  mobileMinimalLayoutEnabled,
  mobilePrimaryTab,
  workspaceMode,
  operationFeedbackNode,
  mobileTopBarNode,
  desktopTopBarNode,
  parameterPanelNode,
  backtestPanelNode,
  optimizationPanelNode,
  liveConnectionDesktopNode,
  liveTradingPanelNode,
  mobileBottomTabBarNode
}: Props) {
  return (
    <div
      className={`mx-auto max-w-[1900px] p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:p-3 md:p-6 ${
        mobileShellEnabled
          ? "mobile-app-shell pb-[calc(env(safe-area-inset-bottom)+var(--mobile-bottom-reserved,0px)+0.75rem)]"
          : "pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
      }`}
    >
      {operationFeedbackNode}

      {mobileMinimalLayoutEnabled ? (
        <div className="mobile-app-content space-y-4">
          {mobileTopBarNode}
          <div className={mobilePrimaryTab === "params" ? "" : "hidden"} aria-hidden={mobilePrimaryTab !== "params"}>
            {parameterPanelNode}
          </div>
          <div className={mobilePrimaryTab === "backtest" ? "" : "hidden"} aria-hidden={mobilePrimaryTab !== "backtest"}>
            {backtestPanelNode}
          </div>
          <div className={mobilePrimaryTab === "optimize" ? "" : "hidden"} aria-hidden={mobilePrimaryTab !== "optimize"}>
            {optimizationPanelNode}
          </div>
          <div className={mobilePrimaryTab === "live" ? "" : "hidden"} aria-hidden={mobilePrimaryTab !== "live"}>
            {liveTradingPanelNode}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:items-start lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            {parameterPanelNode}
          </div>

          <main className="order-1 min-w-0 space-y-4 lg:order-2">
            {desktopTopBarNode}
            <div className={workspaceMode === "backtest" ? "" : "hidden"} aria-hidden={workspaceMode !== "backtest"}>
              {backtestPanelNode}
            </div>
            <div className={workspaceMode === "optimize" ? "" : "hidden"} aria-hidden={workspaceMode !== "optimize"}>
              {optimizationPanelNode}
            </div>
            <div className={workspaceMode === "live" ? "space-y-4" : "hidden"} aria-hidden={workspaceMode !== "live"}>
              {liveConnectionDesktopNode}
              {liveTradingPanelNode}
            </div>
          </main>
        </div>
      )}

      {mobileMinimalLayoutEnabled && mobileBottomTabBarNode}
    </div>
  );
}
