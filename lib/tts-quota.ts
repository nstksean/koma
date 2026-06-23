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
 * 把關點在兩個 TTS route：assertQuota 付費前擋,consumeQuota 合成成功後 +1。
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
 * 是否強制額度。只有 production 強制;dev/test 一律放行,讓本機與測試免設定
 * auth/額度即可用(使用者要求:測試與環境不看權限)。要在本機驗 prod 行為可設
 * TTS_ENFORCE_QUOTA=1。
 */
export function quotaEnforced(): boolean {
  return process.env.NODE_ENV === "production" || process.env.TTS_ENFORCE_QUOTA === "1";
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

/** 付費前檢查：超額丟 QuotaError（route 對應 429）。admin 直接放行。回今日剩餘。 */
export async function assertQuota(auth: Auth): Promise<number> {
  const limit = limitFor(auth.role);
  if (limit === Infinity) return Infinity;
  const used = await countToday(auth.identity);
  if (used >= limit) throw new QuotaError(auth.role, limit);
  return limit - used;
}

/**
 * 合成成功後 +1。admin 不計。
 * ponytail: 並發下兩個不同章可能各自過了 assert 再各 +1,微幅超量;
 *   單人規模可接受。要硬上限再把 assert+consume 併成單條 UPDATE…WHERE count<limit。
 */
export async function consumeQuota(auth: Auth): Promise<void> {
  if (auth.role === "admin") return;
  await db
    .insert(ttsUsage)
    .values({ identity: auth.identity, day: today(), count: 1 })
    .onConflictDoUpdate({
      target: [ttsUsage.identity, ttsUsage.day],
      set: { count: sql`${ttsUsage.count} + 1` },
    });
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
