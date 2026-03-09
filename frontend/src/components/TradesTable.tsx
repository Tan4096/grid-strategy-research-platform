import { useEffect, useMemo, useState } from "react";
import { usePersistedSortOrder } from "../hooks/usePersistedSortOrder";
import { readPlain, STORAGE_KEYS, writePlain } from "../lib/storage";
import SortOrderSwitch from "./SortOrderSwitch";
import type { EventLog, SortOrder, TradeEvent } from "../lib/api-schema";

type ViewMode = "fills" | "closed";

function normalizeViewMode(raw: unknown): ViewMode | null {
  if (raw === "fills" || raw === "closed") {
    return raw;
  }
  return null;
}

type FillRecord = {
  timestamp: string;
  type: "open" | "close";
  side: string;
  price: number;
  quantity: number | null;
  gridIndex: number | null;
  isBasePosition: boolean;
  closeReason: string | null;
  netPnl: number | null;
};

interface Props {
  trades: TradeEvent[];
  events: EventLog[];
}

function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 767px)").matches;
}

function fmt(n: number | null | undefined, digits = 2): string {
  return Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : "-";
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByTimestamp<T>(items: T[], getTimestamp: (item: T) => string, sortOrder: SortOrder): T[] {
  const direction = sortOrder === "desc" ? -1 : 1;
  return [...items].sort((left, right) => (toTimestamp(getTimestamp(left)) - toTimestamp(getTimestamp(right))) * direction);
}

function extractGridIndex(event: EventLog): number | null {
  const payloadValue = Number(event.payload?.grid_index);
  if (Number.isFinite(payloadValue)) {
    return payloadValue;
  }
  const match = event.message.match(/grid=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function buildFillRecords(events: EventLog[]): FillRecord[] {
  return events
    .filter((event) => event.event_type === "open" || event.event_type === "close")
    .map((event) => ({
      timestamp: event.timestamp,
      type: event.event_type === "open" ? "open" : "close",
      side: event.event_type === "open" ? "OPEN" : "CLOSE",
      price: Number(event.price),
      quantity: Number.isFinite(Number(event.payload?.quantity)) ? Number(event.payload?.quantity) : null,
      gridIndex: extractGridIndex(event),
      isBasePosition: Boolean(event.payload?.as_base_position),
      closeReason: typeof event.payload?.close_reason === "string" ? String(event.payload?.close_reason) : null,
      netPnl: Number.isFinite(Number(event.payload?.net_pnl)) ? Number(event.payload?.net_pnl) : null
    }));
}

function ViewSwitch({ mode, onChange }: { mode: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <div className="ui-tab-group" style={{ width: "auto" }} aria-label="成交视图切换">
      <button
        type="button"
        className={`ui-tab ${mode === "fills" ? "is-active" : ""}`}
        onClick={() => onChange("fills")}
      >
        成交明细
      </button>
      <button
        type="button"
        className={`ui-tab ${mode === "closed" ? "is-active" : ""}`}
        onClick={() => onChange("closed")}
      >
        闭合交易
      </button>
    </div>
  );
}

export default function TradesTable({ trades, events }: Props) {
  const [mobileCards, setMobileCards] = useState<boolean>(() => isMobileViewport());
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") {
      return "fills";
    }
    return readPlain(STORAGE_KEYS.backtestTradesViewMode, normalizeViewMode) ?? "fills";
  });
  const [sortOrder, setSortOrder] = usePersistedSortOrder(
    STORAGE_KEYS.backtestRecordSortOrder,
    "desc",
    [STORAGE_KEYS.backtestTradesSortOrder, STORAGE_KEYS.backtestEventsSortOrder]
  );

  const fillRecords = useMemo(() => sortByTimestamp(buildFillRecords(events), (item) => item.timestamp, sortOrder), [events, sortOrder]);
  const closedTrades = useMemo(() => sortByTimestamp(trades, (item) => item.close_time, sortOrder), [trades, sortOrder]);
  const rows = mode === "fills" ? fillRecords : closedTrades;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(max-width: 767px)");
    const sync = (matches: boolean) => setMobileCards(matches);
    sync(media.matches);
    const handler = (event: MediaQueryListEvent) => sync(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.onchange = handler;
    return () => {
      media.onchange = null;
    };
  }, []);

  useEffect(() => {
    writePlain(STORAGE_KEYS.backtestTradesViewMode, mode);
  }, [mode]);

  useEffect(() => {
    setPage(1);
  }, [mobileCards, mode, sortOrder, rows.length]);

  if (!fillRecords.length && !closedTrades.length) {
    return (
      <div className="card p-4">
        <p className="text-sm text-slate-300">暂无成交记录</p>
      </div>
    );
  }

  const pageSize = mobileCards ? 20 : 30;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);

  if (mobileCards) {
    return (
      <div className="card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitch mode={mode} onChange={setMode} />
            <SortOrderSwitch value={sortOrder} onChange={setSortOrder} />
          </div>
          <span>
            第 {safePage}/{totalPages} 页 · 共 {rows.length} 条
          </span>
        </div>
        <div className="mobile-two-col-grid form-scroll is-scrolling max-h-[62vh] grid grid-cols-1 gap-2 overflow-auto pr-1">
          {mode === "fills"
            ? (pagedRows as FillRecord[]).map((row, idx) => (
                <div key={`${row.timestamp}-${row.type}-${pageStart + idx}`} className="card-sub space-y-1.5 p-2 text-xs text-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="mono text-slate-100">{new Date(row.timestamp).toLocaleString()}</p>
                    <p className={`mono font-semibold ${row.type === "open" ? "text-sky-300" : "text-amber-300"}`}>
                      {row.type === "open" ? "OPEN" : "CLOSE"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-300">
                    <p>网格：{row.gridIndex ?? "-"}</p>
                    <p>价格：{fmt(row.price, 2)}</p>
                    <p>数量：{fmt(row.quantity, 5)}</p>
                    <p>底仓：{row.isBasePosition ? "是" : "否"}</p>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {row.type === "close" ? `原因：${row.closeReason ?? "-"} / 净收益：${fmt(row.netPnl, 3)}` : "类型：开仓成交"}
                  </p>
                </div>
              ))
            : (pagedRows as TradeEvent[]).map((trade, idx) => (
                <div key={`${trade.open_time}-${pageStart + idx}`} className="card-sub space-y-1.5 p-2 text-xs text-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="mono text-slate-100">{new Date(trade.open_time).toLocaleString()}</p>
                    <p className={`mono font-semibold ${trade.net_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {fmt(trade.net_pnl, 3)}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-300">
                    <p>方向：{trade.side.toUpperCase()}</p>
                    <p>持仓：{fmt(trade.holding_hours, 2)} h</p>
                    <p>开仓：{fmt(trade.entry_price, 2)}</p>
                    <p>平仓：{fmt(trade.exit_price, 2)}</p>
                    <p>数量：{fmt(trade.quantity, 5)}</p>
                    <p>手续费：{fmt(trade.fee_paid, 3)}</p>
                  </div>
                  <p className="text-[11px] text-slate-400">原因：{trade.close_reason}</p>
                </div>
              ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
            disabled={safePage <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            上一页
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
            disabled={safePage >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch mode={mode} onChange={setMode} />
          <SortOrderSwitch value={sortOrder} onChange={setSortOrder} />
        </div>
        <span>
          第 {safePage}/{totalPages} 页 · 共 {rows.length} 条
        </span>
      </div>
      <p className="mb-2 text-[11px] text-slate-400 sm:hidden">可左右滑动查看完整列</p>
      <div className="form-scroll is-scrolling max-h-[420px] overflow-auto rounded border border-slate-700/60">
        {mode === "fills" ? (
          <table className="w-full min-w-[780px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left">时间</th>
                <th className="px-2 py-2 text-left">类型</th>
                <th className="px-2 py-2 text-right">网格</th>
                <th className="px-2 py-2 text-right">价格</th>
                <th className="px-2 py-2 text-right">数量</th>
                <th className="px-2 py-2 text-center">底仓</th>
                <th className="px-2 py-2 text-right">净收益</th>
                <th className="px-2 py-2 text-left">原因</th>
              </tr>
            </thead>
            <tbody>
              {(pagedRows as FillRecord[]).map((row, idx) => (
                <tr key={`${row.timestamp}-${row.type}-${pageStart + idx}`} className="border-t border-slate-700/50 text-slate-100">
                  <td className="px-2 py-2">{new Date(row.timestamp).toLocaleString()}</td>
                  <td className={`px-2 py-2 ${row.type === "open" ? "text-sky-300" : "text-amber-300"}`}>
                    {row.type === "open" ? "OPEN" : "CLOSE"}
                  </td>
                  <td className="mono px-2 py-2 text-right">{row.gridIndex ?? "-"}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(row.price, 2)}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(row.quantity, 5)}</td>
                  <td className="px-2 py-2 text-center">{row.isBasePosition ? "是" : "否"}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(row.netPnl, 3)}</td>
                  <td className="px-2 py-2 text-slate-300">{row.closeReason ?? (row.type === "open" ? "开仓成交" : "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[780px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left">开仓时间</th>
                <th className="px-2 py-2 text-left">平仓时间</th>
                <th className="px-2 py-2 text-left">方向</th>
                <th className="px-2 py-2 text-right">开仓价</th>
                <th className="px-2 py-2 text-right">平仓价</th>
                <th className="px-2 py-2 text-right">数量</th>
                <th className="px-2 py-2 text-right">净收益</th>
                <th className="px-2 py-2 text-right">手续费</th>
                <th className="px-2 py-2 text-right">持仓(h)</th>
                <th className="px-2 py-2 text-left">原因</th>
              </tr>
            </thead>
            <tbody>
              {(pagedRows as TradeEvent[]).map((trade, idx) => (
                <tr key={`${trade.open_time}-${pageStart + idx}`} className="border-t border-slate-700/50 text-slate-100">
                  <td className="px-2 py-2">{new Date(trade.open_time).toLocaleString()}</td>
                  <td className="px-2 py-2">{new Date(trade.close_time).toLocaleString()}</td>
                  <td className="px-2 py-2 uppercase">{trade.side}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(trade.entry_price, 2)}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(trade.exit_price, 2)}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(trade.quantity, 5)}</td>
                  <td className={`mono px-2 py-2 text-right ${trade.net_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmt(trade.net_pnl, 3)}
                  </td>
                  <td className="mono px-2 py-2 text-right">{fmt(trade.fee_paid, 3)}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(trade.holding_hours, 2)}</td>
                  <td className="px-2 py-2 text-slate-300">{trade.close_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
          disabled={safePage <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          上一页
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-40"
          disabled={safePage >= totalPages}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
