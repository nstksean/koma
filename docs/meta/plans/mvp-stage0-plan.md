# blackCat 階段 0 — MVP 實作計畫

**日期**：2026-06-15
**目標**：最小可用的「零廣告純文字小說閱讀器」，驗證抓取流程 + 核心閱讀體驗
**前置**：見 [competitive-analysis.md](../assessments/competitive-analysis.md)、[experiment-log.md](../assessments/experiment-log.md)
**技術棧**：Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui + Drizzle + Turso (libSQL)

> ✅ **查證註記（2026-06-15，經 `/verify-findings` 雙 agent 交叉驗證 + 親自跑 spike）**：本 stage-0 的 **Next.js-first 方向地基已驗證為穩固** —— `scripts/spike-ttkan.ts` 親自跑通（搜尋 90 命中 → 書頁 → 45 章 → 內文 27 段乾淨），ttkan 採用決策成立。另案（RN/Expo 原生 first）的兩個前提已被削弱並由本方向取代（RNTP V5 商用授權 €999~2,499/年；Capacitor+native plugin 可重用整個 web 不必重寫）。理由與併入的 3 點修正見文末「查證後的方向修正」。完整查證表存於 `~/.claude/plans/tts-pwa-adaptive-dolphin.md`。

---

## 0. 範圍界定（先講清楚不做什麼）

**階段 0 要做的（MVP）**
- 搜尋小說 → 書籍詳情（章節列表）→ 內文閱讀 → 加入書架
- 閱讀進度記憶（記住看到哪一章、哪個位置）
- 日夜模式 + 字體大小/行距
- 零廣告（天生達成）

**明確「不做」（往後階段）**
- ❌ TTS 聽書 / 背景播放 → 階段 3（PWA vs Capacitor 的分水嶺；**查證已定答案：Capacitor + native audio plugin**，見文末「查證後的方向修正」）
- ❌ 書源編輯器 / 多來源聚合 → 階段 2（先寫死一個 adapter）
- ❌ 帳號 / 雲端同步 → 階段 1（schema 先預留，MVP 單機）
- ❌ 離線下載 / Capacitor 打包 → 階段 3+
- ❌ 漫畫、EPUB/TXT 匯入

> 原則：MVP 只證明兩件事 —— **(1) 能穩定抓到一個來源的內容、(2) 閱讀體驗比黑貓乾淨**。其他全部延後。

---

## 1. 首發來源決策（Task 1 spike 已實測，2026-06-15）

| 來源 | 狀態 | 結論 |
|------|------|------|
| qu.la | ⚠️ 302 跳轉到寄生導流頁（網域已停放） | **棄用** |
| sto55.com | ❌ 503 | **棄用** |
| czbooks.net 小說狂人 | ⛔ **Cloudflare JS challenge（403 "Just a moment"）**，純 fetch 過不了 | **棄用**（除非上 headless） |
| 69shuba / uukanshu | ⛔ 同樣 Cloudflare 擋 | 棄用 |
| **tw.ttkan.co 天天看小說** | ✅ 200、UTF-8、SSR、無 Cloudflare、繁中、SPIKE 全鏈路通過 | **首發採用** |
| tw.hjwzw.com 黃金屋 / bq99.cc 筆趣閣 | ✅ 200 無擋，繁中 | 備援來源 |

**關鍵發現**：最「乾淨」的來源（czbooks）反而被 Cloudflare 擋；純 server-side fetch 能用的是 ttkan / hjwzw。架構因此確定走 **fetch + cheerio**，暫不需要 headless browser。

**ttkan 已驗證的結構**：
- 搜尋：`GET /novel/search?language=tw&q={kw}` → `a[href^="/novel/chapters/"]`
- 書頁：`GET /novel/chapters/{slug}` → `<title>《書名》最新章節，{作者} 作品 - {分類} - 天天看小說`；章節 `a[href^="/novel/pagea/"]`
- 內文：`GET /novel/pagea/{slug}_{n}.html` → `div.content`（結束於 `#div_content_end`）
- ⚠️ Task 3 待清洗的雜訊：章節標題 `正文_` 前綴、內文尾端 `章節報錯 分享給朋友：`。

> 實作見 [`scripts/spike-ttkan.ts`](../../../scripts/spike-ttkan.ts)（已做成 `SourceAdapter` 形狀，可直接收斂進 Task 3）。

---

## 2. 架構（替階段 2 的「書源化」預留接縫）

```
[ Pages (RSC) ]
   search / book / reader / library
        │
        ▼
[ API Route Handlers ]  ← 對外介面，含快取邏輯
        │
        ▼
[ SourceAdapter 介面 ]  ← 關鍵抽象：MVP 只有 TtkanAdapter
        │                  階段 2 變成「書源規則驅動」就是擴充這層
        ▼
[ fetch + cheerio 解析 ]
        │
        ▼
[ Turso (Drizzle) 快取 ]  books / chapters / library / progress
```

**設計重點**：即使 MVP 只接一個來源，也要先定義 `SourceAdapter` 介面。這樣階段 2 把「硬寫的 czbooks 邏輯」換成「書源規則 JSON 驅動的通用 adapter」時，上層 API 與頁面完全不用改 —— 這就是 Legado 的核心架構，提早鋪好。

### SourceAdapter 介面（草案）

```typescript
// 所有回傳皆為 immutable plain object（遵守 coding-style：不可變）
export interface SourceAdapter {
  readonly id: string;            // "ttkan"（MVP 首發；實作見 src/sources/）
  readonly name: string;          // "天天看小說"
  readonly baseUrl: string;

  search(keyword: string): Promise<SearchResult[]>;
  getBook(sourceBookId: string): Promise<BookDetail>;        // 含 intro/cover/author
  getChapters(sourceBookId: string): Promise<ChapterRef[]>;  // 章節目錄
  getChapterContent(chapterUrl: string): Promise<string>;    // 純文字內文
}
```

> 抓取一律 **server-side**（Route Handler / Server Action），絕不從 client 直接打來源站 —— 避免 CORS、隱藏來源、可加 rate-limit 與 User-Agent。

---

## 3. 資料模型（Drizzle schema 草案）

```typescript
// books：抓回來的書（跨來源用 source + sourceBookId 唯一）
books: { id, source, sourceBookId, title, author, cover, intro,
         category, latestChapterTitle, fetchedAt }
// 唯一鍵：(source, sourceBookId)

// chapters：章節 + 內文快取（首次讀取時填 content）
chapters: { id, bookId(FK), idx, title, sourceUrl,
            content(nullable), fetchedAt }
// 唯一鍵：(bookId, idx)

// library：書架（MVP 單機 userId 先固定 'local'）
library: { id, userId, bookId(FK), addedAt }

// progress：閱讀進度
progress: { id, userId, bookId(FK), chapterId(FK),
            scrollRatio, updatedAt }
```

**快取策略**：
- 章節內文首次讀取才抓，寫入 `chapters.content` → 之後直接讀 DB（快 + 對來源站友善 + 來源掛了還能讀）。
- 書籍詳情/目錄用 `fetchedAt` 做 TTL（如 6h），過期才重抓「最新章節」。
- ⚠️ 法律註記：server 端快取受版權內容，**個人 MVP 可以**；要上架/公開時須改成「使用者自帶書源、App 不託管內容」（見 competitive-analysis 風險章節）。

---

## 4. 路由 / 頁面

| 路由 | 內容 | 元件重點 |
|------|------|---------|
| `/` | 書架（library）+ 搜尋入口 | 續讀卡片、最近閱讀 |
| `/search?q=` | 搜尋結果列表 | server action 觸發 adapter.search |
| `/book/[source]/[id]` | 書籍詳情 + 章節目錄 | 加入書架、章節列表（虛擬滾動） |
| `/read/[source]/[id]/[idx]` | 閱讀器 | 內文、上下章、目錄抽屜、設定 |

---

## 5. 任務拆解（風險最高的先做）

- [x] **Task 1 — 抓取 SPIKE（gate，最關鍵）✅ 通過（2026-06-15）**
  - `scripts/spike-ttkan.ts`：fetch + cheerio 跑通搜尋（90 命中）→ 書頁（書名/作者/分類/簡介 OK）→ 目錄（45 章）→ 內文（27 段乾淨正文）。
  - 來源決策翻盤：czbooks 被 Cloudflare 擋 → 改用 **tw.ttkan.co**（見 §1）。
  - 編碼 UTF-8、無 Cloudflare、內文乾淨。待清洗雜訊已記錄於 §1。
- [x] **Task 2 — 專案 scaffold ✅**：Next.js **16.2.9**（採已 stable 的 latest，非追 bleeding edge）+ React 19 + Tailwind 4 + shadcn(new-york/neutral) + Drizzle 0.45 + @libsql/client。設定/慣例對齊 uptouryou，**DB 走本地 SQLite 檔（`data/blackcat.db`）+ Turso-ready**（`dialect: 'turso'` + 檔案 fallback），零雲端設定即可開發。
- [x] **Task 3 — SourceAdapter 介面 + TtkanAdapter ✅**（非 Czbooks —— 來源已於 §1 翻盤為 ttkan）。spike 收斂進 `src/sources/`，`parse*` 與 fetch 分離，配真實 HTML fixture 寫 **8 條單元測試**（vitest，全綠）。
- [x] **Task 4 — Drizzle schema + migration ✅**（books/chapters/library/progress，含 FK + unique index；`0000_*.sql` 已套用）。
- [x] **Task 5 — 資料服務層 ✅**：以 **Server Actions + service 層**（`lib/books|library|progress|search`）取代 Route Handlers（單機 MVP 更精簡）。快取已實測：書目 6h TTL、章節內文首讀才抓並寫 DB（2nd load 0.04s / 2nd read 0.011s）。
- [x] **Task 6 — 頁面 ✅**：`/`(書架+搜尋) → `/search` → `/book/[source]/[id]` → `/read/[source]/[id]/[idx]` 全串通，production build + 端對端 HTTP 實測通過。
- [x] **Task 7 — 閱讀器體驗 ✅**：next-themes 日夜模式、字級/行距設定（localStorage）、`scrollRatio` 進度記憶（捲動 debounce 存 + 還原）、上下章 + 鍵盤左右翻章。
- [x] **Task 8 — DoD 驗收 ✅**：Playwright **2 條 E2E** 全綠（搜尋→書頁→閱讀內文乾淨零廣告／設定+進度記憶）。

---

## 6. 測試策略（符合 TDD / 80% 門檻）

- **Adapter 解析是 TDD 的最佳接縫**：把 spike 抓到的 HTML 存成 fixture（實作落於 `tests/fixtures/ttkan/*.html`），對 fixture 寫 selector 解析的單元測試 → 先紅再綠。來源站改版時測試會立刻爆，等於回歸保護。
- **API 層**：mock adapter，測快取命中/未命中、TTL 過期重抓。
- **E2E（Playwright）**：搜尋「斗破蒼穹」→ 進書頁 → 開第一章 → 確認內文出現、無廣告、進度有記住。

---

## 7. 完成定義（Definition of Done）

- ✅ 在 ttkan（首發來源，czbooks 被 Cloudflare 擋故翻盤，見 §1）搜尋關鍵字，能列出書、進書頁看到完整章節目錄。
- ✅ 點章節能讀到**乾淨內文**（已清洗來源站的廣告/導流字樣），零廣告。
- ✅ 關掉再開，自動回到上次讀的章節與位置。
- ✅ 日夜模式 + 至少 3 段字體大小可切換。
- ✅ 加入書架、書架顯示續讀入口。
- ✅ adapter 解析有 fixture 單元測試，核心流程有 1 條 E2E。

---

## 8. 開放決策（要你拍板）

1. **MVP 要不要先做帳號？** 建議：**先不做，userId 固定 `'local'`**，schema 預留欄位。跨裝置同步（你的技術棧強項）留到階段 1 再開，避免 MVP 卡在 auth。
2. **首發來源只接 czbooks 一個夠嗎？** 建議：**夠**。MVP 的目的是驗證流程，不是內容量。多來源是階段 2 的事。
3. **內文清洗的尺度？** czbooks 內文常夾「請記住本站」「最新章節」等雜訊，需要在 adapter 層用規則清掉 —— spike 時一併確認雜訊樣態。

---

## 8.5 查證後的方向修正（2026-06-15，`/verify-findings`）

經雙 agent 交叉驗證（反證者 + 零知識複核者）+ 親自跑 spike，stage-0 的 Next.js-first 方向確立為主幹，併入以下 3 點修正。完整 8 條查證表存於 `~/.claude/plans/tts-pwa-adaptive-dolphin.md`。

**修正 1 — TTS 階段（階段 3）走 Capacitor + native audio plugin，不是純 PWA、也不是 RN+RNTP。**
- 純 PWA / Capacitor 純 web `<audio>` 在 iOS 背景**不可靠**：WKWebView 缺 `com.apple.runningboard…webkit` entitlement（第三方拿不到），純 web 暫停 30s 後即斷音（Apple Forums thread/781787、762582，已驗證至 iOS 18）。
- 可行解：Capacitor + 底層走 AVPlayer 的 native audio plugin（如 `@capgo/native-audio`），**重用整個 Next.js web 閱讀器、不必重寫**。⚠️ 鎖屏控制需確認所選 plugin 有接 `MPRemoteCommandCenter`（查證唯一缺證處）。
- RN + `react-native-track-player` 雖可行，但 **V5 商用授權 €999~2,499/年（已驗證）** + 要重寫 reader UI + 學 RN/New Architecture → 不選。

**修正 2 — 播放 / 逐字計時層做成抽象（`PlayerEngine` 介面），保留原生出口。**
- 逐句高亮：webview `currentTime` + `requestAnimationFrame` 足夠。
- 逐字高亮（中文 char-level，~100ms ≈ 一個字，屬精度邊界）若 webview 不夠準，只把這一塊換成 thin 原生模組，其餘 web 不動。**階段 3 先做精度 POC** 再定。

**修正 3 — 內容上架前加 BYO + 公版書庫（沿用既有 `SourceAdapter` 抽象）。**
- 抓取（ttkan）當**個人 / 開發 MVP**；要上架 App Store 須轉成「使用者自帶書源 + 公版」轉嫁版權風險（與 §3 法律註記、competitive-analysis 風險章節一致）。
- 定位修正：iOS 並非完全空白 —— 已有相容 Legado 書源的第三方 App（读不舍手、小幻阅读）。本產品楔子應是「**乾淨/精緻的 iOS 閱讀器 + 自家 TTS 卡拉OK**」，而非「iOS 沒有閱讀器」。

**TTS 引擎需求（給 IQT TTS 團隊，階段 3 前置阻斷項）**：自家 TTS 須能在合成時回傳**字級 timestamp**（中文 char-level，`{ text_offset(char index), start_ms, end_ms }`）。已驗證此為可行技術（Azure `WordBoundary` 對中文落在字級、ElevenLabs 提供 char-level），故對 IQT 是明確規格而非未知數。

> 🔬 **此 spike 建議「現在、與 stage-0 解耦」先做，不要等階段 3。** 外部引擎（Azure/ElevenLabs）已證字級 timestamp *技術*可行，但**自家 IQT TTS 是否真的吐得出對齊音檔的 char-level timestamp，仍是整個產品單一最高槓桿的未驗證未知數** —— 一支呼叫自家 API、印出回傳結構的 script 即可驗，成本極低；若驗不出，逐字卡拉OK這個核心賣點就不存在。與 stage-0 MVP **平行**進行、互不阻塞。（此點吸收自 [`evidence-ios-pwa-background-audio.md`](./evidence-ios-pwa-background-audio.md) 的建議。）

---

## 9. 來源

- [小說狂人 czbooks.net](https://czbooks.net/)
- [czbooks Legado 書源規則（yckceo id/55）](https://www.yckceo.com/yuedu/shuyuan/content/id/55.html)
- [開源閱讀 Legado（架構參考）](https://github.com/gedoor/legado)
