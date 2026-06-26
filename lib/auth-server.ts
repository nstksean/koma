import "server-only";

import { cookies, headers } from "next/headers";

import { auth as betterAuth } from "@/lib/better-auth";
import { guestAuth, dataOwner, verifySession, userAuth, SESSION_COOKIE, type Auth } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { GUEST_COOKIE } from "@/lib/guest";

/**
 * Server Component / server action 內取目前身分。解析優先序(雙系統並存):
 *   1. better-auth session(真實、已驗證 email)→ `user:<userId>`、role 依 ADMIN_EMAILS。
 *   2. 舊 HMAC koma_session(邀請碼/iqt 自助登入)→ 既有 `admin|member:<id>`。過渡用,最終移除。
 *   3. 否則 guest(hashed IP)。
 *
 * 額度系統(tts_usage)不變,只吃 Auth.identity 字串;新舊命名空間共存,零遷移。
 * 與 resolveAuth(req) 同精神,差別在 cookie/header 來源走 next/headers(只能在請求情境內呼叫)。
 */
export async function getServerAuth(): Promise<Auth> {
  const h = await headers();

  // 1. better-auth session 優先(read-only:不在 RSC 寫 cookie)。
  const session = await betterAuth.api.getSession({ headers: h });
  if (session?.user) {
    return userAuth(session.user.id, session.user.email);
  }

  // 2. 舊 HMAC cookie。
  const cookieStore = await cookies();
  const legacy = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (legacy) return { role: legacy.role, identity: `${legacy.role}:${legacy.id}` };

  // 3. guest:同一條可信來源邏輯集中在 client-ip helper(別在這信任 XFF 第一段)。
  return guestAuth(clientIpFromHeaders((name) => h.get(name)));
}

export interface ServerUser {
  readonly email: string;
  readonly name: string;
  readonly createdAt: Date;
}

/**
 * 目前 better-auth 登入者的帳號資料(email / 顯示名 / 註冊時間),沒登入(訪客或舊邀請碼)回 null。
 * 給 /unlock 個人頁顯示用。ponytail: 與 getServerAuth 各自呼叫一次 getSession;unlock 是低流量頁,
 *           不值得為省一次查詢把 user 塞進 Auth 型別污染全站。
 */
export async function getServerUser(): Promise<ServerUser | null> {
  const session = await betterAuth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    email: session.user.email,
    name: session.user.name,
    createdAt: session.user.createdAt,
  };
}

/**
 * 書架/進度的擁有者 key(RSC / server action 用)。guest 走每瀏覽器一個的 koma_guest
 * cookie(middleware 寫入)→ 各自一桶,而非與額度共用的 hashed IP。詳見 lib/auth.ts 的 dataOwner。
 */
export async function getServerDataOwner(): Promise<string> {
  const [auth, cookieStore] = await Promise.all([getServerAuth(), cookies()]);
  return dataOwner(auth, cookieStore.get(GUEST_COOKIE)?.value);
}
