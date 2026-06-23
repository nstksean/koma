import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

import {
  assertQuota,
  consumeQuota,
  getQuotaStatus,
  today,
  QuotaError,
} from "@/lib/tts-quota";
import { ttsUsage } from "@/db/schema";
import type { Auth } from "@/lib/auth";
import { createTestDb, setActiveDb, type TestDb } from "@/tests/helpers/test-db";

const guest: Auth = { role: "guest", identity: "guest:ip1" };
const member: Auth = { role: "member", identity: "member:m1" };
const admin: Auth = { role: "admin", identity: "admin:a1" };

let testDb: TestDb;
beforeEach(async () => {
  testDb = await createTestDb();
  setActiveDb(testDb);
  vi.stubEnv("TTS_QUOTA_MEMBER", "3");
  vi.stubEnv("TTS_QUOTA_GUEST", "2");
});

describe("consume + assert", () => {
  it("未達上限：assert 通過並回剩餘", async () => {
    expect(await assertQuota(guest)).toBe(2);
    await consumeQuota(guest);
    expect(await assertQuota(guest)).toBe(1);
  });

  it("達上限：assert 丟 QuotaError", async () => {
    await consumeQuota(guest);
    await consumeQuota(guest); // guest limit = 2
    await expect(assertQuota(guest)).rejects.toBeInstanceOf(QuotaError);
  });

  it("member 上限獨立於 guest（不同 identity 不互相消耗）", async () => {
    await consumeQuota(guest);
    await consumeQuota(guest);
    // guest 滿了,但 member 全新
    expect(await assertQuota(member)).toBe(3);
  });

  it("admin：assert 無限、consume 不計", async () => {
    expect(await assertQuota(admin)).toBe(Infinity);
    await consumeQuota(admin);
    const rows = await testDb.select().from(ttsUsage);
    expect(rows).toHaveLength(0); // admin 不寫 usage
  });
});

describe("跨日重置", () => {
  it("昨天的用量不影響今天", async () => {
    // 直接塞一筆「昨天」滿額的紀錄
    await testDb.insert(ttsUsage).values({
      identity: guest.identity,
      day: "2000-01-01",
      count: 99,
    });
    // 今天是 today(),查不到列 → 0 → 通過
    expect(await assertQuota(guest)).toBe(2);
    expect(today()).not.toBe("2000-01-01");
  });
});

describe("getQuotaStatus", () => {
  it("回今日 used/limit/remaining", async () => {
    await consumeQuota(member);
    expect(await getQuotaStatus(member)).toEqual({
      role: "member",
      used: 1,
      limit: 3,
      remaining: 2,
    });
  });

  it("admin 為無限", async () => {
    const s = await getQuotaStatus(admin);
    expect(s.limit).toBe(Infinity);
    expect(s.remaining).toBe(Infinity);
  });
});
