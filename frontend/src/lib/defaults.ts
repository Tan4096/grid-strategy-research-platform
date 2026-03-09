import type { BacktestRequest, OptimizationConfig } from "../lib/api-schema";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const DEFAULT_OPT_WORKERS =
  typeof navigator !== "undefined"
    ? Math.max(1, Math.min(64, navigator.hardwareConcurrency || 4))
    : 4;

export const BACKTEST_STORAGE_VERSION = 2;
export const OPTIMIZATION_STORAGE_VERSION = 2;
export const LEGACY_BACKTEST_PARAMS_STORAGE_KEY = "btc-grid-backtest:last-backtest-request:v1";
export const LEGACY_OPTIMIZATION_PARAMS_STORAGE_KEY = "btc-grid-backtest:last-optimization-config:v1";

export function toBeijingIsoMinuteFromUnixMs(unixMs: number): string {
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

export const FALLBACK_DEFAULTS: BacktestRequest = {
  strategy: {
    side: "long",
    lower: 62000,
    upper: 70000,
    grids: 24,
    leverage: 5,
    margin: 2000,
    stop_loss: 59000,
    use_base_position: false,
    strict_risk_control: true,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0004,
    slippage: 0.0002,
    maintenance_margin_rate: 0.005,
    funding_rate_per_8h: 0,
    funding_interval_hours: 8,
    use_mark_price_for_liquidation: false,
    price_tick_size: 0.1,
    quantity_step_size: 0.0001,
    min_notional: 5,
    max_allowed_loss_usdt: null
  },
  data: {
    source: "binance",
    symbol: "BTCUSDT",
    interval: "1h",
    lookback_days: 14,
    start_time: fallbackStartTime,
    end_time: fallbackEndTime
  }
};

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
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
  anchor_mode: "CURRENT_PRICE",
  custom_anchor_price: null,
  target: "return_drawdown_ratio",
  custom_score_expr: "total_return_usdt / max(max_drawdown_pct, 1)",
  min_closed_trades: 4,
  max_drawdown_pct_limit: null,
  max_allowed_loss_usdt: null,
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
  bayesian_adaptive_fallback_enabled: true,
  bayesian_adaptive_slowdown_factor: 1.8,
  bayesian_adaptive_window_batches: 4,
  bayesian_adaptive_min_trials_after_warmup: 64,
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
