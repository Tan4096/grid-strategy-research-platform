import type { LiveCredentials, LiveExchange, LiveRobotListScope } from "./lib/api-schema";
import type { OperationEvent, OperationEventCategory, OperationEventStatus } from "./lib/operation-models";

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
  mark_price?: number;
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

export type JobTransportMode = "idle" | "connecting" | "sse" | "polling";
