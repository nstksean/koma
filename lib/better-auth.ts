import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";

import { db } from "@/db";
import { user, session, account, verification, rateLimit } from "@/db/schema";
import { sendOtpEmail } from "@/lib/email";

/**
 * better-auth 服務端實例 —— 只啟用 Email 6-digit OTP。
 *
 * 刻意「不」啟用任何社群登入(Google/Apple/...)→ 不觸發 Apple App Review Guideline 4.8。
 * 與舊「邀請碼 + HMAC koma_session cookie」系統並存:better-auth 管真實 email 身分,
 * 額度橋接(identity=`user:<userId>`、role 依 ADMIN_EMAILS)見 lib/auth-server.ts。
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

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: authBaseUrl(),
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification, rateLimit },
  }),
  // serverless/Fluid 多實例不共享記憶體 → 限流狀態存 DB(需 rateLimit 表)。
  rateLimit: { enabled: true, storage: "database" },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300, // 5 分鐘(NIST 800-63B-4:OTP 須短期過期)
      allowedAttempts: 3, // 限次,擋暴力猜碼
      // better-auth 預設明文存 OTP;改 hashed → DB 洩漏不等於洩漏可用碼。
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp }) {
        await sendOtpEmail(email, otp);
      },
    }),
  ],
});
