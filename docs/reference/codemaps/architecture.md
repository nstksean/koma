# Architecture

App Router 路由結構、middleware、Server Action vs Route Handler 的分工,以及讀 / 寫資料流。

## App Router Structure

```
app/
├── layout.tsx                  Root layout(ThemeProvider、字體、iOS 安全區)
├── page.tsx                    首頁:書架 + 繼續閱讀
├── globals.css                 Tailwind v4 + 主題 token
├── manifest.ts                 PWA manifest
├── actions.ts                  全站 Server Actions(書架 / 進度 / 章節 / 匯入)
├── loading.tsx
├── search/                     搜尋(page + loading)
├── import/page.tsx             自帶書(BYO)匯入
├── book/[source]/[id]/         書籍詳情(page / loading / retry-button)
├── read/[source]/[id]/[idx]/   閱讀器(page / loading)
├── login/                      Email/密碼登入(page / login-form / actions)
├── unlock/                     邀請碼兌換(page / unlock-form / logout / actions)
└── api/
    ├── auth/[...all]/route.ts          better-auth handler(GET/POST)
    └── tts/[bookSource]/[id]/[idx]/
        ├── route.ts                    GET → 合成 / 取快取音檔
        └── timestamps/route.ts         GET → 逐字 timing(TimestampsPayload)
```

## Middleware(`middleware.ts`)

- 確保每個瀏覽器有 `koma_guest` 匿名 cookie(`crypto.randomUUID()`);書架 / 進度以此分桶。
- 同時寫入「本次請求」cookie,讓首訪的 RSC/action 立即讀得到(否則首訪先落到 IP 桶)。
- matcher 跳過 `_next/static`、`_next/image`、`favicon.ico`,其餘(頁面 / API / action)全過。

## Server Action vs Route Handler(分工原則)

| 路徑 | 機制 | 為何 |
|---|---|---|
| 讀資料(列表 / 詳情 / 內文) | Server Component 直呼 `lib/` | 預設;RSC 內直接 await,無需 API 層 |
| 寫資料(加書架 / 存進度 / 匯入 / 兌碼) | Server Action(`"use server"`) | 表單 / 互動寫入,免手刻 endpoint |
| 登入(Email/密碼) | Route Handler `/api/auth/[...all]` | better-auth 提供的 handler,需固定 endpoint |
| TTS 音檔 / timestamp | Route Handler `/api/tts/...` | 需回傳二進位音檔 / streaming,且供 `<audio src>` 直連 |

> 設計原則:**能用 Server Action / 直呼就不開 API route**;只有「需要穩定 URL 或回傳非 RSC 內容」的情境才落 Route Handler。

### Server Actions 一覽

| Action | 檔案 | 作用 |
|---|---|---|
| `addToLibraryAction` / `removeFromLibraryAction` | `app/actions.ts` | 書架增刪 |
| `saveProgressAction` | `app/actions.ts` | 存閱讀進度(章節 + 捲動比例) |
| `listChaptersAction` | `app/actions.ts` | 取章節目錄(分頁載入用) |
| `importBookAction` | `app/actions.ts` | 自帶書匯入(`local` 來源) |
| `claimGuestData` | `app/login/actions.ts` | 登入後把 guest 桶併入帳號 |
| `redeemCodeAction` / `signOutAction` | `app/unlock/actions.ts` | 兌換邀請碼 / 登出 |

## Data Flow

```
讀(列表 / 內文)
  Server Component(page.tsx)
    → lib/books.ts getOrFetchBook / getChapterView
       → DB 有快取 → 直接回
       → 無 → src/sources adapter 抓站 → 寫回 chapters.content → 回
    → 渲染

寫(書架 / 進度)
  Client 互動 → Server Action(app/actions.ts)
    → lib/library.ts / lib/progress.ts(以 getServerDataOwner() 分桶)
    → Drizzle upsert → revalidate

聽書(TTS)
  <audio src=/api/tts/[bookSource]/[id]/[idx]>
    → route 檢查額度(lib/tts-quota)+ rate-limit(lib/tts-rate-limit)
    → lib/tts.ts 取快取或呼叫 src/tts provider(Azure)合成 → 落地音檔
  逐字高亮:fetch /api/tts/.../timestamps → audio-player 依 startMs 對齊高亮
```

## Capacitor / iOS

`capacitor.config.ts` 定義 iOS 殼;`@capgo/capacitor-native-audio` 供背景播放(階段 3)。Web 與 iOS 共用同一份 Next.js app,iOS 以原生 audio plugin 取代 web `<audio>` 達成鎖屏 / 背景續播。背景音訊取捨見 [../../meta/plans/evidence-ios-pwa-background-audio.md](../../meta/plans/evidence-ios-pwa-background-audio.md)。

另見:[INDEX.md](INDEX.md) 總導覽、[data-model.md](data-model.md) 資料模型、[domain-lib.md](domain-lib.md) 領域層。
