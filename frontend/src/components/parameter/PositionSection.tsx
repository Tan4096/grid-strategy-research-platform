import { BacktestRequest, StrategyConfig } from "../../types";
import { POSITION_FIELDS, labelClass, renderNumericFields } from "./shared";

interface Props {
  request: BacktestRequest;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
}

export default function PositionSection({ request, updateStrategy }: Props) {
  return (
    <section className="space-y-3 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">仓位控制</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {renderNumericFields(request, POSITION_FIELDS, updateStrategy)}
        <div>
          <label className={labelClass()}>开底仓</label>
          <label className="flex h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={request.strategy.use_base_position}
              onChange={(e) => updateStrategy("use_base_position", e.target.checked)}
            />
            启用
          </label>
        </div>
      </div>
    </section>
  );
}
