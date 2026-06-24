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
  signSession,
  verifySession,
  hashCode,
  resolveAuth,
  redeemCode,
  resolveSessionId,
  guestAuth,
  SESSION_COOKIE,
} from "@/lib/auth";
import { accessCodes } from "@/db/schema";
import { createTestDb, setActiveDb, type TestDb } from "@/tests/helpers/test-db";

describe("session 簽章", () => {
  it("signSession → verifySession 來回成立", () => {
    const token = signSession({ role: "member", id: "abc123" });
    expect(verifySession(token)).toEqual({ role: "member", id: "abc123" });
  });

  it("被竄改的 payload 驗不過(回 null)", () => {
    const token = signSession({ role: "member", id: "abc123" });
    const tampered = token.replace(/^[^.]+/, (b) => b.slice(0, -1) + "X");
    expect(verifySession(tampered)).toBeNull();
  });

  it("亂簽 / 空 token → null", () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("garbage")).toBeNull();
    expect(verifySession("a.b")).toBeNull();
  });

  it("hashCode 同碼穩定、不同碼相異", () => {
    expect(hashCode("HELLO")).toBe(hashCode("hello".toUpperCase()));
    expect(hashCode("a")).not.toBe(hashCode("b"));
  });
});

describe("resolveAuth", () => {
  it("無 cookie → guest,identity 由 IP 派生", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9" },
    });
    const auth = resolveAuth(req);
    expect(auth.role).toBe("guest");
    expect(auth.identity).toBe(guestAuth("1.2.3.4").identity);
  });

  it("有效 session cookie → 對應角色", () => {
    const token = signSession({ role: "admin", id: "deadbeef" });
    const req = new Request("https://x/", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(resolveAuth(req)).toEqual({ role: "admin", identity: "admin:deadbeef" });
  });
});

describe("redeemCode", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
    setActiveDb(testDb);
    vi.stubEnv("ADMIN_CODES", "super-secret-admin");
  });

  it("admin env 碼 → role admin", async () => {
    expect(await redeemCode("super-secret-admin")).toBe("admin");
  });

  it("env 推薦碼 → role member", async () => {
    vi.stubEnv("REFERRAL_CODES", "ref-alice, ref-bob");
    expect(await redeemCode("ref-alice")).toBe("member");
    expect(await redeemCode("ref-bob")).toBe("member");
    expect(await redeemCode("ref-nobody")).toBeNull();
  });

  it("DB member 碼(未停用)→ role member", async () => {
    await testDb.insert(accessCodes).values({
      id: "code1",
      codeHash: hashCode("invite-xyz"),
      role: "member",
      label: "朋友A",
      disabled: false,
      createdAt: new Date(),
    });
    expect(await redeemCode("invite-xyz")).toBe("member");
  });

  it("已停用的碼 → null", async () => {
    await testDb.insert(accessCodes).values({
      id: "code2",
      codeHash: hashCode("dead-code"),
      role: "member",
      label: "",
      disabled: true,
      createdAt: new Date(),
    });
    expect(await redeemCode("dead-code")).toBeNull();
  });

  it("無效碼 / 空白 → null", async () => {
    expect(await redeemCode("nope")).toBeNull();
    expect(await redeemCode("   ")).toBeNull();
  });
});

describe("resolveSessionId(逐人額度)", () => {
  it("同角色續期 → 沿用既有 id(重貼不重置額度)", () => {
    expect(resolveSessionId("member", { role: "member", id: "person-1" })).toBe("person-1");
  });

  it("無既有 session → 鑄新 id;兩次互異(各自一桶)", () => {
    const a = resolveSessionId("member", null);
    const b = resolveSessionId("member", null);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it("角色不同 → 不沿用,鑄新 id", () => {
    expect(resolveSessionId("member", { role: "admin", id: "admin-x" })).not.toBe("admin-x");
  });
});
