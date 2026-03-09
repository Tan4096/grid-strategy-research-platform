import { expect, test } from "@playwright/test";
import { login, mockApi, nowIso } from "./helpers/mockApi";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
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

  await page.getByRole("button", { name: /通知中心/ }).click();
  await expect(page.getByText(/清空/)).toBeVisible();
});

test("history supports retrying only failed items", async ({ page }) => {
  const calls = await mockApi(page, {
    clearSelectedPlan: [
      {
        deleted: 0,
        failed: 1,
        failed_items: [{ job_id: "opt-job-1", reason_code: "REQUEST_FAILED", reason_message: "mock failed" }]
      },
      { deleted: 1, failed: 0, failed_items: [] }
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

test("operation replay from backend is visible", async ({ page }) => {
  const calls = await mockApi(page, {
    operationsList: [{
      operation_id: "op-1",
      action: "clear_selected",
      status: "partial_failed",
      requested: 2,
      success: 1,
      failed: 1,
      skipped: 0,
      failed_items: [{ job_id: "opt-job-1", reason_code: "REQUEST_FAILED", reason_message: "mock failed" }],
      summary_text: "清空完成：成功 1 条，失败 1 条。",
      request_id: "req-op-1",
      created_at: nowIso(),
      updated_at: nowIso(),
      meta: { retryable: true }
    }],
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

  await page.getByRole("button", { name: /通知中心/ }).click();
  await expect(page.getByText(/清空完成：成功 1 条，失败 1 条/)).toBeVisible();
});
