export type SwipeDir = "prev" | "next" | null;

/**
 * 由位移判斷翻頁方向。水平主導且超過閾值才算翻頁,否則當作垂直捲動 → null。
 * 往左滑(dx<0)= next(下一章);往右滑(dx>0)= prev(上一章)。
 */
export function resolveSwipe(dx: number, dy: number, threshold = 50): SwipeDir {
  if (Math.abs(dx) < threshold) return null; // 位移太小
  if (Math.abs(dx) <= Math.abs(dy)) return null; // 垂直主導 → 留給捲動
  return dx < 0 ? "next" : "prev";
}
