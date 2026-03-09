import { Suspense, lazy, useMemo } from "react";
import { buildReturnRateCurve } from "../../../lib/backtestCurveTransforms";
import { resolveCurveColorByLastValue } from "../../../lib/curveColors";
import { CurvePoint } from "../../../types";

const LineChart = lazy(() => import("../../LineChart"));

function ChartFallback({ minHeight = "220px" }: { minHeight?: string }) {
  return (
    <div className="card flex items-center justify-center p-4 text-sm text-slate-400" style={{ minHeight }}>
      图表加载中...
    </div>
  );
}

interface Props {
  bestScoreCurve: CurvePoint[];
  initialMargin: number;
  convergenceCurve: CurvePoint[];
  bestEquityCurve: CurvePoint[];
  curveHoverRatio: number | null;
  onCurveHoverRatioChange: (ratio: number | null) => void;
}

export default function ResultsCurvesPanel({
  bestScoreCurve,
  initialMargin,
  convergenceCurve,
  bestEquityCurve,
  curveHoverRatio,
  onCurveHoverRatioChange
}: Props) {
  const bestReturnRateCurve = useMemo(
    () => buildReturnRateCurve(bestEquityCurve, initialMargin),
    [bestEquityCurve, initialMargin]
  );
  const bestReturnRateCurveColor = useMemo(
    () => resolveCurveColorByLastValue(bestReturnRateCurve),
    [bestReturnRateCurve]
  );

  return (
    <div className="space-y-4">
      {(bestScoreCurve.length > 0 || convergenceCurve.length > 0) && (
        <div className="mobile-two-col-grid grid grid-cols-1 gap-4 xl:grid-cols-2">
          {bestScoreCurve.length > 0 && (
            <Suspense fallback={<ChartFallback minHeight="320px" />}>
              <LineChart
                title="最优评分收敛曲线"
                data={bestScoreCurve}
                color="#22c55e"
                yAxisLabel="评分"
                hoverSyncRatio={curveHoverRatio}
                onHoverSyncRatioChange={onCurveHoverRatioChange}
                area
                compact
                tight
                height={320}
              />
            </Suspense>
          )}
          {convergenceCurve.length > 0 && (
            <Suspense fallback={<ChartFallback minHeight="320px" />}>
              <LineChart
                title="全局收敛曲线"
                data={convergenceCurve}
                color="#38bdf8"
                yAxisLabel="评分"
                hoverSyncRatio={curveHoverRatio}
                onHoverSyncRatioChange={onCurveHoverRatioChange}
                area
                compact
                tight
                height={320}
              />
            </Suspense>
          )}
        </div>
      )}

      {bestReturnRateCurve.length > 0 ? (
        <Suspense fallback={<ChartFallback minHeight="340px" />}>
          <LineChart
            title="最优参数收益率曲线"
            data={bestReturnRateCurve}
            color={bestReturnRateCurveColor}
            yAxisLabel="收益率"
            returnAmountBase={initialMargin}
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={onCurveHoverRatioChange}
            area
          />
        </Suspense>
      ) : (
        <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-slate-700/70 p-4 text-sm text-slate-300">
          暂无最优参数收益率曲线。
        </div>
      )}
    </div>
  );
}
