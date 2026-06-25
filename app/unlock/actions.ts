"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  redeemCode,
  resolveSessionId,
  signSession,
  verifySession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { unlockThrottled } from "@/lib/unlock-rate-limit";

export interface UnlockState {
  error?: string;
}

/** 貼碼解鎖：驗碼 → 種簽章 cookie → 回首頁。useActionState 用。 */
export async function redeemCodeAction(
  _prev: UnlockState,
  form: FormData,
): Promise<UnlockState> {
  // 每 IP 每分鐘兌換嘗試上限,擋枚舉/暴力(Medium-1)。先擋再比對碼。
  if (await unlockThrottled()) {
    return { error: "嘗試過於頻繁，請稍後再試" };
  }

  const code = String(form.get("code") ?? "");
  const role = await redeemCode(code);
  if (!role) return { error: "邀請碼無效或已停用" };

  const store = await cookies();
  // 逐人額度:沿用既有同角色 session 的 id(重貼不重置額度),否則鑄新的 person id。
  const existing = verifySession(store.get(SESSION_COOKIE)?.value);
  const id = resolveSessionId(role, existing);

  store.set(SESSION_COOKIE, signSession({ role, id }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

/** 登出（清舊 HMAC session cookie）。導頁由呼叫端負責(見 LogoutButton 雙系統登出)。 */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
