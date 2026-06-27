# 🐈 Koma

> 零廣告、乾淨、可自訂書源的中文小說閱讀器 —— 定位「iOS 上的 [Legado](https://github.com/gedoor/legado)」。

Koma 取自一隻黑貓的名字(日文 コマ 也是「漫畫的一格 / 翻頁」之意)。目標是把 Android 上 Legado 那種「無廣告、書源可插拔、純粹讀書」的體驗,帶到 iOS 與 Web。

## 特色

- **零廣告、零干擾** —— 介面只為讀書服務,深淺色主題切換。
- **可插拔書源** —— 透過 `SourceAdapter` 介面接書源;也支援「自帶書(BYO)」純本地閱讀。
- **離線優先** —— 預設走本地 SQLite 檔,零雲端設定即可開發;要跨裝置同步時再接 Turso。
- **閱讀進度 / 書櫃** —— 自動記錄章節進度,書櫃管理。
- **聽書(TTS,規劃中)** —— 階段 3 走 Capacitor + native audio plugin,支援 iOS 背景播放。

## 技術棧

| 範疇 | 選用 |
|---|---|
| 框架 | Next.js 16(Turbopack、async `params`/`searchParams`) + React 19 |
| 樣式 | Tailwind v4(CSS-first,無 config 檔) + shadcn/ui |
| 資料層 | Drizzle ORM + libSQL / Turso(本機 `file:` 可離線) |
| 抓取 | `fetch` + `cheerio`(無 headless) |
| 架構 | Server Actions + `lib/` 直呼;Route Handler 僅用於 auth 與 TTS(`/api/auth/*`、`/api/tts/*`) |
| 測試 | Vitest(in-memory libSQL harness) + Playwright(E2E) |

## 開始開發

```bash
npm install

# 開發(預設走本地 data/koma 的 SQLite，無需任何環境變數)
npm run dev

# 資料庫
npm run db:generate   # 由 schema 產生 migration
npm run db:migrate    # 套用 migration
npm run db:studio     # Drizzle Studio

# 測試
npm test              # Vitest（unit / parser）
npm run e2e           # Playwright（E2E）
```

跨裝置同步(階段 1)才需要雲端;複製 `.env.example` 為 `.env` 並填入 Turso 認證:

```bash
cp .env.example .env
# 填 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
```

## 專案結構

```
app/          Next.js App Router（page / search / book / read + actions.ts）
components/   UI 元件（reader-view 等）
lib/          領域邏輯（books / library / progress / search / chapter-split …）
src/sources/  書源 adapter（SourceAdapter 介面 + 各來源實作）
db/           Drizzle schema + migration
tests/        Vitest + Playwright
docs/         文件殿堂（Diátaxis + meta）；入口見 docs/README.md
```

## 狀態

個人 MVP 開發中(階段 0)。書源 adapter 目前僅供個人測試使用;**上架前會改為 BYO 書源 / 不託管任何版權內容**。本機快取的書籍內文存於 `data/`,已排除於版控之外。

## 授權

私人專案,暫未開放授權。
