import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import {
  fmtAssetAmount,
  fmtGridCount,
  MetricCard,
  RobotBadge,
  formatDateTime,
  fmt,
  pct,
  pickPositiveValue,
  resolveBaseAssetSymbol,
  resolveHeldGridCount,
  resolveSingleGridBaseAmount
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
  autoRefreshPaused: boolean;
  autoRefreshPausedReason?: string | null;
  monitoringActive: boolean;
  onApplyParameters: () => void;
}

export default function LiveOverviewSection({
  viewModel,
  autoRefreshPaused,
  autoRefreshPausedReason = null,
  monitoringActive,
  onApplyParameters
}: Props) {
  const {
    currentPrice,
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
  const baseAssetSymbol = resolveBaseAssetSymbol(snapshot.account.symbol, snapshot.account.exchange_symbol);
  const singleGridBaseAmount = resolveSingleGridBaseAmount(snapshot);
  const heldGridCount = resolveHeldGridCount(snapshot);
  const positionDetail = heldGridCount !== null
    ? singleGridBaseAmount !== null
      ? `当前持仓 ${heldGridCount} 格 · 单格 ${fmtAssetAmount(singleGridBaseAmount)} ${baseAssetSymbol}`
      : `当前持仓 ${heldGridCount} 格`
    : singleGridBaseAmount !== null
      ? `当前持仓 ${fmtAssetAmount(snapshot.position.quantity)} ${baseAssetSymbol} · 单格 ${fmtAssetAmount(singleGridBaseAmount)} ${baseAssetSymbol}`
      : `当前持仓 ${fmtAssetAmount(snapshot.position.quantity)} ${baseAssetSymbol}`;
  const heldGridDetail =
    Math.abs(snapshot.position.quantity) <= 1e-9
      ? "当前无持仓"
      : positionDetail;
  const monitoringMeta = [
    `最近刷新 ${formatDateTime(windowInfo.fetched_at)}`,
    autoRefreshPaused ? autoRefreshPausedReason || "自动刷新已暂停" : monitoringActive ? "自动刷新运行中" : "当前未自动刷新",
    monitoring.stale ? "当前显示最近一次成功数据" : "数据最新"
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
          <p className="mt-2 text-sm text-slate-300">
            {snapshot.account.exchange_symbol} · algoId {robot.algo_id} · 区间{" "}
            {formatDateTime(windowInfo.strategy_started_at)} - {formatDateTime(windowInfo.fetched_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onApplyParameters}>
            回填到左侧参数
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="持仓网格数"
          value={fmtGridCount(heldGridCount)}
          detail={heldGridDetail}
        />
        <MetricCard
          label="距止损距离"
          value={headline.stopDistancePct === null ? "--" : `${headline.stopDistancePct.toFixed(2)}%`}
          accent={headline.stopDistancePct !== null && headline.stopDistancePct >= 5 ? "text-emerald-300" : headline.stopDistancePct !== null && headline.stopDistancePct >= 2 ? "text-amber-200" : "text-rose-300"}
          detail={
            pickPositiveValue(robot.stop_loss_price)
              ? `当前价 ${fmt(currentPrice)} · 止损价 ${fmt(pickPositiveValue(robot.stop_loss_price))}`
              : currentPrice
                ? `当前价 ${fmt(currentPrice)}`
                : undefined
          }
        />
        <MetricCard
          label="总收益"
          value={`${fmt(totalPnl)} USDT`}
          accent={totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"}
          meta={`收益率 ${pct(robot.pnl_ratio)}`}
          detail={headline.pnl24h === null ? "近24h --" : `近24h ${fmt(headline.pnl24h)} USDT`}
        />
        <MetricCard
          label="最大回撤"
          value={maxDrawdownPct === null ? "--" : `${maxDrawdownPct.toFixed(2)}%`}
          accent={maxDrawdownPct !== null && maxDrawdownPct <= 10 ? "text-emerald-300" : maxDrawdownPct !== null && maxDrawdownPct <= 20 ? "text-amber-200" : "text-rose-300"}
          detail="按监测期收益曲线计算"
        />
      </div>
    </section>
  );
}
