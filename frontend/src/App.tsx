import { useEffect, useMemo, useState } from "react";
import LineChart from "./components/LineChart";
import MetricCards from "./components/MetricCards";
import OptimizationControls from "./components/OptimizationControls";
import OptimizationHeatmap from "./components/OptimizationHeatmap";
import OptimizationProgressChart from "./components/OptimizationProgressChart";
import OptimizationResultsTable from "./components/OptimizationResultsTable";
import ParameterForm from "./components/ParameterForm";
import PriceGridChart from "./components/PriceGridChart";
import TradesTable from "./components/TradesTable";
import {
  exportOptimizationCsv,
  fetchDefaults,
  fetchOptimizationStatus,
  runBacktest,
  startOptimization
} from "./lib/api";
import {
  BacktestRequest,
  BacktestResponse,
  OptimizationConfig,
  OptimizationRequest,
  OptimizationRow,
  OptimizationStatusResponse,
  SweepRange,
  SortOrder
} from "./types";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const BACKTEST_PARAMS_STORAGE_KEY = "btc-grid-backtest:last-backtest-request:v1";
const OPTIMIZATION_PARAMS_STORAGE_KEY = "btc-grid-backtest:last-optimization-config:v1";
const DEFAULT_OPT_WORKERS =
  typeof navigator !== "undefined"
    ? Math.max(1, Math.min(64, navigator.hardwareConcurrency || 4))
    : 4;
type OptimizationResultTab = "table" | "heatmap" | "curves";
const OPTIMIZATION_RESULT_TABS: Array<{ id: OptimizationResultTab; label: string }> = [
  { id: "table", label: "结果表格" },
  { id: "heatmap", label: "热力图" },
  { id: "curves", label: "曲线分析" }
];

function toBeijingIsoMinuteFromUnixMs(unixMs: number): string {
  const roundedMs = Math.floor(unixMs / MINUTE_MS) * MINUTE_MS;
  const beijingMs = roundedMs + BEIJING_OFFSET_MS;
  const beijingDate = new Date(beijingMs);

  const y = beijingDate.getUTCFullYear();
  const mo = String(beijingDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(beijingDate.getUTCDate()).padStart(2, "0");
  const h = String(beijingDate.getUTCHours()).padStart(2, "0");
  const mi = String(beijingDate.getUTCMinutes()).padStart(2, "0");

  return `${y}-${mo}-${d}T${h}:${mi}:00+08:00`;
}

const fallbackEndTime = toBeijingIsoMinuteFromUnixMs(Date.now());
const fallbackStartTime = toBeijingIsoMinuteFromUnixMs(Date.now() - 14 * DAY_MS);

const FALLBACK_DEFAULTS: BacktestRequest = {
  strategy: {
    side: "long",
    lower: 62000,
    upper: 70000,
    grids: 24,
    leverage: 5,
    margin: 2000,
    stop_loss: 59000,
    use_base_position: false,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    slippage: 0.0002,
    maintenance_margin_rate: 0.005
  },
  data: {
    source: "binance",
    symbol: "BTCUSDT",
    interval: "1h",
    lookback_days: 14,
    start_time: fallbackStartTime,
    end_time: fallbackEndTime,
    csv_content: null
  }
};

const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  optimization_mode: "random_pruned",
  leverage: {
    enabled: true,
    start: 5,
    end: 12,
    step: 1,
    values: null
  },
  grids: {
    enabled: true,
    start: 4,
    end: 12,
    step: 1,
    values: null
  },
  band_width_pct: {
    enabled: true,
    start: 5,
    end: 10,
    step: 1,
    values: null
  },
  stop_loss_ratio_pct: {
    enabled: true,
    start: 0.5,
    end: 2,
    step: 0.5,
    values: null
  },
  optimize_base_position: false,
  anchor_mode: "BACKTEST_START_PRICE",
  custom_anchor_price: null,
  target: "return_drawdown_ratio",
  custom_score_expr: "total_return_usdt / max(max_drawdown_pct, 1)",
  min_closed_trades: 4,
  max_drawdown_pct_limit: null,
  require_positive_return: true,
  robust_validation_weight: 0.7,
  robust_gap_penalty: 0.2,
  max_combinations: 500,
  max_trials: 2000,
  auto_limit_combinations: true,
  max_workers: DEFAULT_OPT_WORKERS,
  batch_size: 300,
  chunk_size: 64,
  warmup_ratio: 0.15,
  random_seed: null,
  resume_study: false,
  resume_study_key: null,
  enable_early_pruning: true,
  drawdown_prune_multiplier: 1.5,
  enable_profit_pruning: true,
  pruning_steps: 2,
  enable_topk_refine: false,
  topk_refine_k: 5,
  refine_leverage_delta: 1,
  refine_grids_delta: 1,
  refine_band_delta_pct: 0.5,
  refine_stop_delta_pct: 0.25,
  walk_forward_enabled: true,
  train_ratio: 0.5
};

function normalizeStoredRequest(raw: unknown): BacktestRequest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<BacktestRequest>;
  if (!candidate.strategy || !candidate.data) {
    return null;
  }

  return {
    strategy: {
      ...FALLBACK_DEFAULTS.strategy,
      ...candidate.strategy
    },
    data: {
      ...FALLBACK_DEFAULTS.data,
      ...candidate.data,
      // Never restore raw CSV payload from local storage.
      csv_content: null
    }
  };
}

function mergeSweepRange(defaultSweep: SweepRange, candidateSweep: unknown): SweepRange {
  if (!candidateSweep || typeof candidateSweep !== "object") {
    return { ...defaultSweep };
  }
  return {
    ...defaultSweep,
    ...(candidateSweep as Partial<SweepRange>)
  };
}

function normalizeStoredOptimizationConfig(raw: unknown): OptimizationConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<OptimizationConfig>;
  const merged: OptimizationConfig = {
    ...DEFAULT_OPTIMIZATION_CONFIG,
    ...candidate,
    leverage: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.leverage, candidate.leverage),
    grids: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.grids, candidate.grids),
    band_width_pct: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.band_width_pct, candidate.band_width_pct),
    stop_loss_ratio_pct: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.stop_loss_ratio_pct, candidate.stop_loss_ratio_pct)
  };
  if (!Number.isFinite(merged.max_trials) || merged.max_trials <= 0) {
    const legacy = Number((candidate as Partial<OptimizationConfig>).max_combinations ?? DEFAULT_OPTIMIZATION_CONFIG.max_trials);
    merged.max_trials = Number.isFinite(legacy) && legacy > 0 ? legacy : DEFAULT_OPTIMIZATION_CONFIG.max_trials;
  }
  return merged;
}

function loadStoredBacktestRequest(): BacktestRequest | null {
  try {
    const raw = window.localStorage.getItem(BACKTEST_PARAMS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredRequest(parsed);
  } catch {
    return null;
  }
}

function loadStoredOptimizationConfig(): OptimizationConfig | null {
  try {
    const raw = window.localStorage.getItem(OPTIMIZATION_PARAMS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredOptimizationConfig(parsed);
  } catch {
    return null;
  }
}

function saveBacktestRequestToStorage(request: BacktestRequest): void {
  try {
    const safeRequest: BacktestRequest = {
      strategy: { ...request.strategy },
      data: {
        ...request.data,
        // Avoid restoring CSV mode without file content in a new session.
        source: request.data.source === "csv" ? "binance" : request.data.source,
        csv_content: null
      }
    };
    window.localStorage.setItem(BACKTEST_PARAMS_STORAGE_KEY, JSON.stringify(safeRequest));
  } catch {
    // no-op when storage is unavailable
  }
}

function saveOptimizationConfigToStorage(config: OptimizationConfig): void {
  try {
    window.localStorage.setItem(OPTIMIZATION_PARAMS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // no-op when storage is unavailable
  }
}

function exportBacktestResultCsv(result: BacktestResponse) {
  const lines: string[] = [];

  lines.push("section,key,value");
  Object.entries(result.summary).forEach(([key, value]) => {
    lines.push(["summary", key, String(value)].join(","));
  });

  lines.push("", "trades,open_time,close_time,side,entry_price,exit_price,quantity,gross_pnl,net_pnl,fee_paid,holding_hours,close_reason");
  result.trades.forEach((trade) => {
    lines.push(
      [
        "trade",
        trade.open_time,
        trade.close_time,
        trade.side,
        trade.entry_price,
        trade.exit_price,
        trade.quantity,
        trade.gross_pnl,
        trade.net_pnl,
        trade.fee_paid,
        trade.holding_hours,
        trade.close_reason
      ].join(",")
    );
  });

  lines.push("", "equity,timestamp,equity");
  result.equity_curve.forEach((point) => {
    lines.push(["equity", point.timestamp, point.value].join(","));
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

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export default function App() {
  const [mode, setMode] = useState<"backtest" | "optimize">("backtest");

  const [request, setRequest] = useState<BacktestRequest>(FALLBACK_DEFAULTS);
  const [requestReady, setRequestReady] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>(DEFAULT_OPTIMIZATION_CONFIG);
  const [optimizationConfigReady, setOptimizationConfigReady] = useState(false);
  const [optimizationJobId, setOptimizationJobId] = useState<string | null>(null);
  const [optimizationStatus, setOptimizationStatus] = useState<OptimizationStatusResponse | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [optimizationStarting, setOptimizationStarting] = useState(false);

  const [optimizationPage, setOptimizationPage] = useState(1);
  const [optimizationPageSize, setOptimizationPageSize] = useState(20);
  const [optimizationSortBy, setOptimizationSortBy] = useState("robust_score");
  const [optimizationSortOrder, setOptimizationSortOrder] = useState<SortOrder>("desc");
  const [optimizationResultTab, setOptimizationResultTab] = useState<OptimizationResultTab>("table");

  useEffect(() => {
    let mounted = true;

    const stored = loadStoredBacktestRequest();
    if (stored) {
      if (mounted) {
        setRequest(stored);
        setRequestReady(true);
      }
      return () => {
        mounted = false;
      };
    }

    fetchDefaults()
      .then((defaults) => {
        if (mounted) {
          setRequest(defaults);
        }
      })
      .catch(() => {
        // Keep fallback defaults when backend is not yet running.
      })
      .finally(() => {
        if (mounted) {
          setRequestReady(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!requestReady) {
      return;
    }
    saveBacktestRequestToStorage(request);
  }, [request, requestReady]);

  useEffect(() => {
    const storedOptimizationConfig = loadStoredOptimizationConfig();
    if (storedOptimizationConfig) {
      setOptimizationConfig(storedOptimizationConfig);
    }
    setOptimizationConfigReady(true);
  }, []);

  useEffect(() => {
    if (!optimizationConfigReady) {
      return;
    }
    saveOptimizationConfigToStorage(optimizationConfig);
  }, [optimizationConfig, optimizationConfigReady]);

  useEffect(() => {
    if (!optimizationJobId) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      try {
        const status = await fetchOptimizationStatus(
          optimizationJobId,
          optimizationPage,
          optimizationPageSize,
          optimizationSortBy,
          optimizationSortOrder
        );
        if (cancelled) {
          return;
        }

        setOptimizationStatus(status);

        const jobStatus = status.job.status;
        if (jobStatus === "completed" || jobStatus === "failed") {
          if (timer) {
            window.clearInterval(timer);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "获取优化状态失败";
          setOptimizationError(message);
        }
      }
    };

    refresh();
    timer = window.setInterval(refresh, 1500);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [optimizationJobId, optimizationPage, optimizationPageSize, optimizationSortBy, optimizationSortOrder]);

  const canExportBacktest = useMemo(() => Boolean(result), [result]);
  const optimizationRunning =
    optimizationStarting ||
    (optimizationStatus?.job.status !== "completed" && optimizationStatus?.job.status !== "failed" && !!optimizationJobId);

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

  const handleRunBacktest = async () => {
    if (request.data.source === "csv" && !request.data.csv_content) {
      setError("已选择 CSV 数据源，但尚未上传 CSV 内容。");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await runBacktest(request);
      setResult(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "回测失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartOptimization = async () => {
    if (request.data.source === "csv" && !request.data.csv_content) {
      setOptimizationError("已选择 CSV 数据源，但尚未上传 CSV 内容。");
      return;
    }
    if (
      optimizationConfig.anchor_mode === "CUSTOM_PRICE" &&
      (!optimizationConfig.custom_anchor_price || optimizationConfig.custom_anchor_price <= 0)
    ) {
      setOptimizationError("当 Anchor 模式为 CUSTOM_PRICE 时，请输入大于 0 的自定义 Anchor 价格。");
      return;
    }

    setOptimizationStarting(true);
    setOptimizationError(null);

    try {
      const payload: OptimizationRequest = {
        base_strategy: request.strategy,
        data: request.data,
        optimization: optimizationConfig
      };

      const started = await startOptimization(payload);
      setOptimizationJobId(started.job_id);
      setOptimizationStatus(null);
      setOptimizationPage(1);
      setOptimizationResultTab("table");
    } catch (err) {
      const message = err instanceof Error ? err.message : "启动优化失败";
      setOptimizationError(message);
    } finally {
      setOptimizationStarting(false);
    }
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
    } catch {
      setOptimizationError("复制参数 JSON 失败，请检查浏览器剪贴板权限。");
    }
  };

  const handleExportOptimization = async () => {
    if (!optimizationJobId) {
      return;
    }

    try {
      const blob = await exportOptimizationCsv(optimizationJobId, optimizationSortBy, optimizationSortOrder);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `optimization-${optimizationJobId}.csv`);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "导出优化结果失败";
      setOptimizationError(message);
    }
  };

  const totalOptimizationPages = optimizationStatus
    ? Math.max(1, Math.ceil(optimizationStatus.total_results / optimizationStatus.page_size))
    : 1;

  return (
    <div className="mx-auto max-w-[1900px] p-4 md:p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[360px_minmax(0,1fr)]">
        <ParameterForm
          request={request}
          onChange={setRequest}
          onCsvLoaded={onCsvLoaded}
          onRun={mode === "backtest" ? handleRunBacktest : handleStartOptimization}
          loading={mode === "backtest" ? loading : optimizationRunning}
          csvFileName={csvFileName}
          runLabel={mode === "backtest" ? "开始回测" : "开始优化"}
          runningLabel={mode === "backtest" ? "回测中..." : "优化中..."}
        />

        <main className="min-w-0 space-y-4">
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
            <>
              {error && (
                <div className="card p-4 text-sm text-rose-300">
                  <p className="font-medium">回测错误</p>
                  <p className="mt-1">{error}</p>
                </div>
              )}

              {!result && !loading && (
                <div className="card flex min-h-[220px] items-center justify-center p-4 text-slate-300">
                  请输入参数并点击“开始回测”
                </div>
              )}

              {result && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="rounded-md border border-cyan-400/60 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-60"
                      disabled={!canExportBacktest}
                      type="button"
                      onClick={() => exportBacktestResultCsv(result)}
                    >
                      导出结果为 CSV
                    </button>
                    <p className="text-xs text-slate-400">导出包含 summary/trades/equity 三个分区</p>
                  </div>

                  <MetricCards summary={result.summary} />

                  <PriceGridChart candles={result.candles} gridLines={result.grid_lines} />

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <LineChart
                      title="收益曲线 (Equity Curve)"
                      data={result.equity_curve}
                      color="#22c55e"
                      yAxisLabel="USDT"
                    />
                    <LineChart
                      title="回撤曲线 (Drawdown)"
                      data={result.drawdown_curve}
                      color="#f43f5e"
                      yAxisLabel="%"
                      area
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <LineChart
                      title="保证金风险率"
                      data={result.margin_ratio_curve}
                      color="#38bdf8"
                      yAxisLabel="ratio"
                    />
                    <LineChart
                      title="杠杆使用率"
                      data={result.leverage_usage_curve}
                      color="#f59e0b"
                      yAxisLabel="x"
                    />
                  </div>

                  <LineChart
                    title="预估强平价格"
                    data={result.liquidation_price_curve}
                    color="#a78bfa"
                    yAxisLabel="price"
                  />

                  <TradesTable trades={result.trades} />
                </>
              )}
            </>
          )}

          {mode === "optimize" && (
            <>
              <OptimizationControls
                config={optimizationConfig}
                onChange={setOptimizationConfig}
                onStart={handleStartOptimization}
                running={optimizationRunning}
              />

              {optimizationError && (
                <div className="card p-4 text-sm text-rose-300">
                  <p className="font-medium">优化错误</p>
                  <p className="mt-1">{optimizationError}</p>
                </div>
              )}

              {optimizationStatus && (
                <>
                  <div className="card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-200">任务ID: {optimizationStatus.job.job_id}</p>
                        <p className="text-xs text-slate-400">
                          状态: {optimizationStatus.job.status} · 进度: {fmt(optimizationStatus.job.progress, 1)}% ·
                          总测试数: {optimizationStatus.job.total_combinations}
                        </p>
                        <p className="text-xs text-slate-500">
                          完成 Trial: {optimizationStatus.job.trials_completed} · 剪枝 Trial:{" "}
                          {optimizationStatus.job.trials_pruned} · 剪枝率:{" "}
                          {fmt((optimizationStatus.job.pruning_ratio ?? 0) * 100, 1)}%
                        </p>
                        {optimizationStatus.job.message && (
                          <p className="mt-1 text-xs text-slate-500">{optimizationStatus.job.message}</p>
                        )}
                      </div>

                      <button
                        className="rounded-md border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-60"
                        type="button"
                        disabled={optimizationStatus.job.status !== "completed"}
                        onClick={handleExportOptimization}
                      >
                        导出优化结果 CSV
                      </button>
                    </div>

                    <div className="mt-3 h-2 rounded bg-slate-800">
                      <div
                        className="h-2 rounded bg-emerald-400 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, optimizationStatus.job.progress))}%` }}
                      />
                    </div>

                    {(optimizationStatus.train_window || optimizationStatus.validation_window) && (
                      <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-300 xl:grid-cols-2">
                        {optimizationStatus.train_window && (
                          <div className="rounded border border-slate-700/60 p-2">
                            训练期: {new Date(optimizationStatus.train_window.start_time).toLocaleString()} ~{" "}
                            {new Date(optimizationStatus.train_window.end_time).toLocaleString()} ({optimizationStatus.train_window.candles} 根)
                          </div>
                        )}
                        {optimizationStatus.validation_window && (
                          <div className="rounded border border-slate-700/60 p-2">
                            验证期: {new Date(optimizationStatus.validation_window.start_time).toLocaleString()} ~{" "}
                            {new Date(optimizationStatus.validation_window.end_time).toLocaleString()} ({optimizationStatus.validation_window.candles} 根)
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {(optimizationStatus.best_row || optimizationStatus.best_validation_row) && (
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      {optimizationStatus.best_row && (
                        <div className="card p-3 text-xs text-slate-200">
                          <p className="font-semibold text-emerald-300">训练期最优参数</p>
                          <p className="mt-1">
                            杠杆 {fmt(optimizationStatus.best_row.leverage, 2)}x · 网格 {optimizationStatus.best_row.grids} ·
                            开底仓 {optimizationStatus.best_row.use_base_position ? "是" : "否"} ·
                            区间 ±{fmt(optimizationStatus.best_row.band_width_pct, 2)}% · 止损 +
                            {fmt(optimizationStatus.best_row.stop_loss_ratio_pct, 2)}%
                          </p>
                          <p className="mt-1">
                            底仓格数 {optimizationStatus.best_row.base_grid_count} · 底仓规模{" "}
                            {fmt(optimizationStatus.best_row.initial_position_size, 2)} ·
                            Anchor {fmt(optimizationStatus.best_row.anchor_price, 2)} · LOWER{" "}
                            {fmt(optimizationStatus.best_row.lower_price, 2)} · UPPER {fmt(optimizationStatus.best_row.upper_price, 2)} ·
                            STOP {fmt(optimizationStatus.best_row.stop_price, 2)}
                          </p>
                          <p className="mt-1">
                            稳健评分 {fmt(optimizationStatus.best_row.robust_score, 4)} · 训练评分{" "}
                            {fmt(optimizationStatus.best_row.score, 4)} · 收益 {fmt(optimizationStatus.best_row.total_return_usdt, 2)} USDT
                          </p>
                          <p className="mt-1">
                            过拟合惩罚 {fmt(optimizationStatus.best_row.overfit_penalty, 4)} · 约束{" "}
                            {optimizationStatus.best_row.passes_constraints ? "通过" : "未通过"}
                          </p>
                          <button
                            type="button"
                            className="mt-2 rounded border border-cyan-400/60 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                            onClick={() => handleApplyOptimizationRow(optimizationStatus.best_row!)}
                          >
                            应用到回测模块
                          </button>
                        </div>
                      )}
                      {optimizationStatus.best_validation_row && (
                        <div className="card p-3 text-xs text-slate-200">
                          <p className="font-semibold text-amber-300">验证期最优参数</p>
                          <p className="mt-1">
                            杠杆 {fmt(optimizationStatus.best_validation_row.leverage, 2)}x · 网格 {optimizationStatus.best_validation_row.grids} ·
                            开底仓 {optimizationStatus.best_validation_row.use_base_position ? "是" : "否"} ·
                            区间 ±{fmt(optimizationStatus.best_validation_row.band_width_pct, 2)}%
                          </p>
                          <p className="mt-1">
                            底仓格数 {optimizationStatus.best_validation_row.base_grid_count} · 底仓规模{" "}
                            {fmt(optimizationStatus.best_validation_row.initial_position_size, 2)} ·
                            Anchor {fmt(optimizationStatus.best_validation_row.anchor_price, 2)} · LOWER{" "}
                            {fmt(optimizationStatus.best_validation_row.lower_price, 2)} · UPPER{" "}
                            {fmt(optimizationStatus.best_validation_row.upper_price, 2)} · STOP{" "}
                            {fmt(optimizationStatus.best_validation_row.stop_price, 2)}
                          </p>
                          <p className="mt-1">
                            验证评分 {fmt(optimizationStatus.best_validation_row.validation_score, 4)} / 验证收益{" "}
                            {fmt(optimizationStatus.best_validation_row.validation_total_return_usdt, 2)} USDT
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {optimizationStatus.best_row && (
                    <div className="card p-3 text-xs text-slate-200">
                      <p className="font-semibold text-cyan-200">实盘执行参数</p>
                      <p className="mt-1">
                        LOWER: {fmt(optimizationStatus.best_row.lower_price, 2)} · UPPER:{" "}
                        {fmt(optimizationStatus.best_row.upper_price, 2)} · STOP: {fmt(optimizationStatus.best_row.stop_price, 2)}
                      </p>
                      <p className="mt-1">
                        杠杆: {fmt(optimizationStatus.best_row.leverage, 2)}x · 格数: {optimizationStatus.best_row.grids} · 开底仓:{" "}
                        {optimizationStatus.best_row.use_base_position ? "是" : "否"} · 底仓格数: {optimizationStatus.best_row.base_grid_count}
                      </p>
                      <p className="mt-1">
                        底仓规模: {fmt(optimizationStatus.best_row.initial_position_size, 2)} · Anchor:{" "}
                        {fmt(optimizationStatus.best_row.anchor_price, 2)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-cyan-400/60 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                          onClick={() => handleApplyOptimizationRow(optimizationStatus.best_row!)}
                        >
                          应用到回测模块
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
                          onClick={() => handleCopyLiveParams(optimizationStatus.best_row!)}
                        >
                          复制 JSON 参数
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-slate-700/70 bg-slate-950/40 p-1">
                        {OPTIMIZATION_RESULT_TABS.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                              optimizationResultTab === tab.id
                                ? "border border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                                : "border border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80"
                            }`}
                            onClick={() => setOptimizationResultTab(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">
                        当前视图:{" "}
                        {optimizationResultTab === "table"
                          ? "结果表格"
                          : optimizationResultTab === "heatmap"
                            ? "热力图"
                            : "曲线分析"}
                      </p>
                    </div>
                  </div>

                  {optimizationResultTab === "table" && (
                    <>
                      <div className="card p-3">
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto_auto]">
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">排序字段</label>
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                              value={optimizationSortBy}
                              onChange={(e) => {
                                setOptimizationSortBy(e.target.value);
                                setOptimizationPage(1);
                              }}
                            >
                              <option value="robust_score">robust_score</option>
                              <option value="score">score</option>
                              <option value="overfit_penalty">overfit_penalty</option>
                              <option value="total_return_usdt">total_return_usdt</option>
                              <option value="max_drawdown_pct">max_drawdown_pct</option>
                              <option value="sharpe_ratio">sharpe_ratio</option>
                              <option value="return_drawdown_ratio">return_drawdown_ratio</option>
                              <option value="validation_score">validation_score</option>
                              <option value="validation_total_return_usdt">validation_total_return_usdt</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">排序方向</label>
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                              value={optimizationSortOrder}
                              onChange={(e) => {
                                setOptimizationSortOrder(e.target.value as SortOrder);
                                setOptimizationPage(1);
                              }}
                            >
                              <option value="desc">DESC</option>
                              <option value="asc">ASC</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-slate-400">每页</label>
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100"
                              value={optimizationPageSize}
                              onChange={(e) => {
                                setOptimizationPageSize(Number(e.target.value));
                                setOptimizationPage(1);
                              }}
                            >
                              <option value={10}>10</option>
                              <option value={20}>20</option>
                              <option value={50}>50</option>
                              <option value={100}>100</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <p className="text-xs text-slate-400">
                              {optimizationStatus.total_results} 组结果 · 第 {optimizationStatus.page}/{totalOptimizationPages} 页
                            </p>
                          </div>
                        </div>
                      </div>

                      <OptimizationResultsTable rows={optimizationStatus.rows} onApply={handleApplyOptimizationRow} />

                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
                          disabled={optimizationStatus.page <= 1}
                          onClick={() => setOptimizationPage((p) => Math.max(1, p - 1))}
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 disabled:opacity-40"
                          disabled={optimizationStatus.page >= totalOptimizationPages}
                          onClick={() => setOptimizationPage((p) => Math.min(totalOptimizationPages, p + 1))}
                        >
                          下一页
                        </button>
                      </div>
                    </>
                  )}

                  {optimizationResultTab === "heatmap" && <OptimizationHeatmap data={optimizationStatus.heatmap} />}

                  {optimizationResultTab === "curves" && (
                    <div className="space-y-4">
                      {(optimizationStatus.best_score_progression.length > 0 ||
                        optimizationStatus.convergence_curve_data.length > 0) && (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                          {optimizationStatus.best_score_progression.length > 0 && (
                            <OptimizationProgressChart
                              title="Best Score Progression"
                              data={optimizationStatus.best_score_progression}
                              color="#22c55e"
                              yAxisLabel="score"
                            />
                          )}
                          {optimizationStatus.convergence_curve_data.length > 0 && (
                            <OptimizationProgressChart
                              title="Convergence Curve"
                              data={optimizationStatus.convergence_curve_data}
                              color="#38bdf8"
                              yAxisLabel="score"
                              area
                            />
                          )}
                        </div>
                      )}

                      {optimizationStatus.best_equity_curve.length > 0 ? (
                        <LineChart
                          title="最优参数收益曲线"
                          data={optimizationStatus.best_equity_curve}
                          color="#22c55e"
                          yAxisLabel="USDT"
                          area
                        />
                      ) : (
                        <div className="card p-4 text-sm text-slate-300">暂无最优参数收益曲线</div>
                      )}
                    </div>
                  )}
                </>
              )}

              {!optimizationStatus && !optimizationRunning && (
                <div className="card flex min-h-[180px] items-center justify-center p-4 text-slate-300">
                  请选择参数范围并点击“开始参数优化”
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
