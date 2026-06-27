# Koma Codemaps

> Last Updated: 2026-06-27
> Tech Stack: Next.js 16(App Router、Turbopack、async `params`)+ React 19 + Tailwind v4 + Drizzle/libSQL + better-auth

各子系統的元件 / 檔案 / 函式對照表的總導覽。**從這裡開始**,再依需要深入單張地圖。

## Overview

Koma 是一個零廣告、可自訂書源的中文小說閱讀器(iOS 優先 + Web)。建在 Next.js App Router 上:**Server Component 抓資料 + Server Action 寫資料 + `lib/` 領域邏輯直呼 DB**;僅 auth 與 TTS 兩條路徑用 Route Handler(因需 streaming / 第三方 handler)。資料層預設走本機 `file:` SQLite(零雲端即可開發),要跨裝置同步時換 Turso。

## Codemap Sections

| 文件 | 子系統 | 一句話 |
|---|---|---|
| [architecture.md](architecture.md) | 整體架構 | App Router 路由、middleware、Server Action vs Route Handler 分工、資料流。 |
| [data-model.md](data-model.md) | 資料模型 | Drizzle schema(books / chapters / library / progress / access-codes / tts-usage + better-auth 表)。 |
| [domain-lib.md](domain-lib.md) | 領域層 | `lib/`(books / library / progress / search / tts …)、書源 adapter(`src/sources/`)、TTS 音源層(`src/tts/`)。 |

## Architecture Diagram

```
┌───────────────────────────────────────────────────────────────┐
│  Client：Web 瀏覽器  /  Capacitor iOS 殼(@capacitor/core)     │
│  Components：reader-view、audio-player、chapter-drawer …       │
└───────────────────────┬───────────────────────────────────────┘
                        │  RSC payload / Server Action 呼叫
┌───────────────────────▼───────────────────────────────────────┐
│  Next.js 16 App Router                                         │
│  ├─ Server Components(page.tsx 抓資料)                       │
│  ├─ Server Actions(app/actions.ts 等,寫入)                 │
│  └─ Route Handlers:/api/auth/*(better-auth)               │
│                     /api/tts/*(合成音檔 + 逐字 timestamp)    │
└───────────────────────┬───────────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────────┐
│  lib/ 領域層(books / library / progress / search / tts / auth)│
└───────┬───────────────────────────────┬───────────────────────┘
        │                               │
┌───────▼─────────────┐   ┌─────────────▼──────────────┐
│ Drizzle ORM          │   │ src/sources/ 書源 adapter   │
│  → libSQL / Turso    │   │  cheerio 抓取 → 外站(ttkan)│
│  (data/koma 本機檔)  │   │ src/tts/ 音源(Azure Speech)│
└──────────────────────┘   └────────────────────────────┘
```

## Key Integration Points

### 雙軌身分系統(Auth)

兩套並存,詳見 [../../explanation/auth-dual-system.md](../../explanation/auth-dual-system.md):

1. **better-auth(Email + 密碼)** — `lib/better-auth.ts`,handler 掛在 `/api/auth/[...all]`,核心表見 `db/schema/auth.ts`。
2. **邀請碼 + 簽章 session cookie** — `lib/auth.ts`(`signSession` / `verifySession`、`koma_session`),`/unlock` 貼碼換 member 身分;admin 碼走環境變數 `ADMIN_CODES` 不入庫。
3. **Guest** — middleware 發 `koma_guest` 匿名 cookie;TTS 額度 fallback 用 hashed IP。

### 資料擁有權(Data Ownership)

書架 / 進度以 `dataOwner` key 分桶:登入者 `user:<id>`、訪客 `guest:<cookie>`。一律由 `getServerDataOwner()`(`lib/auth-server.ts`)解析,訪客登入後 `claimGuestData()` 把 guest 桶併入帳號(`reassignOwner`)。

### TTS 聽書管線(規劃 / 部分上線)

`/api/tts/[bookSource]/[id]/[idx]` 合成並落地音檔,`.../timestamps` 回逐字 timing。音源層(`src/tts/`)抽象在 `AudioSourceProvider`,換源(Azure→IQT→Eleven)只換實作檔。額度 / rate-limit 見 `lib/tts-quota.ts`、`lib/tts-rate-limit.ts`。完整設計見 [../../meta/plans/04-stage3-tts-pipeline.md](../../meta/plans/04-stage3-tts-pipeline.md)。

## Environment Variables

| 變數 | 端 | 用途 | 必要 |
|---|---|---|---|
| TURSO_DATABASE_URL | Server | libSQL/Turso 連線;省略時走本機 `file:data/koma` | 同步時 |
| TURSO_AUTH_TOKEN | Server | Turso 認證 | 同步時 |
| BETTER_AUTH_SECRET | Server | better-auth session 簽章 | ✓ |
| KOMA_SESSION_SECRET | Server | 邀請碼 session cookie 簽章(`lib/auth.ts`) | ✓ |
| ADMIN_CODES | Server | admin 邀請碼(逗號分隔,不入庫) | 選用 |
| AZURE_SPEECH_KEY / AZURE_SPEECH_REGION | Server | Azure TTS 合成 | TTS 時 |

> 以 `.env.example` 為準;本機開發無 Turso 認證即可跑(走 `file:`)。

## Dependencies(核心)

| 套件 | 用途 |
|---|---|
| `next` 16 / `react` 19 | App Router、Server Components/Actions |
| `drizzle-orm` + `@libsql/client` | ORM + libSQL/Turso driver |
| `better-auth` | Email/密碼登入(`/api/auth/*`) |
| `cheerio` | 書源 HTML 抓取解析(無 headless) |
| `radix-ui` / `class-variance-authority` / `tailwind-merge` / `lucide-react` | shadcn 風格 UI 元件 |
| `next-themes` / `sonner` | 主題切換 / toast |
| `zod` | 輸入驗證(系統邊界) |
| `nanoid` | ID 產生(`lib/ids.ts`) |
| `@capacitor/core` + `@capgo/capacitor-native-audio` | iOS 殼 + 背景音訊(階段 3) |
| `microsoft-cognitiveservices-speech-sdk`(dev) | Azure TTS spike / 合成 |

完整清單見根目錄 [package.json](../../../package.json)。

## Related Documentation

- [../../../CLAUDE.md](../../../CLAUDE.md) — 專案慣例與設計錨點
- [../../../README.md](../../../README.md) — 快速開始與技術棧
- [../../design/DESIGN.md](../../design/DESIGN.md) — 設計系統(主題 / 字體 / 色彩)
- [../../explanation/auth-dual-system.md](../../explanation/auth-dual-system.md) — 雙軌身分系統設計動機
- [../../meta/plans/](../../meta/plans/) — 分階段實作計畫(階段 0→3)
