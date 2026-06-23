/**
 * 聽書本機偏好的純解析/夾取邏輯(語速檔位、逐章播放位置)。
 * 實際的 localStorage 讀寫留在 audio-player(client),這裡只做可測的驗證。
 */

/** 解析語速檔位:必須是 [0, len) 的整數,否則回退 fallback。注意 Number(null)===0,需先擋。 */
export function parseRateIdx(raw: string | null, len: number, fallback = 1): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < len ? n : fallback;
}

/** 解析上次聽到的毫秒位置:有限、>0、且小於章長才有效;否則回 0(從頭播)。 */
export function parsePosMs(raw: string | null, durationMs: number): number {
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < durationMs ? n : 0;
}
