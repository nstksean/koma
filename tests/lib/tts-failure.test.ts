import { describe, expect, it } from "vitest";

import { describeFailure, GENERIC_SYNTH_FAILED } from "@/lib/tts-failure";

describe("describeFailure", () => {
  it("逾時優先於其他判斷", () => {
    const r = describeFailure(new Error("合成失敗(500)"), true);
    expect(r.log).toBe("timeout");
    expect(r.user).toContain("逾時");
  });

  it("TypeError 視為網路中斷", () => {
    const r = describeFailure(new TypeError("Failed to fetch"), false);
    expect(r.log).toContain("network");
    expect(r.user).toContain("網路");
  });

  it("HTTP 404 → 找不到章節", () => {
    const r = describeFailure(new Error("合成失敗(404)"), false);
    expect(r.log).toBe("http 404");
    expect(r.user).toContain("沒這章");
  });

  it("HTTP 5xx → 服務忙線", () => {
    const r = describeFailure(new Error("合成失敗(503)"), false);
    expect(r.log).toBe("http 503");
    expect(r.user).toContain("忙線");
  });

  it("未知 Error → 泛用文案,保留 message 到 log", () => {
    const r = describeFailure(new Error("boom"), false);
    expect(r.user).toBe(GENERIC_SYNTH_FAILED);
    expect(r.log).toBe("boom");
  });

  it("非 Error 值 → 泛用文案,String 化到 log", () => {
    const r = describeFailure("nope", false);
    expect(r.user).toBe(GENERIC_SYNTH_FAILED);
    expect(r.log).toBe("nope");
  });
});
