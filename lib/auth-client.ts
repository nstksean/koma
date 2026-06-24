import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * 前端 better-auth client(Email OTP)。供 client component 呼叫:
 *   authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
 *   authClient.signIn.emailOtp({ email, otp })
 *   authClient.signOut()
 * baseURL 留空 → 同源 /api/auth。
 */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});
