import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { buildCumulativeFundingCurve, buildReturnRateCurve } from "../lib/backtestCurveTransforms";
import {
  DRAWDOWN_CURVE_COLOR,
  FUNDING_CURVE_COLOR,
  NEGATIVE_CURVE_COLOR,
  POSITIVE_CURVE_COLOR,
  resolveCurveColorByLastValue
} from "../lib/curveColors";
import { useIsMobile } from "../hooks/responsive/useIsMobile";
import { STORAGE_KEYS } from "../lib/storage";
import type { JobTransportMode } from "../types";
import type { BacktestResponse } from "../lib/api-schema";
import StateBlock from "./ui/StateBlock";

const BacktestEventsTimeline = lazy(() => import("./BacktestEventsTimeline"));
const LineChart = lazy(() => import("./LineChart"));
const MetricCards = lazy(() => import("./MetricCards"));
const PriceGridChart = lazy(() => import("./PriceGridChart"));
const StrategyDiagnosisCard = lazy(() => import("./StrategyDiagnosisCard"));
const StrategyRadarChart = lazy(() => import("./StrategyRadarChart"));
const StrategyScoreCard = lazy(() => import("./StrategyScoreCard"));
const StrategyStatusBar = lazy(() => import("./StrategyStatusBar"));
const TradesTable = lazy(() => import("./TradesTable"));

type BacktestTab = "charts" | "trades" | "events" | "analysis";
type MobileBacktestView = "overview" | "details";

function readMobileBacktestViewFromSession(defaultValue: MobileBacktestView = "overview"): MobileBacktestView {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.mobileBacktestViewV2);
    return raw === "details" ? "details" : "overview";
  } catch {
    return defaultValue;
  }
}

function writeMobileBacktestViewToSession(value: MobileBacktestView): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.mobileBacktestViewV2, value);
  } catch {
    // ignore
  }
}

function readBacktestMetricsExpandedFromSession(defaultValue = false): boolean {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEYS.mobileBacktestMetricsExpanded) === "1";
  } catch {
    return defaultValue;
  }
}

function writeBacktestMetricsExpandedToSession(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.mobileBacktestMetricsExpanded, value ? "1" : "0");
  } catch {
    // ignore
  }
}

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
  transportMode: JobTransportMode;
  symbol: string;
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
  transportMode,
  symbol
}: Props) {
  const isMobileViewport = useIsMobile();

  const scrollToParameterPanel = () => {
    const parameterPanel = document.querySelector("aside");
    if (!parameterPanel) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    parameterPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const parameterAction = (
    <button
      type="button"
      className="ui-btn ui-btn-secondary ui-btn-xs"
      onClick={scrollToParameterPanel}
    >
      去参数区
    </button>
  );

  const [tab, setTab] = useState<BacktestTab>("charts");
  const [mobileView, setMobileView] = useState<MobileBacktestView>(() =>
    readMobileBacktestViewFromSession("overview")
  );
  const [curveHoverRatio, setCurveHoverRatio] = useState<number | null>(null);
  const [mobileMetricsExpanded, setMobileMetricsExpanded] = useState<boolean>(() =>
    readBacktestMetricsExpandedFromSession(false)
  );
  const cumulativeFundingCurve = useMemo(
    () => (result ? buildCumulativeFundingCurve(result.trades, result.events) : []),
    [result]
  );
  const returnRateCurve = useMemo(
    () => (result ? buildReturnRateCurve(result.equity_curve, result.summary.initial_margin) : []),
    [result]
  );
  const returnRateCurveColor = useMemo(
    () => resolveCurveColorByLastValue(returnRateCurve, POSITIVE_CURVE_COLOR, NEGATIVE_CURVE_COLOR),
    [returnRateCurve]
  );
  const unrealizedPnlCurveColor = useMemo(
    () =>
      resolveCurveColorByLastValue(result?.unrealized_pnl_curve ?? [], POSITIVE_CURVE_COLOR, NEGATIVE_CURVE_COLOR),
    [result?.unrealized_pnl_curve]
  );

  useEffect(() => {
    if (tab !== "charts" || (isMobileViewport && mobileView !== "overview")) {
      setCurveHoverRatio(null);
    }
  }, [isMobileViewport, mobileView, tab]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }
    writeBacktestMetricsExpandedToSession(mobileMetricsExpanded);
  }, [isMobileViewport, mobileMetricsExpanded]);

  useEffect(() => {
    if (!isMobileViewport) {
      return;
    }
    writeMobileBacktestViewToSession(mobileView);
  }, [isMobileViewport, mobileView]);

  const analysis = result?.analysis ?? null;
  const scoring = result?.scoring ?? null;
  const diagnosis = result && !analysis ? buildLegacyDiagnosis(result) : null;
  const curveHeight = result
    ? Math.round(Math.max(300, Math.min(400, 300 + Math.log2(Math.max(2, result.equity_curve.length)) * 14)))
    : 320;
  const transportLabel =
    transportMode === "sse"
      ? "SSE 实时流"
      : transportMode === "polling"
        ? "轮询降级"
        : transportMode === "connecting"
          ? "连接中"
          : "等待中";
  const riskLevelLabel = analysis
    ? analysis.risk_level === "high"
      ? "高"
      : analysis.risk_level === "medium"
        ? "中"
        : "低"
    : diagnosis?.level ?? "低";
  const riskSummaryText = analysis?.ai_explanation?.trim()
    ? `风险等级：${riskLevelLabel} · ${analysis.ai_explanation.trim()}`
    : diagnosis?.lines[0]
      ? `风险等级：${riskLevelLabel} · ${diagnosis.lines[0]}`
      : `风险等级：${riskLevelLabel} · 当前参数可继续优化。`;

  const chartsContent = (
    <div className="space-y-4">
      <Suspense fallback={<ChartFallback minHeight="320px" />}>
        <PriceGridChart
          candles={result?.candles ?? []}
          gridLines={result?.grid_lines ?? []}
          events={result?.events ?? []}
          symbol={symbol}
        />
      </Suspense>

      <div className="grid mobile-two-col-grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="收益率曲线"
            data={returnRateCurve}
            color={returnRateCurveColor}
            yAxisLabel="收益率"
            returnAmountBase={result?.summary.initial_margin}
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="回撤曲线"
            data={result?.drawdown_curve ?? []}
            color={DRAWDOWN_CURVE_COLOR}
            yAxisLabel="回撤比例"
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
      </div>

      <div className="grid mobile-two-col-grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="未实现盈亏"
            data={result?.unrealized_pnl_curve ?? []}
            color={unrealizedPnlCurveColor}
            yAxisLabel="USDT"
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="累计资金费"
            data={cumulativeFundingCurve}
            color={FUNDING_CURVE_COLOR}
            yAxisLabel="USDT"
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
      </div>

      <div className="grid mobile-two-col-grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="杠杆使用率"
            data={result?.leverage_usage_curve ?? []}
            color="#f59e0b"
            yAxisLabel="杠杆倍数"
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback minHeight="260px" />}>
          <LineChart
            title="预估强平价格"
            data={result?.liquidation_price_curve ?? []}
            color="#8b5cf6"
            yAxisLabel="价格"
            hoverSyncRatio={curveHoverRatio}
            onHoverSyncRatioChange={setCurveHoverRatio}
            area
            compact
            tight
            height={curveHeight}
          />
        </Suspense>
      </div>
    </div>
  );

  const tradesContent = (
    <Suspense fallback={<ChartFallback minHeight="220px" />}>
      <TradesTable trades={result?.trades ?? []} events={result?.events ?? []} />
    </Suspense>
  );

  const eventsContent = (
    <Suspense fallback={<ChartFallback minHeight="220px" />}>
      <BacktestEventsTimeline events={result?.events ?? []} />
    </Suspense>
  );

  const analysisContent = analysis || scoring || diagnosis ? (
    <div className="space-y-3 text-xs text-slate-200">
      <div className="card p-3">
        <div className="space-y-3">
          {analysis && (
            <Suspense fallback={<ChartFallback minHeight="96px" />}>
              <StrategyStatusBar analysis={analysis} scoring={scoring ?? undefined} />
            </Suspense>
          )}

          {(analysis || diagnosis || scoring) && (
            <div>
              {analysis && scoring ? (
                <div className="grid mobile-two-col-grid gap-3 grid-cols-1 xl:grid-cols-2">
                  <Suspense fallback={<ChartFallback minHeight="120px" />}>
                    <StrategyDiagnosisCard analysis={analysis} />
                  </Suspense>
                  <Suspense fallback={<ChartFallback minHeight="140px" />}>
                    <StrategyScoreCard scoring={scoring} embedded />
                  </Suspense>
                </div>
              ) : (
                <>
                  {analysis && (
                    <Suspense fallback={<ChartFallback minHeight="120px" />}>
                      <StrategyDiagnosisCard analysis={analysis} />
                    </Suspense>
                  )}
                  {scoring && (
                    <Suspense fallback={<ChartFallback minHeight="140px" />}>
                      <StrategyScoreCard scoring={scoring} embedded />
                    </Suspense>
                  )}
                </>
              )}
            </div>
          )}

          {diagnosis && !analysis && (
            <div className="space-y-1 text-slate-300">
              {diagnosis.lines.map((line) => (
                <p key={line}>- {line}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {scoring && (
        <Suspense fallback={<ChartFallback minHeight="320px" />}>
          <StrategyRadarChart scoring={scoring} />
        </Suspense>
      )}
    </div>
  ) : (
    <p className="text-xs text-slate-400">暂无策略评估数据。</p>
  );
  const completeMetricsContent = result ? (
    <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4 text-xs text-slate-200">
      <div className="card-sub px-2 py-2">
        最大单次亏损: <span className="mono">{fmt(result.summary.max_single_loss)} USDT</span>
      </div>
      <div className="card-sub px-2 py-2">
        最大可能亏损: <span className="mono">{fmt(result.summary.max_possible_loss_usdt)} USDT</span>
      </div>
      <div className="card-sub px-2 py-2">
        平均持仓: <span className="mono">{fmt(result.summary.average_holding_hours)} h</span>
      </div>
      <div className="card-sub px-2 py-2">
        完整网格盈利次数: <span className="mono">{result.summary.full_grid_profit_count}</span>
      </div>
      <div className="card-sub px-2 py-2">
        总平仓次数: <span className="mono">{result.summary.total_closed_trades}</span>
      </div>
      <div className="card-sub px-2 py-2">
        开底仓: <span className="mono">{result.summary.use_base_position ? "是" : "否"}</span>
      </div>
      <div className="card-sub px-2 py-2">
        初始底仓格数: <span className="mono">{result.summary.base_grid_count}</span>
      </div>
      <div className="card-sub px-2 py-2">
        初始仓位规模: <span className="mono">{fmt(result.summary.initial_position_size)} USDT</span>
      </div>
      <div className="card-sub px-2 py-2">
        手续费总计: <span className="mono">{fmt(result.summary.fees_paid)} USDT</span>
      </div>
      <div className="card-sub px-2 py-2">
        资金费净额: <span className="mono">{fmt(result.summary.funding_statement_amount)} USDT</span>
      </div>
      <div className="card-sub px-2 py-2">
        总收益率: <span className="mono">{pct(result.summary.total_return_pct)}</span>
      </div>
      <div className="card-sub px-2 py-2">
        止损次数: <span className="mono">{result.summary.stop_loss_count}</span>
      </div>
    </div>
  ) : null;
  const mobileOverviewContent = result ? (
    <div className="space-y-3">
      <Suspense fallback={<ChartFallback minHeight="120px" />}>
        <MetricCards summary={result.summary} embedded compactKeysOnly />
      </Suspense>
      <div className="card-sub border border-slate-700/60 bg-slate-900/30 px-3 py-2 text-xs text-slate-200">
        {riskSummaryText}
      </div>
      <Suspense fallback={<ChartFallback minHeight="280px" />}>
        <LineChart
          title="收益率曲线"
          data={returnRateCurve}
          color={returnRateCurveColor}
          yAxisLabel="收益率"
          returnAmountBase={result?.summary.initial_margin}
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={280}
        />
      </Suspense>
      <button
        type="button"
        className="ui-btn ui-btn-secondary w-full"
        onClick={() => setMobileView("details")}
      >
        查看明细
      </button>
    </div>
  ) : null;
  const mobileRiskCurvesContent = (
    <div className="space-y-3">
      <Suspense fallback={<ChartFallback minHeight="240px" />}>
        <LineChart
          title="回撤曲线"
          data={result?.drawdown_curve ?? []}
          color={DRAWDOWN_CURVE_COLOR}
          yAxisLabel="回撤比例"
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={260}
        />
      </Suspense>
      <Suspense fallback={<ChartFallback minHeight="240px" />}>
        <LineChart
          title="未实现盈亏"
          data={result?.unrealized_pnl_curve ?? []}
          color={unrealizedPnlCurveColor}
          yAxisLabel="USDT"
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={260}
        />
      </Suspense>
      <Suspense fallback={<ChartFallback minHeight="240px" />}>
        <LineChart
          title="累计资金费"
          data={cumulativeFundingCurve}
          color={FUNDING_CURVE_COLOR}
          yAxisLabel="USDT"
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={260}
        />
      </Suspense>
      <Suspense fallback={<ChartFallback minHeight="240px" />}>
        <LineChart
          title="杠杆使用率"
          data={result?.leverage_usage_curve ?? []}
          color="#f59e0b"
          yAxisLabel="杠杆倍数"
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={260}
        />
      </Suspense>
      <Suspense fallback={<ChartFallback minHeight="240px" />}>
        <LineChart
          title="预估强平价格"
          data={result?.liquidation_price_curve ?? []}
          color="#8b5cf6"
          yAxisLabel="价格"
          hoverSyncRatio={curveHoverRatio}
          onHoverSyncRatioChange={setCurveHoverRatio}
          area
          compact
          tight
          height={260}
        />
      </Suspense>
    </div>
  );

  return (
    <>
      {transportMode === "polling" && (
        <div
          className={`mb-2 border border-amber-400/40 bg-amber-500/10 text-amber-200 ${
            isMobileViewport
              ? "rounded-md px-2 py-1 text-[11px]"
              : "card px-3 py-2 text-xs"
          }`}
        >
          实时流暂不可用，已自动降级为轮询跟踪。
        </div>
      )}

      {error && <StateBlock variant="error" title="回测错误" message={error} action={parameterAction} minHeight={120} />}

      {!result && !loading && <StateBlock variant="empty" message="请输入参数并点击“开始回测”" action={parameterAction} minHeight={220} />}
      {!result && loading && <StateBlock variant="loading" message={`回测执行中...（${transportLabel}）`} minHeight={220} />}

      {result && (
        <div className={isMobileViewport ? "space-y-3" : "space-y-5 sm:space-y-6"}>
          {!isMobileViewport && (
            <section className="card space-y-3 p-2.5 sm:p-3" data-tour-id="backtest-result-card">
              <Suspense fallback={<ChartFallback minHeight="120px" />}>
                <MetricCards summary={result.summary} embedded />
              </Suspense>
              <details className="card-sub border border-slate-700/60 bg-slate-900/30 p-2.5" open>
                <summary className="cursor-pointer text-xs font-semibold text-slate-200">查看全部指标</summary>
                {completeMetricsContent}
              </details>
            </section>
          )}

          <section className="card space-y-3 p-2.5 sm:p-3">
            {isMobileViewport ? (
              <>
                <div className="ui-tab-group">
                  <button
                    type="button"
                    className={`ui-tab ${mobileView === "overview" ? "is-active" : ""}`}
                    onClick={() => setMobileView("overview")}
                    data-tour-id="backtest-overview-tab"
                  >
                    总览
                  </button>
                  <button
                    type="button"
                    className={`ui-tab ${mobileView === "details" ? "is-active" : ""}`}
                    onClick={() => setMobileView("details")}
                    data-tour-id="backtest-details-tab"
                  >
                    明细
                  </button>
                </div>

                {mobileView === "overview" ? (
                  mobileOverviewContent
                ) : (
                  <div className="space-y-2">
                    <details open className="rounded border border-slate-700/60 bg-slate-900/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">价格与网格</summary>
                      <div className="mt-2">
                        <Suspense fallback={<ChartFallback minHeight="320px" />}>
                          <PriceGridChart
                            candles={result?.candles ?? []}
                            gridLines={result?.grid_lines ?? []}
                            events={result?.events ?? []}
                            symbol={symbol}
                          />
                        </Suspense>
                      </div>
                    </details>
                    <details
                      className="rounded border border-slate-700/60 bg-slate-900/30 p-2"
                      open={mobileMetricsExpanded}
                      onToggle={(event) => setMobileMetricsExpanded(event.currentTarget.open)}
                    >
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">完整指标</summary>
                      {completeMetricsContent}
                    </details>
                    <details className="rounded border border-slate-700/60 bg-slate-900/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">风险曲线</summary>
                      <div className="mt-2">{mobileRiskCurvesContent}</div>
                    </details>
                    <details className="rounded border border-slate-700/60 bg-slate-900/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">成交记录</summary>
                      <div className="mt-2">{tradesContent}</div>
                    </details>
                    <details className="rounded border border-slate-700/60 bg-slate-900/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">事件时间线</summary>
                      <div className="mt-2">{eventsContent}</div>
                    </details>
                    <details className="rounded border border-slate-700/60 bg-slate-900/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-200">策略评估</summary>
                      <div className="mt-2">{analysisContent}</div>
                    </details>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="ui-tab-group">
                  <button
                    type="button"
                    className={`ui-tab ${tab === "charts" ? "is-active" : ""}`}
                    onClick={() => setTab("charts")}
                  >
                    图表
                  </button>
                  <button
                    type="button"
                    className={`ui-tab ${tab === "trades" ? "is-active" : ""}`}
                    onClick={() => setTab("trades")}
                  >
                    成交记录
                  </button>
                  <button
                    type="button"
                    className={`ui-tab ${tab === "events" ? "is-active" : ""}`}
                    onClick={() => setTab("events")}
                  >
                    事件时间线
                  </button>
                  <button
                    type="button"
                    className={`ui-tab ${tab === "analysis" ? "is-active" : ""}`}
                    onClick={() => setTab("analysis")}
                  >
                    策略评估
                  </button>
                </div>

                {tab === "charts" && chartsContent}
                {tab === "trades" && tradesContent}
                {tab === "events" && eventsContent}
                {tab === "analysis" && analysisContent}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
