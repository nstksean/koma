"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  redeemCode,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { ROLE_HINT_COOKIE } from "@/lib/role-hint";
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
  const session = await redeemCode(code);
  if (!session) return { error: "邀請碼無效或已停用" };

  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  // 非權威角色提示(非 httpOnly):前端據此決定要不要自動 prefetch。
  store.set(ROLE_HINT_COOKIE, session.role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

/** 登出：清掉 session + 角色提示 cookie。 */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ROLE_HINT_COOKIE);
  redirect("/unlock");
}
