import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRateLimiter } from "@/lib/rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter — 固定視窗", () => {
  it("視窗內到上限前允許,超過拒絕", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limit("k").ok).toBe(true);
    expect(limit("k").ok).toBe(true);
    expect(limit("k").ok).toBe(true);
    const blocked = limit("k");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("不同 key 各自獨立計數", () => {
    const limit = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limit("a").ok).toBe(true);
    expect(limit("b").ok).toBe(true); // b 不受 a 影響
    expect(limit("a").ok).toBe(false);
  });

  it("視窗過後重置", () => {
    const limit = createRateLimiter({ windowMs: 1_000, max: 1 });
    expect(limit("k").ok).toBe(true);
    expect(limit("k").ok).toBe(false);
    vi.setSystemTime(1_001); // 跨過視窗
    expect(limit("k").ok).toBe(true);
  });

  it("retryAfterSec 反映到視窗結束的剩餘秒數", () => {
    const limit = createRateLimiter({ windowMs: 10_000, max: 1 });
    limit("k");
    vi.setSystemTime(3_000);
    const r = limit("k");
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(7); // (10000-3000)/1000 取整
  });

  it("過期 key 會被清掉,不會無限長(記憶體上界)", () => {
    const limit = createRateLimiter({ windowMs: 1_000, max: 5 });
    limit("old");
    vi.setSystemTime(2_000);
    // 觸發任一次呼叫做被動清理
    limit("new");
    expect(limit.size()).toBe(1); // old 已被清掉
  });
});
