import type { OptimizationConfig } from "../../lib/api-schema";
import { activeMode, ComputeMode, inputClass, labelClass, modePreset, SectionCard } from "./shared";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  shouldBlockStart: boolean;
  invalidSweep: boolean;
  usesTrialBudget: boolean;
  trialBudgetInvalid: boolean;
  open: boolean;
  onToggle: () => void;
  summary: string;
}

export default function ComputeSection({
  config,
  onChange,
  shouldBlockStart,
  invalidSweep,
  usesTrialBudget,
  trialBudgetInvalid,
  open,
  onToggle,
  summary
}: Props) {
  const selectedMode = activeMode(config.max_workers, config.batch_size, config.chunk_size);
  const modeBtnClass = (active: boolean) =>
    `ui-btn ui-btn-xs w-full ${
      active ? "ui-btn-primary" : "ui-btn-secondary"
    }`;

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
      <div className="mobile-two-col-grid mb-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
        <button
          className={modeBtnClass(selectedMode === "fast")}
          type="button"
          onClick={() => handleApplyMode("fast")}
        >
          极速
        </button>
        <button
          className={modeBtnClass(selectedMode === "balanced")}
          type="button"
          onClick={() => handleApplyMode("balanced")}
        >
          均衡
        </button>
        <button
          className={`${modeBtnClass(selectedMode === "eco")} mobile-two-col-span`}
          type="button"
          onClick={() => handleApplyMode("eco")}
        >
          省电
        </button>
      </div>

      <div className="mb-3 rounded-md border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
        当前调度: 进程 {config.max_workers} / 批大小 {config.batch_size} / Chunk {config.chunk_size}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-2">
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
                ...(usesTrialBudget
                  ? { max_trials: Number(e.target.value) }
                  : { max_combinations: Number(e.target.value) })
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
        <p className="text-xs text-slate-300">
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
