import { useEffect, useMemo, useState } from "react";
import LineChart from "../LineChart";
import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import { NEGATIVE_CURVE_COLOR, POSITIVE_CURVE_COLOR, resolveCurveColorByLastValue } from "../../lib/curveColors";
import { DenseStat, formatDateTime, fmt, pct } from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
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
    windowInfo
  } = viewModel;
  const [curveHoverRatio, setCurveHoverRatio] = useState<number | null>(null);

  useEffect(() => {
    setCurveHoverRatio(null);
  }, [pnlCurveChartUsesReturnRate, pnlCurveChartData.length, pnlCurveDrawdownChartData.length]);

  const liveReturnRateCurveColor = useMemo(
    () => resolveCurveColorByLastValue(pnlCurveChartData, POSITIVE_CURVE_COLOR, NEGATIVE_CURVE_COLOR),
    [pnlCurveChartData]
  );
  if (!robot || !ledgerSummary || !headline || !windowInfo) {
    return null;
  }

  return (
    <section className="card p-2.5 sm:p-3">
      <h3 className="text-sm font-semibold text-slate-100">收益和趋势</h3>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">收益拆解</p>
            <span
              className={`text-sm font-semibold ${
                (robot.total_pnl ?? ledgerSummary.total_pnl) >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              总收益 {fmt(robot.total_pnl ?? ledgerSummary.total_pnl)} USDT
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-300">{headline.pnlSourceSummary}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <DenseStat
              label="网格已实现"
              value={`${fmt(robot.grid_profit ?? ledgerSummary.realized)} USDT`}
              accent={(robot.grid_profit ?? ledgerSummary.realized) >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
            <DenseStat
              label="浮动盈亏"
              value={`${fmt(robot.floating_profit ?? ledgerSummary.unrealized)} USDT`}
              accent={(robot.floating_profit ?? ledgerSummary.unrealized) >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
            <DenseStat
              label="收益率"
              value={pct(robot.pnl_ratio)}
              accent={(robot.pnl_ratio ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
            <DenseStat
              label="近24h净额"
              value={headline.pnl24h === null ? "--" : `${fmt(headline.pnl24h)} USDT`}
              accent={(headline.pnl24h ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
          </div>
          <div className="mt-3 rounded border border-slate-700/60 bg-slate-950/30 px-3 py-2 text-sm text-slate-300">
            {headline.pnlSourceSummary}
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">成本与敞口</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <DenseStat label="手续费" value={`${fmt(robot.total_fee ?? ledgerSummary.fees)} USDT`} />
            <DenseStat
              label="资金费"
              value={`${fmt(robot.funding_fee ?? ledgerSummary.funding)} USDT`}
              accent={(robot.funding_fee ?? ledgerSummary.funding) >= 0 ? "text-emerald-300" : "text-amber-200"}
            />
            <DenseStat label="投入本金" value={`${fmt(robot.investment_usdt)} USDT`} />
            <DenseStat label="当前名义敞口" value={`${fmt(currentNotional)} USDT`} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded border border-slate-700/60 bg-slate-900/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">实盘曲线</p>
          </div>
          <div className="grid gap-2 text-right text-xs text-slate-400 sm:text-sm">
            <span>曲线起点 {formatDateTime(pnlCurveDisplayStart)}</span>
            <span>最新快照 {formatDateTime(pnlCurve?.endTimestamp ?? windowInfo.fetched_at)}</span>
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

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            来源{" "}
            {pnlCurve?.source === "replay"
              ? "成交回放 + 价格重建"
              : pnlCurve?.source === "simulated"
                ? "逐 K 模拟 + 价格重建"
                : pnlCurve?.source === "ledger"
                  ? "逐笔账单"
                  : pnlCurve?.source === "daily"
                    ? "按日汇总"
                    : pnlCurve?.source === "trend"
                      ? "监测快照"
                      : "最新快照"}
          </span>
          <span>
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
          <span>
            浮盈 {fmt(robot.floating_profit ?? ledgerSummary.unrealized)} USDT · 本金 {fmt(robot.investment_usdt)} USDT
          </span>
        </div>
      </div>
    </section>
  );
}
