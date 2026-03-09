import type { BacktestRequest, StrategyConfig } from "../../lib/api-schema";
import { POSITION_FIELDS, labelClass, renderNumericFields } from "./shared";

interface Props {
  request: BacktestRequest;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
}

interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  cardClass: string;
  checkboxClass: string;
}

function ToggleField({ label, checked, onChange, cardClass, checkboxClass }: ToggleFieldProps) {
  return (
    <div>
      <label className={labelClass()}>{label}</label>
      <label className={cardClass}>
        <input
          className={checkboxClass}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="leading-none">启用</span>
      </label>
    </div>
  );
}

export default function PositionSection({ request, updateStrategy }: Props) {
  const toggleCardClass =
    "card-sub grid h-[44px] w-full grid-cols-[16px_1fr] items-center gap-2 border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200";
  const checkboxClass = "m-0 h-4 w-4 shrink-0 align-middle";

  return (
    <section className="card-sub space-y-3 border border-slate-700/60 bg-slate-900/30 p-3" data-tour-id="position-section">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">仓位控制</p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {renderNumericFields(request, POSITION_FIELDS, updateStrategy)}
        <ToggleField
          label="开底仓"
          checked={request.strategy.use_base_position}
          onChange={(checked) => updateStrategy("use_base_position", checked)}
          cardClass={toggleCardClass}
          checkboxClass={checkboxClass}
        />
        <ToggleField
          label="严格风控"
          checked={request.strategy.strict_risk_control}
          onChange={(checked) => updateStrategy("strict_risk_control", checked)}
          cardClass={toggleCardClass}
          checkboxClass={checkboxClass}
        />
      </div>
    </section>
  );
}
