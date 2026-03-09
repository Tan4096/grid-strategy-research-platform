import { describe, expect, it } from "vitest";
import type { OptimizationProgressResponse, OptimizationStatusResponse } from "../lib/api-schema";
import { mergeOptimizationJobMeta, mergeOptimizationProgressStatus } from "./useOptimizationPolling";

function createProgress(progress: number, status: "pending" | "running" | "completed" = "running"): OptimizationProgressResponse {
  return {
    job: {
      job_id: "opt-job-1",
      status,
      created_at: "2026-03-02T10:00:00.000Z",
      started_at: "2026-03-02T10:00:01.000Z",
      finished_at: status === "completed" ? "2026-03-02T10:01:00.000Z" : null,
      progress,
      total_steps: 100,
      completed_steps: Math.round(progress),
      message: null,
      error: null,
      total_combinations: 1000,
      trials_completed: Math.round(progress * 6),
      trials_pruned: 0,
      pruning_ratio: 0
    },
    target: "return_drawdown_ratio"
  };
}

describe("mergeOptimizationProgressStatus", () => {
  it("builds status shell when previous status is null", () => {
    const merged = mergeOptimizationProgressStatus(null, createProgress(12.5), {
      page: 1,
      pageSize: 20,
      sortBy: "robust_score",
      sortOrder: "desc"
    });

    expect(merged.job.progress).toBe(12.5);
    expect(merged.page).toBe(1);
    expect(merged.page_size).toBe(20);
    expect(merged.rows).toEqual([]);
    expect(merged.best_row).toBeNull();
    expect(merged.heatmap).toEqual([]);
  });

  it("keeps existing payload fields when previous status exists", () => {
    const previous: OptimizationStatusResponse = {
      ...mergeOptimizationProgressStatus(null, createProgress(5), {
        page: 2,
        pageSize: 50,
        sortBy: "score",
        sortOrder: "asc"
      }),
      total_results: 2,
      rows: [
        {
          row_id: 1,
          leverage: 5,
          grids: 20,
          use_base_position: false,
          base_grid_count: 0,
          initial_position_size: 0,
          anchor_price: 50000,
          lower_price: 48000,
          upper_price: 52000,
          stop_price: 47000,
          band_width_pct: 8,
          range_lower: 48000,
          range_upper: 52000,
          stop_loss: 47000,
          stop_loss_ratio_pct: 2,
          max_possible_loss_usdt: 100,
          total_return_usdt: 12,
          max_drawdown_pct: 4,
          sharpe_ratio: 1.2,
          win_rate: 0.55,
          return_drawdown_ratio: 3,
          score: 70,
          validation_total_return_usdt: 8,
          validation_max_drawdown_pct: 5,
          validation_sharpe_ratio: 0.9,
          validation_win_rate: 0.52,
          validation_return_drawdown_ratio: 1.6,
          validation_score: 60,
          validation_total_closed_trades: 10,
          robust_score: 65,
          overfit_penalty: 5,
          passes_constraints: true,
          constraint_violations: [],
          total_closed_trades: 20
        }
      ]
    };

    const merged = mergeOptimizationProgressStatus(previous, createProgress(44.4), {
      page: 1,
      pageSize: 20,
      sortBy: "robust_score",
      sortOrder: "desc"
    });

    expect(merged.job.progress).toBe(44.4);
    expect(merged.total_results).toBe(2);
    expect(merged.rows).toHaveLength(1);
    expect(merged.page).toBe(2);
    expect(merged.sort_by).toBe("score");
    expect(merged.sort_order).toBe("asc");
  });
});

describe("mergeOptimizationJobMeta", () => {
  it("keeps previous progress when incoming meta is stale", () => {
    const previous = createProgress(42.5).job;
    const staleIncoming = createProgress(1.0).job;

    const merged = mergeOptimizationJobMeta(previous, staleIncoming);
    expect(merged.progress).toBe(42.5);
    expect(merged.completed_steps).toBe(Math.round(42.5));
  });

  it("accepts terminal incoming status even if progress is lower", () => {
    const previous = createProgress(88.0, "running").job;
    const terminalIncoming = createProgress(100.0, "completed").job;

    const merged = mergeOptimizationJobMeta(previous, terminalIncoming);
    expect(merged.status).toBe("completed");
    expect(merged.progress).toBe(100);
  });
});
