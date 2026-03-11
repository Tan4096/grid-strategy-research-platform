import type { BacktestResponse, LiveOpenOrder } from "../../lib/api-schema";
import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import LiveOrderMiniChart from "./LiveOrderMiniChart";
import {
  DenseStat,
  fmtAssetAmount,
  fmt,
  fmtGridCount,
  pickPositiveValue,
  resolveBaseAssetSymbol,
  resolveHeldGridCount,
  resolveSingleGridBaseAmount,
  riskToneClass,
  riskToneKey,
  RobotBadge,
  robotRunTypeLabel
} from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
  backtestResult?: BacktestResponse | null;
  miniBacktestLoading?: boolean;
  miniBacktestWindowDays?: 7 | 30;
  onMiniBacktestWindowDaysChange?: (value: 7 | 30) => void;
}

function collectActiveOrderLevels(openOrders: LiveOpenOrder[]): { buyLevels: number[]; sellLevels: number[] } {
  const buyPrices = new Set<number>();
  const sellPrices = new Set<number>();

  openOrders.forEach((order) => {
    if (!Number.isFinite(order.price) || order.price <= 0) {
      return;
    }
    if (order.side === "buy") {
      buyPrices.add(order.price);
      return;
    }
    if (order.side === "sell") {
      sellPrices.add(order.price);
    }
  });

  return {
    buyLevels: Array.from(buyPrices).sort((left, right) => left - right),
    sellLevels: Array.from(sellPrices).sort((left, right) => left - right)
  };
}

export default function LiveRiskConfigSection({
  viewModel,
  backtestResult = null,
  miniBacktestLoading = false,
  miniBacktestWindowDays = 30,
  onMiniBacktestWindowDaysChange
}: Props) {
  const { snapshot, robot, currentPrice, headline, directionBadge, trend } = viewModel;
  if (!snapshot || !robot || !headline || !directionBadge) {
    return null;
  }

  const { buyLevels, sellLevels } = collectActiveOrderLevels(snapshot.open_orders);
  const displayedLevelCount = buyLevels.length + sellLevels.length;
  const fallbackLevels = snapshot.inferred_grid.active_levels;
  const hasDirectionalOrderLevels = displayedLevelCount > 0;
  const hasRenderableStructure = hasDirectionalOrderLevels || fallbackLevels.length > 0;
  const baseAssetSymbol = resolveBaseAssetSymbol(snapshot.account.symbol, snapshot.account.exchange_symbol);
  const singleAmountBase = resolveSingleGridBaseAmount(snapshot);
  const heldGridCount = resolveHeldGridCount(snapshot);

  return (
    <section className="card p-2.5 sm:p-3">
      <h3 className="text-sm font-semibold text-slate-100">风险与配置</h3>
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">风险</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DenseStat
              uniformHeight
              label="距强平"
              value={headline.liquidationDistancePct === null ? "--" : `${headline.liquidationDistancePct.toFixed(2)}%`}
              accent={riskToneClass(headline.liquidationDistancePct)}
              emphasis
              tone={riskToneKey(headline.liquidationDistancePct)}
            />
            <DenseStat
              uniformHeight
              label="止损距离"
              value={headline.stopDistancePct === null ? "--" : `${headline.stopDistancePct.toFixed(2)}%`}
              accent={riskToneClass(headline.stopDistancePct)}
              emphasis
              tone={riskToneKey(headline.stopDistancePct)}
            />
            <DenseStat uniformHeight label="配置杠杆" value={fmt(robot.configured_leverage)} />
            <DenseStat uniformHeight label="实际杠杆" value={fmt(robot.actual_leverage)} />
            <DenseStat uniformHeight label="当前价格" value={fmt(currentPrice)} />
            <DenseStat
              uniformHeight
              label="强平价格"
              value={fmt(pickPositiveValue(robot.liquidation_price, snapshot.position.liquidation_price))}
            />
            <DenseStat uniformHeight label="止损价" value={fmt(pickPositiveValue(robot.stop_loss_price))} />
            <DenseStat uniformHeight label="止盈价" value={fmt(robot.take_profit_price)} />
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">配置</p>
            <div className="flex flex-wrap gap-2">
              <RobotBadge label={directionBadge.label} tone={directionBadge.tone} />
              <RobotBadge label={robotRunTypeLabel(robot.run_type)} tone="gray" />
              <RobotBadge label={robot.use_base_position == null ? "基仓未知" : robot.use_base_position ? "已启用基仓" : "未启用基仓"} tone={robot.use_base_position ? "amber" : "gray"} />
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DenseStat uniformHeight label="区间下限" value={fmt(robot.lower_price ?? snapshot.inferred_grid.lower)} />
            <DenseStat uniformHeight label="区间上限" value={fmt(robot.upper_price ?? snapshot.inferred_grid.upper)} />
            <DenseStat uniformHeight label="网格数" value={fmt(robot.grid_count ?? snapshot.inferred_grid.grid_count, 0)} />
            <DenseStat uniformHeight label="格距" value={fmt(robot.grid_spacing ?? snapshot.inferred_grid.grid_spacing, 4)} />
            <DenseStat
              uniformHeight
              label={singleAmountBase !== null ? `单格下单量（${baseAssetSymbol}）` : "单格下单量"}
              value={singleAmountBase !== null ? fmtAssetAmount(singleAmountBase) : fmt(robot.single_amount)}
            />
            <DenseStat uniformHeight label="持仓网格数" value={fmtGridCount(heldGridCount)} />
            <DenseStat uniformHeight label="买单层" value={`${buyLevels.length} 层`} />
            <DenseStat uniformHeight label="卖单层" value={`${sellLevels.length} 层`} />
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/30 p-2.5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs uppercase tracking-wide text-slate-400">当前挂单结构</p>
                <span className="text-[11px] text-slate-500">
                {miniBacktestLoading
                  ? "后台回测 K 线加载中，先显示挂单结构。"
                  : hasDirectionalOrderLevels
                    ? "悬浮可查看时间与 OHLC；左侧标注全部挂单价格。"
                    : fallbackLevels.length > 0
                      ? "灰线=未识别方向的挂单层，悬浮可查看时间与价格。"
                      : "当前没有识别到活跃挂单层。"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="inline-flex rounded-full border border-[color:rgba(var(--accent-rgb),0.28)] bg-[color:rgba(var(--accent-rgb),0.08)] p-0.5 shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.08)]">
                {[7, 30].map((days) => {
                  const active = miniBacktestWindowDays === days;
                  return (
                    <button
                      key={`window-${days}`}
                      type="button"
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        active
                          ? "border-[color:rgba(var(--accent-rgb),0.65)] bg-[color:rgba(var(--accent-rgb),1)] text-slate-950 shadow-[0_0_6px_rgba(var(--accent-rgb),0.35)]"
                          : "text-[rgb(var(--accent-rgb))] hover:bg-[color:rgba(var(--accent-rgb),0.12)]"
                      }`}
                      onClick={() => onMiniBacktestWindowDaysChange?.(days as 7 | 30)}
                    >
                      {days === 30 ? "30天" : "7天"}
                    </button>
                  );
                })}
              </div>
              <RobotBadge label={directionBadge.label} tone={directionBadge.tone} />
              <RobotBadge label={`买单 ${buyLevels.length} 层`} tone="green" />
              <RobotBadge label={`卖单 ${sellLevels.length} 层`} tone="red" />
            </div>
          </div>

          {hasRenderableStructure ? (
            <div className="mt-2.5">
              <LiveOrderMiniChart
                trend={trend}
                currentPrice={currentPrice}
                backtestCandles={backtestResult?.candles ?? []}
                positionSide={snapshot.position.side}
                positionQuantity={snapshot.position.quantity}
                entryPrice={snapshot.position.entry_price}
                buyLevels={buyLevels}
                sellLevels={sellLevels}
                fallbackLevels={fallbackLevels}
              />
            </div>
          ) : (
            <p className="mt-2.5 text-xs text-slate-500">暂无活动价格层</p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span>活跃挂单层 {snapshot.inferred_grid.active_level_count} 层</span>
            <span>当前展示 {hasDirectionalOrderLevels ? displayedLevelCount : fallbackLevels.length} 层</span>
            <span>持仓 {fmtGridCount(heldGridCount)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
