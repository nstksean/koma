import "server-only";

/**
 * 輕量固定視窗(fixed-window)rate limiter,額度之外的第二道閘:擋「單身分在額度
 * 重置前的高頻突刺刷量」與「/unlock 兌換暴力嘗試」(Medium-1)。
 *
 * ponytail: single-instance in-memory limiter, move to KV (e.g. Vercel KV/Upstash)
 *   if multi-instance。天花板:狀態在單一 Node process 的 Map 裡,多實例/重啟即歸零,
 *   且固定視窗在邊界允許短暫 2x 突發。對「成本型 DoS 的第二道閘」這量級夠用,且零依賴
 *   (不引入 redis/upstash)。升級路徑:換成共享 KV + sliding window 或 token bucket。
 */

export interface RateLimitResult {
  /** 是否放行。 */
  readonly ok: boolean;
  /** 被拒時建議的 Retry-After 秒數(到視窗結束),放行時為 0。 */
  readonly retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number; // epoch ms,視窗結束時刻
}

export interface RateLimiter {
  (key: string): RateLimitResult;
  /** 目前追蹤中的 key 數(測試/觀測用)。 */
  size(): number;
}

export interface RateLimitOptions {
  /** 視窗長度(毫秒)。 */
  readonly windowMs: number;
  /** 每視窗每 key 允許的次數上限。 */
  readonly max: number;
}

/**
 * 建一個 fixed-window limiter。每次呼叫傳入 key,回傳是否放行 + Retry-After。
 * 被動清理:每次呼叫順手刪掉已過期的 key,避免 Map 無上限長大。
 */
export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const { windowMs, max } = opts;
  const buckets = new Map<string, Bucket>();

  function sweep(now: number): void {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const limiter = ((key: string): RateLimitResult => {
    const now = Date.now();
    sweep(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfterSec: 0 };
    }

    if (bucket.count >= max) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }) as RateLimiter;

  limiter.size = () => buckets.size;
  return limiter;
}
