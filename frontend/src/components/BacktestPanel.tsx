import { Suspense, lazy, useState } from "react";
import { BacktestResponse } from "../types";
import StateBlock from "./ui/StateBlock";

const BacktestEventsTimeline = lazy(() => import("./BacktestEventsTimeline"));
const BacktestComparisonWorkspace = lazy(() => import("./BacktestComparisonWorkspace"));
const LineChart = lazy(() => import("./LineChart"));
const MetricCards = lazy(() => import("./MetricCards"));
const PriceGridChart = lazy(() => import("./PriceGridChart"));
const StrategyDiagnosisCard = lazy(() => import("./StrategyDiagnosisCard"));
const StrategyRadarChart = lazy(() => import("./StrategyRadarChart"));
const StrategyScoreCard = lazy(() => import("./StrategyScoreCard"));
const StrategyStatusBar = lazy(() => import("./StrategyStatusBar"));
const TradesTable = lazy(() => import("./TradesTable"));

type BacktestTab = "charts" | "trades" | "events";

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function pct(value: number, digits = 2): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : "-";
}

function buildLegacyDiagnosis(result: BacktestResponse): { level: "低" | "中" | "高"; lines: string[] } {
  const s = result.summary;
  const lines: string[] = [];
  let level: "低" | "中" | "高" = "低";

  if (s.liquidation_count > 0 || s.max_drawdown_pct >= 35) {
    level = "高";
  } else if (s.max_drawdown_pct >= 18 || s.stop_loss_count >= 3) {
    level = "中";
  }

  if (s.total_return_usdt < 0) {
    lines.push("当前参数在该区间为负收益，建议先降低杠杆或扩大区间后再优化。");
  } else {
    lines.push("当前参数在该区间为正收益，可继续用优化模块验证稳健性。");
  }

  if (s.max_drawdown_pct >= 25) {
    lines.push("回撤较高，策略对单边走势敏感，建议扩大区间并提高止损缓冲。");
  } else if (s.max_drawdown_pct <= 12) {
    lines.push("回撤控制较好，适合继续做参数精细化扫描。");
  } else {
    lines.push("回撤处于中等水平，建议结合验证期结果再决定实盘参数。");
  }

  if (s.stop_loss_count >= 3) {
    lines.push("止损触发较频繁，当前止损可能偏紧或区间偏窄。");
  }

  if (s.funding_paid > Math.max(1, Math.abs(s.total_return_usdt) * 0.2)) {
    lines.push("资金费影响较大，建议关注资金费率阶段性变化。");
  }

  return { level, lines };
}

interface Props {
  error: string | null;
  result: BacktestResponse | null;
  loading: boolean;
  compareResult: BacktestResponse | null;
  compareLoading: boolean;
  compareError: string | null;
  compareLabel: string | null;
  onClearComparison: () => void;
  canExportBacktest: boolean;
  onExportBacktest: () => void;
  symbol: string;
}

function buildStructureInsight(result: BacktestResponse): { marketStructure: string; fitLabel: string } {
  const candles = result.candles;
  if (candles.length < 3) {
    return { marketStructure: "数据不足", fitLabel: "-" };
  }

  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const trendPct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const maxHigh = Math.max(...candles.map((item) => item.high));
  const minLow = Math.min(...candles.map((item) => item.low));
  const rangePct = firstClose > 0 ? ((maxHigh - minLow) / firstClose) * 100 : 0;

  let marketStructure = "震荡";
  if (Math.abs(trendPct) >= Math.max(4, rangePct * 0.5)) {
    marketStructure = trendPct >= 0 ? "单边上涨" : "单边下跌";
  } else if (trendPct >= 1.5) {
    marketStructure = "震荡偏强";
  } else if (trendPct <= -1.5) {
    marketStructure = "震荡偏弱";
  }

  const diffs = candles.slice(1).map((candle, idx) => candle.close - candles[idx].close);
  let signChanges = 0;
  for (let i = 1; i < diffs.length; i += 1) {
    const prev = Math.sign(diffs[i - 1]);
    const next = Math.sign(diffs[i]);
    if (prev !== 0 && next !== 0 && prev !== next) {
      signChanges += 1;
    }
  }

  const changeRatio = diffs.length > 1 ? signChanges / (diffs.length - 1) : 0;
  const trendPenalty = Math.min(1, Math.abs(trendPct) / Math.max(rangePct, 1));
  const drawdownPenalty = Math.min(1, result.summary.max_drawdown_pct / 40);
  const stopPenalty = Math.min(1, result.summary.stop_loss_count / 6);
  const fitScore = Math.max(
    0,
    Math.min(1, 0.55 * changeRatio + 0.45 * (1 - trendPenalty) - 0.15 * drawdownPenalty - 0.1 * stopPenalty + 0.1)
  );

  let level = "低";
  if (fitScore >= 0.7) {
    level = "高";
  } else if (fitScore >= 0.45) {
    level = "中";
  }

  return { marketStructure, fitLabel: `${level} (${(fitScore * 100).toFixed(0)}%)` };
}

function ChartFallback({ minHeight = "180px" }: { minHeight?: string }) {
  return (
    <div className="card flex items-center justify-center p-4 text-sm text-slate-400" style={{ minHeight }}>
      图表加载中...
    </div>
  );
}

export default function BacktestPanel({
  error,
  result,
  loading,
  compareResult,
  compareLoading,
  compareError,
  compareLabel,
  onClearComparison,
  canExportBacktest,
  onExportBacktest,
  symbol
}: Props) {
  const [tab, setTab] = useState<BacktestTab>("charts");
  const analysis = result?.analysis ?? null;
  const scoring = result?.scoring ?? null;
  const diagnosis = result && !analysis ? buildLegacyDiagnosis(result) : null;
  const structureInsight = result ? buildStructureInsight(result) : null;

  return (
    <>
      {error && <StateBlock variant="error" title="回测错误" message={error} minHeight={120} />}

      {!result && !loading && <StateBlock variant="empty" message="请输入参数并点击“开始回测”" minHeight={220} />}
      {!result && loading && <StateBlock variant="loading" message="回测执行中..." minHeight={220} />}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-md border border-slate-500 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-60"
              disabled={!canExportBacktest}
              type="button"
              onClick={onExportBacktest}
            >
              导出结果为 CSV
            </button>
            <p className="text-xs text-slate-400">导出包含 summary/trades/equity 三个分区</p>
          </div>

          <Suspense fallback={<ChartFallback minHeight="120px" />}>
            <MetricCards summary={result.summary} />
          </Suspense>

          {(compareLoading || compareError || compareResult) && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  {compareLoading ? "参数对比回测执行中..." : "已生成参数对比结果"}
                </p>
                {(compareResult || compareError) && (
                  <button
                    type="button"
                    className="rounded border border-slate-600 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-slate-800"
                    onClick={onClearComparison}
                  >
                    清除对比
                  </button>
                )}
              </div>
              {compareError && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  对比回测失败：{compareError}
                </div>
              )}
              {compareResult && (
                <Suspense fallback={<ChartFallback minHeight="240px" />}>
                  <BacktestComparisonWorkspace
                    baseResult={result}
                    candidateResult={compareResult}
                    candidateLabel={compareLabel}
                  />
                </Suspense>
              )}
            </section>
          )}

          {(analysis || scoring || diagnosis) && (
            <section className="card p-3 text-xs text-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-100">策略评估</p>
                <div className="flex flex-wrap items-center gap-2">
                  {scoring && (
                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                      评分 {fmt(scoring.final_score, 1)} / 100 · {scoring.grade}
                    </span>
                  )}
                  {analysis && (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-200">
                      风险 {analysis.risk_level}
                    </span>
                  )}
                  {analysis && (
                    <span className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">
                      结构 {analysis.structure_dependency}
                    </span>
                  )}
                  {analysis?.overfitting_flag && (
                    <span className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200">
                      过拟合风险
                    </span>
                  )}
                </div>
              </div>

              {analysis && (
                <p className="mt-2 text-slate-300">
                  诊断标签: {analysis.diagnosis_tags.length > 0 ? analysis.diagnosis_tags.join(" / ") : "无"}
                </p>
              )}
              {diagnosis && <p className="mt-2 text-slate-300">{diagnosis.lines[0]}</p>}

              <details className="mt-2 rounded border border-slate-700/60 bg-slate-900/30 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-200">展开评分明细与诊断说明</summary>
                <div className="mt-3 space-y-3">
                  {analysis && (
                    <>
                      <Suspense fallback={<ChartFallback minHeight="96px" />}>
                        <StrategyStatusBar analysis={analysis} />
                      </Suspense>
                      <Suspense fallback={<ChartFallback minHeight="120px" />}>
                        <StrategyDiagnosisCard analysis={analysis} />
                      </Suspense>
                    </>
                  )}

                  {scoring && (
                    <>
                      <Suspense fallback={<ChartFallback minHeight="140px" />}>
                        <StrategyScoreCard scoring={scoring} />
                      </Suspense>
                      <Suspense fallback={<ChartFallback minHeight="320px" />}>
                        <StrategyRadarChart scoring={scoring} />
                      </Suspense>
                    </>
                  )}

                  {diagnosis && !analysis && (
                    <div className="space-y-1 text-slate-300">
                      {diagnosis.lines.map((line) => (
                        <p key={line}>- {line}</p>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </section>
          )}

          <details className="card p-3 text-xs text-slate-200">
            <summary className="cursor-pointer font-semibold text-slate-100">展开详细指标</summary>
            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                最大单次亏损: <span className="mono">{fmt(result.summary.max_single_loss)} USDT</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                平均持仓: <span className="mono">{fmt(result.summary.average_holding_hours)} h</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                完整网格盈利次数: <span className="mono">{result.summary.full_grid_profit_count}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                总平仓次数: <span className="mono">{result.summary.total_closed_trades}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                开底仓: <span className="mono">{result.summary.use_base_position ? "是" : "否"}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                初始底仓格数: <span className="mono">{result.summary.base_grid_count}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                初始仓位规模: <span className="mono">{fmt(result.summary.initial_position_size)} USDT</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                手续费总计: <span className="mono">{fmt(result.summary.fees_paid)} USDT</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                资金费: <span className="mono">{fmt(result.summary.funding_paid)} USDT</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                总收益率: <span className="mono">{pct(result.summary.total_return_pct)}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                止损次数: <span className="mono">{result.summary.stop_loss_count}</span>
              </div>
              <div className="rounded border border-slate-700/60 bg-slate-900/40 px-2 py-2">
                强平次数: <span className="mono">{result.summary.liquidation_count}</span>
              </div>
            </div>
          </details>

          <div className="card p-3">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-slate-700/70 bg-slate-950/40 p-1">
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                  tab === "charts"
                    ? "border border-slate-300/70 bg-slate-200/20 text-slate-100"
                    : "border border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80"
                }`}
                onClick={() => setTab("charts")}
              >
                图表
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                  tab === "trades"
                    ? "border border-slate-300/70 bg-slate-200/20 text-slate-100"
                    : "border border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80"
                }`}
                onClick={() => setTab("trades")}
              >
                成交记录
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                  tab === "events"
                    ? "border border-slate-300/70 bg-slate-200/20 text-slate-100"
                    : "border border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80"
                }`}
                onClick={() => setTab("events")}
              >
                事件时间线
              </button>
            </div>
          </div>

          {tab === "charts" && (
            <>
              <Suspense fallback={<ChartFallback minHeight="320px" />}>
                <PriceGridChart
                  candles={result.candles}
                  gridLines={result.grid_lines}
                  symbol={symbol}
                  marketStructure={structureInsight?.marketStructure}
                  gridFitLabel={structureInsight?.fitLabel}
                />
              </Suspense>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Suspense fallback={<ChartFallback minHeight="340px" />}>
                  <LineChart title="收益曲线 (Equity Curve)" data={result.equity_curve} color="#22c55e" yAxisLabel="USDT" />
                </Suspense>
                <Suspense fallback={<ChartFallback minHeight="340px" />}>
                  <LineChart title="回撤曲线 (Drawdown)" data={result.drawdown_curve} color="#f43f5e" yAxisLabel="回撤比例" area />
                </Suspense>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Suspense fallback={<ChartFallback minHeight="340px" />}>
                  <LineChart title="保证金风险率" data={result.margin_ratio_curve} color="#38bdf8" yAxisLabel="保证金比例" />
                </Suspense>
                <Suspense fallback={<ChartFallback minHeight="340px" />}>
                  <LineChart title="杠杆使用率" data={result.leverage_usage_curve} color="#f59e0b" yAxisLabel="杠杆倍数" />
                </Suspense>
              </div>

              <Suspense fallback={<ChartFallback minHeight="340px" />}>
                <LineChart title="预估强平价格" data={result.liquidation_price_curve} color="#a78bfa" yAxisLabel="价格" />
              </Suspense>
            </>
          )}

          {tab === "trades" && (
            <Suspense fallback={<ChartFallback minHeight="220px" />}>
              <TradesTable trades={result.trades} />
            </Suspense>
          )}

          {tab === "events" && (
            <Suspense fallback={<ChartFallback minHeight="220px" />}>
              <BacktestEventsTimeline events={result.events} />
            </Suspense>
          )}
        </>
      )}
    </>
  );
}
