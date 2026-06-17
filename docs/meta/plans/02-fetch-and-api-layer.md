# 02 — 抓取與 API 層（執行文件）

**日期**:2026-06-15
**對應 stage-0 計畫**:Task 3(SourceAdapter 介面 + TtkanAdapter)+ Task 5(API 層 Route Handlers + 快取)
**前置**:**[01-foundation-and-data-layer.md](./01-foundation-and-data-layer.md) 全綠**(Next 16 起得來、四張表已 migrate)
**狀態**:**✅ 已完成**(commit `276af08`)。Task 3 `SourceAdapter`+`TtkanAdapter`(`src/sources/`)+ Task 5 資料服務層+快取皆已落地。**與計畫偏差**:原計畫的「API Route Handlers(`/api/*`)」實作上改走 **Server Actions + `lib/` service 層**(`lib/books|library|progress|search`,單機 MVP 更精簡,**無 `app/api/`**);故下文 `curl /api/search` 等範例對應 server action / 直接呼叫 `lib/search`。

> 三份執行文件的第二份。02 的產出是「**一條穩定、被快取、可測試的資料管線**」:
> 上層(03 的頁面)只跟 `/api/*` 與 server actions 對話,完全不知道底下是 ttkan、cheerio,還是 DB 快取。
> 本文件結束時應達成:`curl localhost:3000/api/search?q=斗破蒼穹` 回得到乾淨 JSON,且第二次打同一本書的內文是讀 DB(不再打來源站)。

---

## 0. 這一層的設計主旨

stage-0 §2 的架構圖核心是 **`SourceAdapter` 抽象**:MVP 只有一個 `TtkanAdapter`,但介面先定好,階段 2 把它換成「書源規則 JSON 驅動」時,API 與頁面一行都不用改。02 要做的就是:

```
spike-ttkan.ts（一次性腳本）
        │  收斂
        ▼
src/sources/  ──  types.ts（介面）+ ttkan.ts（實作）+ index.ts（registry）
        │  被呼叫
        ▼
src/app/api/  ──  Route Handlers：search / book / chapters / content
        │  讀寫
        ▼
src/db/       ──  快取（books / chapters）+ 書架/進度（library / progress）
```

兩個關鍵原則(延續全域 coding-style):
1. **抓取一律 server-side**。Route Handler / Server Action 才能 import adapter 與 `db`;client 絕不直打來源站(避 CORS、藏來源、可控 UA / rate-limit)。
2. **回傳一律 immutable plain object**,API 統一用 `ApiResponse<T>` envelope(見 §4.1)。

---

## 1. SourceAdapter 介面（`src/sources/types.ts`）

把 spike 裡散落的型別收斂成單一檔。⚠️ 與 spike 的差異:`getChapterContent` 之外再加一個可選的 cleanup 設定,讓階段 2 的「規則驅動」有掛載點。

```ts
// 全部 readonly:回傳不可變(coding-style)
export interface SearchResult {
  readonly source: string;
  readonly sourceBookId: string; // slug
  readonly title: string;
  readonly author: string;
  readonly url: string;
}

export interface ChapterRef {
  readonly idx: number;
  readonly title: string;
  readonly url: string;
}

export interface BookDetail {
  readonly source: string;
  readonly sourceBookId: string;
  readonly title: string;
  readonly author: string;
  readonly category: string;
  readonly cover: string | null;
  readonly intro: string | null;
  readonly latestChapterTitle: string | null;
}

export interface SourceAdapter {
  readonly id: string;       // "ttkan"
  readonly name: string;     // "天天看小說"
  readonly baseUrl: string;

  search(keyword: string): Promise<readonly SearchResult[]>;
  getBook(sourceBookId: string): Promise<BookDetail>;
  getChapters(sourceBookId: string): Promise<readonly ChapterRef[]>;
  getChapterContent(chapterUrl: string): Promise<string>; // 純文字、已清洗
}
```

---

## 2. TtkanAdapter（`src/sources/ttkan.ts`）

直接從 [`scripts/spike-ttkan.ts`](../../../scripts/spike-ttkan.ts) 收斂(spike 刻意做成 adapter 形狀,搬移成本低)。收斂時要做的事:

1. 把 `fetchHtml`、`slugFromChaptersHref`、selector 邏輯原樣搬入。
2. 補 `getBook` 的 `latestChapterTitle`(spike 沒抓,schema 需要)——從目錄最後一章標題取。
3. **清洗規則抽成常數**(spike 寫死在 filter 裡),方便測試與階段 2 規則化:

```ts
// 待清洗的來源站雜訊(Task 1 §1 已記錄樣態)
const NOISE_PATTERNS: readonly RegExp[] = [
  /天天看小說|請記住本站|ttkan/i,     // 導流字樣
  /^=+$/,                              // ==== 分隔線
  /章節報錯|分享給朋友/,                // 內文尾端雜訊
];

const TITLE_PREFIX = /^正文[_:：\s]*/;  // 章節標題的「正文_」前綴
```

4. 內文清洗流程(逐段)維持 spike 的:`div.content` → 移除 `script/style/#div_content_end` → 逐行 trim → 過濾空行 → 過濾 `NOISE_PATTERNS` → `join("\n")`。
5. ⚠️ **rate-limit / 禮貌抓取**:`fetchHtml` 加上逾時(`AbortSignal.timeout(10_000)`)與固定 UA;連抓多章時(02 不批量,但 03 預載章節可能會)在 adapter 內留一個 `delay` hook。MVP 先做單篇,不過度設計。
6. **錯誤處理**:`fetchHtml` 非 2xx 直接 throw 帶 status 的 Error;selector 抓到 0 筆視為「來源站改版」也 throw(讓 fixture 測試與 API 層能區分「真的沒有」vs「壞了」)。

> 收斂後,`scripts/spike-ttkan.ts` 可保留為「手動探針」(改 import `src/sources/ttkan.ts`),或標註為已被取代。建議**保留並改成 import adapter**,當作來源站改版時的快速 smoke test。

---

## 3. Registry（`src/sources/index.ts`）

替階段 2 的多書源先留好查表入口。MVP 只註冊一個。

```ts
import type { SourceAdapter } from "./types";
import { ttkanAdapter } from "./ttkan";

const REGISTRY: Readonly<Record<string, SourceAdapter>> = Object.freeze({
  [ttkanAdapter.id]: ttkanAdapter,
});

export function getAdapter(source: string): SourceAdapter {
  const adapter = REGISTRY[source];
  if (!adapter) throw new Error(`未知書源:${source}`);
  return adapter;
}

export const DEFAULT_SOURCE = ttkanAdapter.id; // "ttkan"
```

> 路由用 `/[source]/...`(見 03),`source` 從 URL 帶進來 → `getAdapter(source)`。MVP 的 `search` 預設打 `DEFAULT_SOURCE`。

---

## 4. API 層（`src/app/api/`）

### 4.1 統一回應 envelope（`src/lib/api-response.ts`）

延續全域 patterns 的 `ApiResponse<T>`:

```ts
export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
}

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}
export function fail(error: string): ApiResponse<never> {
  return { success: false, data: null, error };
}
```

⚠️ Next 16 Route Handler 注意:
- `params` 是 **Promise**(`await context.params`),用 `RouteContext<'/api/...'>` 型別(可 `npx next typegen` 產生)。
- Route Handler 預設不快取(動態)。我們的快取**不靠 Next 的 fetch cache,而是靠 DB**(下節),理由:來源站內容要長期留存、來源掛了還能讀、且要做 TTL 控制。

### 4.2 端點清單

| 方法 | 路由 | 行為 | 快取策略 |
|------|------|------|---------|
| GET | `/api/search?q=&source=` | `adapter.search(q)` | 不快取(即時) |
| GET | `/api/book/[source]/[id]` | 書籍詳情 + 章節目錄 | DB upsert + `fetchedAt` TTL(預設 6h) |
| GET | `/api/chapter/[source]/[id]/[idx]` | 單章內文 | **DB-first**:有 `content` 直接回;無則抓→寫入→回 |
| POST | `/api/library` / DELETE | 加入/移除書架 | 寫 `library` |
| GET | `/api/library` | 書架列表(含續讀資訊) | 讀 `library` join `progress` |
| PUT | `/api/progress` | 更新閱讀進度 | upsert `progress` |

> 進度更新也可改用 **Server Action**(03 的閱讀器直接呼叫,免一層 fetch)。02 兩種都先把 service 函式寫好(見 §5),Route 與 Action 共用同一個 service,避免邏輯重複。

### 4.3 快取讀寫服務（`src/server/books-service.ts`）

把「adapter ↔ DB 快取」邏輯**集中在 service 層**,Route Handler 與 Server Action 都只是薄殼。這是 02 的重點檔。

```ts
// 形狀示意(非完整實作)
const BOOK_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// 1) 取書 + 目錄:DB 命中且未過期 → 回 DB;否則抓來源 → upsert → 回
export async function getBookWithChapters(source: string, sourceBookId: string) {
  const cached = await findBook(source, sourceBookId); // 查 books
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < BOOK_TTL_MS;
  if (fresh) return { book: cached, chapters: await findChapters(cached.id) };

  const adapter = getAdapter(source);
  const detail = await adapter.getBook(sourceBookId);
  const refs = await adapter.getChapters(sourceBookId);
  const book = await upsertBook(detail);          // onConflict (source, sourceBookId)
  await upsertChapterRefs(book.id, refs);          // 只寫 idx/title/url,不覆蓋已抓的 content
  return { book, chapters: await findChapters(book.id) };
}

// 2) 取內文:DB-first
export async function getChapterContent(source: string, sourceBookId: string, idx: number) {
  const row = await findChapter(source, sourceBookId, idx);
  if (row?.content) return row;                    // 快取命中,完全不打來源站
  const adapter = getAdapter(source);
  const content = await adapter.getChapterContent(row!.sourceUrl);
  return await saveChapterContent(row!.id, content); // 寫 content + fetchedAt
}
```

**設計註記**:
- `upsertChapterRefs` ⚠️ 必須**保留已抓的 `content`**(只更新目錄結構)。否則來源站更新最新章節時,會把舊章內文清空。用 `onConflictDoUpdate` 但 `content` 不在 update set 內。
- 內文一旦寫入 **永久快取**(不設 TTL):小說正文不會變,且這正是「來源掛了還能讀」的保命設計。
- ⚠️ **法律註記**(呼應 stage-0 §3、competitive-analysis 風險章節):server 端快取版權內容,個人 MVP 可以;**上架前**要改成 BYO 書源 / 不託管內容。在 service 層留 `// TODO(上架): BYO 模式` 標記。

### 4.4 Route Handler 範例（`src/app/api/chapter/[source]/[id]/[idx]/route.ts`）

```ts
import { NextResponse } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { getChapterContent } from "@/server/books-service";

export async function GET(
  _req: Request,
  context: { params: Promise<{ source: string; id: string; idx: string }> },
) {
  const { source, id, idx } = await context.params; // ⚠️ Next 16 async params
  try {
    const chapter = await getChapterContent(source, id, Number(idx));
    return NextResponse.json(ok(chapter));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知錯誤";
    // server 端記完整錯誤,回給 client 的訊息保持乾淨(security)
    return NextResponse.json(fail(msg), { status: 502 });
  }
}
```

---

## 5. 測試策略（TDD,符合 80% 門檻）

測試是 02 的一等公民,不是事後補。順序:**先寫測試(RED)→ 收斂 adapter / 寫 service(GREEN)**。

### 5.1 Adapter 解析測試(fixture-based,最關鍵)

這是整個專案最該 TDD 的接縫:來源站改版時,測試會立刻爆紅 = 回歸保護。

1. 用 spike 抓真實 HTML,存成 fixture:
   ```
   tests/fixtures/ttkan/search.html
   tests/fixtures/ttkan/chapters.html   # 書頁(含目錄)
   tests/fixtures/ttkan/content.html    # 單章內文
   ```
   ⚠️ fixture 要**去識別化/截斷**(只留解析需要的結構),避免整本版權內容進版控。
2. 測試讀 fixture(不發網路請求)→ 餵進 adapter 的解析函式 → 斷言:
   - `search`:命中數 > 0、第一筆 `title`/`slug` 正確、去重有效。
   - `getBook`:書名/作者/分類從 `<title>` 正則正確拆出。
   - `getChapters`:章數正確、`idx` 遞增去重、首尾章標題正確。
   - `getChapterContent`:**雜訊清洗**——斷言輸出**不含**「天天看小說 / 請記住本站 / 章節報錯」,且標題不含「正文_」前綴。

> ⚠️ 為了讓解析可單測,收斂 adapter 時把「fetch」與「parse」分開:`parseSearch(html)`、`parseBook(html)`、`parseChapters(html)`、`cleanContent(html)` 都是**純函式吃字串**,`fetchHtml` 只負責拿 HTML。測試只測純函式,不 mock 網路。

### 5.2 Service 層測試(mock adapter)

mock `getAdapter` 回傳假 adapter,測快取行為:
- 內文 DB 未命中 → 呼叫 adapter 一次 → 寫入 → 再查命中 → **不再呼叫 adapter**。
- 書籍 `fetchedAt` 未過期 → 不打 adapter;過期 → 重抓。
- `upsertChapterRefs` 不清空已存在的 `content`(重要回歸測試)。
- 用 `file::memory:` 的 libSQL in-memory DB 跑,測完即丟。

### 5.3 工具

- **Vitest**(TS 友善、快):`npm i -D vitest`,加 `"test": "vitest"`、`"test:cov": "vitest run --coverage"`。
- E2E(Playwright)留到 **03**。

---

## 6. 目錄結構（02 新增）

```
src/
├─ sources/
│  ├─ types.ts            # SourceAdapter 介面
│  ├─ ttkan.ts            # TtkanAdapter（parse 純函式 + fetch）
│  └─ index.ts            # registry + getAdapter / DEFAULT_SOURCE
├─ server/
│  └─ books-service.ts    # adapter ↔ DB 快取邏輯（Route + Action 共用）
├─ lib/
│  └─ api-response.ts     # ApiResponse envelope
└─ app/api/
   ├─ search/route.ts
   ├─ book/[source]/[id]/route.ts
   ├─ chapter/[source]/[id]/[idx]/route.ts
   ├─ library/route.ts
   └─ progress/route.ts
tests/
├─ fixtures/ttkan/*.html
├─ sources/ttkan.test.ts
└─ server/books-service.test.ts
```

---

## 7. DoD（02 完成定義）

- [ ] `SourceAdapter` 介面定義完成;`TtkanAdapter` 由 spike 收斂,`parse*` 為可單測純函式。
- [ ] `getAdapter`/registry 可用,`DEFAULT_SOURCE === "ttkan"`。
- [ ] adapter fixture 單元測試齊備(search/book/chapters/content),**含雜訊清洗斷言**,全綠。
- [ ] service 層快取測試齊備:內文 DB-first(命中不重抓)、書籍 TTL、`upsertChapterRefs` 不清空 content,全綠。
- [ ] 五個 Route Handler 可運作,回 `ApiResponse` envelope,`params` 用 async 寫法。
- [ ] 手動驗證:`curl "localhost:3000/api/search?q=斗破蒼穹"` 回乾淨 JSON;同一章內文打兩次,第二次讀 DB(可用 log 或 studio 確認 `content` 已寫入)。
- [ ] coverage ≥ 80%(adapter parse + service)。
- [ ] service 層留有 `// TODO(上架): BYO 書源` 法律標記。

---

## 8. 風險與雷區

| 雷 | 症狀 | 對策 |
|----|------|------|
| ⚠️ `upsertChapterRefs` 覆蓋 `content` | 已快取章節內文被清空,要重抓 | update set 不含 `content`;寫回歸測試守住 |
| ⚠️ Next 16 `params` 當同步用 | runtime 報錯 / 型別錯 | 一律 `await context.params` |
| ⚠️ adapter 把 fetch 與 parse 綁死 | 無法單測,只能打真網路(慢、脆) | 拆成純函式 `parse*(html)` + `fetchHtml` |
| ⚠️ 來源站改版 selector 失效 | 線上突然 0 命中 | 0 筆視為錯誤 throw;fixture 測試 + 保留 spike smoke test |
| ⚠️ fixture 放整本內容 | 版權內容進版控 | fixture 截斷/去識別化,只留結構 |
| ⚠️ client 直接 fetch 來源站 | CORS / 來源暴露 | 只在 Route Handler / Server Action 內抓 |

---

## 9. 來源

- Next.js 16 Route Handler 與 async `params`:[Upgrading: Version 16 | Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16)
- Drizzle upsert(`onConflictDoUpdate`)與 libSQL in-memory:[Drizzle with Turso](https://orm.drizzle.team/docs/tutorials/drizzle-with-turso)
- Task 1 已驗證的 ttkan 結構與雜訊樣態:[mvp-stage0-plan.md §1](./mvp-stage0-plan.md)、[`scripts/spike-ttkan.ts`](../../../scripts/spike-ttkan.ts)

---

**上一份 ← [01-foundation-and-data-layer.md](./01-foundation-and-data-layer.md)**
**下一份 → [03-pages-and-reader-ux.md](./03-pages-and-reader-ux.md)**(頁面 + 閱讀器體驗 + E2E + DoD 驗收)
