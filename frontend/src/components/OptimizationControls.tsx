import { ReactNode, useEffect, useState } from "react";
import { OptimizationConfig } from "../types";
import ComputeSection from "./optimization/ComputeSection";
import RobustSection from "./optimization/RobustSection";
import ScanSection from "./optimization/ScanSection";
import StrategySection from "./optimization/StrategySection";
import { estimateSweepCount } from "./optimization/shared";
import { readPlain, STORAGE_KEYS, writePlain } from "../lib/storage";

interface Props {
  config: OptimizationConfig;
  onChange: (next: OptimizationConfig) => void;
  workspaceTabs?: ReactNode;
  compact?: boolean;
  asCard?: boolean;
}

interface OptimizationControlSections {
  scan: boolean;
  strategy: boolean;
  robust: boolean;
  compute: boolean;
}

const DEFAULT_SECTIONS_OPEN: OptimizationControlSections = {
  scan: true,
  strategy: false,
  robust: false,
  compute: false
};

function normalizeSectionsOpen(raw: unknown): OptimizationControlSections | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<OptimizationControlSections>;
  if (
    typeof value.scan !== "boolean" ||
    typeof value.strategy !== "boolean" ||
    typeof value.robust !== "boolean" ||
    typeof value.compute !== "boolean"
  ) {
    return null;
  }
  return {
    scan: value.scan,
    strategy: value.strategy,
    robust: value.robust,
    compute: value.compute
  };
}

export default function OptimizationControls({
  config,
  onChange,
  workspaceTabs,
  compact = false,
  asCard = true
}: Props) {
  const [sectionsOpen, setSectionsOpen] = useState<OptimizationControlSections>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SECTIONS_OPEN;
    }
    return readPlain(STORAGE_KEYS.optimizationControlSections, normalizeSectionsOpen) ?? DEFAULT_SECTIONS_OPEN;
  });

  useEffect(() => {
    writePlain(STORAGE_KEYS.optimizationControlSections, sectionsOpen);
  }, [sectionsOpen]);

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
  const strategySummary = `${modeName} · 目标 ${config.target}`;
  const robustSummary = `${config.walk_forward_enabled ? "Walk-forward 开启" : "Walk-forward 关闭"} · 最小交易 ${config.min_closed_trades}`;
  const computeSummary = `${config.max_workers} 进程 / 批 ${config.batch_size} / Chunk ${config.chunk_size}`;

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const expandAll = () =>
    setSectionsOpen({
      scan: true,
      strategy: true,
      robust: true,
      compute: true
    });

  const collapseAll = () =>
    setSectionsOpen({
      scan: false,
      strategy: false,
      robust: false,
      compute: false
    });

  const containerClass = asCard ? "card fade-up space-y-3 p-2.5 sm:p-3" : "fade-up space-y-3";

  return (
    <div className={containerClass} data-tour-id="optimization-config-panel">
      {workspaceTabs && <div className="mb-1">{workspaceTabs}</div>}
      {!compact && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">参数优化模块</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {config.optimization_mode === "random_pruned"
                ? "Random Search + Early Pruning + Walk-forward"
                : config.optimization_mode === "bayesian"
                ? "Random Warm-up + Bayesian + Early Pruning + Walk-forward"
                : "Grid Search + 并行计算 + Walk-forward"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">默认仅展开“扫描维度”，其余按需展开。</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs"
              onClick={expandAll}
            >
              展开全部
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs"
              onClick={collapseAll}
            >
              收起全部
            </button>
          </div>
        </div>
      )}

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
    </div>
  );
}
