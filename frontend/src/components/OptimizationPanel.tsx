import { ReactNode, useEffect, useMemo, useState } from "react";
import type { JobTransportMode, MobileOptimizeOverlay } from "../types";
import type { OptimizationConfig, OptimizationProgressResponse, OptimizationRow, OptimizationStatusResponse, SortOrder } from "../lib/api-schema";
import type { OptimizationHistoryClearResult, OptimizationHistoryRestoreResult } from "../lib/operation-models";
import { useMobileOptimizeLandingView } from "../hooks/mobile/useMobileOptimizeLandingView";
import OptimizationControls from "./OptimizationControls";
import OptimizationHistoryWorkspace from "./optimization/workspace/OptimizationHistoryWorkspace";
import OptimizationResultsWorkspace, {
  OptimizationResultTab
} from "./optimization/workspace/OptimizationResultsWorkspace";
import OptimizationRuntimeWorkspace from "./optimization/workspace/OptimizationRuntimeWorkspace";
import ErrorBoundary from "./ui/ErrorBoundary";
import MobileSheet from "./ui/MobileSheet";

export type WorkspaceTab = "runtime" | "results" | "history";
const OPTIMIZATION_PANEL_TAB_SESSION_KEY = "btc-grid-backtest:optimization-panel-tab:v1";

function readDesktopWorkspaceTabFromSession(): WorkspaceTab {
  if (typeof window === "undefined") {
    return "runtime";
  }
  try {
    const raw = window.sessionStorage.getItem(OPTIMIZATION_PANEL_TAB_SESSION_KEY);
    if (raw === "runtime" || raw === "results" || raw === "history") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "runtime";
}

function writeDesktopWorkspaceTabToSession(tab: WorkspaceTab): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(OPTIMIZATION_PANEL_TAB_SESSION_KEY, tab);
  } catch {
    // ignore
  }
}

interface Props {
  config: OptimizationConfig;
  initialMargin: number;
  isMobileViewport?: boolean;
  onChangeConfig: (next: OptimizationConfig) => void;
  optimizationError: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationEtaSeconds: number | null;
  optimizationTransportMode: JobTransportMode;
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  optimizationHistoryHasMore: boolean;
  onRefreshOptimizationHistory: () => void;
  onLoadMoreOptimizationHistory: () => void;
  onClearOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryClearResult>;
  onRestoreOptimizationHistory: (jobIds: string[]) => Promise<OptimizationHistoryRestoreResult>;
  onLoadOptimizationHistoryJob: (jobId: string) => void;
  onRestartOptimizationHistoryJob: (jobId: string) => void;
  onCancelOptimization: () => void;
  onApplyOptimizationRow: (row: OptimizationRow) => void;
  onCopyLiveParams: (row: OptimizationRow) => void;
  optimizationSortBy: string;
  onOptimizationSortByChange: (value: string) => void;
  optimizationSortOrder: SortOrder;
  onOptimizationSortOrderChange: (value: SortOrder) => void;
  optimizationPageSize: number;
  onOptimizationPageSizeChange: (value: number) => void;
  optimizationPage: number;
  totalOptimizationPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  optimizationResultTab: OptimizationResultTab;
  onOptimizationResultTabChange: (tab: OptimizationResultTab) => void;
  onWorkspaceTabChange?: (tab: WorkspaceTab) => void;
}

export type { OptimizationResultTab };

export default function OptimizationPanel({
  config,
  initialMargin,
  isMobileViewport = false,
  onChangeConfig,
  optimizationError,
  optimizationStatus,
  optimizationEtaSeconds,
  optimizationTransportMode,
  optimizationHistory,
  optimizationHistoryLoading,
  optimizationHistoryHasMore,
  onRefreshOptimizationHistory,
  onLoadMoreOptimizationHistory,
  onClearOptimizationHistory,
  onRestoreOptimizationHistory,
  onLoadOptimizationHistoryJob,
  onRestartOptimizationHistoryJob,
  onCancelOptimization,
  onApplyOptimizationRow,
  onCopyLiveParams,
  optimizationSortBy,
  onOptimizationSortByChange,
  optimizationSortOrder,
  onOptimizationSortOrderChange,
  optimizationPageSize,
  onOptimizationPageSizeChange,
  optimizationPage,
  totalOptimizationPages,
  onPrevPage,
  onNextPage,
  optimizationResultTab,
  onOptimizationResultTabChange,
  onWorkspaceTabChange
}: Props) {
  const [desktopWorkspaceTab, setDesktopWorkspaceTab] = useState<WorkspaceTab>(() =>
    readDesktopWorkspaceTabFromSession()
  );
  const [mobileOptimizeView, setMobileOptimizeView] = useMobileOptimizeLandingView(optimizationStatus);
  const [mobileOptimizeOverlay, setMobileOptimizeOverlay] = useState<MobileOptimizeOverlay>("none");

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }
    writeDesktopWorkspaceTabToSession(desktopWorkspaceTab);
  }, [desktopWorkspaceTab, isMobileViewport]);

  const activeWorkspaceTab: WorkspaceTab = isMobileViewport
    ? mobileOptimizeView === "runtime"
      ? "runtime"
      : "results"
    : desktopWorkspaceTab;

  useEffect(() => {
    if (!onWorkspaceTabChange) {
      return;
    }
    if (isMobileViewport && mobileOptimizeOverlay === "history") {
      onWorkspaceTabChange("history");
      return;
    }
    onWorkspaceTabChange(activeWorkspaceTab);
  }, [activeWorkspaceTab, isMobileViewport, mobileOptimizeOverlay, onWorkspaceTabChange]);

  const workspaceTabs: ReactNode = useMemo(() => {
    if (isMobileViewport) {
      return (
        <div className="ui-tab-group">
          <button
            type="button"
            className={`ui-tab ${activeWorkspaceTab === "runtime" ? "is-active" : ""}`}
            onClick={() => setMobileOptimizeView("runtime")}
            data-tour-id="optimization-runtime-tab"
          >
            运行
          </button>
          <button
            type="button"
            className={`ui-tab ${activeWorkspaceTab === "results" ? "is-active" : ""}`}
            onClick={() => setMobileOptimizeView("results")}
            data-tour-id="optimization-results-tab"
          >
            结果
          </button>
        </div>
      );
    }
    return (
      <div className="ui-tab-group">
        <button
          type="button"
          className={`ui-tab ${activeWorkspaceTab === "runtime" ? "is-active" : ""}`}
          onClick={() => setDesktopWorkspaceTab("runtime")}
          data-tour-id="optimization-runtime-tab"
        >
          运行
        </button>
        <button
          type="button"
          className={`ui-tab ${activeWorkspaceTab === "results" ? "is-active" : ""}`}
          onClick={() => setDesktopWorkspaceTab("results")}
          data-tour-id="optimization-results-tab"
        >
          结果
        </button>
        <button
          type="button"
          className={`ui-tab ${activeWorkspaceTab === "history" ? "is-active" : ""}`}
          onClick={() => setDesktopWorkspaceTab("history")}
          data-tour-id="optimization-history-tab"
        >
          历史
        </button>
      </div>
    );
  }, [activeWorkspaceTab, isMobileViewport, setMobileOptimizeView]);

  const historyWorkspaceNode = (
    <OptimizationHistoryWorkspace
      optimizationStatus={optimizationStatus}
      optimizationHistory={optimizationHistory}
      optimizationHistoryLoading={optimizationHistoryLoading}
      optimizationHistoryHasMore={optimizationHistoryHasMore}
      onRefreshOptimizationHistory={onRefreshOptimizationHistory}
      onLoadMoreOptimizationHistory={onLoadMoreOptimizationHistory}
      onClearOptimizationHistory={onClearOptimizationHistory}
      onRestoreOptimizationHistory={onRestoreOptimizationHistory}
      onLoadOptimizationHistoryJob={onLoadOptimizationHistoryJob}
      onRestartOptimizationHistoryJob={onRestartOptimizationHistoryJob}
      onApplyOptimizationRow={onApplyOptimizationRow}
      onCopyLiveParams={onCopyLiveParams}
    />
  );

  return (
    <ErrorBoundary fallbackMessage="参数优化页面渲染异常，请刷新后重试。">
      <div className={isMobileViewport ? "space-y-3" : "space-y-5 sm:space-y-6"}>
        {activeWorkspaceTab === "runtime" && (
          <OptimizationRuntimeWorkspace
            config={config}
            onChangeConfig={onChangeConfig}
            optimizationError={optimizationError}
            optimizationStatus={optimizationStatus}
            optimizationEtaSeconds={optimizationEtaSeconds}
            optimizationTransportMode={optimizationTransportMode}
            onCancelOptimization={onCancelOptimization}
            showControls={false}
            compact={isMobileViewport}
          />
        )}

        <section className="card space-y-3 p-2.5 sm:p-3">
          {workspaceTabs}

          {activeWorkspaceTab === "runtime" &&
            (!isMobileViewport ? (
              <OptimizationControls
                config={config}
                onChange={onChangeConfig}
              />
            ) : null)}

          {activeWorkspaceTab === "results" && (
            <OptimizationResultsWorkspace
              optimizationStatus={optimizationStatus}
              initialMargin={initialMargin}
              optimizationResultTab={optimizationResultTab}
              onOptimizationResultTabChange={onOptimizationResultTabChange}
              onApplyOptimizationRow={onApplyOptimizationRow}
              onCopyLiveParams={onCopyLiveParams}
              optimizationSortBy={optimizationSortBy}
              onOptimizationSortByChange={onOptimizationSortByChange}
              optimizationSortOrder={optimizationSortOrder}
              onOptimizationSortOrderChange={onOptimizationSortOrderChange}
              optimizationPageSize={optimizationPageSize}
              onOptimizationPageSizeChange={onOptimizationPageSizeChange}
              optimizationPage={optimizationPage}
              totalOptimizationPages={totalOptimizationPages}
              onPrevPage={onPrevPage}
              onNextPage={onNextPage}
              isMobileViewport={isMobileViewport}
              onOpenHistory={isMobileViewport ? () => setMobileOptimizeOverlay("history") : undefined}
            />
          )}

          {!isMobileViewport && activeWorkspaceTab === "history" && historyWorkspaceNode}
        </section>
      </div>

      {isMobileViewport && (
        <MobileSheet
          open={mobileOptimizeOverlay === "history"}
          title="历史"
          onClose={() => setMobileOptimizeOverlay("none")}
          dataTourId="optimization-history-overlay"
        >
          {historyWorkspaceNode}
        </MobileSheet>
      )}
    </ErrorBoundary>
  );
}
