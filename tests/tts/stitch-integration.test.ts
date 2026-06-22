import { describe, it, expect } from "vitest";
import { chunkContent } from "@/src/tts/chunk";
import { azureWordsToChars } from "@/src/tts/azure-normalize";
import {
  BYTES_PER_MS,
  pcmBytesToMs,
  shiftCharTimestamps,
} from "@/src/tts/stitch";
import type { AzureBoundary, CharTimestamp } from "@/src/tts/types";

/**
 * 端到端「拼接」整合測試 —— 鏡像 synthesizeAzureChapter 的純函式管線
 * (chunkContent → azureWordsToChars(seg, -cpStart) → shiftCharTimestamps(+cumulativeMs)
 *  → flatten),但不打 Azure。各純函式已各自單測,本檔守護它們「組起來」後仍對齊,
 * 即卡拉OK高亮的三條命脈:
 *   1. 每個 charIndex = 該字在 [...plainText] 的 code-point index(全域對齊);
 *   2. startMs 跨 chunk seam 全程單調不減;
 *   3. 純空白中間 chunk 被跳過,不破壞後續 chunk 的 charIndex 對齊。
 * 另釘住 azureWordsToChars 第二參數的「負 offsetBase(= -cpStart)」刻意用法,
 * 避免日後被當成 sign bug「修正」而整章平移。
 */

// 把一段 chunk 文字模擬成 Azure Word boundary:以「非空白連續字串」為一個詞,
// textOffset = 該詞首字在 [...chunkText] 的 code-point index(段內相對,模擬 speakTextAsync)。
function fakeWordBoundaries(chunkText: string, msPerWord = 200): AzureBoundary[] {
  const cps = [...chunkText];
  const out: AzureBoundary[] = [];
  let startMs = 0;
  let i = 0;
  while (i < cps.length) {
    if (cps[i].trim() === "") {
      i++;
      continue;
    }
    const begin = i;
    let word = "";
    while (i < cps.length && cps[i].trim() !== "") {
      word += cps[i];
      i++;
    }
    out.push({
      text: word,
      textOffset: begin,
      wordLength: [...word].length,
      startMs,
      durationMs: msPerWord,
      type: "Word",
    });
    startMs += msPerWord;
  }
  return out;
}

// 鏡像 synthesizeAzureChapter 的逐段拼接;pcm 以「每詞固定 bytes」模擬該段真實時長。
function stitchChapter(
  plainText: string,
  maxCp: number,
  bytesPerWord: number,
): { chunks: readonly { text: string; cpStart: number }[]; skipped: number[]; chars: CharTimestamp[] } {
  const chunks = chunkContent(plainText, maxCp);
  const batches: (readonly CharTimestamp[])[] = [];
  const skipped: number[] = [];
  let cumulativeMs = 0;
  chunks.forEach((chunk, ci) => {
    if (chunk.text.trim() === "") {
      skipped.push(ci);
      return;
    }
    const boundaries = fakeWordBoundaries(chunk.text);
    const segChars = azureWordsToChars(boundaries, -chunk.cpStart);
    batches.push(shiftCharTimestamps(segChars, cumulativeMs));
    // 只用 PCM bytes 累積時間(絕不用 boundary ms),與 synthesizeAzureChapter 同。
    cumulativeMs += pcmBytesToMs(boundaries.length * bytesPerWord);
  });
  return { chunks, skipped, chars: batches.flat() };
}

describe("stitch 整合(chunk → normalize(-cpStart) → shift → flatten)", () => {
  // maxCp=4 下 "夜色\n\n\n\n\n\n他卻" 切成:
  //   "夜色\n\n"(cpStart 0) / "\n\n\n\n"(cpStart 4,純空白→跳過) / "他卻"(cpStart 8)。
  const plainText = "夜色\n\n\n\n\n\n他卻";
  const MAX_CP = 4;
  const BYTES_PER_WORD = BYTES_PER_MS * 300; // 每詞 300ms 的 PCM(整數毫秒)

  it("切出三段,中間段為純空白且被跳過", () => {
    const { chunks, skipped } = stitchChapter(plainText, MAX_CP, BYTES_PER_WORD);
    expect(chunks).toHaveLength(3);
    expect(chunks[1].text.trim()).toBe("");
    expect(skipped).toEqual([1]);
  });

  it("每個 charIndex 對齊 [...plainText] 的 code-point index", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, BYTES_PER_WORD);
    const cps = [...plainText];
    for (const ct of chars) {
      expect(cps[ct.charIndex]).toBe(ct.char);
    }
    // 只有非空白字進入輸出:夜(0) 色(1) 他(8) 卻(9)。
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1, 8, 9]);
    expect(chars.map((c) => c.char).join("")).toBe("夜色他卻");
  });

  it("startMs 跨 chunk seam 全程單調不減", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, BYTES_PER_WORD);
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i].startMs).toBeGreaterThanOrEqual(chars[i - 1].startMs);
    }
    // 後段(他卻)應被平移到第一段 PCM 時長(300ms)之後。
    const ta = chars.find((c) => c.char === "他");
    expect(ta?.startMs).toBe(300);
  });

  it("純空白中間段被跳過,不破壞後段(他卻)的 charIndex 對齊", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, BYTES_PER_WORD);
    const ta = chars.find((c) => c.char === "他");
    // = 它在 [...plainText] 的真實 index,證明跳過空白段後 cpStart 帳仍正確。
    expect(ta?.charIndex).toBe(8);
  });

  it("負 offsetBase(-cpStart)是刻意用法:還原全域 index 而非減去(勿當 sign bug 修)", () => {
    const seg: AzureBoundary[] = [
      {
        text: "他卻",
        textOffset: 0,
        wordLength: 2,
        startMs: 0,
        durationMs: 200,
        type: "Word",
      },
    ];
    const out = azureWordsToChars(seg, -8); // cpStart=8 → 傳 -8
    expect(out.map((c) => c.charIndex)).toEqual([8, 9]);
  });
});
