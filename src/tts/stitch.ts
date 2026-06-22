/**
 * PCM 串接的時間軸工具(純函式,無副作用)。Workstream A 用來把「逐段合成」
 * 的字級 timestamp 從段內相對時間平移成全章絕對時間。
 *
 * 關鍵原則:跨段累積時間【只用 PCM byte 數換算】,絕不用 boundary 的 ms。
 * 因為 wordBoundary 的 audioOffset 是段內相對值,且詞末到段末可能有靜音尾巴
 * —— 唯有實際 PCM 長度才是該段對音檔貢獻的真實時長。
 */

import type { CharTimestamp } from "./types";

/** Raw24Khz16BitMonoPcm:24000Hz × 16bit × 1ch / 8 / 1000 = 每毫秒 48 bytes。 */
export const BYTES_PER_MS = 48;

/** PCM byte 數 → 毫秒(該段對音檔貢獻的真實時長)。 */
export function pcmBytesToMs(pcmByteLength: number): number {
  return pcmByteLength / BYTES_PER_MS;
}

/**
 * 把一段字級 timestamp 整體平移 deltaMs(回傳新陣列,不可變,勿原地改)。
 * 用於把段內相對時間 + 該段在音檔的起始 offset → 全章絕對時間。
 */
export function shiftCharTimestamps(
  chars: readonly CharTimestamp[],
  deltaMs: number,
): readonly CharTimestamp[] {
  return chars.map((c): CharTimestamp => ({
    ...c,
    startMs: c.startMs + deltaMs,
    endMs: c.endMs + deltaMs,
  }));
}
