import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * tts_usage：每個身分每日的「實際合成」計數。額度檢查即查這張表。
 * identity = 登入者的碼 id（member:<id> / admin:<hash>）或 guest:<hashed-ip>；
 * day = YYYY-MM-DD（UTC）。每日一列,跨日自動重置（查不到列 = 0）。
 */
export const ttsUsage = sqliteTable(
  "tts_usage",
  {
    identity: text("identity").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.identity, t.day] })],
);

export type TtsUsage = typeof ttsUsage.$inferSelect;
export type NewTtsUsage = typeof ttsUsage.$inferInsert;
