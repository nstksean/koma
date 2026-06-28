/**
 * 字級 timestamp 的時間軸工具(純函式,無副作用)。把「逐段合成」的字級
 * timestamp 從段內相對時間平移成全章絕對時間。
 *
 * 跨段累積時間的真實來源是各段 SDK audioDuration(見 azure-synthesize),
 * 絕不用 boundary 的 ms —— wordBoundary 的 audioOffset 是段內相對值,且詞末
 * 到段末可能有靜音尾巴,唯有 audioDuration 才是該段對音檔貢獻的真實時長。
 */

import type { CharTimestamp } from "./types";

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
