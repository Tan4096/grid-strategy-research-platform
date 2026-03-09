import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import {
  DenseStat,
  fmt,
  pickPositiveValue,
  riskToneClass,
  riskToneKey,
  robotRunTypeLabel
} from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
}

export default function LiveRiskConfigSection({ viewModel }: Props) {
  const { snapshot, robot, currentPrice, headline, directionBadge } = viewModel;
  if (!snapshot || !robot || !headline || !directionBadge) {
    return null;
  }

  return (
    <section className="card p-2.5 sm:p-3">
      <h3 className="text-sm font-semibold text-slate-100">风险与配置</h3>
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">风险</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DenseStat
              label="距强平"
              value={headline.liquidationDistancePct === null ? "--" : `${headline.liquidationDistancePct.toFixed(2)}%`}
              accent={riskToneClass(headline.liquidationDistancePct)}
              emphasis
              tone={riskToneKey(headline.liquidationDistancePct)}
            />
            <DenseStat
              label="止损距离"
              value={headline.stopDistancePct === null ? "--" : `${headline.stopDistancePct.toFixed(2)}%`}
              accent={riskToneClass(headline.stopDistancePct)}
              emphasis
              tone={riskToneKey(headline.stopDistancePct)}
            />
            <DenseStat label="运行模式" value={robotRunTypeLabel(robot.run_type)} />
            <DenseStat label="配置杠杆" value={fmt(robot.configured_leverage)} />
            <DenseStat label="实际杠杆" value={fmt(robot.actual_leverage)} />
            <DenseStat label="基仓启用" value={robot.use_base_position == null ? "--" : robot.use_base_position ? "是" : "否"} />
            <DenseStat label="当前价格" value={fmt(currentPrice)} />
            <DenseStat label="强平价格" value={fmt(pickPositiveValue(robot.liquidation_price, snapshot.position.liquidation_price))} />
            <DenseStat label="止损触发价" value={fmt(pickPositiveValue(robot.stop_loss_price))} />
            <DenseStat label="止盈触发价" value={fmt(robot.take_profit_price)} />
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">配置</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DenseStat label="区间下限" value={fmt(robot.lower_price ?? snapshot.inferred_grid.lower)} />
            <DenseStat label="区间上限" value={fmt(robot.upper_price ?? snapshot.inferred_grid.upper)} />
            <DenseStat label="网格数" value={fmt(robot.grid_count ?? snapshot.inferred_grid.grid_count, 0)} />
            <DenseStat label="格距" value={fmt(robot.grid_spacing ?? snapshot.inferred_grid.grid_spacing, 4)} />
            <DenseStat label="方向" value={directionBadge.label} />
            <DenseStat label="活跃层数" value={String(snapshot.inferred_grid.active_level_count)} />
          </div>
          <div className="mt-3 rounded border border-slate-700/60 bg-slate-950/30 px-3 py-2 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">活跃价格层</p>
              <span className="text-xs text-slate-500">共 {snapshot.inferred_grid.active_level_count} 层</span>
            </div>
            <div className="mt-2 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2">
                {snapshot.inferred_grid.active_levels.length > 0 ? (
                  snapshot.inferred_grid.active_levels.map((item) => (
                    <span
                      key={item}
                      className="rounded border border-slate-700/70 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 mono"
                    >
                      {fmt(item)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">暂无活动价格层</span>
                )}
              </div>
            </div>
            {snapshot.inferred_grid.note && (
              <details className="mt-3 text-xs text-slate-400">
                <summary className="cursor-pointer font-semibold uppercase tracking-wide text-slate-500">
                  推断说明
                </summary>
                <p className="mt-2">{snapshot.inferred_grid.note}</p>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
