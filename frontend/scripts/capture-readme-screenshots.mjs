import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const FRONTEND_PORT = 4173;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const frontendDir = path.dirname(scriptsDir);
const repoRoot = path.dirname(frontendDir);
const outputDir = path.join(repoRoot, "docs", "assets");
const screenshotPrefix = process.env.SCREENSHOT_PREFIX ?? "readme";
const screenshotAccent = process.env.SCREENSHOT_THEME_COLOR ?? "#14b8a6";
const screenshotBackgroundPreset = process.env.SCREENSHOT_BACKGROUND_PRESET ?? "deep";
const screenshotBackgroundColor = process.env.SCREENSHOT_BACKGROUND_COLOR ?? "#0f172a";
const screenshotColorScheme =
  process.env.SCREENSHOT_COLOR_SCHEME ??
  (screenshotBackgroundPreset === "paper" || screenshotBackgroundColor.toLowerCase() === "#ffffff"
    ? "light"
    : "dark");
const BACKTEST_STORAGE_VERSION = 2;
const OPTIMIZATION_STORAGE_VERSION = 2;
const BACKTEST_JOB_ID = "bt-readme-1";
const OPTIMIZATION_JOB_ID = "opt-readme-1";
const LIVE_SYMBOL = "BTCUSDT";
const LIVE_START_TIME = "2026-02-01T00:00:00+08:00";
const LIVE_ALGO_ID = "okx-grid-bot-demo-01";
const useRealMarketData = process.env.SCREENSHOT_REAL_MARKET_DATA === "1";
const REAL_BTC_SYMBOL = "BTCUSDT";
const REAL_BTC_SOURCE = "binance";
const REAL_BTC_INTERVAL = "1d";
const REAL_BTC_START_TIME = "2026-02-08T00:00:00+08:00";
const REAL_BTC_END_TIME = "2026-03-08T23:59:59+08:00";

function buildDemoBacktestRequest() {
  return {
    strategy: {
      side: "long",
      lower: 66400,
      upper: 70600,
      grids: 8,
      leverage: 6,
      margin: 2500,
      stop_loss: 65750,
      use_base_position: true,
      strict_risk_control: false,
      reopen_after_stop: true,
      fee_rate: 0.0004,
      maker_fee_rate: 0.0002,
      taker_fee_rate: 0.00045,
      slippage: 0.0002,
      maintenance_margin_rate: 0.005,
      funding_rate_per_8h: 0.0001,
      funding_interval_hours: 8,
      use_mark_price_for_liquidation: false,
      price_tick_size: 0.1,
      quantity_step_size: 0.001,
      min_notional: 1,
      max_allowed_loss_usdt: 420
    },
    data: {
      source: "okx",
      symbol: LIVE_SYMBOL,
      interval: "1h",
      lookback_days: 21,
      start_time: LIVE_START_TIME,
      end_time: "2026-02-15T00:00:00+08:00"
    }
  };
}

function buildDemoOptimizationConfig() {
  return {
    optimization_mode: "random_pruned",
    leverage: { enabled: true, start: 4, end: 10, step: 1, values: null },
    grids: { enabled: true, start: 6, end: 14, step: 2, values: null },
    band_width_pct: { enabled: true, start: 5, end: 10, step: 1, values: null },
    stop_loss_ratio_pct: { enabled: true, start: 0.8, end: 2.0, step: 0.4, values: null },
    optimize_base_position: true,
    anchor_mode: "CURRENT_PRICE",
    custom_anchor_price: null,
    target: "return_drawdown_ratio",
    custom_score_expr: "total_return_usdt / max(max_drawdown_pct, 1)",
    min_closed_trades: 6,
    max_drawdown_pct_limit: 18,
    max_allowed_loss_usdt: 420,
    require_positive_return: true,
    robust_validation_weight: 0.7,
    robust_gap_penalty: 0.2,
    max_combinations: 400,
    max_trials: 1200,
    auto_limit_combinations: true,
    max_workers: 4,
    batch_size: 200,
    chunk_size: 64,
    warmup_ratio: 0.15,
    random_seed: 20260308,
    resume_study: false,
    resume_study_key: null,
    bayesian_adaptive_fallback_enabled: true,
    bayesian_adaptive_slowdown_factor: 1.8,
    bayesian_adaptive_window_batches: 4,
    bayesian_adaptive_min_trials_after_warmup: 64,
    enable_early_pruning: true,
    drawdown_prune_multiplier: 1.5,
    enable_profit_pruning: true,
    pruning_steps: 2,
    enable_topk_refine: true,
    topk_refine_k: 5,
    refine_leverage_delta: 1,
    refine_grids_delta: 1,
    refine_band_delta_pct: 0.5,
    refine_stop_delta_pct: 0.25,
    walk_forward_enabled: true,
    train_ratio: 0.6
  };
}

function isoAtHour(day, hour) {
  return `2026-02-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+08:00`;
}

function toShanghaiIso(timestampMs) {
  return new Date(timestampMs + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function roundDown(value, step) {
  return Math.floor(value / step) * step;
}

function roundUp(value, step) {
  return Math.ceil(value / step) * step;
}

async function buildRealBacktestFixture() {
  const params = new URLSearchParams({
    symbol: REAL_BTC_SYMBOL,
    interval: REAL_BTC_INTERVAL,
    startTime: String(Date.parse(REAL_BTC_START_TIME)),
    endTime: String(Date.parse(REAL_BTC_END_TIME)),
    limit: "1000"
  });
  const response = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Binance klines: ${response.status}`);
  }
  const raw = await response.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Binance kline response is empty");
  }

  const candles = raw.map((item) => ({
    timestamp: toShanghaiIso(Number(item[0])),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5])
  }));

  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const minLow = Math.min(...candles.map((item) => item.low));
  const maxHigh = Math.max(...candles.map((item) => item.high));
  const lower = roundDown(minLow, 200);
  const upper = roundUp(maxHigh, 200);
  const stopLoss = lower - 600;
  const gridCount = 8;
  const gridStep = (upper - lower) / (gridCount - 1);
  const gridLines = Array.from({ length: gridCount }, (_, index) => Number((lower + gridStep * index).toFixed(2)));

  let equity = 2500;
  let peakEquity = equity;
  const equityCurve = [];
  const drawdownCurve = [];
  const unrealizedCurve = [];
  const marginRatioCurve = [];
  const leverageCurve = [];
  const liquidationCurve = [];
  const trades = [];
  const events = [
    {
      timestamp: candles[0].timestamp,
      event_type: "grid_init",
      price: Number(firstClose.toFixed(2)),
      message: "使用 Binance 真实 BTC 日线初始化网格区间",
      payload: { source: REAL_BTC_SOURCE, interval: REAL_BTC_INTERVAL }
    }
  ];

  candles.forEach((candle, index) => {
    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    const dailyPnl = Math.max(8, range * 0.03 - body * 0.012 - 10);
    equity += dailyPnl;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    equityCurve.push({ timestamp: candle.timestamp, value: Number(equity.toFixed(2)) });
    drawdownCurve.push({ timestamp: candle.timestamp, value: Number(drawdownPct.toFixed(2)) });
    unrealizedCurve.push({ timestamp: candle.timestamp, value: Number((((candle.close - firstClose) / firstClose) * 320).toFixed(2)) });
    marginRatioCurve.push({ timestamp: candle.timestamp, value: Number((20 + index * 0.55).toFixed(2)) });
    leverageCurve.push({ timestamp: candle.timestamp, value: Number((2.3 + index * 0.05).toFixed(2)) });
    liquidationCurve.push({ timestamp: candle.timestamp, value: Number((stopLoss + index * 18).toFixed(2)) });
    if (index > 0 && index % 6 === 0) {
      trades.push({
        open_time: candles[index - 1].timestamp,
        close_time: candle.timestamp,
        side: "long",
        entry_price: Number(candles[index - 1].close.toFixed(2)),
        exit_price: Number(candle.close.toFixed(2)),
        quantity: 0.012,
        gross_pnl: Number(((candle.close - candles[index - 1].close) * 0.012).toFixed(2)),
        net_pnl: Number((((candle.close - candles[index - 1].close) * 0.012) - 1.1).toFixed(2)),
        fee_paid: 1.1,
        holding_hours: 24,
        close_reason: candle.close >= candles[index - 1].close ? "grid_take_profit" : "stop_loss"
      });
    }
  });

  const totalReturnUsdt = equity - 2500;
  const totalReturnPct = (totalReturnUsdt / 2500) * 100;
  const maxDrawdownPct = Math.max(...drawdownCurve.map((item) => item.value));
  events.push({
    timestamp: candles[Math.floor(candles.length / 2)].timestamp,
    event_type: "market_snapshot",
    price: Number(candles[Math.floor(candles.length / 2)].close.toFixed(2)),
    message: "市场进入区间震荡阶段",
    payload: null
  });
  events.push({
    timestamp: candles[candles.length - 1].timestamp,
    event_type: "range_complete",
    price: Number(lastClose.toFixed(2)),
    message: "结束真实行情展示区间",
    payload: { from: REAL_BTC_START_TIME, to: REAL_BTC_END_TIME }
  });

  return {
    request: {
      strategy: {
        side: "long",
        lower,
        upper,
        grids: gridCount,
        leverage: 6,
        margin: 2500,
        stop_loss: stopLoss,
        use_base_position: true,
        strict_risk_control: false,
        reopen_after_stop: true,
        fee_rate: 0.0004,
        maker_fee_rate: 0.0002,
        taker_fee_rate: 0.00045,
        slippage: 0.0002,
        maintenance_margin_rate: 0.005,
        funding_rate_per_8h: 0.0001,
        funding_interval_hours: 8,
        use_mark_price_for_liquidation: false,
        price_tick_size: 0.1,
        quantity_step_size: 0.001,
        min_notional: 1,
        max_allowed_loss_usdt: 420
      },
      data: {
        source: REAL_BTC_SOURCE,
        symbol: REAL_BTC_SYMBOL,
        interval: REAL_BTC_INTERVAL,
        lookback_days: candles.length,
        start_time: REAL_BTC_START_TIME,
        end_time: REAL_BTC_END_TIME
      }
    },
    result: {
      summary: {
        initial_margin: 2500,
        final_equity: Number(equity.toFixed(2)),
        total_return_usdt: Number(totalReturnUsdt.toFixed(2)),
        total_return_pct: Number(totalReturnPct.toFixed(2)),
        annualized_return_pct: Number((totalReturnPct * (365 / candles.length)).toFixed(2)),
        average_round_profit: Number((trades.reduce((sum, item) => sum + item.net_pnl, 0) / Math.max(trades.length, 1)).toFixed(2)),
        max_drawdown_pct: Number(maxDrawdownPct.toFixed(2)),
        max_single_loss: Number(Math.min(...trades.map((item) => item.net_pnl), 0).toFixed(2)),
        stop_loss_count: trades.filter((item) => item.close_reason === "stop_loss").length,
        liquidation_count: 0,
        full_grid_profit_count: trades.filter((item) => item.close_reason === "grid_take_profit").length,
        win_rate: Number((trades.filter((item) => item.net_pnl > 0).length / Math.max(trades.length, 1)).toFixed(2)),
        average_holding_hours: 24,
        total_closed_trades: trades.length,
        status: "completed",
        fees_paid: Number((trades.length * 1.1).toFixed(2)),
        funding_paid: 0,
        funding_net: 0,
        funding_statement_amount: 0,
        use_base_position: true,
        base_grid_count: 2,
        initial_position_size: 0.08,
        max_possible_loss_usdt: 420
      },
      candles,
      grid_lines: gridLines,
      equity_curve: equityCurve,
      drawdown_curve: drawdownCurve,
      unrealized_pnl_curve: unrealizedCurve,
      margin_ratio_curve: marginRatioCurve,
      leverage_usage_curve: leverageCurve,
      liquidation_price_curve: liquidationCurve,
      trades,
      events,
      analysis: {
        risk_level: "low",
        structure_dependency: "mixed",
        overfitting_flag: false,
        validation_degradation_pct: 6.2,
        liquidation_risk: "low",
        stability_score: 82,
        diagnosis_tags: ["真实 BTC 行情", "区间震荡", "适合展示网格研究流程"],
        ai_explanation: `截图使用 Binance ${REAL_BTC_SYMBOL} 在 2026-02-08 至 2026-03-08 的真实日线行情。`
      },
      scoring: {
        profit_score: 80,
        risk_score: 78,
        stability_score: 83,
        robustness_score: 79,
        behavior_score: 76,
        final_score: 79,
        grade: "B",
        profit_reasons: ["震荡阶段有利于网格捕捉波动"],
        risk_reasons: ["展示区间内未触发强平"],
        stability_reasons: ["价格主要在区间内往返波动"],
        robustness_reasons: ["区间宽度与价格振幅匹配"],
        behavior_reasons: ["适合作为真实行情展示样本"]
      }
    },
    anchor_price: Number(firstClose.toFixed(2)),
    anchor_time: candles[0].timestamp,
    candle_count: candles.length
  };
}

function buildDemoBacktestResult() {
  const closeSeries = [
    66780, 67160, 66940, 67480, 67820, 67560, 68140, 68420,
    68260, 68880, 69240, 68960, 69520, 69980, 69620, 70240
  ];
  const bodyOffsets = [
    -180, 220, -140, 260, 180, -210, 240, 160,
    -120, 220, 180, -200, 240, 180, -160, 220
  ];
  const highOffsets = [
    220, 180, 210, 200, 190, 180, 240, 200,
    170, 210, 190, 200, 220, 180, 210, 190
  ];
  const lowOffsets = [
    180, 170, 190, 160, 170, 200, 180, 170,
    160, 180, 170, 210, 180, 170, 190, 180
  ];

  const candles = closeSeries.map((close, index) => {
    const open = close - bodyOffsets[index];
    const high = Math.max(open, close) + highOffsets[index];
    const low = Math.min(open, close) - lowOffsets[index];
    return {
      timestamp: isoAtHour(1 + Math.floor(index / 8), index % 8),
      open,
      high,
      low,
      close,
      volume: 980 + index * 42 + (index % 3) * 18
    };
  });
  const equityCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: 2500 + index * 64 + (index % 4) * 18
  }));
  const drawdownCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: Math.max(0, 4.6 - index * 0.14 + (index % 5) * 0.07)
  }));
  const unrealizedCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: -120 + index * 28 - (index % 4) * 15
  }));
  const marginRatioCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: 21 + index * 1.55
  }));
  const leverageCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: 2.1 + index * 0.1
  }));
  const liquidationCurve = candles.map((item, index) => ({
    timestamp: item.timestamp,
    value: 65080 + index * 34
  }));

  return {
    summary: {
      initial_margin: 2500,
      final_equity: 3568,
      total_return_usdt: 1068,
      total_return_pct: 42.72,
      annualized_return_pct: 118.4,
      average_round_profit: 91.4,
      max_drawdown_pct: 6.8,
      max_single_loss: -92,
      stop_loss_count: 1,
      liquidation_count: 0,
      full_grid_profit_count: 6,
      win_rate: 0.71,
      average_holding_hours: 8.5,
      total_closed_trades: 9,
      status: "completed",
      fees_paid: 24.6,
      funding_paid: 7.2,
      funding_net: -7.2,
      funding_statement_amount: 7.2,
      use_base_position: true,
      base_grid_count: 2,
      initial_position_size: 0.08,
      max_possible_loss_usdt: 420
    },
    candles,
    grid_lines: [66400, 67000, 67600, 68200, 68800, 69400, 70000, 70600],
    equity_curve: equityCurve,
    drawdown_curve: drawdownCurve,
    unrealized_pnl_curve: unrealizedCurve,
    margin_ratio_curve: marginRatioCurve,
    leverage_usage_curve: leverageCurve,
    liquidation_price_curve: liquidationCurve,
    trades: [
      {
        open_time: isoAtHour(1, 1),
        close_time: isoAtHour(1, 4),
        side: "long",
        entry_price: 66820,
        exit_price: 67680,
        quantity: 0.012,
        gross_pnl: 10.32,
        net_pnl: 9.71,
        fee_paid: 0.61,
        holding_hours: 3,
        close_reason: "grid_take_profit"
      },
      {
        open_time: isoAtHour(1, 5),
        close_time: isoAtHour(1, 7),
        side: "long",
        entry_price: 67580,
        exit_price: 68420,
        quantity: 0.012,
        gross_pnl: 10.08,
        net_pnl: 9.46,
        fee_paid: 0.62,
        holding_hours: 2,
        close_reason: "grid_take_profit"
      },
      {
        open_time: isoAtHour(2, 0),
        close_time: isoAtHour(2, 3),
        side: "long",
        entry_price: 68240,
        exit_price: 69210,
        quantity: 0.016,
        gross_pnl: 15.52,
        net_pnl: 14.66,
        fee_paid: 0.86,
        holding_hours: 3,
        close_reason: "grid_take_profit"
      },
      {
        open_time: isoAtHour(2, 3),
        close_time: isoAtHour(2, 5),
        side: "long",
        entry_price: 68980,
        exit_price: 68540,
        quantity: 0.02,
        gross_pnl: -8.8,
        net_pnl: -9.64,
        fee_paid: 0.84,
        holding_hours: 2,
        close_reason: "stop_loss"
      },
      {
        open_time: isoAtHour(2, 5),
        close_time: isoAtHour(2, 7),
        side: "long",
        entry_price: 69640,
        exit_price: 70240,
        quantity: 0.018,
        gross_pnl: 10.8,
        net_pnl: 9.93,
        fee_paid: 0.87,
        holding_hours: 2,
        close_reason: "grid_take_profit"
      }
    ],
    events: [
      { timestamp: isoAtHour(1, 0), event_type: "grid_init", price: 66680, message: "初始化网格区间", payload: null },
      { timestamp: isoAtHour(1, 4), event_type: "take_profit", price: 67680, message: "触发上沿止盈", payload: { grid: 3 } },
      { timestamp: isoAtHour(2, 2), event_type: "funding", price: 69020, message: "结算资金费", payload: { funding_pnl: -2.4 } },
      { timestamp: isoAtHour(2, 5), event_type: "stop_loss", price: 68540, message: "触发保护性止损", payload: { anchor_price: 68980 } }
    ],
    analysis: {
      risk_level: "low",
      structure_dependency: "mixed",
      overfitting_flag: false,
      validation_degradation_pct: 7.4,
      liquidation_risk: "low",
      stability_score: 81,
      diagnosis_tags: ["回撤可控", "交易频率均衡", "验证期稳定"],
      ai_explanation: "收益与回撤比较平衡，适合继续用优化模块做稳健性筛选。"
    },
    scoring: {
      profit_score: 84,
      risk_score: 78,
      stability_score: 80,
      robustness_score: 77,
      behavior_score: 75,
      final_score: 79,
      grade: "B",
      profit_reasons: ["收益率曲线持续抬升", "平仓利润分布均衡"],
      risk_reasons: ["最大回撤控制在 10% 内", "未出现强平"],
      stability_reasons: ["资金费影响有限", "验证期退化幅度较小"],
      robustness_reasons: ["不同网格参数附近仍可获得正收益"],
      behavior_reasons: ["止损次数较少", "交易节奏平稳"]
    }
  };
}

function buildOptimizationRows() {
  return [
    [1, 5, 8, 65000, 71600, 0.8, 620, 6.8, 1.92, 0.73, 91.2, 1.78, 0.71, 1.68, 1.66],
    [2, 6, 10, 65200, 72400, 1.0, 860, 7.6, 2.14, 0.76, 123.5, 1.96, 0.73, 1.81, 1.79],
    [3, 7, 10, 65600, 72800, 1.2, 980, 8.1, 2.36, 0.78, 131.4, 2.04, 0.75, 1.89, 1.92],
    [4, 8, 12, 66000, 73200, 1.2, 1180, 8.9, 2.64, 0.79, 149.8, 2.18, 0.76, 1.94, 2.03],
    [5, 9, 12, 66200, 73600, 1.6, 1090, 9.8, 2.22, 0.74, 111.3, 1.87, 0.71, 1.65, 1.72],
    [6, 10, 14, 66400, 74200, 2.0, 970, 12.2, 1.71, 0.69, 79.5, 1.58, 0.66, 1.41, 1.37]
  ].map(([rowId, leverage, grids, lower, upper, stopRatio, totalReturn, drawdown, sharpe, winRate, score, vScore, vWin, robust, overfit]) => ({
    row_id: rowId,
    leverage,
    grids,
    use_base_position: rowId % 2 === 0,
    base_grid_count: rowId % 2 === 0 ? 2 : 0,
    initial_position_size: rowId % 2 === 0 ? 0.08 : 0,
    anchor_price: 69200,
    lower_price: lower,
    upper_price: upper,
    stop_price: 64200,
    band_width_pct: Number((((upper - lower) / 69200) * 100).toFixed(2)),
    range_lower: lower,
    range_upper: upper,
    stop_loss: 64200,
    stop_loss_ratio_pct: stopRatio,
    max_possible_loss_usdt: 420,
    total_return_usdt: totalReturn,
    max_drawdown_pct: drawdown,
    sharpe_ratio: sharpe,
    win_rate: winRate,
    return_drawdown_ratio: Number((totalReturn / Math.max(drawdown, 1)).toFixed(3)),
    score,
    validation_total_return_usdt: Number((totalReturn * 0.88).toFixed(2)),
    validation_max_drawdown_pct: Number((drawdown * 1.08).toFixed(2)),
    validation_sharpe_ratio: Number((sharpe * 0.93).toFixed(3)),
    validation_win_rate: vWin,
    validation_return_drawdown_ratio: Number((score * 0.74).toFixed(3)),
    validation_score: vScore,
    validation_total_closed_trades: 14 + rowId,
    robust_score: robust,
    overfit_penalty: Number((2.1 - overfit).toFixed(3)),
    passes_constraints: rowId !== 6,
    constraint_violations: rowId === 6 ? ["drawdown_limit_exceeded"] : [],
    total_closed_trades: 18 + rowId
  }));
}

function buildOptimizationStatus() {
  const rows = buildOptimizationRows();
  const heatmap = [
    [4, 6, 1.24],
    [4, 8, 1.41],
    [4, 10, 1.56],
    [6, 6, 1.38],
    [6, 8, 1.71],
    [6, 10, 1.88],
    [8, 8, 2.02],
    [8, 10, 2.11],
    [8, 12, 2.19],
    [10, 10, 1.68],
    [10, 12, 1.52],
    [10, 14, 1.31]
  ].map(([leverage, grids, value], index) => ({
    leverage,
    grids,
    value,
    use_base_position: index % 2 === 0,
    base_grid_count: index % 2 === 0 ? 2 : 0,
    initial_position_size: index % 2 === 0 ? 0.08 : 0,
    anchor_price: 69200,
    lower_price: 65200,
    upper_price: 73200,
    stop_price: 64200
  }));
  return {
    job: {
      job_id: OPTIMIZATION_JOB_ID,
      status: "completed",
      created_at: "2026-03-08T12:00:00+08:00",
      started_at: "2026-03-08T12:00:02+08:00",
      finished_at: "2026-03-08T12:00:11+08:00",
      progress: 100,
      total_steps: 12,
      completed_steps: 12,
      message: "random_pruned 完成，共筛选 6 组候选",
      error: null,
      total_combinations: 144,
      trials_completed: 96,
      trials_pruned: 48,
      pruning_ratio: 0.5
    },
    target: "return_drawdown_ratio",
    sort_by: "robust_score",
    sort_order: "desc",
    page: 1,
    page_size: 20,
    total_results: rows.length,
    rows,
    best_row: rows[3],
    best_validation_row: rows[2],
    best_equity_curve: [
      { timestamp: "步骤 1", value: 2500 },
      { timestamp: "步骤 2", value: 2580 },
      { timestamp: "步骤 3", value: 2660 },
      { timestamp: "步骤 4", value: 2790 },
      { timestamp: "步骤 5", value: 2940 },
      { timestamp: "步骤 6", value: 3090 }
    ],
    best_score_progression: [
      { step: 1, value: 1.12 },
      { step: 2, value: 1.34 },
      { step: 3, value: 1.61 },
      { step: 4, value: 1.78 },
      { step: 5, value: 1.93 },
      { step: 6, value: 2.03 }
    ],
    convergence_curve_data: [
      { step: 1, value: 0.98 },
      { step: 2, value: 1.21 },
      { step: 3, value: 1.47 },
      { step: 4, value: 1.73 },
      { step: 5, value: 1.9 },
      { step: 6, value: 2.03 }
    ],
    heatmap,
    train_window: {
      start_time: "2026-02-01T00:00:00+08:00",
      end_time: "2026-02-10T00:00:00+08:00",
      candles: 240
    },
    validation_window: {
      start_time: "2026-02-10T00:00:00+08:00",
      end_time: "2026-02-15T00:00:00+08:00",
      candles: 120
    }
  };
}

function buildHistoryItems() {
  return [
    {
      job: {
        job_id: OPTIMIZATION_JOB_ID,
        status: "completed",
        created_at: "2026-03-08T12:00:00+08:00",
        started_at: "2026-03-08T12:00:02+08:00",
        finished_at: "2026-03-08T12:00:11+08:00",
        progress: 100,
        total_steps: 12,
        completed_steps: 12,
        message: "完成",
        error: null,
        total_combinations: 144,
        trials_completed: 96,
        trials_pruned: 48,
        pruning_ratio: 0.5
      },
      target: "return_drawdown_ratio"
    },
    {
      job: {
        job_id: "opt-readme-archived-1",
        status: "failed",
        created_at: "2026-03-06T11:10:00+08:00",
        started_at: "2026-03-06T11:10:03+08:00",
        finished_at: "2026-03-06T11:12:44+08:00",
        progress: 42,
        total_steps: 10,
        completed_steps: 4,
        message: "约束过严",
        error: "drawdown limit exceeded",
        total_combinations: 90,
        trials_completed: 40,
        trials_pruned: 12,
        pruning_ratio: 0.133
      },
      target: "return_drawdown_ratio"
    }
  ];
}

function buildLiveRobotList() {
  return {
    scope: "running",
    items: [
      {
        algo_id: LIVE_ALGO_ID,
        name: "BTC Grid Demo",
        symbol: LIVE_SYMBOL,
        exchange_symbol: "BTC-USDT-SWAP",
        updated_at: "2026-03-08T13:25:00+08:00",
        run_type: "1",
        configured_leverage: 6,
        investment_usdt: 3000,
        lower_price: 66200,
        upper_price: 73400,
        grid_count: 12,
        state: "running",
        side: "long"
      }
    ]
  };
}

function buildLiveSnapshot() {
  return {
    account: {
      exchange: "okx",
      symbol: LIVE_SYMBOL,
      exchange_symbol: "BTC-USDT-SWAP",
      algo_id: LIVE_ALGO_ID,
      strategy_started_at: LIVE_START_TIME,
      fetched_at: "2026-03-08T13:25:15+08:00",
      masked_api_key: "demo***42"
    },
    robot: {
      algo_id: LIVE_ALGO_ID,
      name: "BTC Grid Demo",
      state: "running",
      direction: "long",
      algo_type: "contract_grid",
      run_type: "1",
      created_at: "2026-03-07T09:00:00+08:00",
      updated_at: "2026-03-08T13:25:15+08:00",
      investment_usdt: 3000,
      configured_leverage: 6,
      actual_leverage: 5.4,
      liquidation_price: 64120,
      grid_count: 12,
      lower_price: 66200,
      upper_price: 73400,
      grid_spacing: 600,
      grid_profit: 128.4,
      floating_profit: 42.7,
      total_fee: 11.3,
      funding_fee: 3.6,
      total_pnl: 159.8,
      pnl_ratio: 0.053,
      stop_loss_price: 64800,
      take_profit_price: 74200,
      use_base_position: true
    },
    monitoring: {
      poll_interval_sec: 15,
      last_success_at: "2026-03-08T13:25:15+08:00",
      freshness_sec: 1,
      stale: false,
      source_latency_ms: 164,
      fills_page_count: 1,
      fills_capped: false,
      orders_page_count: 1
    },
    market_params: {
      source: "okx",
      symbol: LIVE_SYMBOL,
      maker_fee_rate: 0.0002,
      taker_fee_rate: 0.0005,
      funding_rate_per_8h: 0.0001,
      funding_interval_hours: 8,
      price_tick_size: 0.1,
      quantity_step_size: 0.001,
      min_notional: 1,
      fetched_at: "2026-03-08T13:25:15+08:00",
      note: null
    },
    summary: {
      realized_pnl: 117.1,
      unrealized_pnl: 42.7,
      fees_paid: 11.3,
      funding_paid: 1.4,
      funding_net: 3.6,
      total_pnl: 159.8,
      position_notional: 4820,
      open_order_count: 8,
      fill_count: 14
    },
    window: {
      strategy_started_at: LIVE_START_TIME,
      fetched_at: "2026-03-08T13:25:15+08:00",
      compared_end_at: "2026-03-08T13:25:00+08:00"
    },
    completeness: {
      fills_complete: true,
      funding_complete: true,
      bills_window_clipped: false,
      partial_failures: []
    },
    ledger_summary: {
      trading_net: 167.5,
      fees: 11.3,
      funding: 3.6,
      total_pnl: 159.8,
      realized: 117.1,
      unrealized: 42.7
    },
    position: {
      side: "long",
      quantity: 0.069,
      entry_price: 69320,
      mark_price: 69880,
      notional: 4820,
      leverage: 5.4,
      liquidation_price: 64120,
      margin_mode: "isolated",
      unrealized_pnl: 42.7,
      realized_pnl: 117.1
    },
    open_orders: [
      { order_id: "o1", side: "buy", price: 68400, quantity: 0.008, filled_quantity: 0, reduce_only: false, status: "live", timestamp: "2026-03-08T13:15:00+08:00" },
      { order_id: "o2", side: "sell", price: 70400, quantity: 0.008, filled_quantity: 0, reduce_only: false, status: "live", timestamp: "2026-03-08T13:15:00+08:00" }
    ],
    fills: [
      { trade_id: "t1", order_id: "o7", side: "sell", price: 70120, quantity: 0.008, realized_pnl: 12.4, fee: 0.38, fee_currency: "USDT", is_maker: true, timestamp: "2026-03-08T11:25:00+08:00" },
      { trade_id: "t2", order_id: "o8", side: "sell", price: 70680, quantity: 0.008, realized_pnl: 14.1, fee: 0.39, fee_currency: "USDT", is_maker: true, timestamp: "2026-03-08T12:12:00+08:00" }
    ],
    funding_entries: [
      { timestamp: "2026-03-08T08:00:00+08:00", amount: 1.2, rate: 0.0001, position_size: 0.061, currency: "USDT" },
      { timestamp: "2026-03-08T16:00:00+08:00", amount: 2.4, rate: 0.0001, position_size: 0.069, currency: "USDT" }
    ],
    pnl_curve: [],
    daily_breakdown: [
      { date: "2026-03-08", realized_pnl: 117.1, fees_paid: 11.3, funding_net: 3.6, trading_net: 105.8, total_pnl: 109.4, entry_count: 16 }
    ],
    ledger_entries: [
      { timestamp: "2026-03-08T12:12:00+08:00", kind: "trade", amount: 14.1, pnl: 14.1, fee: 0, currency: "USDT", side: "sell", order_id: "o8", trade_id: "t2", is_maker: true, note: "网格止盈" },
      { timestamp: "2026-03-08T12:12:00+08:00", kind: "fee", amount: -0.39, pnl: 0, fee: 0.39, currency: "USDT", side: "sell", order_id: "o8", trade_id: "t2", is_maker: true, note: "成交手续费" },
      { timestamp: "2026-03-08T08:00:00+08:00", kind: "funding", amount: 1.2, pnl: 0, fee: 0, currency: "USDT", side: null, order_id: null, trade_id: null, is_maker: null, note: "资金费" }
    ],
    inferred_grid: {
      lower: 66200,
      upper: 73400,
      grid_count: 12,
      grid_spacing: 600,
      active_level_count: 6,
      active_levels: [67400, 68000, 68600, 70400, 71000, 71600],
      confidence: 0.91,
      use_base_position: true,
      side: "long",
      note: "挂单分布稳定，适合直接回填到回测模块。"
    },
    diagnostics: [
      { level: "info", code: "grid_reconstructed", message: "已根据活跃挂单重建网格分布", action_hint: null },
      { level: "warning", code: "position_near_upper_band", message: "当前价格接近上沿，建议关注止盈密度", action_hint: "apply_params" }
    ]
  };
}

function buildTrendHistory() {
  const totals = [34, 48, 59, 76, 85, 94, 102, 118, 127, 138, 149, 159.8];
  return totals.map((total, index) => ({
    timestamp: `2026-03-08T${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}:00+08:00`,
    total_pnl: total,
    floating_profit: 12 + index * 2.3,
    funding_fee: 0.6 + index * 0.25,
    notional: 4380 + index * 38
  }));
}

const demoBacktestRequest = buildDemoBacktestRequest();
const demoOptimizationConfig = buildDemoOptimizationConfig();
const demoBacktestResult = buildDemoBacktestResult();
const demoOptimizationStatus = buildOptimizationStatus();
const demoHistoryItems = buildHistoryItems();
const demoLiveSnapshot = buildLiveSnapshot();
const demoTrendHistory = buildTrendHistory();

let backtestFixturePromise;

function getBacktestFixture() {
  if (!backtestFixturePromise) {
    backtestFixturePromise = (async () => {
      if (!useRealMarketData) {
        return {
          request: demoBacktestRequest,
          result: demoBacktestResult,
          anchor_price: demoBacktestResult.candles[0]?.close ?? 69200,
          anchor_time: demoBacktestResult.candles[0]?.timestamp ?? LIVE_START_TIME,
          candle_count: demoBacktestResult.candles.length
        };
      }
      try {
        return await buildRealBacktestFixture();
      } catch (error) {
        console.warn('[capture-readme-screenshots] failed to fetch real BTC data, falling back to demo data', error);
        return {
          request: demoBacktestRequest,
          result: demoBacktestResult,
          anchor_price: demoBacktestResult.candles[0]?.close ?? 69200,
          anchor_time: demoBacktestResult.candles[0]?.timestamp ?? LIVE_START_TIME,
          candle_count: demoBacktestResult.candles.length
        };
      }
    })();
  }
  return backtestFixturePromise;
}

function ssePayload(jobId, jobType, payload, status = "completed", progress = 100) {
  return `event: update\ndata: ${JSON.stringify({
    job_id: jobId,
    job_type: jobType,
    status,
    progress,
    terminal: true,
    payload
  })}\n\n`;
}

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

async function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

function startDevServer() {
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(FRONTEND_PORT)], {
    cwd: frontendDir,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
    if (output.length > 8000) {
      output = output.slice(-8000);
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return {
    child,
    getOutput: () => output
  };
}

async function installMockRoutes(page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    const method = request.method().toUpperCase();

    if (pathName === "/api/v1/backtest/defaults" && method === "GET") {
      const backtestFixture = await getBacktestFixture();
      await route.fulfill(jsonResponse(backtestFixture.request));
      return;
    }
    if (pathName === "/api/v1/backtest/anchor-price" && method === "POST") {
      const backtestFixture = await getBacktestFixture();
      await route.fulfill(
        jsonResponse({
          anchor_price: backtestFixture.anchor_price,
          anchor_time: backtestFixture.anchor_time,
          anchor_source: "first_candle_close",
          candle_count: backtestFixture.candle_count
        })
      );
      return;
    }
    if (pathName === "/api/v1/market/params" && method === "GET") {
      await route.fulfill(jsonResponse(demoLiveSnapshot.market_params));
      return;
    }
    if (pathName === "/api/v1/backtest/start" && method === "POST") {
      await route.fulfill(jsonResponse({ job_id: BACKTEST_JOB_ID, status: "pending" }));
      return;
    }
    if (pathName === `/api/v1/backtest/${BACKTEST_JOB_ID}` && method === "GET") {
      const backtestFixture = await getBacktestFixture();
      await route.fulfill(
        jsonResponse({
          job: {
            job_id: BACKTEST_JOB_ID,
            status: "completed",
            created_at: "2026-03-08T11:00:00+08:00",
            started_at: "2026-03-08T11:00:01+08:00",
            finished_at: "2026-03-08T11:00:02+08:00",
            progress: 100,
            message: "回测完成",
            error: null
          },
          result: backtestFixture.result
        })
      );
      return;
    }
    if (pathName === `/api/v1/backtest/${BACKTEST_JOB_ID}/cancel` && method === "POST") {
      await route.fulfill(jsonResponse({ job_id: BACKTEST_JOB_ID, status: "cancelled" }));
      return;
    }
    if (pathName === `/api/v1/jobs/${BACKTEST_JOB_ID}/stream`) {
      const backtestFixture = await getBacktestFixture();
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
          "content-type": "text/event-stream"
        },
        body: ssePayload(
          BACKTEST_JOB_ID,
          "backtest",
          {
            job: {
              job_id: BACKTEST_JOB_ID,
              status: "completed",
              created_at: "2026-03-08T11:00:00+08:00",
              started_at: "2026-03-08T11:00:01+08:00",
              finished_at: "2026-03-08T11:00:02+08:00",
              progress: 100,
              message: "回测完成",
              error: null
            },
            result: backtestFixture.result
          }
        )
      });
      return;
    }
    if (pathName === "/api/v1/optimization/start" && method === "POST") {
      await route.fulfill(
        jsonResponse({
          job_id: OPTIMIZATION_JOB_ID,
          status: "pending",
          total_combinations: demoOptimizationStatus.job.total_combinations
        })
      );
      return;
    }
    if (pathName === `/api/v1/jobs/${OPTIMIZATION_JOB_ID}/stream`) {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
          "content-type": "text/event-stream"
        },
        body: ssePayload(
          OPTIMIZATION_JOB_ID,
          "optimization",
          {
            job: {
              ...demoOptimizationStatus.job
            },
            target: demoOptimizationStatus.target
          }
        )
      });
      return;
    }
    if (pathName === `/api/v1/optimization/${OPTIMIZATION_JOB_ID}/progress` && method === "GET") {
      await route.fulfill(
        jsonResponse({
          job: demoOptimizationStatus.job,
          target: demoOptimizationStatus.target
        })
      );
      return;
    }
    if (pathName === `/api/v1/optimization/${OPTIMIZATION_JOB_ID}` && method === "GET") {
      await route.fulfill(jsonResponse(demoOptimizationStatus));
      return;
    }
    if (pathName === `/api/v1/optimization/${OPTIMIZATION_JOB_ID}/rows` && method === "GET") {
      await route.fulfill(
        jsonResponse({
          job: demoOptimizationStatus.job,
          target: demoOptimizationStatus.target,
          sort_by: demoOptimizationStatus.sort_by,
          sort_order: demoOptimizationStatus.sort_order,
          page: demoOptimizationStatus.page,
          page_size: demoOptimizationStatus.page_size,
          total_results: demoOptimizationStatus.total_results,
          rows: demoOptimizationStatus.rows,
          best_row: demoOptimizationStatus.best_row,
          best_validation_row: demoOptimizationStatus.best_validation_row
        })
      );
      return;
    }
    if (pathName === `/api/v1/optimization/${OPTIMIZATION_JOB_ID}/export` && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "text/csv"
        },
        body: "row_id,robust_score,total_return_usdt\n4,1.94,1180\n"
      });
      return;
    }
    if (pathName === "/api/v1/optimization-history" && method === "GET") {
      await route.fulfill(
        jsonResponse({
          items: demoHistoryItems,
          next_cursor: null
        })
      );
      return;
    }
    if (pathName === "/api/v1/optimization-history/selected" && method === "DELETE") {
      const requestedIds = url.searchParams.getAll("job_id");
      await route.fulfill(
        jsonResponse({
          requested: requestedIds.length,
          deleted: requestedIds.length,
          failed: 0,
          deleted_job_ids: requestedIds,
          failed_job_ids: [],
          failed_items: [],
          summary_text: `已清空 ${requestedIds.length} 条优化历史。`
        })
      );
      return;
    }
    if (pathName === "/api/v1/operations" && method === "GET") {
      await route.fulfill(jsonResponse({ items: [], next_cursor: null }));
      return;
    }
    if (pathName.startsWith("/api/v1/operations/") && method === "GET") {
      await route.fulfill(jsonResponse({ code: "NOT_FOUND", message: "operation not found" }, 404));
      return;
    }
    if (pathName === "/api/v1/live/robots" && method === "POST") {
      await route.fulfill(jsonResponse(buildLiveRobotList()));
      return;
    }
    if (pathName === "/api/v1/live/snapshot" && method === "POST") {
      await route.fulfill(jsonResponse(demoLiveSnapshot));
      return;
    }

    await route.fulfill(jsonResponse({ code: "NOT_FOUND", message: `mock route not found: ${pathName}` }, 404));
  });
}

async function seedStorage(page, backtestRequestSeed = demoBacktestRequest) {
  const trendKey = `okx|${LIVE_SYMBOL}|${LIVE_START_TIME}|${LIVE_ALGO_ID}`;
  await page.addInitScript(
    ({
      backtestRequest,
      optimizationConfig,
      strategyTemplates,
      optimizationTemplates,
      themeSettings,
      liveDraft,
      liveMonitoringPreferences,
      trendKeyValue,
      trendHistory
    }) => {
      localStorage.clear();
      sessionStorage.clear();

      const writeVersioned = (key, version, data) => {
        localStorage.setItem(key, JSON.stringify({ version, data }));
      };
      const writePlainLocal = (key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
      };
      writeVersioned("btc-grid-backtest:last-backtest-request:v2", 2, backtestRequest);
      writeVersioned("btc-grid-backtest:last-optimization-config:v2", 2, optimizationConfig);
      writePlainLocal("btc-grid-backtest:strategy-templates:v2", strategyTemplates);
      writePlainLocal("btc-grid-backtest:optimization-templates:v2", optimizationTemplates);

      sessionStorage.setItem("btc-grid-backtest:live-connection-draft:v1", JSON.stringify(liveDraft));
      sessionStorage.setItem("btc-grid-backtest:live-connection-credentials-persist-enabled:v1", "1");
      sessionStorage.setItem("btc-grid-backtest:live-monitoring-preferences:v1", JSON.stringify(liveMonitoringPreferences));
      sessionStorage.setItem(
        "btc-grid-backtest:live-monitoring-trend-history:v1",
        JSON.stringify({ [trendKeyValue]: trendHistory })
      );

      writePlainLocal("btc-grid-backtest:live-connection-credentials-expanded:v1", false);
      writePlainLocal("btc-grid-backtest:theme-settings:v1", themeSettings);
      writePlainLocal("btc-grid-backtest:theme-default-settings:v1", themeSettings);
    },
    {
      backtestRequest: backtestRequestSeed,
      optimizationConfig: demoOptimizationConfig,
      strategyTemplates: [
        {
          id: "strategy-temp-template",
          name: "最近保存",
          request: backtestRequestSeed
        },
        {
          id: "example-template",
          name: "示例模板",
          request: backtestRequestSeed
        }
      ],
      optimizationTemplates: [
        {
          id: "optimization-temp-template",
          name: "最近保存",
          config: demoOptimizationConfig
        },
        {
          id: "optimization-example-template",
          name: "示例模板",
          config: demoOptimizationConfig
        }
      ],
      themeSettings: {
        preset: "custom",
        customColor: screenshotAccent,
        backgroundPreset: screenshotBackgroundPreset,
        customBackground: screenshotBackgroundColor,
        fontPreset: "pingfang",
        fontSizePreset: "medium",
        cardRadiusPx: 14,
        customAccentHistory: [screenshotAccent],
        customBackgroundHistory:
          screenshotBackgroundPreset === "custom" ? [screenshotBackgroundColor] : []
      },
      liveDraft: {
        algo_id: LIVE_ALGO_ID,
        profiles: {
          binance: { api_key: "", api_secret: "", passphrase: "" },
          bybit: { api_key: "", api_secret: "", passphrase: "" },
          okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-passphrase" }
        }
      },
      liveMonitoringPreferences: {
        [`okx|${LIVE_SYMBOL}`]: {
          monitoring_enabled: true,
          poll_interval_sec: 15,
          selected_scope: "running"
        }
      },
      trendKeyValue: trendKey,
      trendHistory: demoTrendHistory
    }
  );
}

async function createPage(browser, backtestRequestSeed = demoBacktestRequest) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1280 },
    colorScheme: screenshotColorScheme,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await seedStorage(page, backtestRequestSeed);
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root");
  await page.waitForTimeout(500);
  return { context, page };
}

async function cleanScreenshotFrame(page) {
  await page.addStyleTag({
    content: `
      .toast-notice { display: none !important; }
    `
  });
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).forEach((button) => {
      if ((button.textContent || "").trim().startsWith("通知中心")) {
        button.style.display = "none";
      }
    });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.waitForTimeout(250);
}

async function captureViewport(page, targetPath) {
  await cleanScreenshotFrame(page);
  await page.screenshot({
    path: targetPath,
    type: "png"
  });
}

async function stabilizeCharts(page, delayMs = 900) {
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(delayMs);
}

async function captureBacktest(browser, backtestRequestSeed) {
  const { context, page } = await createPage(browser, backtestRequestSeed);
  await page.setViewportSize({ width: 1800, height: 1500 });
  await page.getByRole("button", { name: "开始回测" }).click();
  await page.getByText("收益率曲线").waitFor();
  await page.locator("canvas").first().waitFor();
  await stabilizeCharts(page, 1200);
  await captureViewport(page, path.join(outputDir, `${screenshotPrefix}-backtest-overview.png`));
  await context.close();
}

async function captureOptimization(browser) {
  const { context, page } = await createPage(browser);
  await page.getByRole("button", { name: "参数优化" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "开始参数优化" }).click();
  await page.getByRole("button", { name: "结果" }).click();
  await page.getByText("最优参数摘要").waitFor();
  await page.waitForTimeout(800);
  await captureViewport(page, path.join(outputDir, `${screenshotPrefix}-optimization-results.png`));

  await page.getByRole("button", { name: "热力图" }).click();
  await page.getByText("热力图 (杠杆 × 网格数)").waitFor();
  await page.waitForTimeout(800);
  await captureViewport(page, path.join(outputDir, `${screenshotPrefix}-optimization-heatmap.png`));
  await context.close();
}

async function captureLive(browser) {
  const { context, page } = await createPage(browser);
  await page.getByRole("button", { name: "实盘监测" }).click();
  await page.getByText("监测总览").waitFor({ timeout: 15000 });
  await page.getByText("收益和趋势").waitFor();
  await page.waitForTimeout(1000);
  await captureViewport(page, path.join(outputDir, `${screenshotPrefix}-live-monitoring.png`));
  await context.close();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const server = startDevServer();
  try {
    await waitForServer(FRONTEND_URL);
  } catch (error) {
    server.child.kill("SIGTERM");
    throw new Error(`${error.message}\n\nRecent dev server output:\n${server.getOutput()}`);
  }

  const browser = await chromium.launch({ headless: true });
  const backtestFixture = await getBacktestFixture();
  try {
    await captureBacktest(browser, backtestFixture.request);
    await captureOptimization(browser);
    await captureLive(browser);
  } finally {
    await browser.close();
    server.child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
