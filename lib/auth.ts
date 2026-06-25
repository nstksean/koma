import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accessCodes } from "@/db/schema";
import { clientIpFromRequest } from "@/lib/client-ip";

/**
 * 邀請碼 + 簽章 cookie 的身分系統（無密碼、無第三方）。
 *
 * - admin：碼放環境變數 ADMIN_CODES（逗號分隔）→ 無限額度。
 * - member：碼存 DB（access_codes，只存 sha256）→ 固定額度。
 * - guest：未登入,以 hashed IP 當 identity → 極少額度。
 *
 * session cookie = base64url(payload).HMAC-SHA256(payload)，用 SESSION_SECRET 簽。
 * 無狀態（不查 DB 即可驗），改不了也偽造不了。額度檢查見 lib/tts-quota.ts。
 *
 * 本檔刻意不 import next/headers，好讓 resolveAuth(req) 可在測試直接餵 Request。
 * 需在 Server Component / action 取身分時用 lib/auth-server.ts 的 getServerAuth()。
 */

export type Role = "admin" | "member" | "guest";

export interface Auth {
  readonly role: Role;
  readonly identity: string;
}

/**
 * 誰能用「聽書」(TTS)—— 省成本的單一真實來源。admin / member 可,純訪客 guest 不可。
 * server route 在合成前用它擋 guest(回 403,連額度都不碰);閱讀頁也用它決定 UI。
 */
export function canListen(role: Role): boolean {
  return role !== "guest";
}

export interface SessionPayload {
  readonly role: "admin" | "member"; // guest 不簽 cookie
  readonly id: string;
}

export const SESSION_COOKIE = "koma_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 天（秒）

/** HMAC 金鑰：上線必設;dev/test 退回不安全預設(僅本機)。 */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET 未設定（上線必填，至少 16 字元）");
  }
  return "dev-insecure-secret-change-me"; // ponytail: 僅 dev/test;prod 走上面的 throw
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

/** 定長字串的 constant-time 比較;長度不同直接 false（timingSafeEqual 會丟）。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** 簽出 session token（放進 cookie）。 */
export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** 驗 session token;簽章不符 / 損壞 / 角色非法 → null。 */
export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p && (p.role === "admin" || p.role === "member") && typeof p.id === "string") {
      return { role: p.role, id: p.id };
    }
    return null;
  } catch {
    return null;
  }
}

/** 碼的 sha256 hex —— 用於 DB 儲存與查找。 */
export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function sessionToAuth(s: SessionPayload): Auth {
  return { role: s.role, identity: `${s.role}:${s.id}` };
}

/** guest 身分：以 hashed client IP 當 identity（額度按 IP 算）。 */
export function guestAuth(ip: string): Auth {
  const ipHash = createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 16);
  return { role: "guest", identity: `guest:${ipHash}` };
}

/**
 * 書架/進度的「擁有者 key」—— 與額度 identity 分離。
 *   - 登入者(非 guest):帳號 id 本來就逐人,直接用 identity。
 *   - guest:用每瀏覽器一個的匿名 cookie id → 各自一桶;沒 cookie 才退回 identity(hashed IP)。
 * 額度系統不受影響:仍吃 identity(guest = hashed IP),同 IP 共用一桶是刻意的防濫用。
 */
export function dataOwner(auth: Auth, guestCookie: string | undefined): string {
  if (auth.role !== "guest") return auth.identity;
  return guestCookie ? `guest:${guestCookie}` : auth.identity;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    if (part.slice(0, eqIdx).trim() === name) {
      return decodeURIComponent(part.slice(eqIdx + 1).trim());
    }
  }
  return undefined;
}

/** 從 Request 解析身分：有效 session → admin/member,否則 guest（hashed IP）。 */
export function resolveAuth(req: Request): Auth {
  const session = verifySession(readCookie(req, SESSION_COOKIE));
  return session ? sessionToAuth(session) : guestAuth(clientIpFromRequest(req));
}

function adminCodes(): string[] {
  return (process.env.ADMIN_CODES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 推薦碼（逗號分隔,明碼）→ 命中即 member。與 admin 一樣走 env、不入庫,適合少數固定的好記分享碼。 */
function referralCodes(): string[] {
  return (process.env.REFERRAL_CODES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 驗證邀請碼 → 回它授予的角色,失敗回 null。只認證「碼」,不決定 session id;
 * 逐人 id 由 resolveSessionId 在 action 端決定,好讓每個人各有額度桶。
 * admin 走 env(constant-time 比對);member 來源有二:env REFERRAL_CODES(好記分享碼)
 * 或 DB codeHash(須未停用)。
 */
export async function redeemCode(code: string): Promise<"admin" | "member" | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  for (const ac of adminCodes()) {
    if (safeEqual(ac, trimmed)) return "admin";
  }
  for (const rc of referralCodes()) {
    if (safeEqual(rc, trimmed)) return "member";
  }

  const rows = await db
    .select()
    .from(accessCodes)
    .where(and(eq(accessCodes.codeHash, hashCode(trimmed)), eq(accessCodes.disabled, false)));
  return rows.length > 0 ? "member" : null;
}

/** 鑄一個新的 person id(放進簽章 cookie;只需唯一、不需保密——cookie 已被 HMAC 保護)。 */
export function newSessionId(): string {
  return randomUUID();
}

/**
 * 決定本次 redeem 用哪個 session id —— 逐人額度的核心。
 * 同角色續期就沿用既有 id(重貼碼/續期不重置額度);否則鑄新 id。
 * 每個瀏覽器(cookie jar)= 一個人 = 一個額度桶,兌不同碼/不同人就各自獨立計額。
 * ponytail: 清掉 cookie 後重貼會拿到新桶(等同訪客換 IP),這是無帳號系統的天花板;
 *           要真正防重置得引入帳號或伺服器端裝置綁定,本期不做。
 */
export function resolveSessionId(
  role: "admin" | "member",
  existing: SessionPayload | null,
): string {
  return existing && existing.role === role ? existing.id : newSessionId();
}

// ─── better-auth 橋接(Email OTP 登入)──────────────────────────────────────
// better-auth 管真實、已驗證的 email 身分;額度仍走 tts_usage,登入者額度 identity =
// `user:<userId>`,與舊 admin:/member:/guest:/iqt: 命名空間共存(零遷移)。role 由 email
// 決定:ADMIN_EMAILS 命中 = admin、其餘已驗證 email = member。解析入口見 lib/auth-server.ts。

/** admin email 允許清單(逗號分隔,小寫正規化)。 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** email → role:在 ADMIN_EMAILS 清單 = admin,其餘已登入 email = member。 */
export function roleForEmail(email: string): "admin" | "member" {
  return adminEmails().includes(email.trim().toLowerCase()) ? "admin" : "member";
}

/** better-auth 登入者 → Auth。額度 identity 走 `user:<userId>` 命名空間。 */
export function userAuth(userId: string, email: string): Auth {
  return { role: roleForEmail(email), identity: `user:${userId}` };
}
