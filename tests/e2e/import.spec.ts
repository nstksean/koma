import { test, expect } from "@playwright/test";

/**
 * BYO 匯入：貼上純文字 → 切章成書 → 加入書架 → 本地書可讀（無來源站 adapter）。
 */
test("BYO 匯入：貼文字成書並可閱讀", async ({ page }) => {
  await page.goto("/import");

  await page.getByPlaceholder("書名（必填）").fill("匯入測試書");
  const sample = [
    "第一章 開始",
    "這是第一章的內文，用來測試自帶書匯入流程。",
    "第二章 續篇",
    "這是第二章的內文。",
  ].join("\n");
  await page.locator('textarea[name="text"]').fill(sample);
  await page.getByRole("button", { name: /匯入並加入書架/ }).click();

  // 成功後導到本地書頁
  await expect(page).toHaveURL(/\/book\/local\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("匯入測試書");

  // 切出兩章（章節目錄在 ul 內，不含上方「開始閱讀」按鈕）
  await expect(page.locator('ul a[href^="/read/local/"]')).toHaveCount(2);

  // 進閱讀器讀到內文
  await page.getByRole("link", { name: /開始閱讀/ }).click();
  await expect(page).toHaveURL(/\/read\/local\//);
  await expect(page.locator("article")).toContainText("第一章的內文");
});
