import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkTtsRate } from "@/lib/tts-rate-limit";

/**
 * TTS 第二道閘整合測試。limiter 是 module 單例,故同一身分跨呼叫會累計;
 * 用不同 IP 確保各測試 case 不互相污染(每個 case 用獨立 IP 當 key 的一部分)。
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

function reqFrom(ip: string): Request {
  // 單段 XFF → clientIpFromHeaders 取該段;無 cookie → guest identity 由該 IP 派生。
  return new Request("https://x/api/tts/ttkan/slug/1", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkTtsRate — 每身分每分鐘上限", () => {
  it("上限(20)內放行,第 21 次回 429 + Retry-After", () => {
    const req = reqFrom("100.0.0.1");
    for (let i = 0; i < 20; i++) {
      expect(checkTtsRate(req).ok).toBe(true);
    }
    const blocked = checkTtsRate(req);
    expect(blocked.ok).toBe(false);
    expect(blocked.response?.status).toBe(429);
    expect(blocked.response?.headers.get("Retry-After")).toBeTruthy();
  });

  it("不同 IP(不同身分)各自獨立,不互相消耗", () => {
    const a = reqFrom("100.0.0.2");
    const b = reqFrom("100.0.0.3");
    for (let i = 0; i < 20; i++) checkTtsRate(a);
    expect(checkTtsRate(a).ok).toBe(false); // a 滿
    expect(checkTtsRate(b).ok).toBe(true); // b 不受影響
  });

  it("視窗過後重置", () => {
    const req = reqFrom("100.0.0.4");
    for (let i = 0; i < 20; i++) checkTtsRate(req);
    expect(checkTtsRate(req).ok).toBe(false);
    vi.setSystemTime(60_001);
    expect(checkTtsRate(req).ok).toBe(true);
  });
});
