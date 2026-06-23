import "server-only";

import { headers } from "next/headers";

import { clientIpFromHeaders } from "@/lib/client-ip";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * /unlock 兌換的暴力嘗試節流(Medium-1)。key = 可信 client IP,每 IP 每分鐘限
 * MAX_ATTEMPTS_PER_MIN 次「嘗試」(不分成敗)。邀請碼本身有 144-bit 熵,線上猜碼
 * 已不可行;本閘是把 DB 壓力/枚舉嘗試的放大面收斂掉。
 *
 * ponytail: 用「每次嘗試都計數、上限放寬」取代「只罰失敗 + refund」,省掉 refund
 *   複雜度 —— 一般使用者一分鐘內貼碼遠不到上限,攻擊者枚舉才會撞牆。
 *   single-instance in-memory limiter, move to KV (e.g. Vercel KV/Upstash) if
 *   multi-instance(見 lib/rate-limit.ts)。
 */

const WINDOW_MS = 60_000;
/** 每 IP 每分鐘最多幾次兌換嘗試(寬到不影響正常人,窄到擋枚舉)。 */
const MAX_ATTEMPTS_PER_MIN = 5;

const limiter = createRateLimiter({ windowMs: WINDOW_MS, max: MAX_ATTEMPTS_PER_MIN });

/**
 * 記一次兌換嘗試並回報是否已超限。回 true 表示應拒絕(已被節流)。
 * 在 action 進入時呼叫(每次嘗試都計數)。
 */
export async function unlockThrottled(): Promise<boolean> {
  const h = await headers();
  const ip = clientIpFromHeaders((name) => h.get(name));
  return !limiter(`unlock:${ip}`).ok;
}
