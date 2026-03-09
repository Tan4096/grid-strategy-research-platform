import { expect, type Page } from "@playwright/test";

export interface MockCalls {
  backtestStartIdempotencyKeys: string[];
  optimizationStartIdempotencyKeys: string[];
  clearSelectedCalls: number;
  operationListCalls: number;
  operationDetailCalls: number;
  exportCalls: number;
}

export interface MockApiOptions {
  historyItems?: Array<{ job: ReturnType<typeof optimizationMeta>; target: string }>;
  historyNextCursor?: string | null;
  historyAfterCursor?: Record<string, { items: Array<{ job: ReturnType<typeof optimizationMeta>; target: string }>; next_cursor: string | null }>;
  backtestStatusPlan?: Array<Record<string, unknown>>;
  optimizationProgressPlan?: Array<Record<string, unknown>>;
  optimizationStatusPlan?: Array<Record<string, unknown>>;
  clearSelectedPlan?: Array<{
    deleted: number;
    failed: number;
    failed_items?: Array<{ job_id: string; reason_code: string; reason_message: string }>;
    summary_text?: string;
  }>;
  operationsList?: Array<Record<string, unknown>>;
  operationDetails?: Record<string, Record<string, unknown>>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function backtestDefaults() {
  return {
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
      funding_rate_per_8h: 0.0,
      funding_interval_hours: 8,
      use_mark_price_for_liquidation: false,
      price_tick_size: 0.1,
      quantity_step_size: 0.0001,
      min_notional: 5.0,
      max_allowed_loss_usdt: null
    },
    data: {
      source: "binance",
      symbol: "BTCUSDT",
      interval: "1h",
      lookback_days: 14,
      start_time: "2026-02-01T00:00:00+00:00",
      end_time: "2026-02-15T00:00:00+00:00",
      csv_content: null
    }
  };
}

export function optimizationRow() {
  return {
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
}

export function optimizationMeta(status: "pending" | "running" | "completed" | "failed" | "cancelled") {
  const now = nowIso();
  return {
    job_id: "opt-job-1",
    status,
    created_at: now,
    started_at: now,
    finished_at: status === "completed" ? now : null,
    progress: status === "completed" ? 100 : 10,
    total_steps: 1,
    completed_steps: status === "completed" ? 1 : 0,
    message: status === "completed" ? "done" : "running",
    error: null,
    total_combinations: 1,
    trials_completed: status === "completed" ? 1 : 0,
    trials_pruned: 0,
    pruning_ratio: 0
  };
}

export function optimizationStatusPayload(status: "pending" | "running" | "completed" | "failed" | "cancelled" = "completed") {
  const row = optimizationRow();
  const now = nowIso();
  return {
    job: optimizationMeta(status),
    target: "return_drawdown_ratio",
    sort_by: "robust_score",
    sort_order: "desc",
    page: 1,
    page_size: 20,
    total_results: 1,
    rows: [row],
    best_row: row,
    best_validation_row: null,
    best_equity_curve: [{ timestamp: now, value: 1000 }, { timestamp: now, value: 1020 }],
    best_score_progression: [{ step: 1, value: 2.95 }],
    convergence_curve_data: [{ step: 1, value: 2.95 }],
    heatmap: [],
    train_window: null,
    validation_window: null
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(payload) };
}

export async function mockApi(page: Page, options: MockApiOptions = {}): Promise<MockCalls> {
  const calls: MockCalls = {
    backtestStartIdempotencyKeys: [],
    optimizationStartIdempotencyKeys: [],
    clearSelectedCalls: 0,
    operationListCalls: 0,
    operationDetailCalls: 0,
    exportCalls: 0
  };
  const statusPayload = optimizationStatusPayload();
  let backtestStatusCall = 0;
  let optimizationProgressCall = 0;
  let optimizationStatusCall = 0;
  const defaultHistoryItems = [{ job: optimizationMeta("completed"), target: "return_drawdown_ratio" }];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method().toUpperCase();

    if (path === "/api/v1/backtest/defaults" && method === "GET") {
      await route.fulfill(jsonResponse(backtestDefaults()));
      return;
    }
    if (path === "/api/v1/market/params" && method === "GET") {
      await route.fulfill(jsonResponse({ source: "binance", symbol: "BTCUSDT", maker_fee_rate: 0.0002, taker_fee_rate: 0.0004, funding_rate_per_8h: 0.0, funding_interval_hours: 8, price_tick_size: 0.1, quantity_step_size: 0.0001, min_notional: 5.0, fetched_at: nowIso(), note: null }));
      return;
    }
    if (path === "/api/v1/backtest/start" && method === "POST") {
      calls.backtestStartIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await route.fulfill(jsonResponse({ job_id: "bt-job-1", status: "pending" }));
      return;
    }
    if (path === "/api/v1/backtest/bt-job-1" && method === "GET") {
      const payload = options.backtestStatusPlan?.[Math.min(backtestStatusCall, (options.backtestStatusPlan?.length ?? 1) - 1)] ?? { job: { job_id: "bt-job-1", status: "failed", created_at: nowIso(), started_at: nowIso(), finished_at: nowIso(), progress: 100, message: "failed", error: "mocked backtest failure" }, result: null };
      backtestStatusCall += 1;
      await route.fulfill(jsonResponse(payload));
      return;
    }
    if (path === "/api/v1/live/robots" && method === "POST") {
      await route.fulfill(jsonResponse({ scope: "recent", items: [{ algo_id: "algo-live-1", name: "BTC Grid", symbol: "BTCUSDT", exchange_symbol: "BTC-USDT-SWAP", updated_at: nowIso(), state: "running", side: "long" }] }));
      return;
    }
    if (path === "/api/v1/live/snapshot" && method === "POST") {
      await route.fulfill(jsonResponse({ code: "NOT_IMPLEMENTED" }, 400));
      return;
    }
    if (path === "/api/v1/optimization/start" && method === "POST") {
      calls.optimizationStartIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await route.fulfill(jsonResponse({ job_id: "opt-job-1", status: "pending", total_combinations: 0 }));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1/progress" && method === "GET") {
      const payload = options.optimizationProgressPlan?.[Math.min(optimizationProgressCall, (options.optimizationProgressPlan?.length ?? 1) - 1)] ?? { job: optimizationMeta("completed"), target: "return_drawdown_ratio" };
      optimizationProgressCall += 1;
      await route.fulfill(jsonResponse(payload));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1" && method === "GET") {
      const payload = options.optimizationStatusPlan?.[Math.min(optimizationStatusCall, (options.optimizationStatusPlan?.length ?? 1) - 1)] ?? statusPayload;
      optimizationStatusCall += 1;
      await route.fulfill(jsonResponse(payload));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1/rows" && method === "GET") {
      await route.fulfill(jsonResponse({ job: optimizationMeta("completed"), target: "return_drawdown_ratio", sort_by: "robust_score", sort_order: "desc", page: 1, page_size: 20, total_results: 1, rows: [optimizationRow()], best_row: optimizationRow(), best_validation_row: null }));
      return;
    }
    if (path === "/api/v1/optimization-history" && method === "GET") {
      const cursor = url.searchParams.get("cursor");
      if (cursor && options.historyAfterCursor?.[cursor]) {
        await route.fulfill(jsonResponse(options.historyAfterCursor[cursor]));
        return;
      }
      await route.fulfill(jsonResponse({ items: options.historyItems ?? defaultHistoryItems, next_cursor: options.historyNextCursor ?? null }));
      return;
    }
    if (path === "/api/v1/optimization-history/selected" && method === "DELETE") {
      calls.clearSelectedCalls += 1;
      const requestedIds = url.searchParams.getAll("job_id");
      const plan = options.clearSelectedPlan?.[calls.clearSelectedCalls - 1];
      if (plan) {
        const failedItems = plan.failed_items ?? requestedIds.slice(0, plan.failed).map((job_id) => ({ job_id, reason_code: "REQUEST_FAILED", reason_message: "mock failed" }));
        const failedJobIds = failedItems.map((item) => item.job_id);
        const failedSet = new Set(failedJobIds);
        const deletedJobIds = requestedIds.filter((jobId) => !failedSet.has(jobId)).slice(0, plan.deleted);
        await route.fulfill(jsonResponse({ requested: requestedIds.length, deleted: plan.deleted, failed: plan.failed, deleted_job_ids: deletedJobIds, failed_job_ids: failedJobIds, failed_items: failedItems, summary_text: plan.summary_text }));
        return;
      }
      await route.fulfill(jsonResponse({ requested: requestedIds.length, deleted: requestedIds.length, failed: 0, deleted_job_ids: requestedIds, failed_job_ids: [], failed_items: [] }));
      return;
    }
    if (path === "/api/v1/operations" && method === "GET") {
      calls.operationListCalls += 1;
      await route.fulfill(jsonResponse({ items: options.operationsList ?? [], next_cursor: null }));
      return;
    }
    if (path.startsWith("/api/v1/operations/") && method === "GET") {
      calls.operationDetailCalls += 1;
      const operationId = decodeURIComponent(path.split("/").pop() ?? "");
      const detail = options.operationDetails?.[operationId];
      if (detail) {
        await route.fulfill(jsonResponse(detail));
        return;
      }
      await route.fulfill(jsonResponse({ code: "NOT_FOUND", message: "operation not found" }, 404));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1/export" && method === "GET") {
      calls.exportCalls += 1;
      await route.fulfill({ status: 200, contentType: "text/csv", body: "row_id,score\n1,2.95\n" });
      return;
    }

    await route.fulfill(jsonResponse({ code: "NOT_FOUND", message: "mock route not found" }, 404));
  });

  return calls;
}

export async function login(page: Page): Promise<void> {
  await expect(page.getByPlaceholder("X-API-Key（可选）")).toHaveCount(0);
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 767) {
    const runBacktestButton = page.getByRole("button", { name: "开始回测" });
    await expect(runBacktestButton).toBeVisible();
    if (await runBacktestButton.isDisabled()) {
      await page.locator('[data-tour-id="max-loss-input"]').first().fill("5000");
      await expect(runBacktestButton).toBeEnabled();
    }
  } else {
    await expect(page.locator('[data-tour-id="mobile-parameter-wizard"]')).toBeVisible();
  }
}
