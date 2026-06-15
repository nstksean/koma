/**
 * 預載指定書目到本地 DB 並加入書架。
 * 透過打 app 的 /book 頁面觸發 getOrFetchBook（沿用快取 + 書名覆寫邏輯），
 * 再直接寫 library 表。
 *
 *   需先啟動 server：  PORT=3007 npm start
 *   然後：             BASE_URL=http://localhost:3007 npm run preload
 */
import { createClient } from "@libsql/client";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3007";

const BOOKS: ReadonlyArray<{ source: string; slug: string }> = [
  { source: "ttkan", slug: "jingsongleyuan-santianliangjue" }, // 驚悚樂園
  { source: "ttkan", slug: "doudiyuyouxile_sheihaidangrena-youjiul" }, // 都地獄遊戲了，誰還當人啊
];

async function main() {
  // 1) 觸發抓取 + 快取（走 app 的 getOrFetchBook）。
  for (const b of BOOKS) {
    const url = `${BASE}/book/${b.source}/${encodeURIComponent(b.slug)}`;
    const res = await fetch(url);
    console.log(`抓取 ${url} → ${res.status}`);
    if (!res.ok) throw new Error(`預載失敗：${url}`);
  }

  // 2) 加入書架。
  const db = createClient({
    url: `file:${path.join(process.cwd(), "data", "blackcat.db")}`,
  });
  for (const b of BOOKS) {
    const r = await db.execute({
      sql: "SELECT id, title FROM books WHERE source = ? AND source_book_id = ?",
      args: [b.source, b.slug],
    });
    const row = r.rows[0];
    if (!row) {
      console.log(`⚠️ 找不到已快取的書：${b.slug}`);
      continue;
    }
    await db.execute({
      sql: "INSERT INTO library (id, user_id, book_id, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, book_id) DO NOTHING",
      args: [crypto.randomUUID(), "local", row.id as string, Date.now()],
    });
    console.log(`✅ 已加入書架：${row.title}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
