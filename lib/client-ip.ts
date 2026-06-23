import "server-only";

/**
 * 單一可信來源的 client IP 解析（server-only）。guest 額度以此 IP 派生 identity,
 * 故「IP 從哪取」直接決定額度能否被繞過。
 *
 * 安全前提：絕不信任 client 送的 `X-Forwarded-For` 第一段。XFF 是「由 client 起、
 * 每經一跳代理往右 append」的鏈，最左段完全由 client 自填、可任意偽造;真正可信的是
 * 「最後一跳代理寫進來」的那段,位於鏈的最右邊。因此由右往左、跳過設定數量的可信代理段
 * 後,取得 client IP。偽造左側段無法換到新 identity。
 *
 * ponytail: 採「trusted-proxy hop count」模型(env TRUSTED_PROXY_HOPS,預設 1
 *   = 你前面只有一層反代,如 nginx/Caddy)。這是自我託管(本專案非 Vercel,見
 *   README/next.config)最省的可信來源做法 —— 不需解析 CIDR、不需平台 SDK。
 *   天花板:多層代理或代理鏈長度不固定時會取錯段。升級路徑:若改用平台代理
 *   (Vercel/Cloudflare),改讀平台保證可信的單一 header(x-vercel-forwarded-for /
 *   cf-connecting-ip);若需精確,改成「設定 trusted proxy CIDR 清單,由右往左跳過
 *   屬於清單的段」。
 */

/** 預設信任 1 跳代理(最常見:單層 nginx/Caddy 反代)。 */
const DEFAULT_TRUSTED_HOPS = 1;

function trustedHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TRUSTED_HOPS;
}

/**
 * 從 header getter 解析可信 client IP。getter 同時相容 Web `Request.headers.get`
 * 與 Next `headers()` 的回傳(皆為 `(name) => string | null`)。
 *
 * 解析順序:
 *   1) X-Forwarded-For：切段、去空白、濾空,由右往左跳過 N 跳可信代理取 client。
 *      跳數超過實際段數時退回最左段(不丟錯)。
 *   2) 無 XFF → x-real-ip。
 *   3) 全無 → "unknown"(所有無來源者共用同一桶,不會各自開新額度)。
 */
export function clientIpFromHeaders(
  get: (name: string) => string | null | undefined,
): string {
  const xff = get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      // 由右往左跳過 trustedHops 段;index 夾在 [0, length-1]。
      const idx = Math.max(0, parts.length - 1 - trustedHops());
      return parts[idx];
    }
  }
  const realIp = get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return "unknown";
}

/** 從 Web `Request` 解析可信 client IP（route handler 用）。 */
export function clientIpFromRequest(req: Request): string {
  return clientIpFromHeaders((name) => req.headers.get(name));
}
