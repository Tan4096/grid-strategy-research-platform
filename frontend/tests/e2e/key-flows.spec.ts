import { expect, Page, test } from "@playwright/test";

interface MockCalls {
  backtestStartIdempotencyKeys: string[];
  optimizationStartIdempotencyKeys: string[];
  clearSelectedCalls: number;
  operationListCalls: number;
  operationDetailCalls: number;
  exportCalls: number;
}

interface MockApiOptions {
  historyItems?: Array<{ job: ReturnType<typeof optimizationMeta>; target: string }>;
  historyNextCursor?: string | null;
  historyAfterCursor?: Record<string, { items: Array<{ job: ReturnType<typeof optimizationMeta>; target: string }>; next_cursor: string | null }>;
  clearSelectedPlan?: Array<{
    deleted: number;
    failed: number;
    failed_items?: Array<{ job_id: string; reason_code: string; reason_message: string }>;
    summary_text?: string;
  }>;
  operationsList?: Array<Record<string, unknown>>;
  operationDetails?: Record<string, Record<string, unknown>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function backtestDefaults() {
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

function optimizationRow() {
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

function optimizationMeta(status: "pending" | "running" | "completed" | "failed" | "cancelled") {
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

function optimizationStatusPayload() {
  const row = optimizationRow();
  const now = nowIso();
  return {
    job: optimizationMeta("completed"),
    target: "return_drawdown_ratio",
    sort_by: "robust_score",
    sort_order: "desc",
    page: 1,
    page_size: 20,
    total_results: 1,
    rows: [row],
    best_row: row,
    best_validation_row: null,
    best_equity_curve: [
      { timestamp: now, value: 1000 },
      { timestamp: now, value: 1020 }
    ],
    best_score_progression: [{ step: 1, value: 2.95 }],
    convergence_curve_data: [{ step: 1, value: 2.95 }],
    heatmap: [],
    train_window: null,
    validation_window: null
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  };
}

async function mockApi(page: Page, options: MockApiOptions = {}): Promise<MockCalls> {
  const calls: MockCalls = {
    backtestStartIdempotencyKeys: [],
    optimizationStartIdempotencyKeys: [],
    clearSelectedCalls: 0,
    operationListCalls: 0,
    operationDetailCalls: 0,
    exportCalls: 0
  };
  const statusPayload = optimizationStatusPayload();
  const defaultHistoryItems = [
    {
      job: optimizationMeta("completed"),
      target: "return_drawdown_ratio"
    }
  ];

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
      await route.fulfill(
        jsonResponse({
          source: "binance",
          symbol: "BTCUSDT",
          maker_fee_rate: 0.0002,
          taker_fee_rate: 0.0004,
          funding_rate_per_8h: 0.0,
          funding_interval_hours: 8,
          price_tick_size: 0.1,
          quantity_step_size: 0.0001,
          min_notional: 5.0,
          fetched_at: nowIso(),
          note: null
        })
      );
      return;
    }
    if (path === "/api/v1/backtest/start" && method === "POST") {
      calls.backtestStartIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await route.fulfill(jsonResponse({ job_id: "bt-job-1", status: "pending" }));
      return;
    }
    if (path === "/api/v1/backtest/bt-job-1" && method === "GET") {
      await route.fulfill(
        jsonResponse({
          job: {
            job_id: "bt-job-1",
            status: "failed",
            created_at: nowIso(),
            started_at: nowIso(),
            finished_at: nowIso(),
            progress: 100,
            message: "failed",
            error: "mocked backtest failure"
          },
          result: null
        })
      );
      return;
    }
    if (path === "/api/v1/optimization/start" && method === "POST") {
      calls.optimizationStartIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await route.fulfill(jsonResponse({ job_id: "opt-job-1", status: "pending", total_combinations: 0 }));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1/progress" && method === "GET") {
      await route.fulfill(
        jsonResponse({
          job: optimizationMeta("completed"),
          target: "return_drawdown_ratio"
        })
      );
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1" && method === "GET") {
      await route.fulfill(jsonResponse(statusPayload));
      return;
    }
    if (path === "/api/v1/optimization/opt-job-1/rows" && method === "GET") {
      await route.fulfill(
        jsonResponse({
          job: optimizationMeta("completed"),
          target: "return_drawdown_ratio",
          sort_by: "robust_score",
          sort_order: "desc",
          page: 1,
          page_size: 20,
          total_results: 1,
          rows: [optimizationRow()],
          best_row: optimizationRow(),
          best_validation_row: null
        })
      );
      return;
    }
    if (path === "/api/v1/optimization-history" && method === "GET") {
      const cursor = url.searchParams.get("cursor");
      if (cursor && options.historyAfterCursor?.[cursor]) {
        await route.fulfill(jsonResponse(options.historyAfterCursor[cursor]));
        return;
      }
      await route.fulfill(
        jsonResponse({
          items: options.historyItems ?? defaultHistoryItems,
          next_cursor: options.historyNextCursor ?? null
        })
      );
      return;
    }
    if (path === "/api/v1/optimization-history/selected" && method === "DELETE") {
      calls.clearSelectedCalls += 1;
      const requestedIds = url.searchParams.getAll("job_id");
      const plan = options.clearSelectedPlan?.[calls.clearSelectedCalls - 1];
      if (plan) {
        const failedItems =
          plan.failed_items ??
          requestedIds.slice(0, plan.failed).map((jobId) => ({
            job_id: jobId,
            reason_code: "REQUEST_FAILED",
            reason_message: "mock failed"
          }));
        const failedJobIds = failedItems.map((item) => item.job_id);
        const failedSet = new Set(failedJobIds);
        const deletedJobIds = requestedIds.filter((jobId) => !failedSet.has(jobId)).slice(0, plan.deleted);
        await route.fulfill(
          jsonResponse({
            requested: requestedIds.length,
            deleted: plan.deleted,
            failed: plan.failed,
            deleted_job_ids: deletedJobIds,
            failed_job_ids: failedJobIds,
            failed_items: failedItems,
            summary_text: plan.summary_text
          })
        );
        return;
      }
      await route.fulfill(
        jsonResponse({
          requested: requestedIds.length,
          deleted: requestedIds.length,
          failed: 0,
          deleted_job_ids: requestedIds,
          failed_job_ids: [],
          failed_items: []
        })
      );
      return;
    }
    if (path === "/api/v1/operations" && method === "GET") {
      calls.operationListCalls += 1;
      await route.fulfill(
        jsonResponse({
          items: options.operationsList ?? [],
          next_cursor: null
        })
      );
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
      await route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "row_id,score\n1,2.95\n"
      });
      return;
    }

    await route.fulfill(jsonResponse({ code: "NOT_FOUND", message: "mock route not found" }, 404));
  });

  return calls;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

async function login(page: Page): Promise<void> {
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

test("runtime auth login works", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await login(page);
});

test("backtest start sends idempotency key", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "开始回测" }).click();
  await expect.poll(() => calls.backtestStartIdempotencyKeys.length).toBe(1);
  expect(calls.backtestStartIdempotencyKeys[0]).toBeTruthy();
});

test("optimization start sends idempotency key", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "开始参数优化" }).click();

  await expect.poll(() => calls.optimizationStartIdempotencyKeys.length).toBe(1);
  expect(calls.optimizationStartIdempotencyKeys[0]).toBeTruthy();
});

test("history selected clear works with feedback", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "历史" }).click();
  await page.getByRole("button", { name: "全选已加载范围" }).click();
  await page.getByRole("button", { name: "清空已选" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();

  await expect.poll(() => calls.clearSelectedCalls).toBe(1);
  await expect(page.getByText("最近一次清空：请求 1 条，成功 1 条，失败 0 条。")).toBeVisible();
});

test("optimization export triggers csv endpoint", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "历史" }).click();
  await page.getByRole("button", { name: "查看" }).first().click();
  await page.getByRole("button", { name: "导出优化 CSV" }).click();

  await expect.poll(() => calls.exportCalls).toBe(1);
});

test("apply optimization params back to backtest", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "历史" }).click();
  await page.getByRole("button", { name: "查看" }).first().click();
  await page.getByRole("button", { name: "结果" }).click();
  await page.getByRole("button", { name: "应用到回测模块" }).first().click();

  await expect(page.getByText("已将优化参数回填到回测面板。")).toBeVisible();
  await expect(page.getByRole("button", { name: "回测", exact: true })).toHaveClass(/is-active/);
});

test("operation center keeps history after refresh without replaying top notice", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "历史" }).click();
  await page.getByRole("button", { name: "全选已加载范围" }).click();
  await page.getByRole("button", { name: "清空已选" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText(/清空/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/已清空 1 条优化历史。/)).toHaveCount(0);
  const skipGuideButtonAfterReload = page.getByRole("button", { name: "跳过引导" });
  if (await skipGuideButtonAfterReload.count()) {
    await skipGuideButtonAfterReload.first().click();
  }

  await page.getByRole("button", { name: /操作反馈/ }).click();
  await expect(page.getByText(/清空/)).toBeVisible();
});

test("history supports retrying only failed items", async ({ page }) => {
  const calls = await mockApi(page, {
    clearSelectedPlan: [
      {
        deleted: 0,
        failed: 1,
        failed_items: [
          {
            job_id: "opt-job-1",
            reason_code: "REQUEST_FAILED",
            reason_message: "mock failed"
          }
        ]
      },
      {
        deleted: 1,
        failed: 0,
        failed_items: []
      }
    ]
  });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "历史" }).click();
  await page.getByRole("button", { name: "全选已加载范围" }).click();
  await page.getByRole("button", { name: "清空已选" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();

  await expect(page.getByText("待处理失败：1 条")).toBeVisible();
  await page.getByRole("button", { name: /重试失败项/ }).click();
  await expect.poll(() => calls.clearSelectedCalls).toBe(2);
  await expect(page.getByText("最近一次清空：请求 1 条，成功 1 条，失败 0 条。")).toBeVisible();
});

test("operation replay from backend is visible and detail sync works", async ({ page }) => {
  const calls = await mockApi(page, {
    operationsList: [
      {
        operation_id: "op-1",
        action: "clear_selected",
        status: "partial_failed",
        requested: 2,
        success: 1,
        failed: 1,
        skipped: 0,
        failed_items: [
          {
            job_id: "opt-job-1",
            reason_code: "REQUEST_FAILED",
            reason_message: "mock failed"
          }
        ],
        summary_text: "清空完成：成功 1 条，失败 1 条。",
        request_id: "req-op-1",
        created_at: nowIso(),
        updated_at: nowIso(),
        meta: { retryable: true }
      }
    ],
    operationDetails: {
      "op-1": {
        operation_id: "op-1",
        action: "clear_selected",
        status: "success",
        requested: 2,
        success: 2,
        failed: 0,
        skipped: 0,
        summary_text: "清空完成：成功 2 条，失败 0 条。",
        request_id: "req-op-1",
        created_at: nowIso(),
        updated_at: nowIso(),
        meta: { retryable: false }
      }
    }
  });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: /操作反馈/ }).click();
  await expect(page.getByText("清空完成：成功 1 条，失败 1 条。")).toBeVisible();
  await page.getByRole("button", { name: "同步详情" }).click();
  await expect.poll(() => calls.operationDetailCalls).toBe(1);
  await expect(page.getByText("清空完成：成功 2 条，失败 0 条。")).toBeVisible();
});

test("operation feedback drawer is reachable on mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.locator('[data-tour-id="mobile-tab-optimize"]').click();
  await expect(page.locator('[data-tour-id="optimization-feedback-entry"]')).toHaveCount(0);
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("button", { name: "操作反馈" }).click();
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("button", { name: "更多" })).toBeVisible();
});
