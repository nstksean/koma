import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIpFromHeaders } from "@/lib/client-ip";

/**
 * IP 解析 helper：核心安全前提是「client 送的 X-Forwarded-For 第一段不可信」。
 * 攻擊者偽造第一段就能換全新 guest identity → 無上限觸發付費合成（Critical-1）。
 * 信任模型：最右邊那段才是「最後一跳可信代理」寫入的真實 client，由右往左取，
 * 跳過設定為信任的 proxy 段（TRUSTED_PROXY_HOPS，預設 1）。
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function h(headers: Record<string, string>): (name: string) => string | null {
  const norm = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return (name: string) => norm.get(name.toLowerCase()) ?? null;
}

describe("clientIpFromHeaders — 防 XFF 第一段偽造", () => {
  it("偽造第一段不影響解析：取最右一跳之外的那段（單一可信代理）", () => {
    // 攻擊者送 forged-A / forged-B,真實 client（最後跳前一段)是 9.9.9.9。
    const a = clientIpFromHeaders(
      h({ "x-forwarded-for": "1.1.1.1, 9.9.9.9, 8.8.8.8" }),
    );
    const b = clientIpFromHeaders(
      h({ "x-forwarded-for": "2.2.2.2, 9.9.9.9, 8.8.8.8" }),
    );
    // 攻擊者改第一段 → 解析結果不變（仍是 9.9.9.9），無法靠刷第一段換 identity。
    expect(a).toBe(b);
    expect(a).toBe("9.9.9.9");
  });

  it("預設信任 1 跳：回 XFF 倒數第二段", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe(
      "1.2.3.4",
    );
  });

  it("只有一段時就回那段（直連或代理就是它）", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("可由 TRUSTED_PROXY_HOPS 調整跳數", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    // 3 段、信任 2 跳 → 取倒數第三段。
    expect(
      clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("1.1.1.1");
  });

  it("跳數超過實際段數 → 退回最左段(不丟錯)", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "5");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe(
      "1.1.1.1",
    );
  });

  it("無 XFF → 退回 x-real-ip", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
  });

  it("全無來源 → unknown(所有匿名共用一桶,不另開額度)", () => {
    expect(clientIpFromHeaders(h({}))).toBe("unknown");
  });

  it("空白/空段被過濾,不會回空字串", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": " , , 4.4.4.4" }))).toBe(
      "4.4.4.4",
    );
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "   " }))).toBe("unknown");
  });
});
