/**
 * 非權威的角色提示 cookie（非 httpOnly），只給前端決定「要不要自動 prefetch」。
 * 真正的額度仍由 server 在每個 TTS 請求強制(見 lib/tts-quota.ts);這支被竄改頂多
 * 讓人對自己多送幾次合成、更快燒掉自己的額度,無安全影響。
 *
 * 規則:只有「無限額度」(admin)才自動預合成;member/guest(有限額度)按播放才合成,
 * 避免「光是翻開章節」就被 prefetch 扣掉額度。
 */
export const ROLE_HINT_COOKIE = "koma_role";

/** 讀目前角色提示(client 端;SSR 無 document 時回 null）。 */
export function clientRoleHint(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)koma_role=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * 是否該自動 prefetch。
 * dev/test 不看權限（維持原本開章即 prefetch);production 只有無限額度(admin)才 prefetch。
 */
export function canAutoPrefetch(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return clientRoleHint() === "admin";
}
