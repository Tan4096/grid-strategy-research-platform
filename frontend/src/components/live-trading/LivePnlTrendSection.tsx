import { useEffect, useMemo, useState } from "react";
import LineChart from "../LineChart";
import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import { NEGATIVE_CURVE_COLOR, POSITIVE_CURVE_COLOR, resolveCurveColorByLastValue } from "../../lib/curveColors";
import { DenseStat, formatDateTime, fmt, pct } from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
}

function completenessSummary(fillsComplete: boolean, fundingComplete: boolean): string {
  if (fillsComplete && fundingComplete) {
    return "成交/资金费完整";
  }
  if (!fillsComplete && !fundingComplete) {
    return "成交/资金费部分";
  }
  return fillsComplete ? "资金费部分" : "成交部分";
}

export default function LivePnlTrendSection({ viewModel }: Props) {
  const {
    robot,
    ledgerSummary,
    headline,
    currentNotional,
    pnlCurve,
    pnlCurveChartUsesReturnRate,
    pnlCurveDrawdown,
    pnlCurveMaxDrawdown,
    pnlCurveDisplayStart,
    pnlCurveChartData,
    pnlCurveColor,
    pnlCurveDrawdownChartData,
    pnlCurveDrawdownColor,
    pnlCurveChartHeight,
    windowInfo,
    completeness
  } = viewModel;
  const [curveHoverRatio, setCurveHoverRatio] = useState<number | null>(null);

  useEffect(() => {
    setCurveHoverRatio(null);
  }, [pnlCurveChartUsesReturnRate, pnlCurveChartData.length, pnlCurveDrawdownChartData.length]);

  const liveReturnRateCurveColor = useMemo(
    () => resolveCurveColorByLastValue(pnlCurveChartData, POSITIVE_CURVE_COLOR, NEGATIVE_CURVE_COLOR),
    [pnlCurveChartData]
  );
  if (!robot || !ledgerSummary || !headline || !windowInfo || !completeness) {
    return null;
  }

  const chartMeta = [
    `曲线起点 ${formatDateTime(pnlCurveDisplayStart)}`,
    `最新快照 ${formatDateTime(pnlCurve?.endTimestamp ?? windowInfo.fetched_at)}`,
    `本金 ${fmt(robot.investment_usdt)} USDT`,
    completenessSummary(completeness.fills_complete, completeness.funding_complete)
  ].join(" · ");
  const hasCompletenessWarning = !completeness.fills_complete || !completeness.funding_complete;

  return (
    <section className="card p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-100">收益和趋势</h3>
        {hasCompletenessWarning ? (
          <span className="text-xs text-amber-200">
            数据缺口：{!completeness.fills_complete ? "成交明细未完整；" : ""}
            {!completeness.funding_complete ? "资金费未完整。" : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <DenseStat
          label="未实现盈亏"
          value={`${fmt(robot.floating_profit ?? ledgerSummary.unrealized)} USDT`}
          accent={(robot.floating_profit ?? ledgerSummary.unrealized) >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
        <DenseStat
          label="网格已实现"
          value={`${fmt(robot.grid_profit ?? ledgerSummary.realized)} USDT`}
          accent={(robot.grid_profit ?? ledgerSummary.realized) >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
        <DenseStat
          label="总收益"
          value={`${fmt(robot.total_pnl ?? ledgerSummary.total_pnl)} USDT`}
          accent={(robot.total_pnl ?? ledgerSummary.total_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"}
          detail={`收益率 ${pct(robot.pnl_ratio)}${headline.pnl24h === null ? "" : ` · 近24h ${fmt(headline.pnl24h)} USDT`}`}
        />
        <DenseStat label="手续费" value={`${fmt(robot.total_fee ?? ledgerSummary.fees)} USDT`} />
        <DenseStat
          label="资金费"
          value={`${fmt(robot.funding_fee ?? ledgerSummary.funding)} USDT`}
          accent={(robot.funding_fee ?? ledgerSummary.funding) >= 0 ? "text-emerald-300" : "text-amber-200"}
        />
        <DenseStat label="当前名义敞口" value={`${fmt(currentNotional)} USDT`} />
      </div>

      <div className="mt-4 rounded border border-slate-700/60 bg-slate-900/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
          <span className="text-slate-400">实盘曲线</span>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right min-w-0 flex-1">
            <span className="text-slate-500 truncate">
              回撤 {pnlCurveDrawdown === null
                ? "--"
                : pnlCurveChartUsesReturnRate
                  ? `${pnlCurveDrawdown.toFixed(2)}%`
                  : `${fmt(pnlCurveDrawdown)} USDT`} · 最大 {pnlCurveMaxDrawdown === null
                ? "--"
                : pnlCurveChartUsesReturnRate
                  ? `${pnlCurveMaxDrawdown.toFixed(2)}%`
                  : `${fmt(pnlCurveMaxDrawdown)} USDT`}
            </span>
            <span className="text-slate-400">{chartMeta}</span>
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <LineChart
            title={pnlCurveChartUsesReturnRate ? "收益率曲线" : "收益曲线"}
            data={pnlCurveChartData}
            color={pnlCurveChartUsesReturnRate ? liveReturnRateCurveColor : pnlCurveColor}
            yAxisLabel={pnlCurveChartUsesReturnRate ? "收益率" : "USDT"}
            returnAmountBase={robot.investment_usdt ?? undefined}
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={pnlCurveChartHeight}
          />
          <LineChart
            title="回撤曲线"
            data={pnlCurveDrawdownChartData}
            color={pnlCurveDrawdownColor}
            yAxisLabel={pnlCurveChartUsesReturnRate ? "回撤比例" : "USDT"}
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={pnlCurveChartHeight}
          />
        </div>
      </div>
    </section>
  );
}
