import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// 受測模組透過 next/headers 的 headers() 取得 client IP。
// 提供可控的 x-real-ip(client-ip.ts 直接信任此 header,不涉 hop count)。
let currentIp = "";
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "x-real-ip" ? currentIp : null,
  }),
}));

import { unlockThrottled } from "@/lib/unlock-rate-limit";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// 注意:limiter 是 module-level singleton(in-memory),狀態跨 test 累積。
// 每個 it 用「不同 IP」避免互相污染。

describe("unlockThrottled — 兌換暴力嘗試節流", () => {
  it("未超限:首次嘗試回 false(放行)", async () => {
    currentIp = "10.0.0.1";
    expect(await unlockThrottled()).toBe(false);
  });

  it("超過上限(max=5):同 IP 第 6 次回 true(被節流)", async () => {
    currentIp = "10.0.0.2";
    // 前 5 次落在 max 內 → 放行
    for (let i = 0; i < 5; i += 1) {
      expect(await unlockThrottled()).toBe(false);
    }
    // 第 6 次超過 max → 被節流
    expect(await unlockThrottled()).toBe(true);
  });

  it("不同 IP 各自獨立計數:別的 IP 被節流也不影響新 IP", async () => {
    // 先把某 IP 打到爆
    currentIp = "10.0.0.3";
    for (let i = 0; i < 6; i += 1) {
      await unlockThrottled();
    }
    expect(await unlockThrottled()).toBe(true); // 確認該 IP 已被節流

    // 全新 IP 自己的桶,仍放行
    currentIp = "10.0.0.4";
    expect(await unlockThrottled()).toBe(false);
  });
});
