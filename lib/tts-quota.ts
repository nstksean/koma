import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { ttsUsage } from "@/db/schema";
import type { Auth, Role } from "@/lib/auth";

/**
 * 每日合成額度。只計「真的送 Azure 合成」的次數（cache 命中/重播/拖進度條免費），
 * 正好對齊實際付費點。admin 無限;member/guest 由 env 微調。
 *
 *   TTS_QUOTA_MEMBER（預設 30） / TTS_QUOTA_GUEST（預設 5）
 *
 * 把關點:送 Azure「之前」用 tryConsumeQuota 原子預扣(超額丟 QuotaError → 429);
 * 合成失敗才 refundQuota 回補。預扣與檢查是同一條 SQL,消除 assert→consume 的
 * TOCTOU 競態(併發不同章不會雙花/超量)。
 */

export class QuotaError extends Error {
  constructor(
    readonly role: Role,
    readonly limit: number,
  ) {
    super("今日聽書額度已用完，請明日再試或升級權限");
    this.name = "QuotaError";
  }
}

function numEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 是否強制額度。**預設強制、僅顯式 opt-out**(Medium-2):任何未明確關閉的部署
 * (含 preview/staging)都受額度保護,不再「非 prod 即裸奔免費供應付費合成」。
 * 只有偵測到測試(NODE_ENV==="test")或顯式 TTS_DISABLE_QUOTA=1 才放行。
 * TTS_ENFORCE_QUOTA 保留為向下相容的顯式強制旗標(預設本就強制,設了也只是 true)。
 */
export function quotaEnforced(): boolean {
  if (process.env.TTS_DISABLE_QUOTA === "1") return false;
  if (process.env.NODE_ENV === "test") return false;
  return true;
}

function limitFor(role: Role): number {
  if (role === "admin") return Infinity;
  if (role === "member") return numEnv("TTS_QUOTA_MEMBER", 30);
  return numEnv("TTS_QUOTA_GUEST", 5);
}

/** 今日（UTC）YYYY-MM-DD。跨日查不到列即視為 0,天然重置。 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countToday(identity: string): Promise<number> {
  const rows = await db
    .select()
    .from(ttsUsage)
    .where(and(eq(ttsUsage.identity, identity), eq(ttsUsage.day, today())));
  return rows[0]?.count ?? 0;
}

/**
 * 原子預扣一格額度(送 Azure 付費合成「之前」呼叫)。admin 直接放行、不計。
 *
 * 用單條條件式 upsert 把「檢查上限 + 扣減」併成不可分割的一步:
 *   INSERT(count=1) ON CONFLICT DO UPDATE SET count=count+1 WHERE count < limit
 * 落帳成功(rowsAffected>0)回今日剩餘;被 WHERE 擋下(rowsAffected===0,已達上限)
 * 丟 QuotaError。如此跨並發不同章也不會各自讀到舊值再雙花(消除 TOCTOU)。
 */
export async function tryConsumeQuota(auth: Auth): Promise<number> {
  const limit = limitFor(auth.role);
  if (limit === Infinity) return Infinity;

  const day = today();
  const res = await db.run(sql`
    INSERT INTO tts_usage (identity, day, count) VALUES (${auth.identity}, ${day}, 1)
    ON CONFLICT(identity, day) DO UPDATE SET count = count + 1
    WHERE tts_usage.count < ${limit}
  `);

  if (res.rowsAffected === 0) {
    // 已達上限:WHERE 把 upsert 擋下,沒有任何列被改 → 超額。
    throw new QuotaError(auth.role, limit);
  }

  return limit - (await countToday(auth.identity));
}

/**
 * 回補一格額度(預扣後合成失敗時呼叫)。admin no-op。
 * 加 `count > 0` 下界保護,避免任何競態把 count 壓成負數。
 */
export async function refundQuota(auth: Auth): Promise<void> {
  if (auth.role === "admin") return;
  await db.run(sql`
    UPDATE tts_usage SET count = count - 1
    WHERE identity = ${auth.identity} AND day = ${today()} AND count > 0
  `);
}

export interface QuotaStatus {
  readonly role: Role;
  readonly used: number;
  readonly limit: number; // Infinity = 無限
  readonly remaining: number;
}

/** 給 /unlock 顯示用：目前身分的今日用量。 */
export async function getQuotaStatus(auth: Auth): Promise<QuotaStatus> {
  const limit = limitFor(auth.role);
  if (limit === Infinity) {
    return { role: auth.role, used: 0, limit: Infinity, remaining: Infinity };
  }
  const used = await countToday(auth.identity);
  return { role: auth.role, used, limit, remaining: Math.max(0, limit - used) };
}
