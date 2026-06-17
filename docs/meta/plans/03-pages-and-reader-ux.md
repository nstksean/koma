# 03 — 頁面與閱讀器體驗 + 驗收（執行文件）

**日期**:2026-06-15
**對應 stage-0 計畫**:Task 6(頁面)+ Task 7(閱讀器體驗)+ Task 8(DoD 驗收)
**前置**:**[01](./01-foundation-and-data-layer.md) 與 [02](./02-fetch-and-api-layer.md) 全綠**(地基 + 資料管線就緒)
**狀態**:**✅ 已完成**(commit `276af08` 起;書封+搜尋 skeleton `1fcfdda`、import/search 測試 `bf3f408`)。Task 6 頁面 + Task 7 閱讀器體驗 + Task 8 DoD 驗收皆達成,2 條 E2E 綠。**與計畫偏差**:首發來源是 **ttkan** 非 czbooks(czbooks 被 Cloudflare 擋,見 mvp §1);字級採連續 slider(`FONT_MIN/MAX`,預設 20px),超出 DoD「至少 3 段」要求。

> 三份執行文件的最後一份。03 把 02 的資料管線接成**使用者真的能用的 App**,並完成 stage-0 的 Definition of Done。
> 本文件結束時應達成:搜尋「斗破蒼穹」→ 進書頁 → 開第一章讀到乾淨內文 → 關掉再開回到上次位置 → 日夜/字體可切 → 書架有續讀入口,且 1 條 E2E 綠燈。

---

## 0. 頁面與資料流總覽

```
/                       書架 + 搜尋入口        RSC 讀 /library，續讀卡片
  └─ <SearchBox>        Server Action search → 導去 /search?q=
/search?q=              搜尋結果              RSC 呼叫 adapter.search（或 /api/search）
  └─ 點書 → /book/[source]/[id]
/book/[source]/[id]     書籍詳情 + 章節目錄    RSC 呼叫 getBookWithChapters；加入書架(Action)
  └─ 點章 → /read/[source]/[id]/[idx]
/read/[source]/[id]/[idx]  閱讀器             RSC 取內文(server)+ Client 殼(設定/進度/翻頁)
```

⚠️ Next 16 鐵則(全程適用):
- **`params` / `searchParams` 是 Promise** → 頁面一律 `async function Page(props)` + `await props.params`。用 `PageProps<'/book/[source]/[id]'>` 型別(`npx next typegen` 產生)。
- **預設 Server Component**;只有需要互動/瀏覽器 API(localStorage、scroll、theme toggle)的才標 `"use client"`,且盡量下沉成小的 leaf component,不要整頁變 client。

---

## 1. Root layout 與主題（`src/app/layout.tsx`）

日夜模式用 **`next-themes`**(class 策略,配 Tailwind v4 dark variant)。

```bash
npm i next-themes
```

```tsx
// src/app/layout.tsx（Server Component）
import { ThemeProvider } from "@/components/theme-provider"; // "use client" 薄殼
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // ⚠️ suppressHydrationWarning：next-themes 在 client 改 class,避免 hydration mismatch
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- `globals.css`(Tailwind v4)在 `@theme` 定義閱讀器配色 token(背景、前景、護眼色)。dark variant 用 `@custom-variant dark (&:where(.dark, .dark *))` 對接 next-themes 的 `.dark` class。
- ⚠️ **不要** 在 `<html>` 設全域 `scroll-behavior: smooth`,否則 Next 16 不再幫你在導航時覆蓋(見查證),閱讀器翻頁體感會怪;要平滑捲動就針對特定元件加。

---

## 2. 頁面實作

### 2.1 `/`（書架 + 搜尋）— `src/app/page.tsx`

- RSC:呼叫 `getLibrary()`(02 service)取書架 + join `progress`,渲染:
  - **續讀卡片**:`progress` 依 `updatedAt` desc 取最新一本 → 大卡片「繼續閱讀《書名》第 N 章」連到 `/read/...`。
  - 書架 grid:每本書封面/書名/最新章,點進 `/book/...`。
- 頂部 `<SearchBox>`(client leaf):輸入關鍵字 → 呼叫 search Server Action → `redirect("/search?q=...")`。
- 空書架狀態:引導去搜尋(shadcn empty state)。

### 2.2 `/search`（結果）— `src/app/search/page.tsx`

```tsx
export default async function SearchPage(props: PageProps<"/search">) {
  const { q } = await props.searchParams;          // ⚠️ async
  const keyword = typeof q === "string" ? q : "";
  const results = keyword ? await searchBooks(keyword) : [];
  // 渲染結果列表;每筆連到 /book/[source]/[id]
}
```
- 搜尋走 `DEFAULT_SOURCE`(ttkan)。0 命中 / 來源錯誤要有明確 UI(「沒找到」vs「來源暫時連不上」)。
- `loading.tsx` 用 shadcn `Skeleton` 撐住等待感。

### 2.3 `/book/[source]/[id]`（詳情 + 目錄）— `src/app/book/[source]/[id]/page.tsx`

```tsx
export default async function BookPage(props: PageProps<"/book/[source]/[id]">) {
  const { source, id } = await props.params;       // ⚠️ async
  const { book, chapters } = await getBookWithChapters(source, id);
  // 書名/作者/分類/簡介/封面 + 「加入書架」按鈕(Server Action)
  // 章節目錄(可能上千章 → 見下「虛擬滾動」)
}
```
- **加入書架**:`<AddToShelfButton>`(client)呼叫 Server Action `addToLibrary(source, id)` → `revalidatePath("/")`(讓書架更新)。
- **章節目錄虛擬滾動**:章數可能上千,用 `@tanstack/react-virtual` 只渲染可視範圍,避免一次塞幾千個 DOM。目錄是 client leaf(`<ChapterList>`),資料由 server 傳入。
- 已讀章節打勾(從 `progress` 帶當前章 idx 進來標示)。

### 2.4 `/read/[source]/[id]/[idx]`（閱讀器）— 最重要

**Server 部分**(page.tsx):`await params` → `getChapterContent(source, id, idx)`(02 DB-first)→ 取得乾淨內文與前後章 idx,傳給 client 閱讀器殼。
**Client 部分**(`<Reader>`,`"use client"`):負責設定、進度、翻頁互動。見 §3。

---

## 3. 閱讀器體驗（Task 7,差異化核心）

### 3.1 閱讀設定（localStorage,不進 DB）

字體大小、行距、配色屬「裝置偏好」,存 localStorage 即可(MVP 不跨裝置同步設定;同步留階段 1)。

```ts
// 設定形狀
interface ReaderPrefs {
  readonly fontSize: 16 | 18 | 20 | 22 | 24;  // 至少 3 段(DoD 要求)
  readonly lineHeight: 1.6 | 1.8 | 2.0;
  readonly theme: "light" | "dark" | "sepia"; // 與 next-themes 整合
}
```
- 用 custom hook `useReaderPrefs()`(讀寫 localStorage,SSR-safe:初值在 `useEffect` 後才套,避免 hydration mismatch)。
- 設定面板用 shadcn `Sheet` / `Drawer` 從底部滑出。

### 3.2 閱讀進度記憶（scrollRatio,進 DB)

DoD 核心:「關掉再開,回到上次章節與位置」。

- **記錄**:閱讀器監聽捲動,算 `scrollRatio = scrollTop / (scrollHeight - clientHeight)` → 換算成萬分比整數(0–10000,對齊 01 schema)。
- ⚠️ **debounce**:捲動事件高頻,存進度要 debounce(如 1s)或在 `visibilitychange`/`beforeunload`/換章時才寫,避免狂打 DB。
- **寫入**:呼叫 Server Action `saveProgress(source, id, chapterIdx, scrollRatio)` → upsert `progress`(02 已對 `(userId, bookId)` 設唯一鍵 → 不長多筆)。
- **還原**:進閱讀器時,server 帶入該書 `progress`;若當前 `idx` 等於進度章節,client 在內容掛載後 `scrollTo` 對應比例位置。

```ts
// useDebounce(全域 patterns 已有範式)用於進度寫入
const debouncedRatio = useDebounce(scrollRatio, 1000);
useEffect(() => {
  if (debouncedRatio > 0) saveProgress(source, id, idx, debouncedRatio);
}, [debouncedRatio]);
```

### 3.3 上下章 + 目錄抽屜

- 上一章 / 下一章按鈕:用 server 傳入的 `prevIdx` / `nextIdx` 導頁(`router.push`);換章前先 flush 一次進度寫入。
- 目錄抽屜(shadcn `Sheet`):重用 §2.3 的 `<ChapterList>`,點章直接跳。
- (選配)鍵盤左右鍵 / 點擊左右半屏翻頁,提升體感。

---

## 4. 零廣告（天生達成,但要驗）

零廣告是抓取流程的天然結果(來源乾淨 + 02 已清洗導流字樣)。03 不需特別做事,但 **E2E 要斷言內文中不含**來源站雜訊字樣(見 §5),把「乾淨」變成可回歸的保證。

---

## 5. E2E 測試（Playwright,Task 8）

```bash
npm i -D @playwright/test && npx playwright install chromium
```

關鍵流程(stage-0 DoD 的可執行版):

```ts
// tests/e2e/read-flow.spec.ts（形狀示意）
test("搜尋 → 書頁 → 讀第一章 → 進度記憶", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/搜尋/).fill("斗破蒼穹");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: /斗破蒼穹/ }).first().click(); // → /book/...
  await expect(page.getByText(/作者|分類/)).toBeVisible();
  await page.getByRole("link").filter({ hasText: /第.*章|章節/ }).first().click(); // → /read/...

  // 內文出現、且乾淨(無來源站雜訊)
  const body = page.getByTestId("chapter-content");
  await expect(body).toBeVisible();
  await expect(body).not.toContainText("天天看小說");
  await expect(body).not.toContainText("章節報錯");

  // 捲動 → 等 debounce 寫入 → 重新整理回到位置
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(body).toBeInViewport(); // 或斷言 scrollY > 0
});
```

⚠️ E2E 會真打 ttkan(慢、依賴外網)。可選:用 02 的 fixture 起一個 mock 來源,讓 E2E 穩定離線。MVP 先接真站跑通 1 條即可,之後再 mock 化。

---

## 6. 目錄結構（03 新增）

```
src/
├─ app/
│  ├─ layout.tsx               # ThemeProvider
│  ├─ globals.css              # @theme 配色 + dark variant
│  ├─ page.tsx                 # 書架 + 續讀
│  ├─ search/{page,loading}.tsx
│  ├─ book/[source]/[id]/page.tsx
│  └─ read/[source]/[id]/[idx]/page.tsx
├─ components/
│  ├─ theme-provider.tsx       # "use client" 薄殼
│  ├─ search-box.tsx           # "use client"
│  ├─ chapter-list.tsx         # "use client"（虛擬滾動）
│  ├─ add-to-shelf-button.tsx  # "use client"
│  └─ reader/                  # 閱讀器 client 元件群
│     ├─ reader.tsx
│     ├─ reader-settings.tsx
│     └─ use-reader-prefs.ts
├─ server/
│  └─ actions.ts               # search / addToLibrary / saveProgress（"use server"）
└─ lib/use-debounce.ts
tests/e2e/read-flow.spec.ts
playwright.config.ts
```

> Server Actions 集中在 `src/server/actions.ts`,內部呼叫 02 的 `books-service`,**不重複**快取邏輯。

---

## 7. DoD（03 完成定義＝ stage-0 整體驗收）

對齊 [mvp-stage0-plan.md §7](./mvp-stage0-plan.md):

- [ ] 在搜尋框輸入關鍵字,能列出書、進書頁看到**完整章節目錄**。
- [ ] 點章節讀到**乾淨內文**(已清洗來源站雜訊),零廣告。
- [ ] **關掉再開,自動回到上次的章節與捲動位置**。
- [ ] **日夜模式**可切;字體大小**至少 3 段**可調(行距亦可調)。
- [ ] **加入書架**;書架顯示**續讀入口**(繼續閱讀卡片)。
- [ ] 至少 **1 條 E2E** 綠燈(搜尋→書頁→讀章→進度);adapter fixture 單測(02)仍綠。
- [ ] 頁面全程符合 Next 16 async `params`/`searchParams`;client 元件最小化。
- [ ] 無 `console.log` 殘留(security/hooks 規範);無 hydration warning。

---

## 8. 風險與雷區

| 雷 | 症狀 | 對策 |
|----|------|------|
| ⚠️ localStorage 在 SSR 讀取 | hydration mismatch / `window is not defined` | 偏好初值在 `useEffect` 後套用;`useReaderPrefs` SSR-safe |
| ⚠️ 進度寫入未 debounce | 捲動時狂打 DB / Server Action | debounce 1s + 換章/離開前 flush |
| ⚠️ 整頁標 `"use client"` | 失去 RSC 好處、bundle 變大 | 只把互動 leaf 標 client,內文抓取留 server |
| ⚠️ 章節目錄上千筆全渲染 | 書頁卡頓 | `@tanstack/react-virtual` 虛擬滾動 |
| ⚠️ 全域 `scroll-behavior: smooth` | Next 16 不再覆蓋,翻頁體感怪 | 不設全域,需要時局部加 |
| ⚠️ E2E 依賴真站,flaky | CI 紅綠不穩 | 先跑通真站 1 條;後續用 fixture mock 來源 |
| ⚠️ next-themes 無 `suppressHydrationWarning` | console hydration warning | `<html suppressHydrationWarning>` |

---

## 9. 來源

- Next.js 16 async `params`/`searchParams` 與 `PageProps`/`next typegen`、scroll-behavior 變更:[Upgrading: Version 16 | Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16)
- next-themes + Tailwind v4 dark variant:[Tailwind v4 - shadcn/ui](https://ui.shadcn.com/docs/tailwind-v4)
- 虛擬滾動:[TanStack Virtual](https://tanstack.com/virtual/latest)
- 進度/debounce 範式:全域 `~/.claude/rules/typescript/patterns.md`(`useDebounce`)

---

**上一份 ← [02-fetch-and-api-layer.md](./02-fetch-and-api-layer.md)**

---

## 附:三份文件執行順序總結

| 文件 | 內容 | 完成後狀態 |
|------|------|-----------|
| **01** | git + scaffold(Next 16/Tailwind4/shadcn)+ Drizzle/Turso + 四張表 migrate | `npm run dev` 起得來、`db:studio` 看到空表 |
| **02** | SourceAdapter 收斂 + API 層 + DB 快取 + fixture/service 測試 | `curl /api/search` 回乾淨 JSON、內文 DB-first |
| **03** | 頁面 + 閱讀器(日夜/字體/進度)+ E2E + DoD | 搜尋→讀章→記住位置,stage-0 驗收通過 |

> 每份各自有 DoD;**前一份全綠才動下一份**。三份做完 = stage-0 MVP 完成,接著進階段 1(同步)/階段 2(書源化)/階段 3(TTS,Capacitor 分水嶺,見 mvp-stage0-plan §8.5)。
