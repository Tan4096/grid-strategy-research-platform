import type { ReactNode } from "react";
import type {
  BacktestRequest,
  BacktestResponse,
  LiveMonitoringTrendPoint,
  LiveSnapshotResponse
} from "../types";
import { useLiveTradingViewModel } from "../hooks/live/useLiveTradingViewModel";
import LiveLedgerSection from "./live-trading/LiveLedgerSection";
import LiveOverviewSection from "./live-trading/LiveOverviewSection";
import LivePnlTrendSection from "./live-trading/LivePnlTrendSection";
import LiveRiskConfigSection from "./live-trading/LiveRiskConfigSection";
import StateBlock from "./ui/StateBlock";

interface Props {
  request: BacktestRequest;
  backtestResult: BacktestResponse | null;
  snapshot: LiveSnapshotResponse | null;
  loading: boolean;
  error: string | null;
  monitoringActive: boolean;
  autoRefreshPaused: boolean;
  autoRefreshPausedReason?: string | null;
  nextRefreshAt: number | null;
  trend: LiveMonitoringTrendPoint[];
  onRefresh: () => void;
  onApplyParameters: () => void;
  onApplyEnvironment: () => void;
  onApplyInferredGrid: () => void;
  onRunBacktest: () => void;
  onApplySuggestedWindow: (days: number) => void;
  onStopMonitoring: () => void;
  connectionPanelNode?: ReactNode;
}

export default function LiveTradingPanel({
  request,
  backtestResult: _backtestResult,
  snapshot,
  loading,
  error,
  monitoringActive,
  autoRefreshPaused,
  autoRefreshPausedReason = null,
  nextRefreshAt: _nextRefreshAt,
  trend,
  onRefresh,
  onApplyParameters,
  onApplyEnvironment,
  onApplyInferredGrid: _onApplyInferredGrid,
  onRunBacktest: _onRunBacktest,
  onApplySuggestedWindow,
  onStopMonitoring: _onStopMonitoring,
  connectionPanelNode
}: Props) {
  const viewModel = useLiveTradingViewModel({
    request,
    snapshot,
    autoRefreshPaused,
    trend
  });

  if (!snapshot && loading) {
    return (
      <div className="space-y-4">
        {connectionPanelNode}
        <StateBlock
          variant="loading"
          title="实盘监测同步中"
          message="正在按 OKX algoId 拉取机器人持仓、挂单、成交和资金费。"
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-4">
        {connectionPanelNode}
        <StateBlock
          variant={error ? "error" : "empty"}
          title={error ? "实盘监测失败" : "尚未开始监测"}
          message={
            error ??
            "填写 OKX 凭证并选择监测对象后点击“开始监测”，模块会持续读取该机器人实例的当前快照。"
          }
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={onRefresh}>
              开始监测
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {connectionPanelNode}
      <LiveOverviewSection
        viewModel={viewModel}
        autoRefreshPaused={autoRefreshPaused}
        autoRefreshPausedReason={autoRefreshPausedReason}
        monitoringActive={monitoringActive}
        onApplyParameters={onApplyParameters}
      />
      <LiveRiskConfigSection viewModel={viewModel} />
      <LivePnlTrendSection viewModel={viewModel} />
      <LiveLedgerSection
        viewModel={viewModel}
        autoRefreshPaused={autoRefreshPaused}
        onRefresh={onRefresh}
        onApplyParameters={onApplyParameters}
        onApplyEnvironment={onApplyEnvironment}
        onApplySuggestedWindow={onApplySuggestedWindow}
      />
    </div>
  );
}
