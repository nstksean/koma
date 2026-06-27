# Domain & Library

`lib/` 領域層、書源 adapter(`src/sources/`)、TTS 音源層(`src/tts/`)的函式對照表。這層是 koma 的「backend」—— Server Component / Action 都呼叫這裡。

## `lib/` 領域邏輯

### 書籍 / 閱讀
| 檔案 | 重點 export | 作用 |
|---|---|---|
| `books.ts` | `getOrFetchBook` / `getChapterView` / `listChapterRefs` | 取書與章節:DB 有快取直接回,無則經 adapter 抓站再寫回 |
| `chapter-split.ts` | `splitChapters` | 自帶書純文字切章 |
| `import.ts` | `importBook`(`LOCAL_SOURCE="local"`) | BYO 匯入成本地書 |
| `search.ts` | `searchBooks` | 經 adapter 搜書源 |
| `library.ts` | `addToLibrary` / `removeFromLibrary` / `listLibrary` / `getContinueReading` / `reassignOwner` | 書架 CRUD + 繼續閱讀 + 桶遷移 |
| `progress.ts` | `getProgress` / `saveProgress` | 閱讀進度讀寫 |
| `title-overrides.ts` | `resolveTitle` | 標題覆寫(髒資料修正) |

### 身分 / 安全
| 檔案 | 重點 export | 作用 |
|---|---|---|
| `auth.ts` | `signSession` / `verifySession` / `resolveAuth` / `dataOwner` / `canListen` / `hashCode` | 邀請碼 session 簽章與角色(`admin`/`member`/`guest`) |
| `auth-server.ts` | `getServerAuth` / `getServerUser` / `getServerDataOwner` | server 端取目前身分與資料擁有權 key |
| `auth-client.ts` | `authClient` | better-auth client |
| `better-auth.ts` | `auth` | better-auth 設定(Email/密碼) |
| `guest.ts` | `GUEST_COOKIE` | 匿名 cookie 名 |
| `client-ip.ts` | `clientIpFromHeaders` / `clientIpFromRequest` | 解析來源 IP(guest 後備) |
| `login-validation.ts` | `validateLoginInput` | 登入輸入驗證 |
| `rate-limit.ts` | `createRateLimiter` | 通用 rate limiter |
| `unlock-rate-limit.ts` | `unlockThrottled` | 兌碼節流(暴力破解防護) |

### TTS
| 檔案 | 重點 export | 作用 |
|---|---|---|
| `tts.ts` | `getChapterAudioMeta` / `ChapterAudioFile` | 章節音訊 orchestrator(取快取或觸發合成) |
| `tts-cache.ts` | `pruneCache` | 音檔快取清理 |
| `tts-quota.ts` | `tryConsumeQuota` / `refundQuota` / `getQuotaStatus` / `QuotaError` | 每日合成額度 |
| `tts-rate-limit.ts` | `checkTtsRate` | TTS 短時 rate-limit |
| `tts-failure.ts` | `describeFailure` | 合成失敗訊息對應 |
| `audio-prefs.ts` | `parseRateIdx` / `parsePosMs` | 播放偏好(語速 / 續播位置)解析 |

### 共用 / UI 輔助
`ids.ts`(`newId` nanoid)、`utils.ts`(`cn`)、`swipe.ts`(`resolveSwipe` 翻頁手勢)、`use-mounted.ts`(SSR hydration 防閃)。

## `src/sources/` 書源 adapter

`SourceAdapter` 介面(`types.ts`)是書源化的接縫,上層只依賴介面。

```ts
interface SourceAdapter {
  id; name; baseUrl;
  search(keyword): Promise<SearchResult[]>;
  getBook(sourceBookId): Promise<BookDetail>;
  getChapters(sourceBookId): Promise<ChapterRef[]>;
  getChapterContent(chapterUrl): Promise<string>;
}
```

- `index.ts` — `getAdapter(source)` 查表取 adapter;`DEFAULT_SOURCE = ttkan`。
- `ttkan.ts` — MVP 唯一實作(cheerio 解析,無 headless)。
- 回傳皆 immutable plain object(遵守不可變原則)。

> 上架前會改為 BYO 書源 / 不託管版權內容;adapter 目前僅供個人測試。

## `src/tts/` 音源層

兩層解耦:**音源層**(Azure / IQT / Eleven)輸出統一的 `ChapterAudio`,**播放管線層**只認這個形狀。換音源 = 只換實作 `AudioSourceProvider` 的那一檔。

| 檔案 | 作用 |
|---|---|
| `types.ts` | 契約:`AudioSourceProvider`、`ChapterAudio`、`CharTimestamp`、`TimestampsPayload`、`ChapterAudioMeta` |
| `azure-synthesize.ts` / `azure-normalize.ts` | Azure Speech 合成 + 文字正規化 |
| `chunk.ts` / `stitch.ts` / `wav.ts` | 分段合成 → 串接 → WAV 處理 |
| `sync.ts` | 逐字 timestamp 對齊(詞級 boundary → 字級 timing) |
| `urls.ts` | 音檔 / 路徑工具 |

`charIndex` 與標點處理的精確約定見 `src/tts/types.ts` 內註解;完整管線設計見 [../../meta/plans/04-stage3-tts-pipeline.md](../../meta/plans/04-stage3-tts-pipeline.md)。

另見:[data-model.md](data-model.md)(這些函式操作的表)、[architecture.md](architecture.md)(誰呼叫這層)、[INDEX.md](INDEX.md) 總導覽。
