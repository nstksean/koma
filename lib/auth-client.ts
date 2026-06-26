import { createAuthClient } from "better-auth/react";

/**
 * 前端 better-auth client(Email + 密碼)。供 client component 呼叫:
 *   authClient.signUp.email({ email, password, name })
 *   authClient.signIn.email({ email, password })
 *   authClient.signOut()
 * baseURL 留空 → 同源 /api/auth。
 */
export const authClient = createAuthClient();
