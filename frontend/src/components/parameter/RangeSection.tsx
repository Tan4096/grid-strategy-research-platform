import { BacktestRequest, GridSide, Interval, StrategyConfig } from "../../types";
import {
  INTERVAL_OPTIONS,
  RANGE_FIELDS,
  inputClass,
  labelClass,
  renderNumericFields
} from "./shared";

interface Props {
  request: BacktestRequest;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
  updateData: <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => void;
}

export default function RangeSection({ request, updateStrategy, updateData }: Props) {
  return (
    <section className="card-sub space-y-3 border border-slate-700/60 bg-slate-900/30 p-3" data-tour-id="range-section">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">区间设置</p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className={labelClass()}>方向</label>
          <select
            className={inputClass()}
            value={request.strategy.side}
            onChange={(e) => updateStrategy("side", e.target.value as GridSide)}
          >
            <option value="long">做多网格</option>
            <option value="short">做空网格</option>
          </select>
        </div>
        <div>
          <label className={labelClass()}>周期</label>
          <select
            className={inputClass()}
            value={request.data.interval}
            onChange={(e) => updateData("interval", e.target.value as Interval)}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {renderNumericFields(request, RANGE_FIELDS, updateStrategy)}
      </div>
    </section>
  );
}
