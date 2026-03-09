import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "../../test-utils/renderHook";
import { STORAGE_KEYS } from "../../lib/storage";
import { OptimizationStatusResponse } from "../../types";
import {
  getMobileOptimizeDefaultLandingView,
  normalizeStoredMobileOptimizeLandingView,
  useMobileOptimizeLandingView
} from "./useMobileOptimizeLandingView";

function buildStatus(hasResults: boolean): OptimizationStatusResponse {
  const row = {
    row_id: 1,
    leverage: 8,
    grids: 6,
    use_base_position: false,
    base_grid_count: 0,
    initial_position_size: 0,
    anchor_price: 70000,
    lower_price: 65000,
    upper_price: 71000,
    stop_price: 72000,
    band_width_pct: 8,
    range_lower: 65000,
    range_upper: 71000,
    stop_loss: 72000,
    stop_loss_ratio_pct: 1,
    max_possible_loss_usdt: 180,
    total_return_usdt: 320,
    max_drawdown_pct: 10,
    sharpe_ratio: 1.2,
    win_rate: 0.62,
    return_drawdown_ratio: 3.2,
    score: 3.2,
    validation_total_return_usdt: 280,
    validation_max_drawdown_pct: 11,
    validation_sharpe_ratio: 1.1,
    validation_win_rate: 0.6,
    validation_return_drawdown_ratio: 2.9,
    validation_score: 2.9,
    validation_total_closed_trades: 10,
    robust_score: 2.95,
    overfit_penalty: 0.1,
    passes_constraints: true,
    constraint_violations: [],
    total_closed_trades: 12
  };
  return {
    job: {
      job_id: "opt-job-1",
      status: hasResults ? "completed" : "running",
      created_at: "2026-02-28T00:00:00Z",
      started_at: "2026-02-28T00:00:00Z",
      finished_at: hasResults ? "2026-02-28T01:00:00Z" : null,
      progress: hasResults ? 100 : 20,
      total_steps: 10,
      completed_steps: hasResults ? 10 : 2,
      message: null,
      error: null,
      total_combinations: 100,
      trials_completed: hasResults ? 100 : 20,
      trials_pruned: 0,
      pruning_ratio: 0
    },
    target: "return_drawdown_ratio",
    sort_by: "robust_score",
    sort_order: "desc",
    page: 1,
    page_size: 20,
    total_results: hasResults ? 1 : 0,
    rows: hasResults ? [row] : [],
    best_row: hasResults ? row : null,
    best_validation_row: null,
    best_equity_curve: [],
    best_score_progression: [],
    convergence_curve_data: [],
    heatmap: [],
    train_window: null,
    validation_window: null
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("useMobileOptimizeLandingView", () => {
  it("defaults to runtime when there are no completed results", () => {
    expect(getMobileOptimizeDefaultLandingView(buildStatus(false))).toBe("runtime");
  });

  it("defaults to results when completed results exist", () => {
    expect(getMobileOptimizeDefaultLandingView(buildStatus(true))).toBe("results");
  });

  it("maps legacy history_overlay session value to results", () => {
    expect(normalizeStoredMobileOptimizeLandingView("history_overlay")).toBe("results");
    window.sessionStorage.setItem(STORAGE_KEYS.mobileOptimizeSubtab, "history_overlay");
    const hook = renderHook(() => useMobileOptimizeLandingView(buildStatus(false)));
    expect(hook.value[0]).toBe("results");
    hook.unmount();
  });

  it("prefers results when completed rows exist even if runtime was stored previously", () => {
    window.sessionStorage.setItem(STORAGE_KEYS.mobileOptimizeLandingViewV2, "runtime");
    const hook = renderHook(() => useMobileOptimizeLandingView(buildStatus(true)));
    expect(hook.value[0]).toBe("results");
    hook.unmount();
  });
});
