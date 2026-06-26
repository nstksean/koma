import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db";
import { user, session, account, verification, rateLimit } from "@/db/schema";

/**
 * better-auth 服務端實例 —— 只啟用 Email + 密碼。
 *
 * 刻意「不」啟用任何社群登入(Google/Apple/...)→ 不觸發 Apple App Review Guideline 4.8。
 * email 即帳號;密碼由 better-auth 以 scrypt hash 存在 account.password。
 * 與舊「邀請碼 + HMAC koma_session cookie」系統並存:better-auth 管真實 email 身分,
 * 額度橋接(identity=`user:<userId>`、role 依 ADMIN_EMAILS)見 lib/auth-server.ts。
 *
 * ponytail: 暫不買網域 → 不寄信,連帶「忘記密碼」email 重設先不做。
 *           有網域後在 emailAndPassword 加 sendResetPassword(Resend fetch,~15 行)即可。
 *
 * 不 import "server-only":本檔會被 route handler 以外的非 Next 情境(測試)載入。
 */

/** better-auth 簽章金鑰:上線必設(≥32);dev/test 退回不安全預設(僅本機)。 */
function authSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET 未設定或過短（上線必填,≥32 字元）");
  }
  return "dev-insecure-better-auth-secret-change-me"; // ponytail: 僅 dev/test
}

/** 站台對外 URL:上線必設(cookie/trusted-origin 推導靠它);dev 留空由請求自動推導。 */
function authBaseUrl(): string | undefined {
  const u = process.env.BETTER_AUTH_URL;
  if (u) return u;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_URL 未設定（上線必填）");
  }
  return undefined;
}

/**
 * CSRF origin 白名單。better-auth 預設只信任 baseURL 一個 origin,但 Vercel 每次部署
 * 的唯一網址(VERCEL_URL)與正式網址(…PRODUCTION_URL)都不同 → 不補進去就回
 * INVALID_ORIGIN。Vercel 注入的值不含協定,補 https://。
 * ponytail: 只信任本專案自己的 Vercel 網域,不用 `*.vercel.app` 萬用字元。
 */
function trustedOrigins(): string[] {
  const origins = new Set<string>();
  if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]) {
    if (host) origins.add(`https://${host}`);
  }
  return [...origins];
}

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: authBaseUrl(),
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification, rateLimit },
  }),
  // serverless/Fluid 多實例不共享記憶體 → 限流狀態存 DB(需 rateLimit 表)。
  rateLimit: { enabled: true, storage: "database" },
  emailAndPassword: {
    enabled: true,
    // 不寄信 → 不要求 email 驗證(否則註冊後因無法驗證而卡住)。
    requireEmailVerification: false,
    minPasswordLength: 8, // NIST 800-63B:至少 8 碼
  },
});
