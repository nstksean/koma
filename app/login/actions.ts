"use server";

import { cookies } from "next/headers";

import { getServerAuth } from "@/lib/auth-server";
import { reassignOwner } from "@/lib/library";
import { GUEST_COOKIE } from "@/lib/guest";

/**
 * 登入/註冊成功後呼叫:把 koma_guest 這桶訪客的書架+進度接續到登入帳號。
 * 沒 guest cookie / 還沒真的登入(仍 guest)→ no-op。reassignOwner 自身冪等,
 * 失敗可在下次登入重試(故 login-form 端吞錯不擋登入)。
 */
export async function claimGuestData(): Promise<void> {
  const [auth, store] = await Promise.all([getServerAuth(), cookies()]);
  if (auth.role === "guest") return; // session 尚未成形 → 不搬
  const guestCookie = store.get(GUEST_COOKIE)?.value;
  if (!guestCookie) return;
  await reassignOwner(`guest:${guestCookie}`, auth.identity);
}
