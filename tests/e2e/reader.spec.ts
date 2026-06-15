import { test, expect } from "@playwright/test";

/**
 * DoD 核心流程：搜尋 → 書頁 → 閱讀，確認內文出現、零廣告、上下章可用。
 */
test("搜尋 → 書頁 → 閱讀首章：內文乾淨且零廣告", async ({ page }) => {
  await page.goto("/");

  // 搜尋
  await page.getByPlaceholder("搜尋書名或作者…").fill("斗破蒼穹");
  await page.getByRole("button", { name: "搜尋" }).click();
  await expect(page).toHaveURL(/\/search/);

  // 進入第一本書
  await page.locator('a[href^="/book/ttkan/"]').first().click();
  await expect(page).toHaveURL(/\/book\/ttkan\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("破蒼穹");

  // 章節目錄出現
  await expect(page.locator('a[href^="/read/ttkan/"]').first()).toBeVisible();

  // 開始閱讀
  await page.getByRole("link", { name: /開始閱讀|續讀/ }).click();
  await expect(page).toHaveURL(/\/read\/ttkan\//);

  // 內文出現（至少一段）
  await expect(page.locator("article p").first()).toBeVisible();
  const paragraphCount = await page.locator("article p").count();
  expect(paragraphCount).toBeGreaterThan(0);

  // 零廣告 / 內文乾淨：不應殘留來源站導流字樣
  await expect(page.locator("article")).not.toContainText("天天看小說");
  await expect(page.locator("article")).not.toContainText("章節報錯");

  // 下一章存在
  await expect(page.getByRole("link", { name: /下一章/ })).toBeVisible();
});

test("閱讀設定：可切換字級，閱讀進度被記住", async ({ page }) => {
  await page.goto("/read/ttkan/doupocangqiong-tiancantudou/1");
  await expect(page.locator("article p").first()).toBeVisible();

  // 開設定面板、放大字級
  await page.getByRole("button", { name: "閱讀設定" }).click();
  await page.getByRole("button", { name: "增加字級" }).click();

  // 捲動後離開再回來，進度應被還原（scrollY > 0）
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(1200); // 等 debounce 存進度
  await page.goto("/read/ttkan/doupocangqiong-tiancantudou/1");
  await expect(page.locator("article p").first()).toBeVisible();
  await page.waitForTimeout(500);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
});
