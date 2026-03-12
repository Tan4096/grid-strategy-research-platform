import type { OptimizationConfig, SweepRange } from "../../lib/api-schema";
import { SectionCard, SweepEditor, SweepKey, sweepTitle } from "./shared";

interface Props {
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
}

export default function ScanSection({
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
}: Props) {
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
        <p className="pt-0.5 text-right text-[11px] whitespace-nowrap text-slate-400">
          {usesTrialBudget ? "参数空间" : "预计组合"}{" "}
          <span className="mono font-semibold text-slate-200">{estimatedCombinations}</span>
          {" · "}
          {usesTrialBudget ? "试验预算" : "执行"}{" "}
          <span className="mono font-semibold text-slate-200">{sampledCombinations}</span>
        </p>
      }
    >
      {!usesTrialBudget && exceedsMax && shouldAutoSample && (
        <p className="text-xs text-slate-300">超出上限，后端将自动抽样执行</p>
      )}
      {!usesTrialBudget && exceedsMax && !shouldAutoSample && (
        <p className="text-xs text-slate-300">超出上限，请缩小范围或开启自动抽样</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-2">
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
