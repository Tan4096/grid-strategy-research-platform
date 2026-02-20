import { StrategyAnalysis } from "../types";

interface Props {
  analysis: StrategyAnalysis;
}

const TAG_LABELS: Record<string, string> = {
  high_leverage: "高杠杆",
  range_dependent: "震荡依赖",
  trend_sensitive: "趋势敏感",
  validation_drop: "验证退化",
  high_drawdown: "高回撤",
  high_liquidation_risk: "高强平风险",
  base_position_heavy: "底仓偏重",
  tight_stop_loss: "止损偏紧",
  negative_return: "负收益"
};

function pct(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}

function buildNarrative(analysis: StrategyAnalysis): string[] {
  const lines: string[] = [];

  if (analysis.risk_level === "high") {
    lines.push("当前策略风险等级较高，建议优先降低杠杆或减少底仓暴露。");
  } else if (analysis.risk_level === "medium") {
    lines.push("当前策略风险等级中等，建议结合回撤上限与止损缓冲进一步微调。");
  } else {
    lines.push("当前策略风险等级较低，可在验证期继续观察稳定性。");
  }

  if (analysis.overfitting_flag) {
    lines.push(`验证期表现显著下降（退化 ${pct(analysis.validation_degradation_pct)}），存在过拟合风险。`);
  }

  if (analysis.structure_dependency === "range") {
    lines.push("该策略高度依赖震荡行情，单边趋势阶段可能降低表现。");
  } else if (analysis.structure_dependency === "trend_sensitive") {
    lines.push("该策略对趋势切换较敏感，建议扩大区间并降低交易频率。");
  } else {
    lines.push("策略为混合结构依赖，对不同市场阶段有一定适应能力。");
  }

  if (analysis.liquidation_risk === "high") {
    lines.push("强平风险偏高，建议降低杠杆或减少初始底仓格数。");
  }

  return lines;
}

export default function StrategyDiagnosisCard({ analysis }: Props) {
  const lines = buildNarrative(analysis);

  return (
    <div className="card p-3 text-xs text-slate-200">
      <p className="font-semibold text-slate-100">策略结构诊断</p>
      <div className="mt-2 space-y-1 text-slate-300">
        {lines.map((line) => (
          <p key={line}>- {line}</p>
        ))}
      </div>

      {analysis.diagnosis_tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {analysis.diagnosis_tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-200"
            >
              {TAG_LABELS[tag] ?? tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

