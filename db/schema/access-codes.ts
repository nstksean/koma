import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * access_codes：邀請碼。你用 `npm run code:gen` 產碼發給試用者(role=member),
 * 對方在 /unlock 貼碼換 session。只存碼的 sha256（codeHash）——DB 外洩也不直接
 * 暴露可用的明碼。admin 碼走環境變數 ADMIN_CODES,不入庫。
 */
export const accessCodes = sqliteTable("access_codes", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  role: text("role").notNull().default("member"), // 目前只用來發 member
  label: text("label").notNull().default(""), // 給誰 / 用途備註
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type AccessCode = typeof accessCodes.$inferSelect;
export type NewAccessCode = typeof accessCodes.$inferInsert;
