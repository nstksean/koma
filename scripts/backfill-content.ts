/**
 * 回填指定書的所有章節內文（content）到本地 DB。
 * 只抓 content 為 null 的章節 → 可重複執行（斷點續抓）。
 * 並發抓取 + 失敗重試 + 進度輸出，禮貌性 jitter 避免打爆來源站。
 *
 *   npx tsx scripts/backfill-content.ts <source> <sourceBookId> [concurrency]
 *   e.g. npx tsx scripts/backfill-content.ts ttkan fengwuyaodeshiyanrizhi-fennudesongshu
 */
import { createClient } from "@libsql/client";
import path from "node:path";
import { getAdapter } from "../src/sources/index";

const [, , source, sourceBookId, concurrencyArg] = process.argv;
const CONCURRENCY = Math.max(1, Number(concurrencyArg) || 5);
const MAX_RETRY = 3;

if (!source || !sourceBookId) {
  console.error(
    "用法：npx tsx scripts/backfill-content.ts <source> <sourceBookId> [concurrency]",
  );
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  url: string,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const content = await adapter.getChapterContent(url);
      if (!content.trim()) throw new Error("空內文");
      return content;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRY) await sleep(500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main() {
  const adapter = getAdapter(source);
  if (!adapter) throw new Error(`未知書源（無 adapter）：${source}`);

  const db = createClient({
    url: `file:${path.join(process.cwd(), "data", "blackcat.db")}`,
  });

  const bookRes = await db.execute({
    sql: "SELECT id, title FROM books WHERE source = ? AND source_book_id = ?",
    args: [source, sourceBookId],
  });
  const book = bookRes.rows[0];
  if (!book) throw new Error(`DB 找不到書：${source}/${sourceBookId}（先打書頁快取目錄）`);

  const pending = await db.execute({
    sql: "SELECT id, idx, source_url FROM chapters WHERE book_id = ? AND (content IS NULL OR length(content) = 0) ORDER BY idx",
    args: [book.id as string],
  });

  const total = pending.rows.length;
  console.log(`📖 ${book.title}：待抓 ${total} 章（並發 ${CONCURRENCY}）`);
  if (total === 0) {
    console.log("✅ 已全數快取，無事可做。");
    process.exit(0);
  }

  let done = 0;
  const failed: number[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < total) {
      const row = pending.rows[cursor++];
      const idx = row.idx as number;
      const url = row.source_url as string;
      try {
        const content = await fetchWithRetry(adapter!, url);
        await db.execute({
          sql: "UPDATE chapters SET content = ?, fetched_at = ? WHERE id = ?",
          args: [content, Date.now(), row.id as string],
        });
      } catch (e) {
        failed.push(idx);
        console.warn(`⚠️ 第 ${idx} 章失敗：${e instanceof Error ? e.message : e}`);
      }
      done++;
      if (done % 25 === 0 || done === total) {
        console.log(`  …${done}/${total}（失敗 ${failed.length}）`);
      }
      await sleep(80 + Math.floor(Math.random() * 120)); // 禮貌性 jitter
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (failed.length) {
    console.log(
      `\n⚠️ 完成，但 ${failed.length} 章失敗（idx：${failed.slice(0, 30).join(", ")}${failed.length > 30 ? " …" : ""}）。重跑本指令會自動續抓。`,
    );
    process.exit(2);
  }
  console.log(`\n✅ 全部 ${total} 章內文已回填完成。`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
