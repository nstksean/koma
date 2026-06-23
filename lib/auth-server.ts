import "server-only";

import { cookies, headers } from "next/headers";

import { guestAuth, verifySession, SESSION_COOKIE, type Auth } from "@/lib/auth";

/**
 * Server Component / server action 內取目前身分。
 * 與 resolveAuth(req) 同邏輯,差別只在 cookie/IP 來源走 next/headers
 * （只能在請求情境內呼叫）。抽到本檔是為了不讓 lib/auth.ts 沾 next/headers,
 * 保持那邊在 vitest 可直接 import。
 */
export async function getServerAuth(): Promise<Auth> {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (session) return { role: session.role, identity: `${session.role}:${session.id}` };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "unknown";
  return guestAuth(ip);
}
