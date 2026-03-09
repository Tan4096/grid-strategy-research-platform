import { expect, test } from "@playwright/test";

test("loads app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Crypto网格策略回测工具/);
  await expect(page.locator("#root")).toBeVisible();
});
