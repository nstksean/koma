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
  dataOwner,
  adminEmails,
  roleForEmail,
  userAuth,
  canListen,
  SESSION_COOKIE,
} from "@/lib/auth";
import { accessCodes } from "@/db/schema";
import { createTestDb, setActiveDb, type TestDb } from "@/tests/helpers/test-db";

describe("canListen 聽書權限", () => {
  it("admin / member 可聽書", () => {
    expect(canListen("admin")).toBe(true);
    expect(canListen("member")).toBe(true);
  });
  it("guest 不可聽書", () => {
    expect(canListen("guest")).toBe(false);
  });
});

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

describe("better-auth 橋接(email → role / identity)", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "boss@koma.app, admin@iqt.ai");
  });

  it("ADMIN_EMAILS 命中 → admin(去空白、大小寫不敏感)", () => {
    expect(roleForEmail("boss@koma.app")).toBe("admin");
    expect(roleForEmail("  ADMIN@IQT.AI ")).toBe("admin");
  });

  it("非清單 email → member", () => {
    expect(roleForEmail("reader@gmail.com")).toBe("member");
  });

  it("adminEmails 正規化逗號清單(去空白、轉小寫、濾空)", () => {
    vi.stubEnv("ADMIN_EMAILS", " A@x.com ,, B@Y.com ");
    expect(adminEmails()).toEqual(["a@x.com", "b@y.com"]);
  });

  it("userAuth → identity 用 user:<userId> 命名空間、role 依 email", () => {
    expect(userAuth("u-123", "reader@gmail.com")).toEqual({
      role: "member",
      identity: "user:u-123",
    });
    expect(userAuth("u-999", "boss@koma.app")).toEqual({
      role: "admin",
      identity: "user:u-999",
    });
  });

  it("ADMIN_EMAILS 未設 → 任何 email 皆 member", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(roleForEmail("boss@koma.app")).toBe("member");
  });
});

describe("dataOwner(書架/進度擁有者)", () => {
  it("guest 有 cookie → 各自一桶(guest:<cookie>),與 IP identity 無關", () => {
    const a = dataOwner(guestAuth("1.2.3.4"), "uuid-aaa");
    const b = dataOwner(guestAuth("1.2.3.4"), "uuid-bbb");
    expect(a).toBe("guest:uuid-aaa");
    expect(a).not.toBe(b); // 同 IP 不同瀏覽器 → 不共用
  });

  it("guest 無 cookie → 退回 hashed IP identity(後備)", () => {
    const auth = guestAuth("1.2.3.4");
    expect(dataOwner(auth, undefined)).toBe(auth.identity);
  });

  it("登入者(非 guest)→ 直接用帳號 identity,忽略 cookie", () => {
    expect(dataOwner({ role: "member", identity: "user:u-1" }, "uuid-x")).toBe("user:u-1");
    expect(dataOwner({ role: "admin", identity: "admin:a" }, undefined)).toBe("admin:a");
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
