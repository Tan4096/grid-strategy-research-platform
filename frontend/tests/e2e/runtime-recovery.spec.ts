import { expect, test } from "@playwright/test";
import { login, mockApi, nowIso, optimizationMeta, optimizationStatusPayload } from "./helpers/mockApi";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("backtest falls back to polling when EventSource is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { EventSource?: typeof EventSource }).EventSource = undefined;
  });
  await mockApi(page, {
    backtestStatusPlan: [
      {
        job: {
          job_id: "bt-job-1",
          status: "running",
          created_at: nowIso(),
          started_at: nowIso(),
          finished_at: null,
          progress: 10,
          message: "running",
          error: null
        },
        result: null
      }
    ]
  });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "开始回测" }).click();
  await expect(page.getByText("实时流暂不可用，已自动降级为轮询跟踪。")).toBeVisible();
  await expect(page.getByText("轮询降级")).toBeVisible();
});

test("optimization falls back to polling when EventSource is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { EventSource?: typeof EventSource }).EventSource = undefined;
  });
  await mockApi(page, {
    optimizationProgressPlan: [{ job: optimizationMeta("running"), target: "return_drawdown_ratio" }],
    optimizationStatusPlan: [optimizationStatusPayload("running")]
  });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "参数优化" }).click();
  await page.getByRole("button", { name: "开始参数优化" }).click();
  await expect(page.getByText("实时连接已降级为轮询")).toBeVisible();
});

test("resumes active backtest job from session storage", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { EventSource?: typeof EventSource }).EventSource = undefined;
    window.sessionStorage.setItem(
      "backtest_active_job_v1",
      JSON.stringify({ job_id: "bt-job-1", started_at: Date.now() })
    );
  });
  await mockApi(page, {
    backtestStatusPlan: [
      {
        job: {
          job_id: "bt-job-1",
          status: "running",
          created_at: nowIso(),
          started_at: nowIso(),
          finished_at: null,
          progress: 35,
          message: "running",
          error: null
        },
        result: null
      }
    ]
  });
  await page.goto("/");
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.getByText("实时流暂不可用，已自动降级为轮询跟踪。")).toBeVisible();
  await expect(page.getByText("轮询降级")).toBeVisible();
});

test("recovers backtest polling immediately when page becomes visible again", async ({ page }) => {
  await page.addInitScript(() => {
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state
    });
    (window as unknown as { __setVisibilityState?: (next: DocumentVisibilityState) => void }).__setVisibilityState = (next) => {
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    (window as unknown as { EventSource?: typeof EventSource }).EventSource = undefined;
  });
  await mockApi(page, {
    backtestStatusPlan: [
      {
        job: {
          job_id: "bt-job-1",
          status: "running",
          created_at: nowIso(),
          started_at: nowIso(),
          finished_at: null,
          progress: 10,
          message: "running",
          error: null
        },
        result: null
      },
      {
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
      }
    ]
  });
  await page.goto("/");
  await login(page);

  await page.getByRole("button", { name: "开始回测" }).click();
  await page.evaluate(() => {
    (window as unknown as { __setVisibilityState?: (next: DocumentVisibilityState) => void }).__setVisibilityState?.("hidden");
  });
  await page.evaluate(() => {
    (window as unknown as { __setVisibilityState?: (next: DocumentVisibilityState) => void }).__setVisibilityState?.("visible");
  });

  await expect(page.getByText("mocked backtest failure")).toBeVisible();
});
