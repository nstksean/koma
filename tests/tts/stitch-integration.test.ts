import { describe, it, expect } from "vitest";
import { chunkContent } from "@/src/tts/chunk";
import {
  azureWordsToChars,
  utf16ToCodePointOffset,
} from "@/src/tts/azure-normalize";
import { shiftCharTimestamps } from "@/src/tts/stitch";
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

// 鏡像 synthesizeAzureChapter 的逐段拼接;每段時長以「每詞固定 ms」模擬 SDK audioDuration。
function stitchChapter(
  plainText: string,
  maxCp: number,
  msPerWord: number,
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
    // 用各段真實時長累積(絕不用 boundary ms),與 synthesizeAzureChapter 同。
    cumulativeMs += boundaries.length * msPerWord;
  });
  return { chunks, skipped, chars: batches.flat() };
}

describe("stitch 整合(chunk → normalize(-cpStart) → shift → flatten)", () => {
  // maxCp=4 下 "夜色\n\n\n\n\n\n他卻" 切成:
  //   "夜色\n\n"(cpStart 0) / "\n\n\n\n"(cpStart 4,純空白→跳過) / "他卻"(cpStart 8)。
  const plainText = "夜色\n\n\n\n\n\n他卻";
  const MAX_CP = 4;
  const MS_PER_WORD = 300; // 每詞 300ms 的合成時長

  it("切出三段,中間段為純空白且被跳過", () => {
    const { chunks, skipped } = stitchChapter(plainText, MAX_CP, MS_PER_WORD);
    expect(chunks).toHaveLength(3);
    expect(chunks[1].text.trim()).toBe("");
    expect(skipped).toEqual([1]);
  });

  it("每個 charIndex 對齊 [...plainText] 的 code-point index", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, MS_PER_WORD);
    const cps = [...plainText];
    for (const ct of chars) {
      expect(cps[ct.charIndex]).toBe(ct.char);
    }
    // 只有非空白字進入輸出:夜(0) 色(1) 他(8) 卻(9)。
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1, 8, 9]);
    expect(chars.map((c) => c.char).join("")).toBe("夜色他卻");
  });

  it("startMs 跨 chunk seam 全程單調不減", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, MS_PER_WORD);
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i].startMs).toBeGreaterThanOrEqual(chars[i - 1].startMs);
    }
    // 後段(他卻)應被平移到第一段時長(300ms)之後。
    const ta = chars.find((c) => c.char === "他");
    expect(ta?.startMs).toBe(300);
  });

  it("純空白中間段被跳過,不破壞後段(他卻)的 charIndex 對齊", () => {
    const { chars } = stitchChapter(plainText, MAX_CP, MS_PER_WORD);
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

/**
 * 非 BMP 字端到端對齊（鏡像 synthesizeSegment 的「收 boundary 即 UTF-16→code-point」
 * 淨化步驟 + azureWordsToChars(-cpStart) 拼接）。fakeWordBoundaries16 用【真 UTF-16
 * textOffset】(模擬 SDK 的 indexOf 語義)製造 boundary，重現實際 bug 觸發條件。
 *
 * 守護:chunk 內含 surrogate pair 字（U+20000）時,其後每個詞的 charIndex 仍對齊
 * [...content] 的 code-point index（不因每個非 BMP 字累積 +1 而整段後移）。
 */
// 以「非空白連續字串」為詞;textOffset = 該詞首字在 chunkText 的【UTF-16 code-unit】
// offset（鏡像 Azure SDK privRawText.indexOf(text) 的真實語義,故非 BMP 字後會 +1）。
function fakeWordBoundaries16(chunkText: string, msPerWord = 200): AzureBoundary[] {
  const cps = [...chunkText];
  const out: AzureBoundary[] = [];
  let startMs = 0;
  let i = 0;
  while (i < cps.length) {
    if (cps[i].trim() === "") {
      i++;
      continue;
    }
    const word: string[] = [];
    while (i < cps.length && cps[i].trim() !== "") {
      word.push(cps[i]);
      i++;
    }
    const w = word.join("");
    out.push({
      text: w,
      textOffset: chunkText.indexOf(w), // UTF-16 offset(SDK 語義)
      wordLength: w.length, // UTF-16 length(SDK 語義,僅參考)
      startMs,
      durationMs: msPerWord,
      type: "Word",
    });
    startMs += msPerWord;
  }
  return out;
}

// 鏡像 synthesizeSegment + synthesizeAzureChapter 的新拼接路徑:
// 收 boundary 時先把 UTF-16 textOffset 淨化成段內 code-point offset,再餵 normalize。
function stitchChapter16(plainText: string, maxCp: number): CharTimestamp[] {
  const chunks = chunkContent(plainText, maxCp);
  const batches: (readonly CharTimestamp[])[] = [];
  let cumulativeMs = 0;
  for (const chunk of chunks) {
    if (chunk.text.trim() === "") continue;
    const raw = fakeWordBoundaries16(chunk.text);
    // synthesizeSegment 的淨化步驟:textOffset(UTF-16) → 段內 code-point offset。
    const boundaries = raw.map((b) => ({
      ...b,
      textOffset: utf16ToCodePointOffset(chunk.text, b.textOffset),
    }));
    const segChars = azureWordsToChars(boundaries, -chunk.cpStart);
    batches.push(shiftCharTimestamps(segChars, cumulativeMs));
    cumulativeMs += boundaries.length * 300;
  }
  return batches.flat();
}

describe("非 BMP 字端到端對齊(UTF-16 textOffset → code-point 淨化)", () => {
  it("單一 chunk 內含 U+20000:其後每字 charIndex 仍對齊 [...content]", () => {
    // 𠀀(U+20000)在開頭 → 之後「好嗎他卻」全部會因 SDK UTF-16 offset 而 +1（若未淨化）。
    const plainText = "𠀀好嗎他卻";
    const chars = stitchChapter16(plainText, 900);
    const cps = [...plainText];
    for (const ct of chars) {
      expect(cps[ct.charIndex]).toBe(ct.char); // 鐵則:cps[charIndex] 必須等於該字
    }
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(chars.map((c) => c.char).join("")).toBe("𠀀好嗎他卻");
  });

  it("多個非 BMP 字夾雜 BMP:charIndex 全程對齊,不累積偏移", () => {
    const plainText = "天𠀀地𠀁人";
    const chars = stitchChapter16(plainText, 900);
    const cps = [...plainText];
    for (const ct of chars) {
      expect(cps[ct.charIndex]).toBe(ct.char);
    }
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("非 BMP 字跨多 chunk:每段 cpStart 還原後仍對齊", () => {
    // maxCp=3 把 "𠀀好嗎天地" 切成多段;非 BMP 在前段,守護跨段對齊。
    const plainText = "𠀀好嗎天地";
    const chars = stitchChapter16(plainText, 3);
    const cps = [...plainText];
    for (const ct of chars) {
      expect(cps[ct.charIndex]).toBe(ct.char);
    }
    expect(chars.map((c) => c.char).join("")).toBe("𠀀好嗎天地");
  });
});
