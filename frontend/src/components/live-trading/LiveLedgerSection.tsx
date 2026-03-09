import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import { DenseStat, StatusBadge, fmt, pct } from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
  autoRefreshPaused: boolean;
  onRefresh: () => void;
  onApplyParameters: () => void;
  onApplyEnvironment: () => void;
  onApplySuggestedWindow: (days: number) => void;
}

export default function LiveLedgerSection({ viewModel }: Props) {
  const {
    snapshot,
    completeness,
    coverageScore,
    ledgerSummary,
    syncStatus,
    windowInfo,
    ledgerView,
    setLedgerView,
    dailyBreakdown,
    filteredEntries
  } = viewModel;

  if (!snapshot || !completeness || !ledgerSummary || !windowInfo) {
    return null;
  }

  return (
    <section className="card p-2.5 sm:p-3">
      <h3 className="text-sm font-semibold text-slate-100">账单</h3>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded border border-slate-700/60 bg-slate-900/20 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">同步概览</p>
            <StatusBadge
              compact
              label="状态"
              value={syncStatus === "ready" ? "已同步" : syncStatus === "partial" ? "部分成功" : "同步失败"}
              tone={syncStatus}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-sm text-slate-300">账单覆盖率</span>
            <span className="text-lg font-semibold text-slate-100">{pct(coverageScore)}</span>
          </div>
        </div>

        <div className="rounded border border-slate-700/60 bg-slate-900/20 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">账单范围</p>
            <StatusBadge
              compact
              label="资金费"
              value={completeness.funding_complete ? "完整" : "部分"}
              tone={completeness.funding_complete ? "ready" : "partial"}
            />
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-100">
            {new Date(windowInfo.strategy_started_at).toLocaleDateString()} ~ {new Date(windowInfo.compared_end_at).toLocaleDateString()}
          </div>
          {completeness.bills_window_clipped ? (
            <div className="mt-1 text-xs text-amber-200">账单时间窗已截断</div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-700/60 bg-slate-900/30 p-1">
          {([
            ["summary", "摘要"],
            ["daily", "按日汇总"],
            ["ledger", "逐笔账单"]
          ] as const).map(([value, label]) => {
            const active = ledgerView === value;
            return (
              <button
                key={value}
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  active ? "bg-slate-200 text-slate-900" : "text-slate-300 hover:bg-slate-800/70"
                }`}
                onClick={() => setLedgerView(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-slate-400">
          {ledgerView === "summary"
            ? "查看收益拆解与成本占比。"
            : ledgerView === "daily"
              ? `当前共 ${dailyBreakdown.length} 个按日汇总条目。`
              : `当前共 ${filteredEntries.length} 条逐笔账单。`}
        </div>
      </div>

      {ledgerView === "summary" && (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <DenseStat label="已实现" value={`${fmt(ledgerSummary.realized)} USDT`} />
          <DenseStat
            label="未实现"
            value={`${fmt(ledgerSummary.unrealized)} USDT`}
            accent={ledgerSummary.unrealized >= 0 ? "text-emerald-300" : "text-rose-300"}
          />
          <DenseStat
            label="交易净额"
            value={`${fmt(ledgerSummary.trading_net)} USDT`}
            accent={ledgerSummary.trading_net >= 0 ? "text-emerald-300" : "text-rose-300"}
          />
          <DenseStat
            label="总净额"
            value={`${fmt(ledgerSummary.total_pnl)} USDT`}
            accent={ledgerSummary.total_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}
          />
          <DenseStat label="手续费" value={`${fmt(ledgerSummary.fees)} USDT`} />
          <DenseStat
            label="资金费"
            value={`${fmt(ledgerSummary.funding)} USDT`}
            accent={ledgerSummary.funding >= 0 ? "text-emerald-300" : "text-amber-200"}
          />
          <DenseStat
            label="资金费/总收益"
            value={Math.abs(ledgerSummary.total_pnl) > 0 ? `${((ledgerSummary.funding / ledgerSummary.total_pnl) * 100).toFixed(1)}%` : "--"}
          />
          <DenseStat
            label="总成本/总收益"
            value={
              Math.abs(ledgerSummary.total_pnl) > 0
                ? `${(((Math.abs(ledgerSummary.fees) + Math.abs(Math.min(ledgerSummary.funding, 0))) / Math.abs(ledgerSummary.total_pnl)) * 100).toFixed(1)}%`
                : "--"
            }
          />
        </div>
      )}

      {ledgerView === "daily" && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2 pr-3">日期</th>
                <th className="pb-2 pr-3">已实现</th>
                <th className="pb-2 pr-3">手续费</th>
                <th className="pb-2 pr-3">资金费</th>
                <th className="pb-2 pr-3">交易净额</th>
                <th className="pb-2 pr-3">总净额</th>
                <th className="pb-2">条数</th>
              </tr>
            </thead>
            <tbody>
              {dailyBreakdown.map((item) => (
                <tr key={item.date} className="border-t border-slate-800/80">
                  <td className="py-2 pr-3">{item.date}</td>
                  <td className="py-2 pr-3 mono">{fmt(item.realized_pnl)}</td>
                  <td className="py-2 pr-3 mono">{fmt(item.fees_paid)}</td>
                  <td className="py-2 pr-3 mono">{fmt(item.funding_net)}</td>
                  <td className="py-2 pr-3 mono">{fmt(item.trading_net)}</td>
                  <td className={`py-2 pr-3 mono ${item.total_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmt(item.total_pnl)}</td>
                  <td className="py-2">{item.entry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dailyBreakdown.length === 0 && <p className="text-sm text-slate-400">当前没有按日汇总账单。</p>}
        </div>
      )}

      {ledgerView === "ledger" && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2 pr-3">时间</th>
                <th className="pb-2 pr-3">类型</th>
                <th className="pb-2 pr-3">方向</th>
                <th className="pb-2 pr-3">金额</th>
                <th className="pb-2 pr-3">PnL</th>
                <th className="pb-2 pr-3">Fee</th>
                <th className="pb-2">备注</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={`${entry.timestamp}-${entry.kind}-${entry.trade_id ?? entry.order_id ?? entry.note ?? "row"}`} className="border-t border-slate-800/80">
                  <td className="py-2 pr-3">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="py-2 pr-3 uppercase">{entry.kind}</td>
                  <td className="py-2 pr-3 uppercase">{entry.side ?? "--"}</td>
                  <td className={`py-2 pr-3 mono ${entry.amount >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmt(entry.amount, 6)}</td>
                  <td className="py-2 pr-3 mono">{fmt(entry.pnl, 6)}</td>
                  <td className="py-2 pr-3 mono">{fmt(entry.fee, 6)}</td>
                  <td className="py-2 text-xs text-slate-400">{entry.note ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEntries.length === 0 && <p className="text-sm text-slate-400">当前没有逐笔账单。</p>}
        </div>
      )}
    </section>
  );
}
