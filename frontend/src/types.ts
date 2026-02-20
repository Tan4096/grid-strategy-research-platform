export type GridSide = "long" | "short";
export type DataSource = "binance" | "bybit" | "okx" | "csv";
export type Interval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "1d";

export interface StrategyConfig {
  side: GridSide;
  lower: number;
  upper: number;
  grids: number;
  leverage: number;
  margin: number;
  stop_loss: number;
  use_base_position: boolean;
  reopen_after_stop: boolean;
  fee_rate: number;
  maker_fee_rate?: number | null;
  taker_fee_rate?: number | null;
  slippage: number;
  maintenance_margin_rate: number;
  funding_rate_per_8h?: number;
  funding_interval_hours?: number;
  use_mark_price_for_liquidation?: boolean;
  price_tick_size?: number;
  quantity_step_size?: number;
  min_notional?: number;
}

export interface DataConfig {
  source: DataSource;
  symbol: string;
  interval: Interval;
  lookback_days: number;
  start_time?: string | null;
  end_time?: string | null;
  csv_content?: string | null;
}

export interface BacktestRequest {
  strategy: StrategyConfig;
  data: DataConfig;
}

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CurvePoint {
  timestamp: string;
  value: number;
}

export interface TradeEvent {
  open_time: string;
  close_time: string;
  side: GridSide;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pnl: number;
  net_pnl: number;
  fee_paid: number;
  holding_hours: number;
  close_reason: "grid_take_profit" | "stop_loss" | "liquidation";
}

export interface EventLog {
  timestamp: string;
  event_type: string;
  price: number;
  message: string;
}

export interface BacktestSummary {
  initial_margin: number;
  final_equity: number;
  total_return_usdt: number;
  total_return_pct: number;
  annualized_return_pct: number | null;
  average_round_profit: number;
  max_drawdown_pct: number;
  max_single_loss: number;
  stop_loss_count: number;
  liquidation_count: number;
  full_grid_profit_count: number;
  win_rate: number;
  average_holding_hours: number;
  total_closed_trades: number;
  status: string;
  fees_paid: number;
  funding_paid: number;
  use_base_position: boolean;
  base_grid_count: number;
  initial_position_size: number;
}

export type AnalysisRiskLevel = "low" | "medium" | "high";
export type StructureDependency = "range" | "mixed" | "trend_sensitive";

export interface StrategyAnalysis {
  risk_level: AnalysisRiskLevel;
  structure_dependency: StructureDependency;
  overfitting_flag: boolean;
  validation_degradation_pct: number;
  liquidation_risk: AnalysisRiskLevel;
  stability_score: number;
  diagnosis_tags: string[];
  ai_explanation: string | null;
}

export interface StrategyScoring {
  profit_score: number;
  risk_score: number;
  stability_score: number;
  robustness_score: number;
  behavior_score: number;
  final_score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  profit_reasons?: string[];
  risk_reasons?: string[];
  stability_reasons?: string[];
  robustness_reasons?: string[];
  behavior_reasons?: string[];
}

export interface BacktestResponse {
  summary: BacktestSummary;
  candles: Candle[];
  grid_lines: number[];
  equity_curve: CurvePoint[];
  drawdown_curve: CurvePoint[];
  margin_ratio_curve: CurvePoint[];
  leverage_usage_curve: CurvePoint[];
  liquidation_price_curve: CurvePoint[];
  trades: TradeEvent[];
  events: EventLog[];
  analysis?: StrategyAnalysis | null;
  scoring?: StrategyScoring | null;
}

export type BacktestJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface BacktestJobMeta {
  job_id: string;
  status: BacktestJobStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  progress: number;
  message?: string | null;
  error?: string | null;
}

export interface BacktestStartResponse {
  job_id: string;
  status: BacktestJobStatus;
}

export interface BacktestStatusResponse {
  job: BacktestJobMeta;
  result: BacktestResponse | null;
}

export interface MarketParamsResponse {
  source: DataSource;
  symbol: string;
  maker_fee_rate: number;
  taker_fee_rate: number;
  funding_rate_per_8h: number;
  funding_interval_hours: number;
  price_tick_size: number;
  quantity_step_size: number;
  min_notional: number;
  fetched_at: string;
  note: string | null;
}

export type OptimizationTarget =
  | "total_return"
  | "sharpe"
  | "min_drawdown"
  | "return_drawdown_ratio"
  | "custom";
export type OptimizationMode = "grid" | "bayesian" | "random_pruned";
export type AnchorMode = "BACKTEST_START_PRICE" | "BACKTEST_AVG_PRICE" | "CURRENT_PRICE" | "CUSTOM_PRICE";

export type SortOrder = "desc" | "asc";
export type OptimizationJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface SweepRange {
  enabled: boolean;
  start: number | null;
  end: number | null;
  step: number | null;
  values: number[] | null;
}

export interface OptimizationConfig {
  optimization_mode: OptimizationMode;
  leverage: SweepRange;
  grids: SweepRange;
  band_width_pct: SweepRange;
  stop_loss_ratio_pct: SweepRange;
  optimize_base_position: boolean;
  anchor_mode: AnchorMode;
  custom_anchor_price?: number | null;
  target: OptimizationTarget;
  custom_score_expr?: string | null;
  min_closed_trades: number;
  max_drawdown_pct_limit?: number | null;
  require_positive_return: boolean;
  robust_validation_weight: number;
  robust_gap_penalty: number;
  max_combinations: number;
  max_trials: number;
  auto_limit_combinations: boolean;
  max_workers: number;
  batch_size: number;
  chunk_size: number;
  warmup_ratio: number;
  random_seed?: number | null;
  resume_study: boolean;
  resume_study_key?: string | null;
  bayesian_adaptive_fallback_enabled: boolean;
  bayesian_adaptive_slowdown_factor: number;
  bayesian_adaptive_window_batches: number;
  bayesian_adaptive_min_trials_after_warmup: number;
  enable_early_pruning: boolean;
  drawdown_prune_multiplier: number;
  enable_profit_pruning: boolean;
  pruning_steps: number;
  enable_topk_refine: boolean;
  topk_refine_k: number;
  refine_leverage_delta: number;
  refine_grids_delta: number;
  refine_band_delta_pct: number;
  refine_stop_delta_pct: number;
  walk_forward_enabled: boolean;
  train_ratio: number;
}

export interface OptimizationRequest {
  base_strategy: StrategyConfig;
  data: DataConfig;
  optimization: OptimizationConfig;
}

export interface OptimizationRow {
  row_id: number;
  leverage: number;
  grids: number;
  use_base_position: boolean;
  base_grid_count: number;
  initial_position_size: number;
  anchor_price: number;
  lower_price: number;
  upper_price: number;
  stop_price: number;
  band_width_pct: number;
  range_lower: number;
  range_upper: number;
  stop_loss: number;
  stop_loss_ratio_pct: number;
  total_return_usdt: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  win_rate: number;
  return_drawdown_ratio: number;
  score: number;
  validation_total_return_usdt: number | null;
  validation_max_drawdown_pct: number | null;
  validation_sharpe_ratio: number | null;
  validation_win_rate: number | null;
  validation_return_drawdown_ratio: number | null;
  validation_score: number | null;
  validation_total_closed_trades: number | null;
  robust_score: number | null;
  overfit_penalty: number | null;
  passes_constraints: boolean;
  constraint_violations: string[];
  total_closed_trades: number;
}

export interface OptimizationHeatmapCell {
  leverage: number;
  grids: number;
  value: number;
  use_base_position: boolean;
  base_grid_count: number;
  initial_position_size: number;
  anchor_price: number;
  lower_price: number;
  upper_price: number;
  stop_price: number;
}

export interface OptimizationTimeWindow {
  start_time: string;
  end_time: string;
  candles: number;
}

export interface OptimizationJobMeta {
  job_id: string;
  status: OptimizationJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress: number;
  total_steps: number;
  completed_steps: number;
  message: string | null;
  error: string | null;
  total_combinations: number;
  trials_completed: number;
  trials_pruned: number;
  pruning_ratio: number;
}

export interface OptimizationProgressPoint {
  step: number;
  value: number;
}

export interface OptimizationStartResponse {
  job_id: string;
  status: OptimizationJobStatus;
  total_combinations: number;
}

export interface OptimizationProgressResponse {
  job: OptimizationJobMeta;
  target: OptimizationTarget;
}

export interface OptimizationStatusResponse {
  job: OptimizationJobMeta;
  target: OptimizationTarget;
  sort_by: string;
  sort_order: SortOrder;
  page: number;
  page_size: number;
  total_results: number;
  rows: OptimizationRow[];
  best_row: OptimizationRow | null;
  best_validation_row: OptimizationRow | null;
  best_equity_curve: CurvePoint[];
  best_score_progression: OptimizationProgressPoint[];
  convergence_curve_data: OptimizationProgressPoint[];
  heatmap: OptimizationHeatmapCell[];
  train_window: OptimizationTimeWindow | null;
  validation_window: OptimizationTimeWindow | null;
}

export interface OptimizationRowsResponse {
  job: OptimizationJobMeta;
  target: OptimizationTarget;
  sort_by: string;
  sort_order: SortOrder;
  page: number;
  page_size: number;
  total_results: number;
  rows: OptimizationRow[];
  best_row: OptimizationRow | null;
  best_validation_row: OptimizationRow | null;
}

export interface OptimizationHeatmapResponse {
  job: OptimizationJobMeta;
  target: OptimizationTarget;
  heatmap: OptimizationHeatmapCell[];
  best_row: OptimizationRow | null;
}
