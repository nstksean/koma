import type { CharTimestamp } from "./types";

/**
 * 逐字高亮同步器核心（04 §5.1）。給定 timing map（已按 startMs 遞增）與
 * player 回拋的 currentMs，binary search 找「最後一個 startMs <= currentMs」
 * 的字 —— 即當前該高亮的字。O(log n) per frame，整章上千字也無感。
 *
 * 純函式、可單測。回傳 charTimestamps 的陣列 index（非 CharTimestamp.charIndex；
 * 渲染對齊用 `chars[ans].charIndex`）。
 *
 * ⚠️ 前置條件（呼叫端負責）：`chars` 必須按 startMs 遞增。這是 binary search 的
 * 正確性依據；每幀執行故不在此做 O(n) 檢查。`azureWordsToChars` 已保證此序；
 * 其他 provider（如 IQT forced-alignment）若排序保證較弱，須在 provider 端排序後再傳入。
 *
 * 變速無需縮放：timestamp 永遠存 1.0× ms，player 的 currentMs 本身就是音檔
 * 播放位置毫秒，直接拿來查即可（§5.2）。詞間停頓 gap 期間會停在前一字。
 *
 * @returns 命中字的陣列 index；-1 = 尚未開始（currentMs 在第一字之前）或空輸入。
 */
export function activeCharIndex(
  chars: readonly CharTimestamp[],
  currentMs: number,
): number {
  let lo = 0;
  let hi = chars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chars[mid].startMs <= currentMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
