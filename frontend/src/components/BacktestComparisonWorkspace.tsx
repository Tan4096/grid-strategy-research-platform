import { useMemo } from "react";
import type { BacktestResponse, CurvePoint } from "../lib/api-schema";
import { buildOpenPositionsCurve, buildReturnRateCurve } from "../lib/backtestCurveTransforms";
import ComparisonLineChart from "./ComparisonLineChart";

interface Props {
  baseResult: BacktestResponse;
  candidateResult: BacktestResponse;
  candidateLabel?: string | null;
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function maxCurveValue(points: CurvePoint[]): number {
  if (!points.length) {
    return 0;
  }
  return points.reduce((max, point) => (point.value > max ? point.value : max), Number.NEGATIVE_INFINITY);
}

function DeltaCard({
  label,
  base,
  candidate,
  delta,
  betterWhenLower = false,
  unit = ""
}: {
  label: string;
  base: number;
  candidate: number;
  delta: number;
  betterWhenLower?: boolean;
  unit?: string;
}) {
  const improved = betterWhenLower ? delta < 0 : delta > 0;
  const neutral = Math.abs(delta) < 1e-9;
  const deltaClass = neutral ? "text-slate-300" : improved ? "text-emerald-300" : "text-rose-300";
  const deltaText = `${delta >= 0 ? "+" : ""}${fmt(delta, 2)}${unit}`;

  return (
    <div className="rounded border border-slate-700/60 bg-slate-900/40 p-3 text-xs text-slate-200">
      <p className="text-slate-300">{label}</p>
      <p className="mt-1">当前：<span className="mono">{fmt(base, 2)}{unit}</span></p>
      <p>优化：<span className="mono">{fmt(candidate, 2)}{unit}</span></p>
      <p className={`mono mt-1 font-semibold ${deltaClass}`}>差值：{deltaText}</p>
    </div>
  );
}

export default function BacktestComparisonWorkspace({
  baseResult,
  candidateResult,
  candidateLabel
}: Props) {
  const baseSummary = baseResult.summary;
  const candidateSummary = candidateResult.summary;

  const baseReturnRateCurve = useMemo(
    () => buildReturnRateCurve(baseResult.equity_curve, baseSummary.initial_margin),
    [baseResult.equity_curve, baseSummary.initial_margin]
  );
  const candidateReturnRateCurve = useMemo(
    () => buildReturnRateCurve(candidateResult.equity_curve, candidateSummary.initial_margin),
    [candidateResult.equity_curve, candidateSummary.initial_margin]
  );

  const baseOpenPositionsCurve = useMemo(
    () => buildOpenPositionsCurve(baseResult.events),
    [baseResult.events]
  );
  const candidateOpenPositionsCurve = useMemo(
    () => buildOpenPositionsCurve(candidateResult.events),
    [candidateResult.events]
  );
  const baseMaxOpenPositions = maxCurveValue(baseOpenPositionsCurve);
  const candidateMaxOpenPositions = maxCurveValue(candidateOpenPositionsCurve);

  return (
    <section className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">回测对比工作台</p>
        <p className="text-xs text-slate-400">
          当前参数 vs {candidateLabel ?? "优化参数"}
        </p>
      </div>

      <div className="mobile-two-col-grid mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
        <DeltaCard
          label="总收益"
          base={baseSummary.total_return_usdt}
          candidate={candidateSummary.total_return_usdt}
          delta={candidateSummary.total_return_usdt - baseSummary.total_return_usdt}
          unit=" USDT"
        />
        <DeltaCard
          label="最大回撤"
          base={baseSummary.max_drawdown_pct}
          candidate={candidateSummary.max_drawdown_pct}
          delta={candidateSummary.max_drawdown_pct - baseSummary.max_drawdown_pct}
          betterWhenLower
          unit=" 百分比"
        />
        <DeltaCard
          label="胜率"
          base={baseSummary.win_rate * 100}
          candidate={candidateSummary.win_rate * 100}
          delta={(candidateSummary.win_rate - baseSummary.win_rate) * 100}
          unit=" 百分点"
        />
        <DeltaCard
          label="峰值持仓格数"
          base={baseMaxOpenPositions}
          candidate={candidateMaxOpenPositions}
          delta={candidateMaxOpenPositions - baseMaxOpenPositions}
          betterWhenLower
          unit=" 格"
        />
      </div>

      <div className="mt-4 space-y-4">
        <ComparisonLineChart
          title="收益率曲线对比"
          baseData={baseReturnRateCurve}
          candidateData={candidateReturnRateCurve}
          yAxisLabel="收益率"
          baseReturnAmountBase={baseSummary.initial_margin}
          candidateReturnAmountBase={candidateSummary.initial_margin}
          candidateLabel={candidateLabel ?? "优化参数"}
        />
        <ComparisonLineChart
          title="回撤曲线对比"
          baseData={baseResult.drawdown_curve}
          candidateData={candidateResult.drawdown_curve}
          yAxisLabel="回撤比例"
          candidateLabel={candidateLabel ?? "优化参数"}
        />
        <ComparisonLineChart
          title="持仓网格数对比"
          baseData={baseOpenPositionsCurve}
          candidateData={candidateOpenPositionsCurve}
          yAxisLabel="持仓格数"
          candidateLabel={candidateLabel ?? "优化参数"}
        />
      </div>
    </section>
  );
}
