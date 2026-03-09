import { useEffect, useMemo, useState } from "react";
import { usePersistedSortOrder } from "../hooks/usePersistedSortOrder";
import { readPlain, STORAGE_KEYS, writePlain } from "../lib/storage";
import SortOrderSwitch from "./SortOrderSwitch";
import { EventLog, SortOrder } from "../types";

interface Props {
  events: EventLog[];
}

const EVENT_TYPES = ["all", "order_placed", "open", "close", "stop_loss", "liquidation", "funding", "base_position_init", "snapshot"] as const;
type EventTypeFilter = (typeof EVENT_TYPES)[number];

interface PersistedEventFilters {
  eventType: EventTypeFilter;
  keyword: string;
}

function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 767px)").matches;
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(4);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortEvents(events: EventLog[], sortOrder: SortOrder): EventLog[] {
  const direction = sortOrder === "desc" ? -1 : 1;
  return [...events].sort((left, right) => (toTimestamp(left.timestamp) - toTimestamp(right.timestamp)) * direction);
}

function normalizeEventFilters(raw: unknown): PersistedEventFilters | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<PersistedEventFilters>;
  if (!EVENT_TYPES.includes(value.eventType as EventTypeFilter)) {
    return null;
  }
  if (typeof value.keyword !== "string") {
    return null;
  }
  return {
    eventType: value.eventType as EventTypeFilter,
    keyword: value.keyword
  };
}

function readPersistedEventFilters(): PersistedEventFilters | null {
  if (typeof window === "undefined") {
    return null;
  }
  return readPlain(STORAGE_KEYS.backtestEventsFilters, normalizeEventFilters);
}

export default function BacktestEventsTimeline({ events }: Props) {
  const [mobileCards, setMobileCards] = useState<boolean>(() => isMobileViewport());
  const [eventType, setEventType] = useState<EventTypeFilter>(() => readPersistedEventFilters()?.eventType ?? "all");
  const [keyword, setKeyword] = useState(() => readPersistedEventFilters()?.keyword ?? "");
  const [sortOrder, setSortOrder] = usePersistedSortOrder(
    STORAGE_KEYS.backtestRecordSortOrder,
    "desc",
    [STORAGE_KEYS.backtestTradesSortOrder, STORAGE_KEYS.backtestEventsSortOrder]
  );

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
    writePlain(STORAGE_KEYS.backtestEventsFilters, {
      eventType,
      keyword
    });
  }, [eventType, keyword]);

  const filtered = useMemo(() => {
    const lowered = keyword.trim().toLowerCase();
    const matched = events.filter((item) => {
      if (eventType !== "all" && item.event_type !== eventType) {
        return false;
      }
      if (!lowered) {
        return true;
      }
      return item.message.toLowerCase().includes(lowered) || item.event_type.toLowerCase().includes(lowered);
    });
    return sortEvents(matched, sortOrder);
  }, [events, eventType, keyword, sortOrder]);

  if (!events.length) {
    return (
      <div className="card p-4 text-sm text-slate-300">
        当前回测没有事件记录
      </div>
    );
  }

  return (
    <div className="card p-3">
      <div className="mobile-two-col-grid mb-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <label className="mb-1 block text-xs text-slate-400">事件类型</label>
          <select
            className="ui-input"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventTypeFilter)}
          >
            {EVENT_TYPES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">关键词过滤</label>
          <input
            className="ui-input"
            type="text"
            value={keyword}
            placeholder="例如 stop_loss / funding / grid=3"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <p>共 {filtered.length} 条事件</p>
        <SortOrderSwitch value={sortOrder} onChange={setSortOrder} />
      </div>
      {mobileCards ? (
        <div className="mobile-two-col-grid form-scroll is-scrolling max-h-[62vh] grid grid-cols-1 gap-2 overflow-auto pr-1">
          {filtered.map((event, idx) => (
            <div key={`${event.timestamp}-${event.event_type}-${idx}`} className="card-sub space-y-1.5 p-2 text-xs text-slate-200">
              <div className="flex items-center justify-between gap-2">
                <p className="mono text-slate-100">{new Date(event.timestamp).toLocaleString()}</p>
                <p className="mono text-[11px] text-slate-300">{event.event_type}</p>
              </div>
              <p className="text-[11px] text-slate-300">价格：{fmtPrice(event.price)}</p>
              <p className="text-[11px] text-slate-400 break-words">{event.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-slate-400 sm:hidden">可左右滑动查看完整列</p>
          <div className="form-scroll is-scrolling max-h-[420px] overflow-auto rounded border border-slate-700/60">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
                <tr>
                  <th className="px-2 py-2 text-left">时间</th>
                  <th className="px-2 py-2 text-left">类型</th>
                  <th className="px-2 py-2 text-right">价格</th>
                  <th className="px-2 py-2 text-left">消息</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event, idx) => (
                  <tr key={`${event.timestamp}-${event.event_type}-${idx}`} className="border-t border-slate-700/50 text-slate-100">
                    <td className="px-2 py-2">{new Date(event.timestamp).toLocaleString()}</td>
                    <td className="px-2 py-2">{event.event_type}</td>
                    <td className="mono px-2 py-2 text-right">{fmtPrice(event.price)}</td>
                    <td className="px-2 py-2 text-slate-300">{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
