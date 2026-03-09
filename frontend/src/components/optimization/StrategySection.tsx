import type { OptimizationConfig, OptimizationMode, OptimizationTarget } from "../../lib/api-schema";
import { inputClass, labelClass, SectionCard } from "./shared";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  open: boolean;
  onToggle: () => void;
  summary: string;
}

const TARGET_OPTIONS: Array<{ value: OptimizationTarget; label: string }> = [
  { value: "total_return", label: "最大总收益" },
  { value: "sharpe", label: "最大夏普比率" },
  { value: "min_drawdown", label: "最小最大回撤" },
  { value: "return_drawdown_ratio", label: "最大收益/回撤比" },
  { value: "custom", label: "自定义评分函数" }
];

const OPTIMIZATION_MODE_OPTIONS: Array<{ value: OptimizationMode; label: string }> = [
  { value: "random_pruned", label: "Random Pruned（推荐）" },
  { value: "bayesian", label: "Bayesian" },
  { value: "grid", label: "Grid Search" }
];

export default function StrategySection({ config, onChange, open, onToggle, summary }: Props) {
  const supportsPruning = config.optimization_mode !== "grid";
  const supportsBayesianOnly = config.optimization_mode === "bayesian";

  return (
    <SectionCard
      title="策略与目标"
      description="先选优化模式和目标；高级搜索参数可按需展开"
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-2">
        <div>
          <label className={labelClass()}>优化模式</label>
          <select
            className={inputClass()}
            value={config.optimization_mode}
            onChange={(e) => onChange({ ...config, optimization_mode: e.target.value as OptimizationMode })}
          >
            {OPTIMIZATION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass()}>优化目标</label>
          <select
            className={inputClass()}
            value={config.target}
            onChange={(e) => onChange({ ...config, target: e.target.value as OptimizationTarget })}
          >
            {TARGET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {config.target === "custom" && (
        <div className="mt-3">
          <label className={labelClass()}>自定义评分函数</label>
          <input
            className={inputClass()}
            type="text"
            value={config.custom_score_expr ?? ""}
            placeholder="例如 total_return_usdt / max(max_drawdown_pct, 1)"
            onChange={(e) => onChange({ ...config, custom_score_expr: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">
            可用变量: total_return_usdt, max_drawdown_pct, sharpe_ratio, win_rate, return_drawdown_ratio
          </p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.optimize_base_position}
            onChange={(e) => onChange({ ...config, optimize_base_position: e.target.checked })}
          />
          将开底仓纳入优化维度（True/False）
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.require_positive_return}
            onChange={(e) => onChange({ ...config, require_positive_return: e.target.checked })}
          />
          仅保留训练/验证都为正收益的组合
        </label>
      </div>

      <details className="mt-3 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-200">高级搜索参数</summary>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <div>
            <label className={labelClass()}>Warm-up 比例</label>
            <input
              className={inputClass()}
              type="number"
              min={0}
              max={0.9}
              step={0.05}
              value={config.warmup_ratio}
              disabled={!supportsBayesianOnly}
              onChange={(e) => onChange({ ...config, warmup_ratio: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={labelClass()}>剪枝检查步数</label>
            <input
              className={inputClass()}
              type="number"
              min={1}
              max={5}
              step={1}
              value={config.pruning_steps}
              disabled={!supportsPruning}
              onChange={(e) => onChange({ ...config, pruning_steps: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={labelClass()}>回撤剪枝阈值倍数</label>
            <input
              className={inputClass()}
              type="number"
              min={1}
              max={10}
              step={0.1}
              value={config.drawdown_prune_multiplier}
              disabled={!supportsPruning || !config.enable_early_pruning}
              onChange={(e) => onChange({ ...config, drawdown_prune_multiplier: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={labelClass()}>Top-K 精扫 K 值</label>
            <input
              className={inputClass()}
              type="number"
              min={1}
              max={20}
              step={1}
              value={config.topk_refine_k}
              disabled={!supportsBayesianOnly || !config.enable_topk_refine}
              onChange={(e) => onChange({ ...config, topk_refine_k: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={config.enable_early_pruning}
              disabled={!supportsPruning}
              onChange={(e) => onChange({ ...config, enable_early_pruning: e.target.checked })}
            />
            启用 Early Pruning
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={config.enable_profit_pruning}
              disabled={!supportsPruning || !config.enable_early_pruning}
              onChange={(e) => onChange({ ...config, enable_profit_pruning: e.target.checked })}
            />
            启用收益潜力剪枝
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={config.enable_topk_refine}
              disabled={!supportsBayesianOnly}
              onChange={(e) => onChange({ ...config, enable_topk_refine: e.target.checked })}
            />
            启用 Top-K 局部精扫
          </label>
        </div>
      </details>
    </SectionCard>
  );
}
