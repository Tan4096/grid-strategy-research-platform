import { useEffect, useMemo, useState } from "react";
import type { LiveSnapshotResponse } from "../../lib/api-schema";
import type { LiveTradingViewModel } from "../../hooks/live/useLiveTradingViewModel";
import {
  buildGridLedgerGroups,
  filterClosedGridGroups,
  filterFundingRows,
  filterOpenGridGroups,
  type ClosedGridLedgerGroup,
  type FundingLedgerRow,
  type OpenGridLedgerGroup
} from "./ledgerGrouping";
import { DenseStat, fmt, formatDurationSeconds } from "./shared";

interface Props {
  viewModel: LiveTradingViewModel;
  autoRefreshPaused: boolean;
  onRefresh: () => void;
  onApplyParameters: () => void;
  onApplyEnvironment: () => void;
  onApplySuggestedWindow: (days: number) => void;
}

type GridLedgerSection = "closed" | "open" | "funding";

const GRID_LEDGER_SECTIONS: Array<{ value: GridLedgerSection; label: string }> = [
  { value: "closed", label: "已平仓网格" },
  { value: "open", label: "未平仓网格" },
  { value: "funding", label: "资金费" }
];

const LEDGER_TIME_OPTIONS: Array<{ value: "all" | "24h" | "7d" | "30d"; label: string }> = [
  { value: "all", label: "全部时间" },
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" }
];

const LEDGER_SIDE_OPTIONS: Array<{ value: "all" | "buy" | "sell"; label: string }> = [
  { value: "all", label: "全部方向" },
  { value: "buy", label: "买入开仓" },
  { value: "sell", label: "卖出开仓" }
];

const LEDGER_PAGE_SIZE = 20;

function paginationWindow(page: number, pageCount: number): number[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  if (page <= 3) {
    return [1, 2, 3, 4, 5];
  }
  if (page >= pageCount - 2) {
    return Array.from({ length: 5 }, (_, index) => pageCount - 4 + index);
  }
  return [page - 2, page - 1, page, page + 1, page + 2];
}

function slicePage<T>(items: T[], page: number): T[] {
  const startIndex = (page - 1) * LEDGER_PAGE_SIZE;
  return items.slice(startIndex, startIndex + LEDGER_PAGE_SIZE);
}

function closedGroupLabel(group: ClosedGridLedgerGroup): string {
  return group.direction === "long" ? "买入开仓 → 卖出平仓" : "卖出开仓 → 买入平仓";
}

function openGroupLabel(group: OpenGridLedgerGroup): string {
  return group.direction === "long" ? "买入开仓，等待卖出平仓" : "卖出开仓，等待买入平仓";
}

function amountTone(value: number): string {
  return value >= 0 ? "text-emerald-300" : "text-rose-300";
}

function fundingAmountTone(value: number): string {
  return value >= 0 ? "text-emerald-300" : "text-amber-200";
}

function renderPageSummary(start: number, end: number, total: number, unit: string): string {
  if (total === 0) {
    return `当前没有${unit}。`;
  }
  return `每页 ${LEDGER_PAGE_SIZE} ${unit}，当前显示第 ${start}-${end} ${unit}，共 ${total} ${unit}。`;
}

function baseCardClass(isBase: boolean): string {
  return isBase
    ? "border-[color:rgba(var(--accent-rgb),0.55)] bg-[color:rgba(var(--accent-rgb),0.12)] shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.12)]"
    : "border-slate-700/60 bg-slate-950/30";
}

function baseSectionClass(isBase: boolean): string {
  return isBase ? "border-[color:rgba(var(--accent-rgb),0.28)] bg-[color:rgba(var(--accent-rgb),0.06)]" : "border-slate-700/50 bg-slate-950/30";
}

function fundingTable(rows: FundingLedgerRow[]) {
  return (
    <table className="w-full min-w-[760px] border-collapse text-left text-sm text-slate-200">
      <thead className="sticky top-0 z-10 bg-slate-900/95 text-xs uppercase tracking-wide text-slate-400 backdrop-blur">
        <tr>
          <th className="px-3 py-2 pr-3 first:rounded-tl-lg">时间</th>
          <th className="px-3 py-2 pr-3">类型</th>
          <th className="px-3 py-2 pr-3 text-right">金额</th>
          <th className="px-3 py-2 pr-3">币种</th>
          <th className="px-3 py-2 last:rounded-tr-lg">备注</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-slate-800/70">
            <td className="px-3 py-2 whitespace-nowrap">{new Date(row.timestamp).toLocaleString()}</td>
            <td className="px-3 py-2">
              <span className="inline-flex rounded-full border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-200">
                资金费
              </span>
            </td>
            <td className={`px-3 py-2 text-right mono whitespace-nowrap ${fundingAmountTone(row.amount)}`}>{fmt(row.amount, 6)}</td>
            <td className="px-3 py-2 whitespace-nowrap">{row.currency ?? "--"}</td>
            <td className="px-3 py-2 text-xs text-slate-400">资金费结算</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function closedGridList(
  groups: ClosedGridLedgerGroup[],
  expandedGroups: Record<string, boolean>,
  onToggleGroup: (key: string) => void
) {
  return (
    <div className="divide-y divide-slate-800/70">
      {groups.map((group) => {
        const expanded = expandedGroups[group.key] ?? false;
        const isBase = group.source === "base_inferred";
        return (
          <div key={group.key} className={isBase ? "bg-[color:rgba(var(--accent-rgb),0.06)]" : "bg-slate-900/10"}>
            <button
              type="button"
              className={`flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition ${isBase ? "hover:bg-[color:rgba(var(--accent-rgb),0.12)]" : "hover:bg-slate-800/25"}`}
              onClick={() => onToggleGroup(group.key)}
              aria-expanded={expanded}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isBase ? (
                    <span className="inline-flex rounded-full border border-[color:rgba(var(--accent-rgb),0.55)] bg-[color:rgba(var(--accent-rgb),0.22)] px-2 py-0.5 text-[11px] font-semibold text-slate-50 shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.12)]">
                      底仓网格
                    </span>
                  ) : null}
                  <span className="inline-flex rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                    已平仓网格
                  </span>
                  <span className="text-sm font-semibold text-slate-100">{new Date(group.closeLeg.fill.timestamp).toLocaleString()}</span>
                  <span className="text-xs text-slate-400">{closedGroupLabel(group)}</span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <div className={`rounded border px-3 py-2 ${baseSectionClass(isBase)}`}>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">开仓价</div>
                    <div className="mt-1 mono text-sm font-semibold text-slate-100">{fmt(group.openLeg.fill.price, 2)}</div>
                  </div>
                  <div className={`rounded border px-3 py-2 ${baseSectionClass(isBase)}`}>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">平仓价</div>
                    <div className="mt-1 mono text-sm font-semibold text-slate-100">{fmt(group.closeLeg.fill.price, 2)}</div>
                  </div>
                  <div className="rounded border border-slate-700/50 bg-slate-950/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">数量</div>
                    <div className="mt-1 mono text-sm font-semibold text-slate-100">{fmt(group.quantity, 4)}</div>
                  </div>
                  <div className="rounded border border-slate-700/50 bg-slate-950/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">已实现</div>
                    <div className={`mt-1 mono text-sm font-semibold ${amountTone(group.realizedPnl)}`}>{fmt(group.realizedPnl, 6)}</div>
                  </div>
                  <div className="rounded border border-slate-700/50 bg-slate-950/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">净收益</div>
                    <div className={`mt-1 mono text-sm font-semibold ${amountTone(group.netPnl)}`}>{fmt(group.netPnl, 6)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>持有 {formatDurationSeconds(Math.max(0, Math.round((Date.parse(group.closeLeg.fill.timestamp) - Date.parse(group.openLeg.fill.timestamp)) / 1000)))}</span>
                  <span>手续费 {fmt(group.feesPaid, 6)}</span>
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${isBase ? "border-[color:rgba(var(--accent-rgb),0.6)] bg-[color:rgba(var(--accent-rgb),0.18)] text-slate-50" : "border-slate-700/60 text-slate-300"}`}>
                {expanded ? "收起" : "展开"}
              </span>
            </button>
            {expanded ? (
              <div className={`border-t px-3 py-3 ${isBase ? "border-[color:rgba(var(--accent-rgb),0.24)] bg-[color:rgba(var(--accent-rgb),0.06)]" : "border-slate-800/70 bg-slate-950/25"}`}>
                <div className="grid gap-2 xl:grid-cols-2">
                  <div className="rounded border border-slate-700/50 bg-slate-950/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200">开仓</span>
                      <span className="text-xs text-slate-400">{new Date(group.openLeg.fill.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-400">
                      <div>方向：{group.openLeg.fill.side === "buy" ? "买入" : "卖出"}</div>
                      <div>价格：<span className="mono text-slate-200">{fmt(group.openLeg.fill.price, 2)}</span></div>
                      <div>数量：<span className="mono text-slate-200">{fmt(group.openLeg.quantity, 4)}</span></div>
                      <div>手续费：<span className="mono text-slate-200">{fmt(group.openLeg.fee, 6)}</span></div>
                      <div className="text-slate-500">订单 {group.openLeg.fill.order_id ?? "--"} · 成交 {group.openLeg.fill.trade_id}</div>
                    </div>
                  </div>
                  <div className="rounded border border-slate-700/50 bg-slate-950/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200">平仓</span>
                      <span className="text-xs text-slate-400">{new Date(group.closeLeg.fill.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-400">
                      <div>方向：{group.closeLeg.fill.side === "buy" ? "买入" : "卖出"}</div>
                      <div>价格：<span className="mono text-slate-200">{fmt(group.closeLeg.fill.price, 2)}</span></div>
                      <div>数量：<span className="mono text-slate-200">{fmt(group.closeLeg.quantity, 4)}</span></div>
                      <div>已实现：<span className={`mono ${amountTone(group.realizedPnl)}`}>{fmt(group.realizedPnl, 6)}</span></div>
                      <div className="text-slate-500">订单 {group.closeLeg.fill.order_id ?? "--"} · 成交 {group.closeLeg.fill.trade_id}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function openGridList(groups: OpenGridLedgerGroup[]) {
  return (
    <div className="space-y-3 p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const isBase = group.source === "base_inferred";
          return (
            <div key={group.key} className={`rounded border px-3 py-3 ${baseCardClass(isBase)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isBase ? (
                    <span className="inline-flex rounded-full border border-[color:rgba(var(--accent-rgb),0.55)] bg-[color:rgba(var(--accent-rgb),0.22)] px-2 py-0.5 text-[11px] font-semibold text-slate-50 shadow-[inset_0_0_0_1px_rgba(var(--accent-rgb),0.12)]">
                      底仓网格
                    </span>
                  ) : null}
                  <span className="inline-flex rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                    未平仓网格
                  </span>
                  <span className="text-xs text-slate-400">{openGroupLabel(group)}</span>
                </div>
                <span className="text-xs text-slate-400">{new Date(group.closeOrder?.timestamp ?? group.openLeg.fill.timestamp).toLocaleString()}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">开仓价</div>
                  <div className="mt-1 mono text-sm font-semibold text-slate-100">{fmt(group.openLeg.fill.price, 2)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">平仓价</div>
                  <div className="mt-1 mono text-sm font-semibold text-slate-100">{group.closeOrder ? fmt(group.closeOrder.price, 2) : "--"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">数量</div>
                  <div className="mt-1 mono text-sm font-semibold text-slate-100">{fmt(group.quantity, 4)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">浮动盈亏</div>
                  <div className={`mt-1 mono text-sm font-semibold ${amountTone(group.unrealizedPnl)}`}>{fmt(group.unrealizedPnl, 6)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>手续费 {fmt(group.feesPaid, 6)}</span>
                <span className={amountTone(group.netPnl)}>净额 {fmt(group.netPnl, 6)}</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">开仓订单 {group.openLeg.fill.order_id ?? "--"} · 成交 {group.openLeg.fill.trade_id}</div>
              <div className="mt-1 text-[11px] text-slate-500">平仓挂单 {group.closeOrder?.order_id ?? "--"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LiveLedgerSection({ viewModel }: Props) {
  const {
    snapshot,
    completeness,
    ledgerSummary,
    windowInfo,
    ledgerView,
    setLedgerView,
    dailyBreakdown,
    timeFilter,
    setTimeFilter,
    sideFilter,
    setSideFilter,
    realizedOnly,
    setRealizedOnly,
    searchQuery,
    setSearchQuery
  } = viewModel;

  const [gridSection, setGridSection] = useState<GridLedgerSection>("open");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  if (!snapshot || !completeness || !ledgerSummary || !windowInfo) {
    return null;
  }

  const { closedGroups, openGroups, fundingRows } = useMemo(() => buildGridLedgerGroups(snapshot as LiveSnapshotResponse), [snapshot]);
  const now = Date.parse(windowInfo.fetched_at);
  const filteredClosedGroups = useMemo(
    () =>
      filterClosedGridGroups(closedGroups, {
        timeFilter,
        searchQuery,
        sideFilter,
        realizedOnly,
        now
      }),
    [closedGroups, timeFilter, searchQuery, sideFilter, realizedOnly, now]
  );
  const filteredOpenGroups = useMemo(
    () =>
      filterOpenGridGroups(openGroups, {
        timeFilter,
        searchQuery,
        sideFilter,
        now
      }),
    [openGroups, timeFilter, searchQuery, sideFilter, now]
  );
  const filteredFundingRows = useMemo(
    () =>
      filterFundingRows(fundingRows, {
        timeFilter,
        searchQuery,
        now
      }),
    [fundingRows, timeFilter, searchQuery, now]
  );

  const activeCount =
    gridSection === "closed" ? filteredClosedGroups.length : gridSection === "open" ? filteredOpenGroups.length : filteredFundingRows.length;
  const pageCount = Math.max(1, Math.ceil(activeCount / LEDGER_PAGE_SIZE));
  const visiblePages = useMemo(() => paginationWindow(ledgerPage, pageCount), [ledgerPage, pageCount]);

  useEffect(() => {
    setLedgerPage(1);
  }, [gridSection, timeFilter, searchQuery, sideFilter, realizedOnly, activeCount]);

  useEffect(() => {
    setLedgerPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const paginatedClosedGroups = useMemo(() => slicePage(filteredClosedGroups, ledgerPage), [filteredClosedGroups, ledgerPage]);
  const paginatedOpenGroups = useMemo(() => slicePage(filteredOpenGroups, ledgerPage), [filteredOpenGroups, ledgerPage]);
  const paginatedFundingRows = useMemo(() => slicePage(filteredFundingRows, ledgerPage), [filteredFundingRows, ledgerPage]);

  const pageStart = activeCount === 0 ? 0 : (ledgerPage - 1) * LEDGER_PAGE_SIZE + 1;
  const pageEnd = Math.min(activeCount, ledgerPage * LEDGER_PAGE_SIZE);

  const ledgerViewSummary =
    ledgerView === "summary"
      ? "查看收益拆解与成本占比。"
      : ledgerView === "daily"
        ? `当前共 ${dailyBreakdown.length} 个按日汇总条目。`
        : gridSection === "closed"
          ? `当前共 ${filteredClosedGroups.length} 个已平仓网格。`
          : gridSection === "open"
            ? `当前共 ${filteredOpenGroups.length} 个未平仓网格。`
            : `当前共 ${filteredFundingRows.length} 条资金费。`;

  const hasLedgerFilters =
    gridSection !== "open" ||
    timeFilter !== "all" ||
    sideFilter !== "all" ||
    realizedOnly ||
    searchQuery.trim().length > 0;

  return (
    <section className="card p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ui-tab-group" aria-label="账单模块">
          <span className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950 px-3.5 py-1.5 text-sm font-bold text-slate-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <span className="h-4 w-1.5 rounded-full bg-slate-200" />
            账单
          </span>
          {([
            ["summary", "摘要"],
            ["daily", "按日汇总"],
            ["ledger", "逐笔账单"]
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`ui-tab !border-transparent !bg-transparent !shadow-none hover:!bg-slate-900/10 ${
                ledgerView === value ? "is-active !border-slate-300/25 !bg-slate-200/10 text-slate-100" : "text-slate-400"
              }`}
              onClick={() => setLedgerView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-right text-xs text-slate-400">
          未平仓 {openGroups.length} · 已平仓 {closedGroups.length} · 范围 {new Date(windowInfo.strategy_started_at).toLocaleDateString()} ~ {new Date(windowInfo.compared_end_at).toLocaleDateString()}
          {!completeness.funding_complete ? " · 资金费部分" : ""}
          {completeness.bills_window_clipped ? " · 账单时间窗已截断" : ""}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
        <div className="text-xs text-slate-400">{ledgerViewSummary}</div>
      </div>

      {ledgerView === "summary" && (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <DenseStat label="已实现" value={`${fmt(ledgerSummary.realized)} USDT`} />
          <DenseStat label="未实现" value={`${fmt(ledgerSummary.unrealized)} USDT`} accent={amountTone(ledgerSummary.unrealized)} />
          <DenseStat label="交易净额" value={`${fmt(ledgerSummary.trading_net)} USDT`} accent={amountTone(ledgerSummary.trading_net)} />
          <DenseStat label="总净额" value={`${fmt(ledgerSummary.total_pnl)} USDT`} accent={amountTone(ledgerSummary.total_pnl)} />
          <DenseStat label="手续费" value={`${fmt(ledgerSummary.fees)} USDT`} />
          <DenseStat label="资金费" value={`${fmt(ledgerSummary.funding)} USDT`} accent={fundingAmountTone(ledgerSummary.funding)} />
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
        <div className="mt-4 overflow-x-auto rounded border border-slate-700/60 bg-slate-900/20">
          <table className="w-full min-w-full border-collapse text-left text-sm text-slate-200">
            <thead className="bg-slate-900/95 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 pr-3 first:rounded-tl-lg">日期</th>
                <th className="px-3 py-2 pr-3">已实现</th>
                <th className="px-3 py-2 pr-3">手续费</th>
                <th className="px-3 py-2 pr-3">资金费</th>
                <th className="px-3 py-2 pr-3">交易净额</th>
                <th className="px-3 py-2 pr-3">总净额</th>
                <th className="px-3 py-2 last:rounded-tr-lg">条数</th>
              </tr>
            </thead>
            <tbody>
              {dailyBreakdown.map((item) => (
                <tr key={item.date} className="border-t border-slate-800/80">
                  <td className="px-3 py-2 pr-3">{item.date}</td>
                  <td className="px-3 py-2 pr-3 mono">{fmt(item.realized_pnl)}</td>
                  <td className="px-3 py-2 pr-3 mono">{fmt(item.fees_paid)}</td>
                  <td className="px-3 py-2 pr-3 mono">{fmt(item.funding_net)}</td>
                  <td className="px-3 py-2 pr-3 mono">{fmt(item.trading_net)}</td>
                  <td className={`px-3 py-2 pr-3 mono ${amountTone(item.total_pnl)}`}>{fmt(item.total_pnl)}</td>
                  <td className="px-3 py-2">{item.entry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dailyBreakdown.length === 0 ? <p className="px-3 py-4 text-sm text-slate-400">当前没有按日汇总账单。</p> : null}
        </div>
      )}

      {ledgerView === "ledger" && (
        <div className="mt-3 space-y-2.5">
          <div className="sticky top-0 z-10 rounded border border-slate-700/60 bg-slate-900/20 p-2.5 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="ui-tab-group" aria-label="网格账单视图切换">
                {GRID_LEDGER_SECTIONS.map((section) => (
                  <button
                    key={section.value}
                    type="button"
                    className={`ui-tab ${gridSection === section.value ? "is-active" : ""}`}
                    onClick={() => setGridSection(section.value)}
                  >
                    {section.label} {section.value === "closed" ? closedGroups.length : section.value === "open" ? openGroups.length : fundingRows.length}
                  </button>
                ))}
              </div>
              <div className="text-xs text-slate-400">
                {gridSection === "closed"
                  ? "一组账单对应一个已完成网格：开仓 + 平仓。"
                  : gridSection === "open"
                    ? "未平仓网格按待平仓挂单展示，底仓网格已单独标记。"
                    : "资金费单独列出，不再混进网格账单。"}
                {gridSection === "open" && !completeness.fills_complete ? " · 当前数量可能偏保守" : ""}
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 lg:grid-cols-[minmax(220px,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]">
              <input
                type="search"
                className="ui-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={gridSection === "funding" ? "搜索时间 / 币种" : "搜索订单号 / 成交号 / 时间"}
              />
              <select className="ui-input" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as typeof timeFilter)}>
                {LEDGER_TIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="ui-input"
                value={sideFilter}
                onChange={(event) => setSideFilter(event.target.value as typeof sideFilter)}
                disabled={gridSection === "funding"}
              >
                {LEDGER_SIDE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-end gap-2">
                {gridSection === "closed" ? (
                  <button
                    type="button"
                    className={`ui-tab ${realizedOnly ? "is-active" : ""}`}
                    onClick={() => setRealizedOnly((current) => !current)}
                  >
                    只看有盈亏
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ui-tab"
                  onClick={() => {
                    setGridSection("open");
                    setTimeFilter("all");
                    setSideFilter("all");
                    setRealizedOnly(false);
                    setSearchQuery("");
                  }}
                  disabled={!hasLedgerFilters}
                >
                  重置
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded border border-slate-700/60 bg-slate-900/20">
            {activeCount > 0 ? (
              <>
                <div className="form-scroll max-h-[560px] overflow-auto" style={{ paddingRight: 0 }}>
                  {gridSection === "funding"
                    ? fundingTable(paginatedFundingRows)
                    : gridSection === "closed"
                      ? closedGridList(paginatedClosedGroups, expandedGroups, (key) =>
                          setExpandedGroups((current) => ({ ...current, [key]: !current[key] }))
                        )
                      : openGridList(paginatedOpenGroups)}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 px-3 py-2 text-xs text-slate-400">
                  <span>{renderPageSummary(pageStart, pageEnd, activeCount, gridSection === "funding" ? "条" : "组")}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`ui-tab ${ledgerPage === 1 ? "cursor-not-allowed opacity-40" : ""}`}
                      onClick={() => setLedgerPage((current) => Math.max(1, current - 1))}
                      disabled={ledgerPage === 1}
                    >
                      上一页
                    </button>
                    {visiblePages[0] > 1 ? <span className="px-1 text-slate-500">…</span> : null}
                    {visiblePages.map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        className={`ui-tab ${ledgerPage === pageNumber ? "is-active" : ""}`}
                        onClick={() => setLedgerPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    {visiblePages[visiblePages.length - 1] < pageCount ? <span className="px-1 text-slate-500">…</span> : null}
                    <button
                      type="button"
                      className={`ui-tab ${ledgerPage === pageCount ? "cursor-not-allowed opacity-40" : ""}`}
                      onClick={() => setLedgerPage((current) => Math.min(pageCount, current + 1))}
                      disabled={ledgerPage === pageCount}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="px-3 py-8 text-center text-sm text-slate-400">当前筛选条件下没有账单。</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
