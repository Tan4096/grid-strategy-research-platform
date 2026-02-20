import { BacktestRequest, StrategyConfig } from "../../types";
import { RISK_FIELDS, inputClass, labelClass, renderNumericFields } from "./shared";

interface Props {
  request: BacktestRequest;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
}

export default function RiskSection({ request, updateStrategy }: Props) {
  return (
    <section className="space-y-3 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">风险控制</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {renderNumericFields(request, RISK_FIELDS, updateStrategy)}
        <div>
          <label className={labelClass()}>止损后重开</label>
          <select
            className={inputClass()}
            value={request.strategy.reopen_after_stop ? "true" : "false"}
            onChange={(e) => updateStrategy("reopen_after_stop", e.target.value === "true")}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-400">手续费率由交易所参数自动同步（Maker/Taker）。</p>
    </section>
  );
}
