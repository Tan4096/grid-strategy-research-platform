export type GridSide = "long" | "short";
export type DataSource = "binance" | "bybit" | "okx";
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
  strict_risk_control: boolean;
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
  max_allowed_loss_usdt?: number | null;
}

export interface DataConfig {
  source: DataSource;
  symbol: string;
  interval: Interval;
  lookback_days: number;
  start_time?: string | null;
  end_time?: string | null;
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
  payload?: Record<string, unknown> | null;
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
  funding_net: number;
  funding_statement_amount: number;
  use_base_position: boolean;
  base_grid_count: number;
  initial_position_size: number;
  max_possible_loss_usdt: number;
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
  unrealized_pnl_curve: CurvePoint[];
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
  idempotency_reused?: boolean;
}

export interface BacktestStatusResponse {
  job: BacktestJobMeta;
  result: BacktestResponse | null;
}

export interface BacktestAnchorPriceResponse {
  anchor_price: number;
  anchor_time: string;
  anchor_source: "first_candle_close" | "avg_candle_close" | "last_candle_close" | "custom_price";
  candle_count: number;
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
  reference_price?: number | null;
  fetched_at: string;
  note: string | null;
}

export type LiveExchange = "binance" | "bybit" | "okx";

export interface LiveCredentials {
  api_key: string;
  api_secret: string;
  passphrase?: string | null;
}

export type LiveRobotListScope = "running" | "recent";

export interface LiveRobotListRequest {
  exchange: LiveExchange;
  scope?: LiveRobotListScope;
  credentials: LiveCredentials;
}

export interface LiveRobotListItem {
  algo_id: string;
  name: string;
  symbol: string;
  exchange_symbol: string;
  updated_at?: string | null;
  run_type?: string | null;
  configured_leverage?: number | null;
  investment_usdt?: number | null;
  lower_price?: number | null;
  upper_price?: number | null;
  grid_count?: number | null;
  state?: "running" | "stopped" | string | null;
  side?: "long" | "short" | "flat" | null;
}

export interface LiveRobotListResponse {
  scope: LiveRobotListScope;
  items: LiveRobotListItem[];
}

export interface LiveSnapshotRequest {
  exchange: LiveExchange;
  symbol: string;
  strategy_started_at: string;
  algo_id: string;
  monitoring_poll_interval_sec?: number;
  monitoring_scope?: LiveRobotListScope;
  credentials: LiveCredentials;
}

export interface LiveConnectionDraft {
  algo_id: string;
  profiles: Record<LiveExchange, LiveCredentials>;
}

export interface LiveMonitoringPreference {
  monitoring_enabled: boolean;
  poll_interval_sec: 5 | 15 | 30 | 60;
  selected_scope: LiveRobotListScope;
}

export interface LiveMonitoringTrendPoint {
  timestamp: string;
  total_pnl: number;
  floating_profit: number;
  funding_fee: number;
  notional: number;
}

export interface LiveAccountInfo {
  exchange: LiveExchange;
  symbol: string;
  exchange_symbol: string;
  algo_id: string;
  strategy_started_at: string;
  fetched_at: string;
  masked_api_key: string;
}

export interface LiveSnapshotSummary {
  realized_pnl: number;
  unrealized_pnl: number;
  fees_paid: number;
  funding_paid: number;
  funding_net: number;
  total_pnl: number;
  position_notional: number;
  open_order_count: number;
  fill_count: number;
}

export interface LiveRobotOverview {
  algo_id: string;
  name: string;
  state?: string | null;
  direction?: "long" | "short" | "flat" | null;
  algo_type?: string | null;
  run_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  investment_usdt?: number | null;
  configured_leverage?: number | null;
  actual_leverage?: number | null;
  liquidation_price?: number | null;
  grid_count?: number | null;
  lower_price?: number | null;
  upper_price?: number | null;
  grid_spacing?: number | null;
  grid_profit?: number | null;
  floating_profit?: number | null;
  total_fee?: number | null;
  funding_fee?: number | null;
  total_pnl?: number | null;
  pnl_ratio?: number | null;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  use_base_position?: boolean | null;
}

export interface LivePosition {
  side: "long" | "short" | "flat";
  quantity: number;
  entry_price: number;
  mark_price: number;
  notional: number;
  leverage?: number | null;
  liquidation_price?: number | null;
  margin_mode?: string | null;
  unrealized_pnl: number;
  realized_pnl: number;
}

export interface LiveOpenOrder {
  order_id: string;
  client_order_id?: string | null;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  filled_quantity: number;
  reduce_only: boolean;
  status: string;
  timestamp?: string | null;
}

export interface LiveFill {
  trade_id: string;
  order_id?: string | null;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  realized_pnl: number;
  fee: number;
  fee_currency?: string | null;
  is_maker?: boolean | null;
  timestamp: string;
}

export interface LiveFundingEntry {
  timestamp: string;
  amount: number;
  rate?: number | null;
  position_size?: number | null;
  currency?: string | null;
}

export interface LiveInferredGrid {
  lower?: number | null;
  upper?: number | null;
  grid_count?: number | null;
  grid_spacing?: number | null;
  active_level_count: number;
  active_levels: number[];
  confidence: number;
  use_base_position?: boolean | null;
  side?: GridSide | null;
  note?: string | null;
}

export interface LiveDiagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  action_hint?: string | null;
}

export interface LiveWindowInfo {
  strategy_started_at: string;
  fetched_at: string;
  compared_end_at: string;
}

export interface LiveCompleteness {
  fills_complete: boolean;
  funding_complete: boolean;
  bills_window_clipped: boolean;
  partial_failures: string[];
}

export interface LiveLedgerSummary {
  trading_net: number;
  fees: number;
  funding: number;
  total_pnl: number;
  realized: number;
  unrealized: number;
}

export interface LiveLedgerEntry {
  timestamp: string;
  kind: "trade" | "fee" | "funding";
  amount: number;
  pnl: number;
  fee: number;
  currency?: string | null;
  side?: "buy" | "sell" | null;
  order_id?: string | null;
  trade_id?: string | null;
  is_maker?: boolean | null;
  note?: string | null;
}

export interface LiveDailyBreakdown {
  date: string;
  realized_pnl: number;
  fees_paid: number;
  funding_net: number;
  trading_net: number;
  total_pnl: number;
  entry_count: number;
}

export interface LiveMonitoringInfo {
  poll_interval_sec: number;
  last_success_at: string;
  freshness_sec: number;
  stale: boolean;
  source_latency_ms: number;
  fills_page_count: number;
  fills_capped: boolean;
  orders_page_count: number;
}

export interface LiveSnapshotResponse {
  account: LiveAccountInfo;
  robot: LiveRobotOverview;
  monitoring: LiveMonitoringInfo;
  market_params?: MarketParamsResponse | null;
  summary: LiveSnapshotSummary;
  window: LiveWindowInfo;
  completeness: LiveCompleteness;
  ledger_summary: LiveLedgerSummary;
  position: LivePosition;
  open_orders: LiveOpenOrder[];
  fills: LiveFill[];
  funding_entries: LiveFundingEntry[];
  pnl_curve?: CurvePoint[];
  daily_breakdown: LiveDailyBreakdown[];
  ledger_entries: LiveLedgerEntry[];
  inferred_grid: LiveInferredGrid;
  diagnostics: LiveDiagnostic[];
}

export interface LiveComparisonMetric {
  key:
    | "total_pnl"
    | "trading_net"
    | "realized_pnl"
    | "unrealized_pnl"
    | "fees_paid"
    | "funding_net"
    | "position_notional"
    | "active_levels";
  label: string;
  backtest_value: number;
  live_value: number;
  diff_value: number;
  explanation?: string | null;
}

export interface LiveComparisonSummary {
  blocked: boolean;
  issues: string[];
  metrics: LiveComparisonMetric[];
  reasons: string[];
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
  max_allowed_loss_usdt?: number | null;
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
  max_possible_loss_usdt: number;
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
  idempotency_reused?: boolean;
}

export interface OptimizationHistoryFailedItem {
  job_id: string;
  reason_code: string;
  reason_message: string;
}

export interface OptimizationProgressResponse {
  job: OptimizationJobMeta;
  target: OptimizationTarget;
}

export interface OptimizationHistoryPageResponse {
  items: OptimizationProgressResponse[];
  next_cursor: string | null;
}

export interface OptimizationHistoryClearResult {
  requested: number;
  deleted: number;
  failed: number;
  deleted_job_ids: string[];
  failed_job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  skipped?: number;
  skipped_job_ids?: string[];
  soft_delete_ttl_hours?: number;
  operation_id?: string;
  undo_until?: string;
  summary_text?: string;
  request_id?: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export interface OptimizationHistoryRestoreResult {
  requested: number;
  restored: number;
  failed: number;
  restored_job_ids: string[];
  failed_job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  operation_id?: string;
  summary_text?: string;
  request_id?: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export type OperationEventCategory = "info" | "success" | "warning" | "error";
export type OperationEventKind = "state" | "history";
export type OperationEventStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_failed"
  | "failed"
  | "undone"
  | "expired";

export interface OperationEvent {
  id: string;
  kind?: OperationEventKind;
  category: OperationEventCategory;
  action: string;
  status: OperationEventStatus;
  title: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
  request_id?: string | null;
  operation_id?: string | null;
  job_ids?: string[];
  failed_items?: OptimizationHistoryFailedItem[];
  retryable?: boolean | null;
  undo_until?: string | null;
  source?: string | null;
}

export interface OperationRecord {
  operation_id: string;
  action: string;
  status: string;
  requested: number;
  success: number;
  failed: number;
  skipped: number;
  job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  undo_until?: string | null;
  summary_text?: string | null;
  request_id?: string | null;
  created_at: string;
  updated_at: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export interface OperationRecordPageResponse {
  items: OperationRecord[];
  next_cursor: string | null;
}

export interface MobileBottomInsetState {
  safe_area_px: number;
  sticky_action_px: number;
  floating_entry_px: number;
  bottom_nav_px: number;
  reserved_bottom_px: number;
}

export type AppWorkspaceMode = "backtest" | "optimize" | "live";
export type ParameterMode = "backtest" | "optimize";

export type MobilePrimaryTab = "params" | "backtest" | "optimize" | "live";

export interface MobileShellState {
  active_primary_tab: MobilePrimaryTab;
  updated_at: string;
}

export type MobileParameterWizardStep =
  | "environment"
  | "strategy_position"
  | "risk_submit";

export type MobileOptimizeView = "runtime" | "results";
export type MobileOptimizeLandingView = "runtime" | "results";
export type MobileOptimizeOverlay = "none" | "history" | "results_table" | "analysis" | "feedback";
export type MobileTemplateSheetMode = "strategy" | "optimization";

// Backward compatibility aliases during migration.
export type OperationFeedbackType = OperationEventCategory;
export type OperationFeedbackStatus = OperationEventStatus;
export type OperationFeedbackItem = OperationEvent;

export type JobStreamType = "backtest" | "optimization";
export type JobTransportMode = "idle" | "connecting" | "sse" | "polling";

export interface JobStreamUpdate<TPayload = unknown> {
  job_id: string;
  job_type: JobStreamType;
  status: string;
  progress: number;
  terminal: boolean;
  payload: TPayload;
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
