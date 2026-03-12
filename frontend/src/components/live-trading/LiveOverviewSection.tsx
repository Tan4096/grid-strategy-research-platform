import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import {
  fmtGridCount,
  MetricCard,
  RobotBadge,
  formatDateTime,
  fmt,
  pct,
  resolveHeldGridCount
} from "./shared";

function computeMaxDrawdownPct(points: Array<{ value: number }>, investmentUsdt: number | null | undefined): number | null {
  if (!Array.isArray(points) || points.length === 0 || investmentUsdt == null || !Number.isFinite(investmentUsdt) || investmentUsdt <= 0) {
    return null;
  }
  let peakEquity = investmentUsdt;
  let maxDrawdownPct = 0;
  for (const point of points) {
    const equity = investmentUsdt + (Number.isFinite(point.value) ? point.value : 0);
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity <= 0) {
      continue;
    }
    const drawdownPct = ((peakEquity - equity) / peakEquity) * 100;
    if (Number.isFinite(drawdownPct)) {
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    }
  }
  return maxDrawdownPct;
}

interface Props {
  viewModel: LiveTradingViewModel;
  refreshLoading: boolean;
  autoRefreshPaused: boolean;
  autoRefreshPausedReason?: string | null;
  monitoringActive: boolean;
  onRefresh: () => void;
  onApplyParameters: () => void;
}

export default function LiveOverviewSection({
  viewModel,
  refreshLoading,
  autoRefreshPaused,
  autoRefreshPausedReason = null,
  monitoringActive,
  onRefresh,
  onApplyParameters
}: Props) {
  const {
    directionBadge,
    monitoring,
    robot,
    snapshot,
    stateBadge,
    headline,
    windowInfo,
    ledgerSummary,
    pnlCurve
  } = viewModel;
  if (!snapshot || !robot || !monitoring || !windowInfo || !stateBadge || !directionBadge || !headline) {
    return null;
  }

  const totalPnl = robot.total_pnl ?? ledgerSummary?.total_pnl ?? snapshot.summary.total_pnl;
  const maxDrawdownPct = computeMaxDrawdownPct(pnlCurve?.points ?? [], robot.investment_usdt);
  const heldGridCount = resolveHeldGridCount(snapshot);
  const monitoringMeta = [
    autoRefreshPaused ? autoRefreshPausedReason || "自动刷新已暂停" : monitoringActive ? "自动刷新运行中" : "当前未自动刷新",
    monitoring.stale ? "当前显示最近一次成功数据" : "数据最新",
    `区间 ${formatDateTime(windowInfo.strategy_started_at)} - ${formatDateTime(windowInfo.fetched_at)}`
  ].join(" · ");

  return (
    <section className="card p-2.5 sm:p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-slate-100">监测总览</p>
            <span className={`text-xs ${autoRefreshPaused ? "text-rose-300" : monitoring.stale ? "text-amber-200" : "text-slate-500"}`}>
              {monitoringMeta}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-100">{robot.name}</h2>
            <RobotBadge label={stateBadge.label} tone={stateBadge.tone} />
            <RobotBadge label={directionBadge.label} tone={directionBadge.tone} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onRefresh} disabled={refreshLoading}>
            {refreshLoading ? "刷新中..." : "刷新"}
          </button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onApplyParameters}>
            回填到左侧参数
          </button>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="持仓网格数"
          value={fmtGridCount(heldGridCount)}
          compact
        />
        <MetricCard
          label="距止损距离"
          value={headline.stopDistancePct === null ? "--" : `${headline.stopDistancePct.toFixed(2)}%`}
          compact
          accent={headline.stopDistancePct !== null && headline.stopDistancePct >= 5 ? "text-emerald-300" : headline.stopDistancePct !== null && headline.stopDistancePct >= 2 ? "text-amber-200" : "text-rose-300"}
        />
        <MetricCard
          label="总收益"
          value={`${fmt(totalPnl)} USDT`}
          compact
          accent={totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"}
          meta={`收益率 ${pct(robot.pnl_ratio)}`}
        />
        <MetricCard
          label="最大回撤"
          value={maxDrawdownPct === null ? "--" : `${maxDrawdownPct.toFixed(2)}%`}
          compact
          accent={maxDrawdownPct !== null && maxDrawdownPct <= 10 ? "text-emerald-300" : maxDrawdownPct !== null && maxDrawdownPct <= 20 ? "text-amber-200" : "text-rose-300"}
        />
      </div>
    </section>
  );
}
