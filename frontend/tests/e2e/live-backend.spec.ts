import { expect, test } from "@playwright/test";

const liveBackendEnabled = process.env.E2E_REAL_BACKEND === "1";
const apiBase = process.env.E2E_API_BASE ?? "http://127.0.0.1:8000";

test.describe("live backend integration", () => {
  test.skip(!liveBackendEnabled, "set E2E_REAL_BACKEND=1 to run against a real backend");

  test("backtest start returns job and frontend requests status/stream", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "开始回测" })).toBeVisible();

    const startResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v1/backtest/start")
    );

    let createdJobId = "";
    let sawStatusOrStream = false;
    page.on("request", (request) => {
      if (!createdJobId) {
        return;
      }
      const url = request.url();
      const method = request.method().toUpperCase();
      const hitStatus = method === "GET" && url.includes(`/api/v1/backtest/${createdJobId}`);
      const hitStream = method === "GET" && url.includes(`/api/v1/jobs/${createdJobId}/stream`);
      if (hitStatus || hitStream) {
        sawStatusOrStream = true;
      }
    });

    await page.getByRole("button", { name: "开始回测" }).click();

    const startResponse = await startResponsePromise;
    expect(startResponse.ok()).toBeTruthy();
    const payload = (await startResponse.json()) as { job_id?: string; status?: string };
    expect(typeof payload.job_id).toBe("string");
    expect(payload.job_id).toBeTruthy();
    createdJobId = String(payload.job_id);
    expect(typeof payload.status).toBe("string");

    await expect.poll(() => sawStatusOrStream, { timeout: 20_000 }).toBe(true);
  });

  test("history selected clear API returns structured payload", async ({ page }) => {
    const sessionId = `e2e-live-${Date.now()}`;

    const historyResponse = await page.request.get(`${apiBase}/api/v1/optimization-history?limit=1`, {
      headers: {
        "X-Client-Session": sessionId
      }
    });
    expect(historyResponse.ok()).toBeTruthy();

    const historyPayload = (await historyResponse.json()) as {
      items?: Array<{ job?: { job_id?: string } }>;
    };
    const firstJobId = historyPayload.items?.[0]?.job?.job_id;
    const targetJobId = firstJobId && firstJobId.trim() ? firstJobId.trim() : `missing-${Date.now()}`;

    const clearResponse = await page.request.delete(
      `${apiBase}/api/v1/optimization-history/selected?job_id=${encodeURIComponent(targetJobId)}`,
      {
        headers: {
          "X-Confirm-Action": "CLEAR_SELECTED_OPTIMIZATION_HISTORY",
          "X-Confirm-Count": "1",
          "X-Client-Session": sessionId
        }
      }
    );

    expect(clearResponse.ok()).toBeTruthy();
    const clearPayload = (await clearResponse.json()) as Record<string, unknown>;
    expect(clearPayload).toMatchObject({
      requested: expect.any(Number),
      deleted: expect.any(Number),
      failed: expect.any(Number),
      deleted_job_ids: expect.any(Array),
      failed_job_ids: expect.any(Array),
      failed_items: expect.any(Array)
    });
  });
});
