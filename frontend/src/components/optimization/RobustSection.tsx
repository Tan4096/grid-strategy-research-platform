import { OptimizationConfig } from "../../types";
import { inputClass, labelClass, numberOrNull, SectionCard } from "./shared";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  open: boolean;
  onToggle: () => void;
  summary: string;
}

export default function RobustSection({ config, onChange, open, onToggle, summary }: Props) {
  return (
    <SectionCard
      title="稳健性与风控"
      description="限制回撤、交易数并进行 Walk-forward 验证"
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <div>
          <label className={labelClass()}>最小平仓交易数</label>
          <input
            className={inputClass()}
            type="number"
            min={0}
            step={1}
            value={config.min_closed_trades}
            onChange={(e) => onChange({ ...config, min_closed_trades: Number(e.target.value) })}
          />
        </div>

        <div>
          <label className={labelClass()}>最大回撤上限(%)</label>
          <input
            className={inputClass()}
            type="number"
            min={0}
            step={0.1}
            placeholder="为空则不限制"
            value={config.max_drawdown_pct_limit ?? ""}
            onChange={(e) => onChange({ ...config, max_drawdown_pct_limit: numberOrNull(e.target.value) })}
          />
        </div>

        <div>
          <label className={labelClass()}>验证集权重</label>
          <input
            className={inputClass()}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={config.robust_validation_weight}
            onChange={(e) => onChange({ ...config, robust_validation_weight: Number(e.target.value) })}
          />
        </div>

        <div>
          <label className={labelClass()}>过拟合惩罚系数</label>
          <input
            className={inputClass()}
            type="number"
            min={0}
            max={10}
            step={0.05}
            value={config.robust_gap_penalty}
            onChange={(e) => onChange({ ...config, robust_gap_penalty: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.walk_forward_enabled}
            onChange={(e) => onChange({ ...config, walk_forward_enabled: e.target.checked })}
          />
          启用 Walk-forward（训练期 / 验证期）
        </label>

        <div>
          <label className={labelClass()}>训练集比例</label>
          <input
            className={inputClass()}
            type="number"
            min={0.1}
            max={0.9}
            step={0.05}
            value={config.train_ratio}
            disabled={!config.walk_forward_enabled}
            onChange={(e) => onChange({ ...config, train_ratio: Number(e.target.value) })}
          />
        </div>
      </div>
    </SectionCard>
  );
}
