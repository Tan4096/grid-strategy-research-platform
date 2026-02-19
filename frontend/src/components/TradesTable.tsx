import { TradeEvent } from "../types";

interface Props {
  trades: TradeEvent[];
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

export default function TradesTable({ trades }: Props) {
  if (!trades.length) {
    return (
      <div className="card p-4">
        <p className="text-sm text-slate-300">暂无成交记录</p>
      </div>
    );
  }

  return (
    <div className="card fade-up overflow-x-auto p-2">
      <table className="w-full min-w-[920px] border-collapse text-xs">
        <thead>
          <tr className="text-slate-300">
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
          {trades.slice(0, 300).map((trade, idx) => (
            <tr key={`${trade.open_time}-${idx}`} className="border-t border-slate-700/50 text-slate-100">
              <td className="px-2 py-2">{new Date(trade.open_time).toLocaleString()}</td>
              <td className="px-2 py-2">{new Date(trade.close_time).toLocaleString()}</td>
              <td className="px-2 py-2 uppercase">{trade.side}</td>
              <td className="mono px-2 py-2 text-right">{fmt(trade.entry_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(trade.exit_price, 2)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(trade.quantity, 5)}</td>
              <td
                className={`mono px-2 py-2 text-right ${
                  trade.net_pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {fmt(trade.net_pnl, 3)}
              </td>
              <td className="mono px-2 py-2 text-right">{fmt(trade.fee_paid, 3)}</td>
              <td className="mono px-2 py-2 text-right">{fmt(trade.holding_hours, 2)}</td>
              <td className="px-2 py-2">{trade.close_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
