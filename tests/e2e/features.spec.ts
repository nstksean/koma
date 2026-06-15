import { test, expect } from "@playwright/test";

const BOOK = "/book/ttkan/doupocangqiong-tiancantudou";
const READ1 = "/read/ttkan/doupocangqiong-tiancantudou/1";

test("書頁章節搜尋可過濾目錄", async ({ page }) => {
  await page.goto(BOOK);
  const counter = page.getByText(/共 \d+ 章/).first();
  await expect(counter).toBeVisible();
  const before = (await counter.textContent()) ?? "";

  await page.getByPlaceholder("搜尋章節（標題或章號）").fill("100");
  await expect(counter).not.toHaveText(before); // 章數變少
  await expect(page.locator('ul a[href^="/read/ttkan/"]').first()).toBeVisible();
});

test("閱讀器顯示章節序位、目錄抽屜可開啟並跳章", async ({ page }) => {
  await page.goto(READ1);
  await expect(page.locator("article p").first()).toBeVisible();
  await expect(page.getByText(/第 1 \/ \d+ 章/)).toBeVisible();

  await page.getByRole("button", { name: "章節目錄" }).click();
  await expect(page.getByPlaceholder("搜尋章節（標題或章號）")).toBeVisible();

  const links = page.locator('div[role="dialog"] ul a[href^="/read/ttkan/"]');
  await expect(links.first()).toBeVisible();
  await links.nth(1).click(); // 跳到第二章（不過濾，避免清單重繪造成點擊不穩定）
  await expect(page).toHaveURL(/\/read\/ttkan\/doupocangqiong-tiancantudou\/\d+/);
  await expect(page.locator("article p").first()).toBeVisible();
});

test("讀過之後首頁出現「繼續閱讀」", async ({ page }) => {
  await page.goto(READ1);
  await expect(page.locator("article p").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(1100); // 等進度 debounce 存入

  await page.goto("/");
  await expect(page.getByText("繼續閱讀")).toBeVisible();
});
