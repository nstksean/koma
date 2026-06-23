import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accessCodes } from "@/db/schema";

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

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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
  return session ? sessionToAuth(session) : guestAuth(clientIp(req));
}

function adminCodes(): string[] {
  return (process.env.ADMIN_CODES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 驗證邀請碼 → 回 session payload（供種 cookie），失敗回 null。
 * admin 走 env（constant-time 比對）;member 查 DB codeHash（須未停用）。
 */
export async function redeemCode(code: string): Promise<SessionPayload | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  for (const ac of adminCodes()) {
    if (safeEqual(ac, trimmed)) {
      return { role: "admin", id: hashCode(trimmed).slice(0, 12) };
    }
  }

  const rows = await db
    .select()
    .from(accessCodes)
    .where(and(eq(accessCodes.codeHash, hashCode(trimmed)), eq(accessCodes.disabled, false)));
  if (rows.length > 0) return { role: "member", id: rows[0].id };

  return null;
}
