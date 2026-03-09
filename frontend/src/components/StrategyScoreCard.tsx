import type { StrategyScoring } from "../lib/api-schema";

interface Props {
  scoring: StrategyScoring;
  embedded?: boolean;
}

const GRADE_CLASS: Record<StrategyScoring["grade"], string> = {
  A: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
  B: "border-cyan-400/50 bg-cyan-500/15 text-cyan-200",
  C: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  D: "border-rose-400/50 bg-rose-500/15 text-rose-200",
  E: "border-red-500/60 bg-red-600/20 text-red-200"
};

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function reasonList(reasons: string[] | undefined): string[] {
  if (!reasons || reasons.length === 0) {
    return ["无额外扣分"];
  }
  return reasons;
}

export default function StrategyScoreCard({ scoring, embedded = false }: Props) {
  return (
    <div className={embedded ? "text-xs text-slate-200" : "card p-3 text-xs text-slate-200"}>
      {embedded ? (
        <p className="font-semibold text-slate-100">评分维度</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-100">策略综合评分</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{fmt(scoring.final_score)} / 100</p>
          </div>
          <span className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${GRADE_CLASS[scoring.grade]}`}>
            等级 {scoring.grade}
          </span>
        </div>
      )}

      <div className="mobile-two-col-grid mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-5">
        <div className="card-sub px-2 py-2">
          收益: <span className="mono">{fmt(scoring.profit_score)}</span>
        </div>
        <div className="card-sub px-2 py-2">
          风险: <span className="mono">{fmt(scoring.risk_score)}</span>
        </div>
        <div className="card-sub px-2 py-2">
          稳定: <span className="mono">{fmt(scoring.stability_score)}</span>
        </div>
        <div className="card-sub px-2 py-2">
          鲁棒: <span className="mono">{fmt(scoring.robustness_score)}</span>
        </div>
        <div className="card-sub px-2 py-2">
          行为: <span className="mono">{fmt(scoring.behavior_score)}</span>
        </div>
      </div>

      <details className="card-sub mt-3 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-100">评分说明</summary>
        <div className="mt-2 space-y-2 text-[11px] text-slate-300">
          <p>
            Final = 0.30*Profit + 0.25*Risk + 0.20*Stability + 0.15*Robustness + 0.10*Behavior
          </p>

          <div>
            <p className="font-semibold text-slate-200">ProfitScore 扣分/加分原因：</p>
            {reasonList(scoring.profit_reasons).map((item) => (
              <p key={`p-${item}`}>- {item}</p>
            ))}
          </div>
          <div>
            <p className="font-semibold text-slate-200">RiskScore 扣分原因：</p>
            {reasonList(scoring.risk_reasons).map((item) => (
              <p key={`r-${item}`}>- {item}</p>
            ))}
          </div>
          <div>
            <p className="font-semibold text-slate-200">StabilityScore 扣分原因：</p>
            {reasonList(scoring.stability_reasons).map((item) => (
              <p key={`s-${item}`}>- {item}</p>
            ))}
          </div>
          <div>
            <p className="font-semibold text-slate-200">RobustnessScore 扣分原因：</p>
            {reasonList(scoring.robustness_reasons).map((item) => (
              <p key={`rb-${item}`}>- {item}</p>
            ))}
          </div>
          <div>
            <p className="font-semibold text-slate-200">BehaviorScore 扣分原因：</p>
            {reasonList(scoring.behavior_reasons).map((item) => (
              <p key={`b-${item}`}>- {item}</p>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
