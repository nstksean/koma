import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

function getDb(): Db {
  if (!_db) {
    const client = createClient({
      // 預設走本地 SQLite 檔；設了 TURSO_* 就連雲端（階段 1 跨裝置同步）。
      url:
        process.env.TURSO_DATABASE_URL ??
        `file:${path.join(process.cwd(), "data", "blackcat.db")}`,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Lazy proxy：避免在 import 期就建立連線（讓 build/測試不需要 DB 也能載入）。
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
