# 01 — 專案地基與資料層（執行文件）

**日期**：2026-06-15
**對應 stage-0 計畫**：Task 2（專案 scaffold）+ Task 4（Drizzle schema + migration）
**前置**：Task 1 抓取 spike 已通過（見 [`scripts/spike-ttkan.ts`](../../../scripts/spike-ttkan.ts)、[mvp-stage0-plan.md](./mvp-stage0-plan.md)）
**狀態**：**✅ 已完成**（commit `276af08` initial commit）。Task 2 scaffold + Task 4 Drizzle schema/migration（`0000_*.sql`）皆已落地，四張表就緒。**與計畫偏差**：本文件原述「還不是 git repo」，現已 `git init` 並推上遠端（`origin = git@github.com:nstksean/koma.git`）。

> 這是三份執行文件的第一份：
> - **01（本文件）**：把空目錄變成「能跑、能連 DB、schema 已 migrate」的地基。
> - **02**：把 spike 收斂成 `SourceAdapter` + API 層（含 fixture 測試與快取）。
> - **03**：頁面、閱讀器體驗、E2E 與 DoD 驗收。
>
> 三份依序執行,01 是 02/03 的硬前置。本文件結束時應達成的狀態:`npm run dev` 起得來、`npm run db:studio` 能看到四張空表。

---

## 0. 為什麼先做地基（不要跳過）

目前 `blackCat/` 只有 `docs/`、`scripts/spike-ttkan.ts`、一個最小 `package.json`(只裝了 cheerio + tsx)。**還不是 git repo**、沒有 Next.js、沒有 DB。02/03 的所有程式碼都掛在這層地基上,所以 01 的 DoD 必須 100% 綠燈才能往下。

本文件刻意把「會被 2026 版本變動咬到的雷」標成 ⚠️,因為 stage-0 計畫寫的是 Next.js 16 / Tailwind 4,而這兩者在 2025Q4～2026 有破壞性變更(見 §7 查證附錄)。

---

## 1. 技術棧版本基準（2026-06-15 查證）

| 套件 | 版本基準 | 關鍵變動（影響 scaffold） |
|------|---------|--------------------------|
| Next.js | **16.2.x**（current stable, 2026-06） | Turbopack 預設、`params`/`searchParams` 全面 async、`next lint` 移除、middleware→`proxy` |
| React / react-dom | **19.2** | bundled 在 Next 16；React Compiler 1.0 stable（opt-in） |
| Node.js | **≥ 20.9.0**（LTS） | Next 16 最低要求,Node 18 不再支援 |
| TypeScript | **≥ 5.1** | Next 16 最低要求 |
| Tailwind CSS | **v4** | CSS-first,`@import "tailwindcss"`,無 `tailwind.config.js`,改用 `@theme`；PostCSS plugin 改名 `@tailwindcss/postcss` |
| shadcn/ui | latest CLI | `init` 已原生支援 Tailwind v4 + React 19 + App Router |
| Drizzle ORM | latest | `drizzle-orm` + `@libsql/client` |
| drizzle-kit | latest（devDep） | `dialect: 'turso'`；`generate` / `migrate` / `push` / `studio` |
| Turso (libSQL) | — | 雲端 SQLite；**本機開發可用 `file:` URL,完全離線** |

> ⚠️ 先 `node -v` 確認 ≥ 20.9。若用 nvm,在專案放一個 `.nvmrc`(內容 `20`)避免之後踩到。

---

## 2. 執行步驟

### Step A — 初始化 git（目前不是 repo）

```bash
cd /Users/sean/Documents/sean/blackCat
git init
```

`.gitignore` 在 scaffold 後由 create-next-app 產生,但要**手動補上**這幾條(DB 與 env 不可進版控):

```gitignore
# 本機 SQLite（開發用,不進版控）
*.db
*.db-journal
local.db*

# env
.env
.env.local

# Drizzle 產物中的本機快照（migrations 本身要進版控,meta 也要）
```

> ⚠️ `drizzle/`(migrations 輸出目錄)**要進版控** —— migration 是 schema 的真相來源。只有 `*.db` 本機資料檔不進。

### Step B — scaffold Next.js 16（⚠️ 不要覆蓋現有檔案）

現有目錄已有 `docs/`、`scripts/`、`package.json`。`create-next-app .`(就地)會因目錄非空而報錯或要求清空 —— **不可清空**。兩個安全做法,擇一:

**做法 1（推薦）— scaffold 到暫存再搬移**
```bash
# 在上層目錄產生暫存專案
npx create-next-app@latest blackcat-tmp \
  --ts --app --tailwind --eslint --src-dir --use-npm \
  --import-alias "@/*" --turbopack
# 把 Next 產物搬進 blackCat（保留既有 docs/ scripts/）
# 然後手動合併 package.json 的 dependencies（保留 cheerio）
```

**做法 2 — 就地 scaffold 並手動處理衝突**
先把 `package.json`、`scripts/`、`docs/` 暫移他處,`create-next-app .` 後再合併回來。

> 不論哪種,最後 `package.json` 必須**同時保留** `cheerio`(spike/adapter 需要)與 Next 全家桶。合併後跑一次 `npm install`。

create-next-app flags 說明:
- `--ts` TypeScript、`--app` App Router、`--tailwind` Tailwind v4、`--eslint` ESLint flat config、`--src-dir` 用 `src/`、`--import-alias "@/*"`、`--turbopack`(Next 16 已預設,明寫無妨)。

### Step C — ⚠️ 修掉 Next 16 的 scripts 與 config

create-next-app 可能仍寫出帶 `--turbopack` 的舊式 scripts。Next 16 已預設 Turbopack,精簡成:

```jsonc
// package.json → scripts（移除多餘的 --turbopack）
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",            // ⚠️ next lint 已移除,直接用 eslint CLI
    "spike": "tsx scripts/spike-ttkan.ts"
  }
}
```

`next.config.ts` 保持最小;若之後要顯示來源站封面圖,才加 `images.remotePatterns`(注意 Next 16 `images.domains` 已 deprecated):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MVP 暫不需要遠端圖片;階段需要封面時再開:
  // images: { remotePatterns: [{ protocol: "https", hostname: "tw.ttkan.co" }] },
};

export default nextConfig;
```

### Step D — shadcn/ui init（Tailwind v4）

```bash
npx shadcn@latest init
```
- 選 recommended defaults(會自動接好 Tailwind v4 `@theme`、App Router、`@/*` alias)。
- MVP 先裝閱讀器會用到的元件即可,之後再補:
```bash
npx shadcn@latest add button card input dialog drawer dropdown-menu sheet skeleton
```

> ⚠️ Tailwind v4 不再有 `tailwind.config.js`。設計 token 寫在 `src/app/globals.css` 的 `@theme {}` 裡。日夜模式由 03 的 `next-themes` 接管,這裡不用先設。

### Step E — 安裝資料層套件

```bash
npm i drizzle-orm @libsql/client dotenv
npm i -D drizzle-kit
```

---

## 3. 資料層設定（Drizzle + Turso，本機 `file:` 優先）

### 3.1 env（本機開發完全離線）

MVP 決策是「單機」,所以**本機直接用 SQLite 檔案,不必先開 Turso 雲端帳號**。`@libsql/client` 原生支援 `file:` URL。

```bash
# .env.local（不進版控）
TURSO_CONNECTION_URL=file:./local.db
TURSO_AUTH_TOKEN=
```

> 之後要上雲(階段 1 同步)時,只需把這兩個值換成 `turso db tokens create <db>` 拿到的雲端 URL/token,**程式碼不用改**。這是刻意保留的出口。

### 3.2 `drizzle.config.ts`（專案根目錄）

```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",                 // migrations 輸出（要進版控）
  dialect: "turso",                 // libSQL;file: 與雲端 URL 皆適用
  dbCredentials: {
    url: process.env.TURSO_CONNECTION_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,   // file: 時為空字串即可
  },
});
```

### 3.3 DB client `src/db/index.ts`

```ts
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// 注意:連線只能在 server 端建立(Route Handler / Server Action / RSC)
export const db = drizzle({
  connection: {
    url: process.env.TURSO_CONNECTION_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  schema,
});
```

> ⚠️ 絕不可在 Client Component import `db`。env 不要加 `NEXT_PUBLIC_` 前綴,確保 token 不外洩到 bundle(呼應 security 規則)。

---

## 4. Schema 定義（`src/db/schema.ts`）

對應 stage-0 §3 的四張表。全部用 `drizzle-orm/sqlite-core`,時間戳一律存毫秒整數(`mode: "timestamp_ms"`),唯一鍵用 `uniqueIndex` 表達。

```ts
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// books：抓回來的書（跨來源以 source + sourceBookId 唯一）
export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),               // "ttkan"
    sourceBookId: text("source_book_id").notNull(),  // slug
    title: text("title").notNull(),
    author: text("author"),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category"),
    latestChapterTitle: text("latest_chapter_title"),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    bookSourceUnique: uniqueIndex("books_source_book_unique").on(
      t.source,
      t.sourceBookId,
    ),
  }),
);

// chapters：章節 + 內文快取（首次讀取才填 content）
export const chapters = sqliteTable(
  "chapters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),          // 章節序號
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull(),
    content: text("content"),               // nullable:未抓取時為 null
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    chapterBookIdxUnique: uniqueIndex("chapters_book_idx_unique").on(
      t.bookId,
      t.idx,
    ),
  }),
);

// library：書架（MVP 單機,userId 固定 'local'）
export const library = sqliteTable(
  "library",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull().default("local"),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    libUserBookUnique: uniqueIndex("library_user_book_unique").on(
      t.userId,
      t.bookId,
    ),
  }),
);

// progress：閱讀進度（每本書一筆,看到哪章 + 章內捲動比例）
export const progress = sqliteTable(
  "progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull().default("local"),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    scrollRatio: integer("scroll_ratio").notNull().default(0), // 0–10000(萬分比,避免浮點)
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    progUserBookUnique: uniqueIndex("progress_user_book_unique").on(
      t.userId,
      t.bookId,
    ),
    progUserUpdatedIdx: index("progress_user_updated_idx").on(
      t.userId,
      t.updatedAt,
    ),
  }),
);
```

**設計註記**:
- `scrollRatio` 用「萬分比整數(0–10000)」而非浮點,避免 SQLite 浮點誤差,且足夠精細。03 的閱讀器存進度時換算。
- `progress` 對 `(userId, bookId)` 唯一 → upsert(`onConflictDoUpdate`)即可,不會長出多筆。
- `progress_user_updated_idx` 是給首頁「最近閱讀/續讀卡片」用的查詢索引。
- 時間戳預設值用 SQLite `unixepoch() * 1000`,與 Drizzle `timestamp_ms` 對齊。

---

## 5. Migration 流程

```bash
# 1) 由 schema 產生 migration SQL（輸出到 ./drizzle）
npx drizzle-kit generate

# 2) 套用到本機 file:./local.db
npx drizzle-kit migrate

# 3) 視覺化確認四張表存在
npx drizzle-kit studio
```

把這些收進 `package.json` scripts(讓 02/03 不用記指令):

```jsonc
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

> `db:push`(直接推 schema、不留 migration)只在快速試錯時用;**正式 schema 變更一律走 `generate` → `migrate`**,讓 `drizzle/` 留下可追溯的遷移歷史(呼應 git-workflow / database-migrations 規範)。

---

## 6. 目標目錄結構（01 結束時）

```
blackCat/
├─ .nvmrc                      # 20
├─ .gitignore                  # 補上 *.db / .env*
├─ .env.local                  # file:./local.db（不進版控）
├─ drizzle.config.ts
├─ next.config.ts
├─ package.json                # Next 全家桶 + cheerio + drizzle
├─ drizzle/                    # ← migrations（進版控）
│  └─ 0000_*.sql
├─ local.db                    # ← 本機 SQLite（不進版控）
├─ docs/                       # 既有文件 + 本三份執行文件
├─ scripts/spike-ttkan.ts      # 既有 spike（02 會收斂它）
└─ src/
   ├─ app/                     # App Router（03 填頁面）
   │  ├─ layout.tsx
   │  ├─ page.tsx
   │  └─ globals.css           # Tailwind v4 @import + @theme
   ├─ components/ui/           # shadcn 元件
   ├─ db/
   │  ├─ index.ts              # db client
   │  └─ schema.ts             # 四張表
   └─ lib/                     # utils（shadcn 的 cn 等）
```

> `src/sources/`(SourceAdapter)與 `src/app/api/`(Route Handlers)留給 **02** 建立,本文件不碰。

---

## 7. DoD（01 完成定義）

01 完成 = 以下全綠,才可進入 02:

- [ ] `node -v` ≥ 20.9;repo 已 `git init`,`.gitignore` 含 `*.db` 與 `.env*`。
- [ ] `npm run dev` 起得來,瀏覽器開 `http://localhost:3000` 看到 Next 預設頁,**無 console error**。
- [ ] `package.json` 同時含 `next`/`react@19`/`cheerio`/`drizzle-orm`/`@libsql/client`,devDep 含 `drizzle-kit`/`tsx`。
- [ ] scripts 已精簡(`dev`/`build`/`start` 無多餘 `--turbopack`;`lint` 走 `eslint .`)。
- [ ] shadcn 已 init,`src/components/ui/` 至少有 `button`。
- [ ] `npm run db:generate` 在 `drizzle/` 產出 `0000_*.sql`,內含 books/chapters/library/progress 四張表與唯一索引。
- [ ] `npm run db:migrate` 成功;`npm run db:studio` 看得到四張空表與索引。
- [ ] `npm run spike` 仍可跑(確認 cheerio 依賴在合併 package.json 後沒被弄掉)。

---

## 8. 風險與雷區（execution 時注意）

| 雷 | 症狀 | 對策 |
|----|------|------|
| ⚠️ create-next-app 覆蓋既有 `docs/`/`scripts/` | 檔案被刪 | 用 §2 Step B「暫存搬移」做法,不要就地清空 |
| ⚠️ scripts 殘留 `--turbopack` / `next lint` | Next 16 報 warning 或 `next lint` 直接失效 | §2 Step C 精簡 scripts |
| ⚠️ Tailwind v4 找不到 `tailwind.config.js` | 以為設定遺失 | v4 是 CSS-first,token 在 `globals.css` `@theme`,屬正常 |
| ⚠️ `db` 被 import 進 Client Component | build 失敗 / token 外洩風險 | `db/index.ts` 只在 server 端用;不加 `NEXT_PUBLIC_` |
| ⚠️ `local.db` 進了版控 | 把抓來的版權內容推上遠端 | `.gitignore` 先補 `*.db`,再 `git add` |
| ⚠️ Node < 20.9 | Next 16 安裝/啟動失敗 | 升級 Node;放 `.nvmrc` |

---

## 9. 查證附錄（2026-06-15）

- **Next.js 16**:Turbopack 預設(dev+build,免 `--turbopack`)、`params`/`searchParams` 全面 async(03 會用 `await props.params` + `PageProps<'/route'>`)、`cacheLife`/`cacheTag` 已 stable、`cacheComponents` 取代舊 PPR、`next lint` 移除改用 ESLint CLI、middleware→`proxy.ts`、Node ≥ 20.9 / TS ≥ 5.1。
  - 來源:[Upgrading: Version 16 | Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16)、[Next.js 16 blog](https://nextjs.org/blog/next-16)
- **shadcn/ui + Tailwind v4**:CLI `init` 已支援 v4 + React 19 + App Router;v4 CSS-first(`@import "tailwindcss"` + `@theme`)。
  - 來源:[Tailwind v4 - shadcn/ui](https://ui.shadcn.com/docs/tailwind-v4)、[Next.js - shadcn/ui](https://ui.shadcn.com/docs/installation/next)
- **Drizzle + Turso**:`drizzle-orm` + `@libsql/client`;`dialect: 'turso'`;本機可用 `file:` URL 離線開發;`generate`/`migrate`/`push`/`studio`。
  - 來源:[Drizzle with Turso](https://orm.drizzle.team/docs/tutorials/drizzle-with-turso)、[Drizzle + Turso - Turso docs](https://docs.turso.tech/sdk/ts/orm/drizzle)

---

**下一份 → [02-fetch-and-api-layer.md](./02-fetch-and-api-layer.md)**(SourceAdapter 收斂 + API 層 + 快取 + fixture 測試)
