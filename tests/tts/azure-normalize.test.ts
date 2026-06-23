import { describe, it, expect } from "vitest";
import {
  azureWordsToChars,
  utf16ToCodePointOffset,
} from "@/src/tts/azure-normalize";
import type { AzureBoundary } from "@/src/tts/types";

/**
 * azureWordsToChars — Azure 詞級 wordBoundary → 字級 CharTimestamp[]。
 * 三件事：過濾標點 / 依字數均分時間 / SSML-relative offset 正規化回純文字 index。
 * fixture 取自 spike 實測句「夜色漸深,他卻毫無睡意。」(04 §2.1)。
 */
describe("azureWordsToChars", () => {
  // 「夜色」「毫無」「睡意」各 wordLength=2；漸/深/他/卻 =1；逗號/句號為 Punctuation。
  // textOffset 模擬 SSML-relative（首字「夜」落 offsetBase 而非 0）。
  const OFFSET_BASE = 161;
  const boundaries: readonly AzureBoundary[] = [
    { text: "夜色", textOffset: 161, wordLength: 2, startMs: 50, durationMs: 400, type: "Word" },
    { text: "漸", textOffset: 163, wordLength: 1, startMs: 450, durationMs: 200, type: "Word" },
    { text: "深", textOffset: 164, wordLength: 1, startMs: 650, durationMs: 338, type: "Word" },
    { text: ",", textOffset: 165, wordLength: 1, startMs: 0, durationMs: 0, type: "Punctuation" },
    { text: "他", textOffset: 166, wordLength: 1, startMs: 1088, durationMs: 180, type: "Word" },
    { text: "卻", textOffset: 167, wordLength: 1, startMs: 1268, durationMs: 180, type: "Word" },
    { text: "毫無", textOffset: 168, wordLength: 2, startMs: 1448, durationMs: 400, type: "Word" },
    { text: "睡意", textOffset: 170, wordLength: 2, startMs: 1848, durationMs: 500, type: "Word" },
    { text: "。", textOffset: 172, wordLength: 1, startMs: 0, durationMs: 0, type: "Punctuation" },
  ];

  it("過濾標點：Punctuation / Sentence boundary 不進輸出", () => {
    const chars = azureWordsToChars(boundaries, OFFSET_BASE);
    expect(chars.every((c) => c.char !== "," && c.char !== "。")).toBe(true);
    // 8 個漢字（夜色漸深他卻毫無睡意），標點被濾掉
    expect(chars.map((c) => c.char).join("")).toBe("夜色漸深他卻毫無睡意");
  });

  it("依字數均分 2-char 詞的時間到字級", () => {
    const chars = azureWordsToChars(boundaries, OFFSET_BASE);
    // 「夜色」startMs=50 duration=400 → 夜 50~250、色 250~450
    const ye = chars.find((c) => c.char === "夜")!;
    const se = chars.find((c) => c.char === "色")!;
    expect(ye).toMatchObject({ startMs: 50, endMs: 250 });
    expect(se).toMatchObject({ startMs: 250, endMs: 450 });
  });

  it("單字詞 no-op：startMs/endMs = 原 boundary 時間", () => {
    const chars = azureWordsToChars(boundaries, OFFSET_BASE);
    const shen = chars.find((c) => c.char === "深")!;
    expect(shen).toMatchObject({ startMs: 650, endMs: 988 }); // 650 + 338
  });

  it("offset 正規化：textOffset - offsetBase 讓首字 charIndex 從 0 起", () => {
    const chars = azureWordsToChars(boundaries, OFFSET_BASE);
    expect(chars[0]).toMatchObject({ char: "夜", charIndex: 0 });
    expect(chars[1]).toMatchObject({ char: "色", charIndex: 1 });
    // charIndex 是「含標點全文」的 code-point index（Azure textOffset 語意）。
    // 逗號落在 index 4 但為 Punctuation 被濾掉 → 輸出在 4 留 gap，與 §3.2
    // 渲染建議 `[...text].map((c,i)=>data-ci={i})`（標點掛 data-ci 但不高亮）對齊。
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9, 10]);
  });

  it("輸出按 startMs 單調遞增（可直餵 binary search）", () => {
    const chars = azureWordsToChars(boundaries, OFFSET_BASE);
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i].startMs).toBeGreaterThanOrEqual(chars[i - 1].startMs);
    }
  });

  it("offsetBase=0：plain-text 輸入時 charIndex = textOffset", () => {
    const plain: readonly AzureBoundary[] = [
      { text: "夜色", textOffset: 0, wordLength: 2, startMs: 0, durationMs: 200, type: "Word" },
    ];
    const chars = azureWordsToChars(plain, 0);
    expect(chars.map((c) => c.charIndex)).toEqual([0, 1]);
  });

  it("未來相容：全 1-char 詞（IQT/Eleven 原生 per-char）= 均分為 no-op", () => {
    const perChar: readonly AzureBoundary[] = [
      { text: "夜", textOffset: 0, wordLength: 1, startMs: 0, durationMs: 100, type: "Word" },
      { text: "色", textOffset: 1, wordLength: 1, startMs: 100, durationMs: 100, type: "Word" },
    ];
    const chars = azureWordsToChars(perChar, 0);
    expect(chars).toEqual([
      { char: "夜", charIndex: 0, startMs: 0, endMs: 100 },
      { char: "色", charIndex: 1, startMs: 100, endMs: 200 },
    ]);
  });

  it("code-point 切字：非 BMP 字元用 [...] 不被切成 surrogate pair", () => {
    // 𠀀 (U+20000) 為 surrogate pair；確保 [...text] 而非 .split("")
    const surrogate: readonly AzureBoundary[] = [
      { text: "𠀀好", textOffset: 0, wordLength: 2, startMs: 0, durationMs: 200, type: "Word" },
    ];
    const chars = azureWordsToChars(surrogate, 0);
    expect(chars.map((c) => c.char)).toEqual(["𠀀", "好"]);
  });

  it("空輸入 → 空陣列", () => {
    expect(azureWordsToChars([], 0)).toEqual([]);
  });

  it("全 Punctuation / Sentence 輸入（無 Word）→ 空陣列", () => {
    const noWord: readonly AzureBoundary[] = [
      { text: "。", textOffset: 0, wordLength: 1, startMs: 0, durationMs: 0, type: "Punctuation" },
      { text: "", textOffset: 1, wordLength: 0, startMs: 0, durationMs: 0, type: "Sentence" },
    ];
    expect(azureWordsToChars(noWord, 0)).toEqual([]);
  });

  it("退化：durationMs=0 的多字 Word 仍保留每字 entry 與正確 charIndex", () => {
    // 刻意行為（非資料遺失）：per=0 → startMs=endMs 相同，但 entry 與 charIndex 完整。
    const zeroDur: readonly AzureBoundary[] = [
      { text: "夜色", textOffset: 0, wordLength: 2, startMs: 500, durationMs: 0, type: "Word" },
    ];
    expect(azureWordsToChars(zeroDur, 0)).toEqual([
      { char: "夜", charIndex: 0, startMs: 500, endMs: 500 },
      { char: "色", charIndex: 1, startMs: 500, endMs: 500 },
    ]);
  });
});

/**
 * utf16ToCodePointOffset — 把 SDK 的 UTF-16 textOffset 轉成段內 code-point offset。
 * Azure SDK 用 `privRawText.indexOf(text)`（UTF-16 語義）算 textOffset，但整條高亮
 * 對齊鐵則是 charIndex 落在 `[...text]` 的 code-point 索引空間。段內出現任一非 BMP
 * 字（佔 2 UTF-16 unit）時兩者開始分歧 → 此函式在進 azureWordsToChars 前淨化。
 */
describe("utf16ToCodePointOffset", () => {
  it("純 BMP 文字：UTF-16 offset = code-point offset（恆等）", () => {
    const t = "夜色漸深";
    expect(utf16ToCodePointOffset(t, 0)).toBe(0);
    expect(utf16ToCodePointOffset(t, 1)).toBe(1);
    expect(utf16ToCodePointOffset(t, 3)).toBe(3);
    expect(utf16ToCodePointOffset(t, 4)).toBe(4); // 結尾
  });

  it("非 BMP 字（U+20000 佔 2 UTF-16 unit）之後的 offset 被收斂回 code-point", () => {
    // "𠀀好嗎": 𠀀 佔 utf16 [0,1]; 好 在 utf16=2/cp=1; 嗎 在 utf16=3/cp=2
    const t = "𠀀好嗎";
    expect(utf16ToCodePointOffset(t, 0)).toBe(0); // 𠀀
    expect(utf16ToCodePointOffset(t, 2)).toBe(1); // 好（SDK 會回 utf16=2）
    expect(utf16ToCodePointOffset(t, 3)).toBe(2); // 嗎（SDK 會回 utf16=3）
    expect(utf16ToCodePointOffset(t, 5)).toBe(3); // 結尾
  });

  it("多個非 BMP 字累積偏移", () => {
    // "𠀀𠀁好": 兩個 surrogate pair 各佔 2 → 好 在 utf16=4/cp=2
    const t = "𠀀𠀁好";
    expect(utf16ToCodePointOffset(t, 4)).toBe(2);
  });

  it("offset 落在 surrogate pair 內部（不應發生，防禦性）→ 取所在字的 cp index", () => {
    // utf16=1 落在 𠀀 的 low surrogate；保守回 0（該字 code-point index）。
    const t = "𠀀好";
    expect(utf16ToCodePointOffset(t, 1)).toBe(0);
  });

  it("offset 超出長度 → 回總 code-point 數（夾住，不溢出）", () => {
    const t = "𠀀好";
    expect(utf16ToCodePointOffset(t, 99)).toBe(2);
  });
});
