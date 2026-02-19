import { ReactNode, useState } from "react";
import { AnchorMode, OptimizationConfig, OptimizationMode, OptimizationTarget, SweepRange } from "../types";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  onStart: () => void;
  running: boolean;
}

type SweepKey = "leverage" | "grids" | "band_width_pct" | "stop_loss_ratio_pct";
type ComputeMode = "fast" | "balanced" | "eco";

function labelClass() {
  return "mb-1 block text-xs uppercase tracking-wide text-slate-400";
}

function inputClass() {
  return "w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400";
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sweepTitle(key: SweepKey): string {
  const mapping: Record<SweepKey, string> = {
    leverage: "杠杆",
    grids: "网格数",
    band_width_pct: "区间宽度(%)",
    stop_loss_ratio_pct: "止损比例(%)"
  };
  return mapping[key];
}

function hardwareWorkers(): number {
  const hardware = typeof navigator !== "undefined" ? Number(navigator.hardwareConcurrency || 0) : 0;
  if (!Number.isFinite(hardware) || hardware <= 0) {
    return 4;
  }
  return Math.max(1, Math.min(64, Math.floor(hardware)));
}

function modePreset(mode: ComputeMode): { max_workers: number; batch_size: number; chunk_size: number } {
  const workers = hardwareWorkers();
  if (mode === "fast") {
    return {
      max_workers: workers,
      batch_size: 800,
      chunk_size: 128
    };
  }
  if (mode === "eco") {
    return {
      max_workers: Math.max(1, Math.floor(workers * 0.35)),
      batch_size: 200,
      chunk_size: 32
    };
  }
  return {
    max_workers: Math.max(1, Math.floor(workers * 0.7)),
    batch_size: 400,
    chunk_size: 64
  };
}

function activeMode(config: OptimizationConfig): ComputeMode | null {
  const fast = modePreset("fast");
  const balanced = modePreset("balanced");
  const eco = modePreset("eco");

  if (
    config.max_workers === fast.max_workers &&
    config.batch_size === fast.batch_size &&
    config.chunk_size === fast.chunk_size
  ) {
    return "fast";
  }
  if (
    config.max_workers === balanced.max_workers &&
    config.batch_size === balanced.batch_size &&
    config.chunk_size === balanced.chunk_size
  ) {
    return "balanced";
  }
  if (
    config.max_workers === eco.max_workers &&
    config.batch_size === eco.batch_size &&
    config.chunk_size === eco.chunk_size
  ) {
    return "eco";
  }
  return null;
}

function estimateSweepCount(sweep: SweepRange): number {
  if (!sweep.enabled) {
    return 1;
  }
  if (sweep.values && sweep.values.length > 0) {
    return sweep.values.length;
  }
  if (sweep.start === null || sweep.end === null || sweep.step === null) {
    return 0;
  }
  if (sweep.step <= 0 || sweep.end < sweep.start) {
    return 0;
  }
  const count = Math.floor((sweep.end - sweep.start) / sweep.step + 1e-9) + 1;
  return Math.max(count, 0);
}

function SectionCard({
  title,
  description,
  children,
  right,
  collapsible = false,
  open = true,
  onToggle,
  summary
}: {
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  summary?: string;
}) {
  return (
    <section className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
      <div className={`flex flex-wrap items-start justify-between gap-2 ${open ? "mb-3" : ""}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left transition hover:text-slate-50"
            aria-expanded={open}
          >
            <span className={`text-[10px] text-slate-400 transition ${open ? "rotate-90" : ""}`}>▶</span>
            <div>
              <p className="text-sm font-semibold text-slate-200">{title}</p>
              {description ? <p className="mt-1 text-xs text-slate-400">{description}</p> : null}
            </div>
          </button>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-200">{title}</p>
            {description ? <p className="mt-1 text-xs text-slate-400">{description}</p> : null}
          </div>
        )}
        {right}
      </div>
      {!open && summary ? <p className="rounded border border-slate-700/50 bg-slate-950/40 px-2 py-1 text-xs text-slate-300">{summary}</p> : null}
      {open ? children : null}
    </section>
  );
}

function SweepEditor({
  title,
  sweep,
  onChange,
  integerStep = false
}: {
  title: string;
  sweep: SweepRange;
  onChange: (next: SweepRange) => void;
  integerStep?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={sweep.enabled}
            onChange={(e) =>
              onChange({
                ...sweep,
                enabled: e.target.checked
              })
            }
          />
          启用
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          className={inputClass()}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="开始"
          value={sweep.start ?? ""}
          onChange={(e) => onChange({ ...sweep, start: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
        <input
          className={inputClass()}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="结束"
          value={sweep.end ?? ""}
          onChange={(e) => onChange({ ...sweep, end: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
        <input
          className={inputClass()}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="步长"
          value={sweep.step ?? ""}
          onChange={(e) => onChange({ ...sweep, step: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
      </div>
    </div>
  );
}

const TARGET_OPTIONS: Array<{ value: OptimizationTarget; label: string }> = [
  { value: "total_return", label: "最大总收益" },
  { value: "sharpe", label: "最大夏普比率" },
  { value: "min_drawdown", label: "最小最大回撤" },
  { value: "return_drawdown_ratio", label: "最大收益/回撤比" },
  { value: "custom", label: "自定义评分函数" }
];

const ANCHOR_OPTIONS: Array<{ value: AnchorMode; label: string }> = [
  { value: "BACKTEST_START_PRICE", label: "回测起始收盘价" },
  { value: "BACKTEST_AVG_PRICE", label: "回测区间均价" },
  { value: "CURRENT_PRICE", label: "当前价格（数据末端）" },
  { value: "CUSTOM_PRICE", label: "自定义价格" }
];

const OPTIMIZATION_MODE_OPTIONS: Array<{ value: OptimizationMode; label: string }> = [
  { value: "random_pruned", label: "Random Pruned（推荐）" },
  { value: "bayesian", label: "Bayesian" },
  { value: "grid", label: "Grid Search" }
];

function ScanSection({
  config,
  onChange,
  exceedsMax,
  shouldAutoSample,
  sampledCombinations,
  estimatedCombinations,
  usesTrialBudget,
  open,
  onToggle,
  summary
}: {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  exceedsMax: boolean;
  shouldAutoSample: boolean;
  sampledCombinations: number;
  estimatedCombinations: number;
  usesTrialBudget: boolean;
  open: boolean;
  onToggle: () => void;
  summary: string;
}) {
  const updateSweep = (key: SweepKey, next: SweepRange) => {
    onChange({
      ...config,
      [key]: next
    });
  };

  return (
    <SectionCard
      title="扫描维度"
      description={
        config.optimization_mode === "random_pruned"
          ? "定义参数空间，系统会执行 Random Search + Early Pruning"
          : config.optimization_mode === "bayesian"
          ? "定义参数空间，系统会做随机预热 + Bayesian 搜索"
          : "选择要扫描的参数与范围"
      }
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
      right={
        <div className="rounded border border-slate-700/60 bg-slate-950/50 px-2 py-1 text-right">
          <p className="text-[11px] text-slate-400">{usesTrialBudget ? "参数空间" : "预计组合"}</p>
          <p className="mono text-xs font-semibold text-slate-100">{estimatedCombinations}</p>
          <p className="text-[11px] text-slate-500">{usesTrialBudget ? "试验预算" : "执行"}: {sampledCombinations}</p>
        </div>
      }
    >
      {!usesTrialBudget && exceedsMax && shouldAutoSample && <p className="text-xs text-amber-300">超出上限，后端将自动抽样执行</p>}
      {!usesTrialBudget && exceedsMax && !shouldAutoSample && <p className="text-xs text-rose-300">超出上限，请缩小范围或开启自动抽样</p>}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SweepEditor
          title={sweepTitle("leverage")}
          sweep={config.leverage}
          onChange={(next) => updateSweep("leverage", next)}
        />
        <SweepEditor
          title={sweepTitle("grids")}
          sweep={config.grids}
          onChange={(next) => updateSweep("grids", next)}
          integerStep
        />
        <SweepEditor
          title={sweepTitle("band_width_pct")}
          sweep={config.band_width_pct}
          onChange={(next) => updateSweep("band_width_pct", next)}
        />
        <SweepEditor
          title={sweepTitle("stop_loss_ratio_pct")}
          sweep={config.stop_loss_ratio_pct}
          onChange={(next) => updateSweep("stop_loss_ratio_pct", next)}
        />
      </div>
    </SectionCard>
  );
}

function StrategySection({
  config,
  onChange,
  open,
  onToggle,
  summary
}: {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  open: boolean;
  onToggle: () => void;
  summary: string;
}) {
  const customAnchorRequired = config.anchor_mode === "CUSTOM_PRICE";
  const supportsPruning = config.optimization_mode !== "grid";
  const supportsBayesianOnly = config.optimization_mode === "bayesian";

  return (
    <SectionCard
      title="策略、目标与搜索策略"
      description={
        config.optimization_mode === "random_pruned"
          ? "Anchor、优化目标 + Random Search + Early Pruning"
          : config.optimization_mode === "bayesian"
          ? "Anchor、优化目标 + Random Warm-up / Bayesian / Pruning / Top-K"
          : "Anchor、优化目标 + Grid 搜索设置"
      }
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
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
          <label className={labelClass()}>Anchor 价格基准</label>
          <select
            className={inputClass()}
            value={config.anchor_mode}
            onChange={(e) => onChange({ ...config, anchor_mode: e.target.value as AnchorMode })}
          >
            {ANCHOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass()}>自定义 Anchor 价格</label>
          <input
            className={inputClass()}
            type="number"
            step={0.01}
            min={0}
            value={config.custom_anchor_price ?? ""}
            disabled={!customAnchorRequired}
            placeholder={customAnchorRequired ? "请输入价格" : "仅 CUSTOM_PRICE 生效"}
            onChange={(e) => onChange({ ...config, custom_anchor_price: numberOrNull(e.target.value) })}
          />
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.enable_early_pruning}
            disabled={!supportsPruning}
            onChange={(e) => onChange({ ...config, enable_early_pruning: e.target.checked })}
          />
          启用 Early Pruning
        </label>
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
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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

      {config.target === "custom" && (
        <div>
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
    </SectionCard>
  );
}

function RobustSection({
  config,
  onChange,
  open,
  onToggle,
  summary
}: {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  open: boolean;
  onToggle: () => void;
  summary: string;
}) {
  return (
    <SectionCard
      title="稳健性与风控"
      description="限制回撤、交易数并进行 Walk-forward 验证"
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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

function ComputeSection({
  config,
  onChange,
  shouldBlockStart,
  invalidSweep,
  usesTrialBudget,
  trialBudgetInvalid,
  open,
  onToggle,
  summary
}: {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  shouldBlockStart: boolean;
  invalidSweep: boolean;
  usesTrialBudget: boolean;
  trialBudgetInvalid: boolean;
  open: boolean;
  onToggle: () => void;
  summary: string;
}) {
  const selectedMode = activeMode(config);

  const handleApplyMode = (mode: ComputeMode) => {
    const preset = modePreset(mode);
    onChange({
      ...config,
      max_workers: preset.max_workers,
      batch_size: preset.batch_size,
      chunk_size: preset.chunk_size,
      auto_limit_combinations: true
    });
  };

  return (
    <SectionCard
      title="计算资源"
      description="控制组合上限、并行度与超限策略"
      collapsible
      open={open}
      onToggle={onToggle}
      summary={summary}
    >
      <div className="mb-3 grid grid-cols-3 gap-2">
        <button
          className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
            selectedMode === "fast"
              ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
              : "border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800/60"
          }`}
          type="button"
          onClick={() => handleApplyMode("fast")}
        >
          极速
        </button>
        <button
          className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
            selectedMode === "balanced"
              ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-100"
              : "border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800/60"
          }`}
          type="button"
          onClick={() => handleApplyMode("balanced")}
        >
          均衡
        </button>
        <button
          className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
            selectedMode === "eco"
              ? "border-amber-400/70 bg-amber-500/20 text-amber-100"
              : "border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800/60"
          }`}
          type="button"
          onClick={() => handleApplyMode("eco")}
        >
          省电
        </button>
      </div>

      <div className="mb-3 rounded-md border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
        当前调度: 进程 {config.max_workers} / 批大小 {config.batch_size} / Chunk {config.chunk_size}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div>
          <label className={labelClass()}>{usesTrialBudget ? "最大试验数" : "最大组合数"}</label>
          <input
            className={inputClass()}
            type="number"
            min={1}
            max={200000}
            value={usesTrialBudget ? config.max_trials : config.max_combinations}
            onChange={(e) =>
              onChange({
                ...config,
                ...(usesTrialBudget ? { max_trials: Number(e.target.value) } : { max_combinations: Number(e.target.value) })
              })
            }
          />
        </div>
        {!usesTrialBudget && (
          <label className="mt-6 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={config.auto_limit_combinations}
              onChange={(e) => onChange({ ...config, auto_limit_combinations: e.target.checked })}
            />
            超限自动抽样（推荐）
          </label>
        )}
      </div>

      {shouldBlockStart && (
        <p className="text-xs text-rose-300">
          {invalidSweep
            ? "扫描范围配置无效，请检查开始/结束/步长。"
            : trialBudgetInvalid
            ? "试验数配置无效，请将“最大试验数”设置为大于 0。"
            : "预计组合超过上限，请缩小范围或开启“超限自动抽样”。"}
        </p>
      )}
    </SectionCard>
  );
}

export default function OptimizationControls({ config, onChange, onStart, running }: Props) {
  const [sectionsOpen, setSectionsOpen] = useState({
    scan: true,
    strategy: true,
    robust: false,
    compute: true
  });
  const usesTrialBudget = config.optimization_mode !== "grid";
  const leverageCount = estimateSweepCount(config.leverage);
  const gridsCount = estimateSweepCount(config.grids);
  const widthCount = estimateSweepCount(config.band_width_pct);
  const stopCount = estimateSweepCount(config.stop_loss_ratio_pct);
  const basePositionCount = config.optimize_base_position ? 2 : 1;

  const estimatedCombinations = leverageCount * gridsCount * widthCount * stopCount * basePositionCount;
  const invalidSweep = estimatedCombinations <= 0;
  const exceedsMax = !usesTrialBudget && estimatedCombinations > config.max_combinations;
  const shouldAutoSample = config.auto_limit_combinations;
  const trialBudgetInvalid = usesTrialBudget && (!Number.isFinite(config.max_trials) || config.max_trials < 1);
  const sampledCombinations = usesTrialBudget
    ? Math.max(1, Number(config.max_trials || 0))
    : exceedsMax && shouldAutoSample
    ? config.max_combinations
    : estimatedCombinations;
  const shouldBlockStart = invalidSweep || trialBudgetInvalid || (!usesTrialBudget && exceedsMax && !shouldAutoSample);
  const modeName =
    config.optimization_mode === "random_pruned"
      ? "Random Pruned"
      : config.optimization_mode === "bayesian"
      ? "Bayesian"
      : "Grid";
  const scanSummary = `${estimatedCombinations} 空间 · ${sampledCombinations} ${usesTrialBudget ? "试验预算" : "执行组合"}`;
  const strategySummary = `${modeName} · 目标 ${config.target} · Anchor ${config.anchor_mode}`;
  const robustSummary = `${config.walk_forward_enabled ? "Walk-forward 开启" : "Walk-forward 关闭"} · 最小交易 ${config.min_closed_trades}`;
  const computeSummary = `${config.max_workers} 进程 / 批 ${config.batch_size} / Chunk ${config.chunk_size}`;
  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="card fade-up space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-100">参数优化模块</h2>
        <p className="mt-1 text-xs text-slate-400">
          {config.optimization_mode === "random_pruned"
            ? "Random Search + Early Pruning + Walk-forward"
            : config.optimization_mode === "bayesian"
            ? "Random Warm-up + Bayesian + Early Pruning + Walk-forward"
            : "Grid Search + 并行计算 + Walk-forward"}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">点击区块标题可折叠，先调扫描维度与计算资源，再看高级项。</p>
      </div>

      <ScanSection
        config={config}
        onChange={onChange}
        exceedsMax={exceedsMax}
        shouldAutoSample={shouldAutoSample}
        sampledCombinations={sampledCombinations}
        estimatedCombinations={estimatedCombinations}
        usesTrialBudget={usesTrialBudget}
        open={sectionsOpen.scan}
        onToggle={() => toggleSection("scan")}
        summary={scanSummary}
      />

      <StrategySection
        config={config}
        onChange={onChange}
        open={sectionsOpen.strategy}
        onToggle={() => toggleSection("strategy")}
        summary={strategySummary}
      />

      <RobustSection
        config={config}
        onChange={onChange}
        open={sectionsOpen.robust}
        onToggle={() => toggleSection("robust")}
        summary={robustSummary}
      />

      <ComputeSection
        config={config}
        onChange={onChange}
        shouldBlockStart={shouldBlockStart}
        invalidSweep={invalidSweep}
        usesTrialBudget={usesTrialBudget}
        trialBudgetInvalid={trialBudgetInvalid}
        open={sectionsOpen.compute}
        onToggle={() => toggleSection("compute")}
        summary={computeSummary}
      />

      <button
        className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onStart}
        disabled={running || shouldBlockStart}
        type="button"
      >
        {running ? "优化中..." : "开始参数优化"}
      </button>
    </div>
  );
}
