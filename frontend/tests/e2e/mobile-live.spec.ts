import { expect, test } from "@playwright/test";
import { login, mockApi } from "./helpers/mockApi";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("operation feedback drawer is reachable on mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.locator('[data-tour-id="mobile-tab-optimize"]').click();
  await page.getByRole("button", { name: "通知" }).click();
  await expect(page.getByText(/通知中心/)).toBeVisible();
  await expect(page.getByText(/当前没有需要关注的通知。/)).toBeVisible();
});

test("mobile live credentials restore only after explicit opt-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");
  await login(page);

  await page.locator("select").first().selectOption("okx");
  await page.locator('[data-tour-id="mobile-tab-live"]').click();
  await page.getByPlaceholder("输入 OKX API Key").fill("demo-live-key");
  await page.getByPlaceholder("输入 OKX API Secret").fill("demo-live-secret");
  await page.getByPlaceholder("输入 OKX Passphrase").fill("demo-live-passphrase");

  const draftBeforeOptIn = await page.evaluate(() => window.sessionStorage.getItem("btc-grid-backtest:live-connection-draft:v1"));
  const persistBeforeOptIn = await page.evaluate(() => window.sessionStorage.getItem("btc-grid-backtest:live-connection-credentials-persist-enabled:v1"));
  expect(draftBeforeOptIn).toContain('"api_key":""');
  expect(draftBeforeOptIn).toContain('"api_secret":""');
  expect(persistBeforeOptIn).toBe("0");

  await page.getByRole("checkbox", { name: /在当前浏览器会话中保存 OKX 凭证/ }).check();

  const draftAfterOptIn = await page.evaluate(() => window.sessionStorage.getItem("btc-grid-backtest:live-connection-draft:v1"));
  const persistAfterOptIn = await page.evaluate(() => window.sessionStorage.getItem("btc-grid-backtest:live-connection-credentials-persist-enabled:v1"));
  expect(draftAfterOptIn).toContain("demo-live-key");
  expect(draftAfterOptIn).toContain("demo-live-secret");
  expect(draftAfterOptIn).toContain("demo-live-passphrase");
  expect(persistAfterOptIn).toBe("1");
});
