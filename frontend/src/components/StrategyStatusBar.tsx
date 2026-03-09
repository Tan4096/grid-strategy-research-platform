import type { StrategyAnalysis, StrategyScoring } from "../lib/api-schema";
import RiskLevelBadge from "./RiskLevelBadge";

interface Props {
  analysis: StrategyAnalysis;
  scoring?: StrategyScoring;
}

const STRUCTURE_LABEL: Record<StrategyAnalysis["structure_dependency"], string> = {
  range: "震荡依赖",
  mixed: "混合结构",
  trend_sensitive: "趋势敏感"
};

export default function StrategyStatusBar({ analysis, scoring }: Props) {
  return (
    <div className="mobile-two-col-grid grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 text-xs text-slate-200 xl:grid-cols-4">
      <div className="card-sub ui-chip-accent px-2 py-2">
        <p className="opacity-80">综合评分</p>
        <p className="mt-1 font-semibold text-slate-100">
          {scoring ? `${scoring.final_score.toFixed(1)} / 100 · ${scoring.grade}` : "-"}
        </p>
      </div>
      <div className="card-sub px-2 py-2">
        <p className="text-slate-400">风险等级</p>
        <div className="mt-1">
          <RiskLevelBadge level={analysis.risk_level} />
        </div>
      </div>
      <div className="card-sub px-2 py-2">
        <p className="text-slate-400">结构依赖</p>
        <p className="mt-1 font-semibold text-slate-100">{STRUCTURE_LABEL[analysis.structure_dependency]}</p>
      </div>
      <div className="card-sub px-2 py-2">
        <p className="text-slate-400">过拟合风险</p>
        <p className={`mt-1 font-semibold ${analysis.overfitting_flag ? "text-rose-300" : "text-emerald-300"}`}>
          {analysis.overfitting_flag ? "是" : "否"}
        </p>
      </div>
    </div>
  );
}
