import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import ParameterForm from "./components/ParameterForm";
import { useBacktestRunner } from "./hooks/useBacktestRunner";
import { useMarketSync } from "./hooks/useMarketSync";
import { useOptimizationRunner } from "./hooks/useOptimizationRunner";
import { usePersistedBacktestRequest } from "./hooks/usePersistedBacktestRequest";
import { usePersistedOptimizationConfig } from "./hooks/usePersistedOptimizationConfig";
import { STORAGE_KEYS, readPlain, writePlain } from "./lib/storage";
import {
  BacktestResponse,
  BacktestRequest,
  OptimizationConfig,
  OptimizationRow,
  SweepRange
} from "./types";

const BacktestPanel = lazy(() => import("./components/BacktestPanel"));
const OptimizationPanel = lazy(() => import("./components/OptimizationPanel"));

function exportBacktestResultCsv(result: BacktestResponse, request?: BacktestRequest) {
  const csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const text = String(value);
    if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  };
  const lines: string[] = [];

  if (request) {
    lines.push("section,key,value");
    Object.entries(request.strategy).forEach(([key, value]) => {
      lines.push(["strategy", key, csvEscape(value)].join(","));
    });
    Object.entries(request.data).forEach(([key, value]) => {
      if (key === "csv_content") {
        return;
      }
      lines.push(["data", key, csvEscape(value)].join(","));
    });
    lines.push("");
  }

  lines.push("section,key,value");
  Object.entries(result.summary).forEach(([key, value]) => {
    lines.push(["summary", key, csvEscape(value)].join(","));
  });

  if (result.analysis) {
    Object.entries(result.analysis).forEach(([key, value]) => {
      lines.push(["analysis", key, csvEscape(Array.isArray(value) ? value.join("|") : value)].join(","));
    });
  }
  if (result.scoring) {
    Object.entries(result.scoring).forEach(([key, value]) => {
      lines.push(["scoring", key, csvEscape(Array.isArray(value) ? value.join("|") : value)].join(","));
    });
  }

  lines.push(
    "",
    "events,timestamp,event_type,price,message"
  );
  result.events.forEach((event) => {
    lines.push(
      [
        "event",
        csvEscape(event.timestamp),
        csvEscape(event.event_type),
        csvEscape(event.price),
        csvEscape(event.message)
      ].join(",")
    );
  });

  lines.push(
    "",
    "trades,open_time,close_time,side,entry_price,exit_price,quantity,gross_pnl,net_pnl,fee_paid,holding_hours,close_reason"
  );
  result.trades.forEach((trade) => {
    lines.push(
      [
        "trade",
        csvEscape(trade.open_time),
        csvEscape(trade.close_time),
        csvEscape(trade.side),
        csvEscape(trade.entry_price),
        csvEscape(trade.exit_price),
        csvEscape(trade.quantity),
        csvEscape(trade.gross_pnl),
        csvEscape(trade.net_pnl),
        csvEscape(trade.fee_paid),
        csvEscape(trade.holding_hours),
        csvEscape(trade.close_reason)
      ].join(",")
    );
  });

  lines.push("", "equity,timestamp,equity");
  result.equity_curve.forEach((point) => {
    lines.push(["equity", csvEscape(point.timestamp), csvEscape(point.value)].join(","));
  });

  lines.push("", "drawdown,timestamp,value");
  result.drawdown_curve.forEach((point) => {
    lines.push(["drawdown", csvEscape(point.timestamp), csvEscape(point.value)].join(","));
  });

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  link.setAttribute("href", url);
  link.setAttribute("download", `btc-grid-backtest-${ts}.csv`);
  link.click();
  URL.revokeObjectURL(url);
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function cloneBacktestRequest(request: BacktestRequest): BacktestRequest {
  return {
    strategy: { ...request.strategy },
    data: { ...request.data }
  };
}

function buildBacktestPrecheck(request: BacktestRequest): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const side = request.strategy.side;
  const { lower, upper, stop_loss, leverage, grids, margin, maintenance_margin_rate, use_base_position } = request.strategy;

  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    errors.push("区间参数无效：UPPER 必须大于 LOWER。");
  }
  if (!Number.isFinite(grids) || grids < 2) {
    errors.push("网格数量必须大于等于 2。");
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    errors.push("杠杆必须大于 0。");
  }
  if (!Number.isFinite(margin) || margin <= 0) {
    errors.push("保证金必须大于 0。");
  }
  if (side === "short" && stop_loss <= upper) {
    errors.push("做空网格的 STOP_LOSS 必须高于 UPPER。");
  }
  if (side === "long" && stop_loss >= lower) {
    errors.push("做多网格的 STOP_LOSS 必须低于 LOWER。");
  }

  const startTs = parseIso(request.data.start_time ?? null);
  const endTs = parseIso(request.data.end_time ?? null);
  if (startTs !== null && endTs !== null && startTs >= endTs) {
    errors.push("开始时间必须早于结束时间。");
  }

  const stopDistancePct =
    side === "short"
      ? upper > 0
        ? ((stop_loss - upper) / upper) * 100
      : 0
      : lower > 0
      ? ((lower - stop_loss) / lower) * 100
      : 0;
  if (Number.isFinite(stopDistancePct) && stopDistancePct > 0 && stopDistancePct < 0.8) {
    warnings.push("止损距离较窄（<0.8%），容易被短期波动触发。");
  }
  if (leverage > 15) {
    warnings.push("当前杠杆 > 15，风险偏高。");
  }
  if (maintenance_margin_rate >= 0.01) {
    warnings.push("维持保证金率较高，会提高强平触发概率。");
  }
  if (use_base_position) {
    const potentialBaseGrids = Math.max(grids - 2, 0);
    const potentialBaseNotional = (margin * leverage * potentialBaseGrids) / Math.max(grids, 1);
    if (potentialBaseGrids >= 4 || potentialBaseNotional >= margin * leverage * 0.6) {
      warnings.push("开底仓后潜在初始底仓规模偏大，请确认仓位承受能力。");
    }
  }
  if (request.data.source === "csv" && !request.data.csv_content) {
    warnings.push("当前是 CSV 模式，尚未上传文件。");
  }

  return { errors, warnings };
}

function estimateSweepCount(sweep: SweepRange): number {
  if (!sweep.enabled) {
    return 1;
  }
  if (sweep.values && sweep.values.length > 0) {
    return sweep.values.length;
  }
  if (sweep.start === null || sweep.end === null || sweep.step === null) {
    return 0;
  }
  if (sweep.step <= 0 || sweep.end < sweep.start) {
    return 0;
  }
  return Math.floor((sweep.end - sweep.start) / sweep.step + 1e-9) + 1;
}

function buildOptimizationPrecheck(
  request: BacktestRequest,
  optimization: OptimizationConfig
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const baseCheck = buildBacktestPrecheck(request);
  errors.push(...baseCheck.errors);
  warnings.push(...baseCheck.warnings);

  const leverageCount = estimateSweepCount(optimization.leverage);
  const gridsCount = estimateSweepCount(optimization.grids);
  const widthCount = estimateSweepCount(optimization.band_width_pct);
  const stopCount = estimateSweepCount(optimization.stop_loss_ratio_pct);
  const baseCount = optimization.optimize_base_position ? 2 : 1;
  const spaceSize = leverageCount * gridsCount * widthCount * stopCount * baseCount;

  if (spaceSize <= 0) {
    errors.push("参数扫描范围无效，请检查开始/结束/步长。");
  }
  if (optimization.optimization_mode === "grid" && spaceSize > optimization.max_combinations && !optimization.auto_limit_combinations) {
    errors.push("Grid 模式预计组合超过上限，且未开启自动抽样。");
  }
  if (optimization.optimization_mode !== "grid" && optimization.max_trials < 1) {
    errors.push("试验数必须大于 0。");
  }
  if (optimization.anchor_mode === "CUSTOM_PRICE" && (!optimization.custom_anchor_price || optimization.custom_anchor_price <= 0)) {
    errors.push("Anchor 模式为 CUSTOM_PRICE 时必须输入有效价格。");
  }
  if (spaceSize > 100000) {
    warnings.push(`当前参数空间 ${spaceSize.toLocaleString()} 组，建议缩小范围或启用剪枝。`);
  }

  if (!optimization.require_positive_return) {
    warnings.push("未启用正收益约束，结果中可能出现负收益组合。");
  }
  if (optimization.max_drawdown_pct_limit === null) {
    warnings.push("未设置最大回撤约束，建议设置风控上限。");
  }
  if (optimization.optimization_mode === "bayesian" && optimization.max_trials > 5000) {
    warnings.push("Bayesian 试验数较大，建议开启自适应降级并使用“极速”计算模式。");
  }
  if (optimization.optimization_mode !== "grid" && optimization.max_workers <= 1) {
    warnings.push("当前并行进程数为 1，会显著降低优化速度。");
  }

  return { errors, warnings };
}

export default function App() {
  const [mode, setMode] = useState<"backtest" | "optimize">("backtest");

  const { request, setRequest, requestReady } = usePersistedBacktestRequest();
  const [baselineRequest, setBaselineRequest] = useState<BacktestRequest | null>(null);
  const [compareRequest, setCompareRequest] = useState<BacktestRequest | null>(null);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);
  const [compareRunToken, setCompareRunToken] = useState(0);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const { optimizationConfig, setOptimizationConfig, optimizationConfigReady } =
    usePersistedOptimizationConfig();
  const toastTimerRef = useRef<number | null>(null);

  const backtestPrecheck = useMemo(() => buildBacktestPrecheck(request), [request]);
  const optimizationPrecheck = useMemo(
    () => buildOptimizationPrecheck(request, optimizationConfig),
    [request, optimizationConfig]
  );
  const comparePrecheck = useMemo(
    () =>
      compareRequest
        ? buildBacktestPrecheck(compareRequest)
        : { errors: ["请先选择要对比的优化组合。"], warnings: [] },
    [compareRequest]
  );

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const dismissed = readPlain<string>(STORAGE_KEYS.onboardingDismissed, (value) =>
      typeof value === "string" ? value : null
    );
    setOnboardingVisible(dismissed !== "1");
  }, []);

  const { marketParamsSyncing, marketParamsNote, syncMarketParams } = useMarketSync({
    request,
    setRequest
  });

  const {
    result,
    loading,
    error,
    runBacktest
  } = useBacktestRunner({
    request,
    requestReady,
    precheck: backtestPrecheck
  });
  const {
    result: compareResult,
    loading: compareLoading,
    error: compareError,
    runBacktest: runCompareBacktest,
    reset: resetCompareBacktest
  } = useBacktestRunner({
    request: compareRequest ?? request,
    requestReady: requestReady && Boolean(compareRequest),
    precheck: comparePrecheck
  });

  const [optimizationState, optimizationActions] = useOptimizationRunner({
    request,
    requestReady,
    optimizationConfig,
    optimizationConfigReady,
    optimizationPrecheck,
    showToast,
    onEnterOptimize: () => setMode("optimize")
  });

  useEffect(() => {
    if (compareRunToken <= 0 || !compareRequest) {
      return;
    }
    void runCompareBacktest();
  }, [compareRunToken, compareRequest, runCompareBacktest]);

  const canExportBacktest = useMemo(() => Boolean(result), [result]);

  const onCsvLoaded = (filename: string, content: string) => {
    setCsvFileName(filename);
    setRequest((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        source: "csv",
        csv_content: content
      }
    }));
  };

  const handleApplyOptimizationRow = (row: OptimizationRow) => {
    setRequest((prev) => ({
      ...prev,
      strategy: {
        ...prev.strategy,
        lower: row.lower_price,
        upper: row.upper_price,
        stop_loss: row.stop_price,
        leverage: row.leverage,
        grids: row.grids,
        use_base_position: row.use_base_position
      }
    }));
    setMode("backtest");
    showToast("已将优化参数回填到回测面板。");
  };

  const handleClearComparison = () => {
    setCompareLabel(null);
    setCompareRequest(null);
    setCompareRunToken(0);
    resetCompareBacktest();
  };

  const handleRunBacktest = async () => {
    handleClearComparison();
    setBaselineRequest(cloneBacktestRequest(request));
    await runBacktest();
  };

  const handleRunComparison = (row: OptimizationRow) => {
    if (!result) {
      setMode("backtest");
      showToast("请先完成一次当前参数回测，再执行参数对比。");
      return;
    }
    const baseRequest = baselineRequest ?? request;
    const comparisonPayload: BacktestRequest = {
      strategy: {
        ...baseRequest.strategy,
        lower: row.lower_price,
        upper: row.upper_price,
        stop_loss: row.stop_price,
        leverage: row.leverage,
        grids: row.grids,
        use_base_position: row.use_base_position
      },
      data: {
        ...baseRequest.data
      }
    };
    setCompareRequest(comparisonPayload);
    setCompareLabel(`优化组合 #${row.row_id}`);
    setMode("backtest");
    setCompareRunToken((value) => value + 1);
  };

  const handleCopyLiveParams = async (row: OptimizationRow) => {
    const payload = {
      lower: row.lower_price,
      upper: row.upper_price,
      stop_loss: row.stop_price,
      leverage: row.leverage,
      grids: row.grids,
      use_base_position: row.use_base_position,
      base_grid_count: row.base_grid_count,
      initial_position_size: row.initial_position_size,
      anchor_price: row.anchor_price,
      band_width_pct: row.band_width_pct,
      stop_loss_ratio_pct: row.stop_loss_ratio_pct
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showToast("参数 JSON 已复制到剪贴板。");
    } catch {
      optimizationActions.setOptimizationError("复制参数 JSON 失败，请检查浏览器剪贴板权限。");
    }
  };

  return (
    <div className="mx-auto max-w-[1900px] p-4 md:p-6">
      {toastMessage && (
        <div className="fixed right-4 top-4 z-50 rounded-md border border-cyan-400/40 bg-slate-950/90 px-3 py-2 text-xs text-cyan-100 shadow-lg">
          {toastMessage}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_minmax(0,1fr)]">
        <ParameterForm
          mode={mode}
          request={request}
          onChange={setRequest}
          optimizationConfig={optimizationConfig}
          onOptimizationConfigChange={setOptimizationConfig}
          onCsvLoaded={onCsvLoaded}
          onRun={mode === "backtest" ? handleRunBacktest : optimizationActions.startOptimizationRun}
          loading={mode === "backtest" ? loading : optimizationState.optimizationRunning}
          csvFileName={csvFileName}
          marketParamsSyncing={marketParamsSyncing}
          marketParamsNote={marketParamsNote}
          onSyncMarketParams={() => syncMarketParams()}
          runLabel={mode === "backtest" ? "开始回测" : "开始参数优化"}
          runningLabel={mode === "backtest" ? "回测中..." : "优化中..."}
          hideRunButton={false}
        />

        <main className="min-w-0 space-y-4">
          {onboardingVisible && (
            <div className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-cyan-200">新手 3 步流程</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-300">
                    <li>先在左侧设置交易对、时间区间、网格参数，点击开始回测。</li>
                    <li>确认收益曲线、回撤和事件时间线，排除异常参数。</li>
                    <li>切到参数优化，筛选通过约束的组合并一键应用回测复核。</li>
                  </ol>
                </div>
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200"
                  onClick={() => {
                    writePlain(STORAGE_KEYS.onboardingDismissed, "1");
                    setOnboardingVisible(false);
                  }}
                >
                  我知道了
                </button>
              </div>
            </div>
          )}

          <div className="card flex items-center justify-between p-2">
            <div className="inline-flex rounded-lg border border-slate-700/70 bg-slate-900/60 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "backtest" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
                }`}
                onClick={() => setMode("backtest")}
              >
                回测
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "optimize" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
                }`}
                onClick={() => setMode("optimize")}
              >
                参数优化
              </button>
            </div>
            <p className="text-xs text-slate-400">优化模块：Random Pruned / Bayesian / Grid + 剪枝 + Walk-forward</p>
          </div>

          {mode === "backtest" && (
            <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载回测面板中...</div>}>
              <BacktestPanel
                error={error}
                result={result}
                loading={loading}
                compareResult={compareResult}
                compareLoading={compareLoading}
                compareError={compareError}
                compareLabel={compareLabel}
                onClearComparison={handleClearComparison}
                canExportBacktest={canExportBacktest}
                symbol={request.data.symbol}
                onExportBacktest={() => {
                  if (result) {
                    exportBacktestResultCsv(result, baselineRequest ?? request);
                  }
                }}
              />
            </Suspense>
          )}

          {mode === "optimize" && (
            <Suspense fallback={<div className="card p-4 text-sm text-slate-300">加载优化面板中...</div>}>
              <OptimizationPanel
                config={optimizationConfig}
                onChangeConfig={setOptimizationConfig}
                optimizationError={optimizationState.optimizationError}
                optimizationStatus={optimizationState.optimizationStatus}
                optimizationEtaSeconds={optimizationState.optimizationEtaSeconds}
                optimizationHistory={optimizationState.optimizationHistory}
                optimizationHistoryLoading={optimizationState.optimizationHistoryLoading}
                onRefreshOptimizationHistory={optimizationActions.refreshOptimizationHistory}
                onLoadOptimizationHistoryJob={optimizationActions.loadOptimizationJob}
                onRestartOptimizationHistoryJob={optimizationActions.restartOptimizationJob}
                onFetchOptimizationHistoryJobStatus={optimizationActions.fetchHistoryJobStatus}
                onCancelOptimization={optimizationActions.cancelOptimizationRun}
                onExportOptimization={optimizationActions.exportOptimizationResult}
                onApplyOptimizationRow={handleApplyOptimizationRow}
                onCompareOptimizationRow={handleRunComparison}
                onCopyLiveParams={handleCopyLiveParams}
                optimizationSortBy={optimizationState.optimizationSortBy}
                onOptimizationSortByChange={(value) => {
                  optimizationActions.setOptimizationSortBy(value);
                  optimizationActions.setOptimizationPage(1);
                }}
                optimizationSortOrder={optimizationState.optimizationSortOrder}
                onOptimizationSortOrderChange={(value) => {
                  optimizationActions.setOptimizationSortOrder(value);
                  optimizationActions.setOptimizationPage(1);
                }}
                optimizationPageSize={optimizationState.optimizationPageSize}
                onOptimizationPageSizeChange={(value) => {
                  optimizationActions.setOptimizationPageSize(value);
                  optimizationActions.setOptimizationPage(1);
                }}
                optimizationPage={optimizationState.optimizationPage}
                totalOptimizationPages={optimizationState.totalOptimizationPages}
                onPrevPage={() => optimizationActions.setOptimizationPage((p) => Math.max(1, p - 1))}
                onNextPage={() =>
                  optimizationActions.setOptimizationPage((p) =>
                    Math.min(optimizationState.totalOptimizationPages, p + 1)
                  )
                }
                optimizationResultTab={optimizationState.optimizationResultTab}
                onOptimizationResultTabChange={optimizationActions.setOptimizationResultTab}
              />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
