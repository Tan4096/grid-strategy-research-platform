import { useMemo, useState } from "react";
import { EventLog } from "../types";

interface Props {
  events: EventLog[];
}

const EVENT_TYPES = ["all", "open", "close", "stop_loss", "liquidation", "funding", "base_position_init", "snapshot"] as const;

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(4);
}

export default function BacktestEventsTimeline({ events }: Props) {
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>("all");
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const lowered = keyword.trim().toLowerCase();
    return events.filter((item) => {
      if (eventType !== "all" && item.event_type !== eventType) {
        return false;
      }
      if (!lowered) {
        return true;
      }
      return item.message.toLowerCase().includes(lowered) || item.event_type.toLowerCase().includes(lowered);
    });
  }, [events, eventType, keyword]);

  if (!events.length) {
    return (
      <div className="card p-4 text-sm text-slate-300">
        当前回测没有事件记录
      </div>
    );
  }

  return (
    <div className="card p-3">
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <label className="mb-1 block text-xs text-slate-400">事件类型</label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as (typeof EVENT_TYPES)[number])}
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
            className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
            type="text"
            value={keyword}
            placeholder="例如 stop_loss / funding / grid=3"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      <p className="mb-2 text-xs text-slate-400">共 {filtered.length} 条事件</p>
      <div className="max-h-[420px] overflow-auto rounded border border-slate-700/60">
        <table className="w-full min-w-[720px] border-collapse text-xs">
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
    </div>
  );
}
