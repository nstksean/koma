import "server-only";

import { clientIpFromRequest } from "@/lib/client-ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { resolveAuth } from "@/lib/auth";

/**
 * TTS 合成路徑的「每身分每分鐘」第二道閘(Medium-1),擋額度重置前的高頻突刺。
 * audio route 與 timestamps route 共用同一個 module 單例(import 同一支),
 * 故同一身分對兩條 route 的請求一起計數。
 *
 * ponytail: single-instance in-memory limiter, move to KV (e.g. Vercel KV/Upstash)
 *   if multi-instance(見 lib/rate-limit.ts 的天花板與升級路徑)。
 */

const WINDOW_MS = 60_000;
/** 每身分每分鐘最多觸發的 TTS 請求數(含 cache hit;遠高於正常閱讀節奏)。 */
const MAX_PER_MIN = 20;

const limiter = createRateLimiter({ windowMs: WINDOW_MS, max: MAX_PER_MIN });

/**
 * discriminated union:`ok: false` 時 `response` 必為 Response,讓 route 端
 * `if (!rate.ok) return rate.response` 能被 TS 正確 narrow。
 */
export type TtsRateLimitOutcome =
  | { readonly ok: true; readonly response: null }
  | { readonly ok: false; readonly response: Response };

/**
 * 對一個 TTS 請求做速率檢查。key = 可信 client IP + 身分 identity:
 * 同時綁「來源 IP」與「身分」,避免單一維度被繞過。
 */
export function checkTtsRate(req: Request): TtsRateLimitOutcome {
  const ip = clientIpFromRequest(req);
  const { identity } = resolveAuth(req);
  const result = limiter(`${ip}|${identity}`);
  if (result.ok) return { ok: true, response: null };
  return {
    ok: false,
    response: new Response("請求過於頻繁，請稍後再試", {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSec) },
    }),
  };
}
