import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

import {
  getQuotaStatus,
  quotaEnforced,
  refundQuota,
  today,
  tryConsumeQuota,
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

afterEach(() => {
  vi.unstubAllEnvs();
});

async function countOf(identity: string): Promise<number> {
  const rows = await testDb.select().from(ttsUsage);
  return rows.find((r) => r.identity === identity)?.count ?? 0;
}

describe("tryConsumeQuota — 原子預扣", () => {
  it("未達上限:成功預扣並回剩餘,count 立即 +1", async () => {
    expect(await tryConsumeQuota(guest)).toBe(1); // limit 2 - now 1
    expect(await countOf(guest.identity)).toBe(1);
    expect(await tryConsumeQuota(guest)).toBe(0); // 第二次:用完最後一格
    expect(await countOf(guest.identity)).toBe(2);
  });

  it("達上限:丟 QuotaError,且 count 不再增加(原子擋下)", async () => {
    await tryConsumeQuota(guest);
    await tryConsumeQuota(guest); // guest limit = 2,已用完
    await expect(tryConsumeQuota(guest)).rejects.toBeInstanceOf(QuotaError);
    expect(await countOf(guest.identity)).toBe(2); // 沒有溢出成 3
  });

  it("member 上限獨立於 guest", async () => {
    await tryConsumeQuota(guest);
    await tryConsumeQuota(guest);
    expect(await tryConsumeQuota(member)).toBe(2); // member limit 3 - 1
  });

  it("admin:無限,不寫 usage", async () => {
    expect(await tryConsumeQuota(admin)).toBe(Infinity);
    expect(await tryConsumeQuota(admin)).toBe(Infinity);
    const rows = await testDb.select().from(ttsUsage);
    expect(rows).toHaveLength(0);
  });

  it("併發 N 個請求在上限邊界不會超用(TOCTOU 防護)", async () => {
    // guest limit = 2。同時送 10 個預扣,只應有 2 個成功、8 個 QuotaError。
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => tryConsumeQuota(guest)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof QuotaError,
    ).length;
    expect(ok).toBe(2);
    expect(rejected).toBe(8);
    expect(await countOf(guest.identity)).toBe(2); // 嚴格等於上限,絕不超用
  });
});

describe("refundQuota — 合成失敗回補", () => {
  it("預扣後回補:count 退回", async () => {
    await tryConsumeQuota(guest); // count 1
    await refundQuota(guest);
    expect(await countOf(guest.identity)).toBe(0);
  });

  it("count 已為 0 時回補不會變負(下界保護)", async () => {
    await refundQuota(guest); // 無列 → no-op
    expect(await countOf(guest.identity)).toBe(0);
  });

  it("admin 回補為 no-op", async () => {
    await refundQuota(admin);
    const rows = await testDb.select().from(ttsUsage);
    expect(rows).toHaveLength(0);
  });

  it("預扣→回補→可再次預扣(額度真的還回來了)", async () => {
    await tryConsumeQuota(guest);
    await tryConsumeQuota(guest); // 用完 limit 2
    await refundQuota(guest); // 退一格
    expect(await tryConsumeQuota(guest)).toBe(0); // 又能扣一次
    expect(await countOf(guest.identity)).toBe(2);
  });
});

describe("跨日重置", () => {
  it("昨天的滿額不影響今天", async () => {
    await testDb.insert(ttsUsage).values({
      identity: guest.identity,
      day: "2000-01-01",
      count: 99,
    });
    expect(await tryConsumeQuota(guest)).toBe(1);
    expect(today()).not.toBe("2000-01-01");
  });
});

describe("getQuotaStatus", () => {
  it("回今日 used/limit/remaining", async () => {
    await tryConsumeQuota(member);
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

describe("quotaEnforced — 預設強制,僅顯式 opt-out", () => {
  it("未設任何旗標 → 強制(預設安全)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TTS_DISABLE_QUOTA", "");
    vi.stubEnv("TTS_ENFORCE_QUOTA", "");
    expect(quotaEnforced()).toBe(true);
  });

  it("production → 強制", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(quotaEnforced()).toBe(true);
  });

  it("test 環境 → 放行(本機測試免設定)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TTS_DISABLE_QUOTA", "");
    expect(quotaEnforced()).toBe(false);
  });

  it("顯式 TTS_DISABLE_QUOTA=1 → 放行", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TTS_DISABLE_QUOTA", "1");
    expect(quotaEnforced()).toBe(false);
  });

  it("非 prod 但未 opt-out → 仍強制(preview/staging 不再裸奔)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TTS_DISABLE_QUOTA", "");
    expect(quotaEnforced()).toBe(true);
  });
});
