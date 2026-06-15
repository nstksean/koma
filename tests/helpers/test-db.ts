import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATION = path.join(
  process.cwd(),
  "db/migrations/0000_elite_sir_ram.sql",
);

/**
 * 建一個全新的記憶體 libsql 資料庫並套用 migration。
 * 每個測試呼叫一次，確保完全隔離（互不污染）。
 * migration 內的 `--> statement-breakpoint` 是 `--` 開頭的 SQL 註解，
 * 可整份交給 executeMultiple。
 */
export async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(readFileSync(MIGRATION, "utf8"));
  return drizzle(client, { schema });
}

// ---- 給 vi.mock("@/db") 用的可替換 db ----
// vi.mock 工廠會 import 本檔並回傳 activeDbProxy 當成 `db`。
// 每個測試在 beforeEach 以 setActiveDb(await createTestDb()) 換上新庫。
let active: TestDb | null = null;

export function setActiveDb(db: TestDb): void {
  active = db;
}

/** 代理到當前測試庫；所有 lib 透過 `@/db` 取得的 `db` 都會打到這裡。 */
export const activeDbProxy = new Proxy({} as TestDb, {
  get(_target, prop, receiver) {
    if (!active) {
      throw new Error(
        "測試資料庫尚未初始化：請在 beforeEach 呼叫 setActiveDb(await createTestDb())。",
      );
    }
    const value = Reflect.get(active as object, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(active)
      : value;
  },
});
