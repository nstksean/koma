"use server";

import { cookies } from "next/headers";

import { getServerAuth } from "@/lib/auth-server";
import { reassignOwner } from "@/lib/library";
import { GUEST_COOKIE } from "@/lib/guest";

/**
 * claimGuestData 結果(讓 client 判斷該不該重試 / 該不該彈成功 toast):
 *   - "claimed":真的把訪客資料搬進帳號了。
 *   - "no-guest-data":已登入但沒有訪客資料可搬(no-op,屬正常)。
 *   - "session-not-ready":server 端還讀不到 session(仍判為 guest)→ client 應重試。
 *   - "error":搬移過程出錯,夾帶訊息供 UI 顯示;reassignOwner 冪等,可重試。
 */
export type ClaimGuestResult =
  | { status: "claimed" }
  | { status: "no-guest-data" }
  | { status: "session-not-ready" }
  | { status: "error"; message: string };

/**
 * 登入/註冊成功後呼叫:把 koma_guest 這桶訪客的書架+進度接續到登入帳號。
 * 沒 guest cookie → no-op。仍判為 guest 代表 session cookie 尚未被 server 讀到,
 * 回 "session-not-ready" 讓 client 重試。reassignOwner 自身冪等,可安全重跑。
 */
export async function claimGuestData(): Promise<ClaimGuestResult> {
  const [auth, store] = await Promise.all([getServerAuth(), cookies()]);
  if (auth.role === "guest") return { status: "session-not-ready" };
  const guestCookie = store.get(GUEST_COOKIE)?.value;
  if (!guestCookie) return { status: "no-guest-data" };
  try {
    await reassignOwner(`guest:${guestCookie}`, auth.identity);
    return { status: "claimed" };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "接續訪客資料失敗" };
  }
}
