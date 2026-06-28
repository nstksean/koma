# UX 加強計畫 — Koma

> Generated on 2026-06-26(來源:5 個並行 sub-agent 對閱讀頁/聽書/書庫/登入/視覺無障礙的審查)
> Status: **規劃中**(待使用者確認後進入實作)

## Context
全 App UX 盤點,目標是補齊「iOS 優先 + 一隻陪你夜讀的貓」這兩個核心承諾目前沒落地的地方。問題集中在四塊:iOS 切版(safe-area)、聽書在 iOS 的鎖屏/背景、淺色主題無障礙對比、以及登入/書庫的動線與信任感。多個 agent 交叉指出的項目(safe-area、行距、觸控目標、章名排版)信心最高。

## 範圍決策
- 不在本計畫處理:新增主題、買網域開「忘記密碼」流程(刻意不買)、多書源切換 UI(規劃中)。
- 採分階段交付,每階段可獨立 commit / PR。**Phase 1 一行快修先上**,Phase 4(聽書原生整合)最大、單獨開。

---

## Phase 1 — iOS 切版 + 一行快修(P0,低風險高信心,先上)

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 1.1 | 補 `viewport` export,啟用 `viewport-fit=cover` | [app/layout.tsx](../../../app/layout.tsx) | `export const viewport = { viewportFit: "cover" }`(Next 16 Metadata API) |
| 1.2 | header 加頂部安全區 | [reader-view.tsx:254](../../../components/reader/reader-view.tsx#L254) | `pt-[env(safe-area-inset-top)]` |
| 1.3 | 聽書播放列加底部安全區 | [audio-player.tsx:611](../../../components/reader/audio-player.tsx#L611) | `pb-[calc(0.75rem+env(safe-area-inset-bottom))]` |
| 1.4 | 行距對齊 DESIGN(1.95 → 1.85) | [reader-view.tsx:60](../../../components/reader/reader-view.tsx#L60) + [globals.css:154](../../../app/globals.css#L154) | 兩處改 `1.85` |
| 1.5 | 修匯入 file input 真 bug | [import-form.tsx:50](../../../components/import-form.tsx#L50) | 加 `name="file"`;`onPickFile` catch 失敗時 `toast.error` 不再靜默 |
| 1.6 | Clean Paper 對比過 WCAG AA | [globals.css:114-119](../../../app/globals.css#L114) | `--brand`/`--muted-foreground` 調深至 ≥4.5:1,或文字處改用 `--ink` |
| 1.7 | 加入書架失敗補 toast | [library-button.tsx:22](../../../components/library-button.tsx#L22) | catch 內 `toast.error("加入失敗,再試一次")` |

**驗收**:iPhone 瀏海機 header/播放列不被切;Clean Paper 文字過 AA;匯入大檔走 server path 成功;書架操作失敗有提示。

---

## Phase 2 — 閱讀頁排版與沉浸感(reader core)

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 2.1 | 行寬隨字級(改 em) | [reader-view.tsx:370](../../../components/reader/reader-view.tsx#L370) | `max-w-2xl` → `max-w-[40em]`(綁字級),符合 DESIGN 19–21em |
| 2.2 | 點中央隱藏/顯示工具列(沉浸感) | [reader-view.tsx:368](../../../components/reader/reader-view.tsx#L368) | 中央區 tap toggle header 顯隱;捲動模式也要 |
| 2.3 | 章名排版落地品牌臉 | [reader-view.tsx:380](../../../components/reader/reader-view.tsx#L380) | 章名 Noto Sans TC 700 / 24–28px;加 Fraunces uppercase eyebrow(DESIGN §80-81) |
| 2.4 | 觸控目標 ≥44px | [button.tsx:21](../../../components/ui/button.tsx#L21)、search/chapter-list input | icon 鈕 `size-11`;input 統一 `h-11` |
| 2.5 | 還原捲動位置等字型 ready | [reader-view.tsx:181](../../../components/reader/reader-view.tsx#L181) | `document.fonts.ready` 後再 `scrollTo`,避免落錯點 |
| 2.6 | 鍵盤 ←/→ 換章擋連發 | [reader-view.tsx:235](../../../components/reader/reader-view.tsx#L235) | debounce / 鎖,避免按住跳多章 |

---

## Phase 3 — 書庫 / 導覽 / 資訊架構

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 3.1 | 加固定底部 tab bar(書庫/搜尋/我的) | 新增 component + [app/layout.tsx](../../../app/layout.tsx) | 常駐導覽,取代逐層返回 |
| 3.2 | 書籍詳情頁加 loading 骨架 | 新增 `app/book/[source]/[id]/loading.tsx` | 對齊 max-w-2xl + 書封/標題/章節列 |
| 3.3 | 詳情頁抓書失敗區分 error/not-found | [book/[source]/[id]/page.tsx:21](../../../app/book/[source]/[id]/page.tsx#L21) | 來源站掛掉給「重新整理」,而非一律 404 |
| 3.4 | 書架改封面網格 + 排序切換 | [app/page.tsx:101](../../../app/page.tsx#L101) + [lib/library.ts](../../../lib/library.ts) | DESIGN §98 `grid auto-fill minmax(150px,1fr)`;排序加書名/加入時間 |
| 3.5 | 空書架雙 CTA(搜尋 + 匯入) | [app/page.tsx:95](../../../app/page.tsx#L95) | 首次使用者也看得到「匯入自帶書」 |
| 3.6 | 搜尋結果補作者/分類、隱藏來源代號 | [search/page.tsx:60-84](../../../app/search/page.tsx#L60) | 結果列加副標;空狀態不曝露 `ttkan` |
| 3.7 | 章節列「跳到目前章」 | [chapter-list.tsx:46](../../../components/chapter-list.tsx#L46) | 切到 currentIdx 視窗並捲動到該列 |

---

## Phase 4 — 聽書 / TTS(P0,較大,單獨開)

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 4.1 | iOS 鎖屏/背景控制(核心缺口) | [audio-player.tsx:613](../../../components/reader/audio-player.tsx#L613) | 補 `navigator.mediaSession`(metadata + play/pause/seek handlers),或接 `@capgo/capacitor-native-audio` |
| 4.2 | 來電/被搶音訊中斷後恢復 | [audio-player.tsx:496](../../../components/reader/audio-player.tsx#L496) | 監聽原生 `pause`/`play` 同步 `status`,處理 interruption resume |
| 4.3 | 語音選擇器(後端已就緒) | [audio-player.tsx:120](../../../components/reader/audio-player.tsx#L120) | 露出 [parse-params.ts:23](../../../app/api/tts/[bookSource]/parse-params.ts#L23) 已 allowlist 的三音色 |
| 4.4 | ±15s 快轉/倒轉鈕 | [audio-player.tsx:650](../../../components/reader/audio-player.tsx#L650) | 補一組跳轉鈕(聽書最常用「往回退一句」) |
| 4.5 | 高亮 auto-scroll 改平滑跟隨 | [use-tts-highlight.ts:64](../../../components/reader/use-tts-highlight.ts#L64) | 越過下緣即小步推進,取代攢一批猛跳置中 |
| 4.6 | 首播長合成可取消 + 階段回饋 | [audio-player.tsx:780](../../../components/reader/audio-player.tsx#L780) | 提供 abort 入口(首播可達 45s) |
| 4.7 | 403(未解鎖)vs 429(額度用完)文案分流 | [audio-player.tsx:61](../../../components/reader/audio-player.tsx#L61) | 訪客是無權限非額度用完,文案分開 |

---

## Phase 5 — 登入 / 帳號信任 / 文案溫度

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 5.1 | 訪客資料接續確認 session 成形 | [login-form.tsx:32](../../../app/login/login-form.tsx#L32) + [actions.ts:16](../../../app/actions.ts#L16) | 登入後確認 session 再 `claimGuestData`;失敗保留 retry,不再 `catch {}` 全吞 |
| 5.2 | 接續成功給回饋 | 首頁 / toast | 「已把你的書架與進度帶進帳號」 |
| 5.3 | 錯誤訊息繁中化(溫暖調性) | [login-form.tsx:42](../../../app/login/login-form.tsx#L42) | 對應 error code 出繁中文案,不直丟英文 |
| 5.4 | 顯示密碼 toggle | [login-form.tsx:60](../../../app/login/login-form.tsx#L60) | 眼睛 icon 切 text/password |
| 5.5 | 忘記密碼逃生口 | [login-form.tsx](../../../app/login/login-form.tsx) | 一行 muted 連到 `/unlock`(目前無重設流程) |
| 5.6 | 返回鍵保留來源 context | [login/page.tsx:20](../../../app/login/page.tsx#L20)、[unlock/page.tsx:27](../../../app/unlock/page.tsx#L27) | `router.back()` 或 `?from=`,別寫死回首頁 |

---

## Phase 6 — 無障礙收尾

| # | 改什麼 | 檔案 | 修法 |
|---|---|---|---|
| 6.1 | chapter drawer focus trap | [chapter-drawer.tsx:74](../../../components/reader/chapter-drawer.tsx#L74) | 開啟移焦入內、關閉還焦、`aria-labelledby` 關聯標題 |
| 6.2 | 設定面板改用 Popover | [reader-view.tsx:303](../../../components/reader/reader-view.tsx#L303) | 統一用既有 [popover.tsx](../../../components/ui/popover.tsx),補 Esc / 點外關閉 / focus 管理 |
| 6.3 | 進度條補 ARIA | [reader-view.tsx:246](../../../components/reader/reader-view.tsx#L246) | `role="progressbar"` + `aria-valuenow`;移除 `text-muted-foreground/70` 的 alpha(破壞對比) |

---

## 建議執行順序
1. **Phase 1 先上**(一個 commit,全是低風險快修,馬上修好 iOS 切版 + 真 bug + 無障礙)
2. Phase 2 → 3 → 5 → 6(漸進)
3. **Phase 4 單獨開**(原生音訊整合最大、需真機測,可獨立排程)

> 完成後依 docs 慣例:檔頭標 ✅ + commit hash,`git mv` 到 `docs/meta/plans/`,更新索引。
