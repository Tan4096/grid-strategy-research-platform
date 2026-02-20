import { StrategyAnalysis } from "../types";
import RiskLevelBadge from "./RiskLevelBadge";

interface Props {
  analysis: StrategyAnalysis;
}

const STRUCTURE_LABEL: Record<StrategyAnalysis["structure_dependency"], string> = {
  range: "震荡依赖",
  mixed: "混合结构",
  trend_sensitive: "趋势敏感"
};

function pct(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(0)}%`;
}

export default function StrategyStatusBar({ analysis }: Props) {
  return (
    <div className="card p-3">
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-200 xl:grid-cols-5">
        <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
          <p className="text-slate-400">风险等级</p>
          <div className="mt-1">
            <RiskLevelBadge level={analysis.risk_level} />
          </div>
        </div>
        <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
          <p className="text-slate-400">结构依赖</p>
          <p className="mt-1 font-semibold text-slate-100">{STRUCTURE_LABEL[analysis.structure_dependency]}</p>
        </div>
        <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
          <p className="text-slate-400">过拟合风险</p>
          <p className={`mt-1 font-semibold ${analysis.overfitting_flag ? "text-rose-300" : "text-emerald-300"}`}>
            {analysis.overfitting_flag ? "是" : "否"}
          </p>
        </div>
        <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
          <p className="text-slate-400">稳定性评分</p>
          <p className="mt-1 font-semibold text-slate-100">{pct(analysis.stability_score)}</p>
        </div>
        <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
          <p className="text-slate-400">强平风险</p>
          <div className="mt-1">
            <RiskLevelBadge level={analysis.liquidation_risk} />
          </div>
        </div>
      </div>
    </div>
  );
}

