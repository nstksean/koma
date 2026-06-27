# Data Model

Drizzle schema 對照表。SQLite(libSQL / Turso),schema 位於 `db/schema/*.ts`,migration 在 `db/migrations/`。

## 表一覽

| 表 | 檔案 | 用途 | 唯一鍵 |
|---|---|---|---|
| `books` | `db/schema/books.ts` | 抓回來的書 | `(source, source_book_id)` |
| `chapters` | `db/schema/chapters.ts` | 章節目錄 + 內文快取 | `(book_id, idx)` |
| `library` | `db/schema/library.ts` | 書架(每擁有者一桶) | `(user_id, book_id)` |
| `progress` | `db/schema/progress.ts` | 閱讀進度 | `(user_id, book_id)` |
| `access_codes` | `db/schema/access-codes.ts` | 邀請碼(只存 hash) | `code_hash` |
| `tts_usage` | `db/schema/tts-usage.ts` | 每身分每日合成計數 | `(identity, day)` PK |
| better-auth 表 | `db/schema/auth.ts` | `user` / `session` / `account` / `verification` / `rate_limit` | — |

## 關聯

```
books ──1:N──> chapters        (chapters.book_id → books.id, cascade)
books ──1:N──> library         (library.book_id → books.id, cascade)
books ──1:N──> progress        (progress.book_id → books.id, cascade)
chapters ──1:1──> progress      (progress.chapter_id → chapters.id, cascade)
```

`library` / `progress` 不外鍵連 user —— 以 `user_id` 字串(dataOwner key)分桶,跨 better-auth 帳號與 guest 通用。

## 欄位重點

### books
`id`(nanoid)、`source`(如 `ttkan` / `local`)、`source_book_id`(slug)、`title`、`author`、`cover`、`intro`、`category`、`latest_chapter_title`、`fetched_at`。跨來源以 `(source, source_book_id)` 唯一識別。

### chapters
`book_id`、`idx`(來源站頁碼)、`title`、`source_url`、`content`(**null = 尚未抓內文**,首次讀取才填,之後直接讀 DB)、`fetched_at`。

### library / progress
`user_id` 存 dataOwner key(登入者 `user:<id>`、guest `guest:<cookie>`)。欄位 `default "local"` 是早期單機殘留,runtime 一律由 `getServerDataOwner()` 帶真實 key,不會落到 default。`progress` 另有 `scroll_ratio`(0~1 章內位置)。

### access_codes
只存 `code_hash`(sha256)—— DB 外洩也不直接暴露明碼。`role` 目前只發 `member`;`label` 備註發給誰;`disabled` 可停用。admin 碼走環境變數不入庫。

### tts_usage
`identity`(`member:<id>` / `admin:<hash>` / `guest:<hashed-ip>`)、`day`(`YYYY-MM-DD` UTC)、`count`。每日一列,跨日查不到列即視為 0(自動重置)。額度檢查直接查這張表(`lib/tts-quota.ts`)。

## Migrations

`npm run db:generate`(由 schema 產 migration)→ `npm run db:migrate`(套用)。目前三份:`0000` / `0001` / `0002`,快照在 `db/migrations/meta/`。

另見:[domain-lib.md](domain-lib.md)(操作這些表的 `lib/` 函式)、[INDEX.md](INDEX.md) 總導覽。
