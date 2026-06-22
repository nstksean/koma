import { describe, it, expect } from "vitest";
import { activeCharIndex } from "@/src/tts/sync";
import type { CharTimestamp } from "@/src/tts/types";

/**
 * activeCharIndex — 給 timing map + 當前 ms，binary search 找「最後一個
 * startMs <= currentMs」的字（04 §5.1）。純函式、O(log n)。
 */
describe("activeCharIndex", () => {
  // 夜 0~120 / 色 120~250 / 漸 250~410 / 深 410~600
  const chars: readonly CharTimestamp[] = [
    { char: "夜", charIndex: 0, startMs: 0, endMs: 120 },
    { char: "色", charIndex: 1, startMs: 120, endMs: 250 },
    { char: "漸", charIndex: 2, startMs: 250, endMs: 410 },
    { char: "深", charIndex: 3, startMs: 410, endMs: 600 },
  ];

  it("currentMs 在第一字之前 → -1（尚未開始）", () => {
    expect(activeCharIndex(chars, -1)).toBe(-1);
  });

  it("currentMs 正好落在某字 startMs → 該字 index", () => {
    expect(activeCharIndex(chars, 0)).toBe(0);
    expect(activeCharIndex(chars, 120)).toBe(1);
    expect(activeCharIndex(chars, 410)).toBe(3);
  });

  it("currentMs 落在兩字之間 → 取較早者（最後一個 startMs <= currentMs）", () => {
    expect(activeCharIndex(chars, 60)).toBe(0); // 夜 期間
    expect(activeCharIndex(chars, 249)).toBe(1); // 色 期間
    expect(activeCharIndex(chars, 409)).toBe(2); // 漸 期間
  });

  it("currentMs 超過末字 → 停在末字 index", () => {
    expect(activeCharIndex(chars, 9999)).toBe(3);
  });

  it("詞間停頓 gap：停在前一字（endMs < currentMs < 下一字 startMs）", () => {
    // 模擬「深」止 988、下一詞「他」起 1088，中間 100ms 靜音
    const withGap: readonly CharTimestamp[] = [
      { char: "深", charIndex: 0, startMs: 650, endMs: 988 },
      { char: "他", charIndex: 1, startMs: 1088, endMs: 1268 },
    ];
    expect(activeCharIndex(withGap, 1030)).toBe(0); // gap 期間停在「深」
  });

  it("單一元素", () => {
    const one: readonly CharTimestamp[] = [{ char: "夜", charIndex: 0, startMs: 0, endMs: 120 }];
    expect(activeCharIndex(one, -5)).toBe(-1);
    expect(activeCharIndex(one, 0)).toBe(0);
    expect(activeCharIndex(one, 500)).toBe(0);
  });

  it("空陣列 → -1", () => {
    expect(activeCharIndex([], 100)).toBe(-1);
  });

  it("大量字（千字章）binary search 仍正確", () => {
    // 每字 100ms：startMs = i*100
    const many: CharTimestamp[] = Array.from({ length: 1000 }, (_, i) => ({
      char: "字",
      charIndex: i,
      startMs: i * 100,
      endMs: i * 100 + 100,
    }));
    expect(activeCharIndex(many, 0)).toBe(0);
    expect(activeCharIndex(many, 49_950)).toBe(499); // 499*100=49900 <= 49950 < 50000
    expect(activeCharIndex(many, 99_900)).toBe(999);
    expect(activeCharIndex(many, 100_000)).toBe(999);
  });
});
