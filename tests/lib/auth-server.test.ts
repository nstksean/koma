import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// vi.mock 工廠會被 hoist 到檔頂,故共用狀態須用 vi.hoisted 一起提升,否則
// 工廠裡會 ReferenceError(存取尚未初始化的 top-level 變數)。
const { headerMap, cookieMap, getSession } = vi.hoisted(() => ({
  headerMap: new Map<string, string>(),
  cookieMap: new Map<string, string>(),
  getSession: vi.fn(),
}));

// next/headers 只能在請求情境內呼叫;測試裡用可控的 mock 餵 header / cookie。
// headers() 與 cookies() 皆 async,各回一個帶 .get(name) 的物件。
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
  }),
  cookies: async () => ({
    get: (name: string) =>
      cookieMap.has(name) ? { value: cookieMap.get(name) } : undefined,
  }),
}));

// better-auth 服務端實例:整顆 mock 掉(避免載入 @/db、@/lib/email),
// 只留可控的 api.getSession,讓每個 test 自行回 session 或 null。
vi.mock("@/lib/better-auth", () => ({
  auth: { api: { getSession } },
}));

// @/lib/auth、@/lib/client-ip、@/lib/guest 都是純函式 → 用真品。
import { getServerAuth, getServerDataOwner } from "@/lib/auth-server";
import { signSession, guestAuth, userAuth, SESSION_COOKIE } from "@/lib/auth";
import { GUEST_COOKIE } from "@/lib/guest";

function setHeader(name: string, value: string): void {
  headerMap.set(name.toLowerCase(), value);
}
function setCookie(name: string, value: string): void {
  cookieMap.set(name, value);
}

beforeEach(() => {
  headerMap.clear();
  cookieMap.clear();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getServerAuth — 優先序 1:better-auth session", () => {
  it("有 session(普通 email)→ identity user:<id>、role member", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@koma.app");
    getSession.mockResolvedValue({ user: { id: "u-123", email: "reader@gmail.com" } });

    const auth = await getServerAuth();

    expect(auth).toEqual(userAuth("u-123", "reader@gmail.com"));
    expect(auth).toEqual({ role: "member", identity: "user:u-123" });
  });

  it("有 session(ADMIN_EMAILS 命中)→ role admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@koma.app, admin@iqt.ai");
    getSession.mockResolvedValue({ user: { id: "u-999", email: "ADMIN@iqt.ai" } });

    const auth = await getServerAuth();

    expect(auth).toEqual({ role: "admin", identity: "user:u-999" });
  });

  it("session 物件存在但無 user → 不算登入,往下走(回 guest)", async () => {
    getSession.mockResolvedValue({ user: null });

    const auth = await getServerAuth();

    expect(auth.role).toBe("guest");
  });
});

describe("getServerAuth — 優先序 2:舊 HMAC koma_session cookie", () => {
  it("無 session + 有效 HMAC cookie → identity <role>:<id>", async () => {
    setCookie(SESSION_COOKIE, signSession({ role: "member", id: "m-1" }));

    const auth = await getServerAuth();

    expect(auth).toEqual({ role: "member", identity: "member:m-1" });
  });

  it("admin 角色的 cookie → admin:<id>", async () => {
    setCookie(SESSION_COOKIE, signSession({ role: "admin", id: "a-7" }));

    expect(await getServerAuth()).toEqual({ role: "admin", identity: "admin:a-7" });
  });

  it("cookie 被竄改 / 簽章不符 → 不採信,落到 guest", async () => {
    const token = signSession({ role: "admin", id: "a-7" });
    const tampered = token.replace(/^[^.]+/, (b) => b.slice(0, -1) + "X");
    setCookie(SESSION_COOKIE, tampered);
    setHeader("x-real-ip", "5.6.7.8");

    const auth = await getServerAuth();

    expect(auth.role).toBe("guest");
    expect(auth.identity).toBe(guestAuth("5.6.7.8").identity);
  });
});

describe("getServerAuth — 優先序 3:guest(可信 IP)", () => {
  it("無 session、無 cookie → guest,IP 由 client-ip helper 派生", async () => {
    setHeader("x-real-ip", "9.9.9.9");

    const auth = await getServerAuth();

    expect(auth).toEqual(guestAuth("9.9.9.9"));
    expect(auth.role).toBe("guest");
  });

  it("XFF 多段:不盲信第一段,跳過 1 跳可信代理取右側 client(防偽造額度繞過)", async () => {
    // 預設 TRUSTED_PROXY_HOPS=1:鏈 [client, proxy] 取最右-1 = client。
    // client 偽造最左段 "1.1.1.1" 無法換到新 identity。
    setHeader("x-forwarded-for", "1.1.1.1, 203.0.113.5");

    const auth = await getServerAuth();

    expect(auth.identity).toBe(guestAuth("1.1.1.1").identity);
    expect(auth.identity).not.toBe(guestAuth("203.0.113.5").identity);
  });
});

describe("getServerAuth — 優先序衝突:better-auth 勝過舊 cookie", () => {
  it("session 與合法 legacy cookie 同時存在 → 採 better-auth,忽略 cookie", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    getSession.mockResolvedValue({ user: { id: "u-real", email: "reader@gmail.com" } });
    // 同時放一張合法的 admin legacy cookie:必須被無視。
    setCookie(SESSION_COOKIE, signSession({ role: "admin", id: "legacy-admin" }));

    const auth = await getServerAuth();

    expect(auth).toEqual({ role: "member", identity: "user:u-real" });
    expect(auth.identity).not.toContain("legacy-admin");
    expect(auth.role).not.toBe("admin");
  });
});

describe("getServerDataOwner — guest cookie 接線", () => {
  it("登入者 → 直接用帳號 identity(user:<id>)", async () => {
    getSession.mockResolvedValue({ user: { id: "u-77", email: "reader@gmail.com" } });
    setCookie(GUEST_COOKIE, "browser-uuid-xyz"); // 登入者應忽略它

    expect(await getServerDataOwner()).toBe("user:u-77");
  });

  it("guest 有 koma_guest cookie → owner = guest:<cookie>,而非 hashed-IP identity", async () => {
    setHeader("x-real-ip", "9.9.9.9");
    setCookie(GUEST_COOKIE, "browser-uuid-xyz");

    const owner = await getServerDataOwner();

    expect(owner).toBe("guest:browser-uuid-xyz");
    // 關鍵:owner 來自瀏覽器 cookie,不等於以 IP 派生的額度 identity。
    expect(owner).not.toBe(guestAuth("9.9.9.9").identity);
  });

  it("guest 無 koma_guest cookie → 退回 hashed-IP identity(後備)", async () => {
    setHeader("x-real-ip", "9.9.9.9");

    const owner = await getServerDataOwner();

    expect(owner).toBe(guestAuth("9.9.9.9").identity);
  });
});
