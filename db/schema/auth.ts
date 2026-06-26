import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * better-auth 核心 schema（v1.6.20）。欄位由 `getAuthTables()` 對齊產出,欄位名須與
 * better-auth field 名完全一致(camelCase);日期用 integer timestamp(秒)、boolean 用 integer。
 *
 * - email+密碼:密碼 scrypt hash 存在 account.password(providerId="credential")。
 *   verification 表目前閒置(留作日後 email 驗證/密碼重設用);移除需配套 migration,故保留。
 * - rateLimit 表因 rateLimit.storage="database" 而需要(serverless 多實例共享限流狀態)。
 *
 * 與舊「邀請碼 + HMAC cookie」系統並存;額度仍走 tts_usage(identity 字串),
 * 登入者的 identity = `user:<userId>`,見 lib/auth-server.ts 的橋接。
 */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const rateLimit = sqliteTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").unique(),
  count: integer("count").notNull(),
  lastRequest: integer("lastRequest").notNull(),
});

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
