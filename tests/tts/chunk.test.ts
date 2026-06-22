import { describe, it, expect } from "vitest";
import { chunkContent } from "@/src/tts/chunk";
import type { ContentChunk } from "@/src/tts/chunk";

/**
 * chunkContent — 章節純文字分塊(Workstream A)。
 * 重點:round-trip 無損(join===content)、cpStart 連續無 gap/重疊、絕不 trim、
 * \n 邊界切在換行之後、超長無 \n 硬切、surrogate pair 用 [...] 不被切壞。
 */
describe("chunkContent", () => {
  /** 連續性不變式:每塊 cpStart === 前一塊 cpStart + 前一塊 code-point 長度。 */
  function assertContiguous(chunks: readonly ContentChunk[]): void {
    for (let k = 1; k < chunks.length; k++) {
      const prevLen = [...chunks[k - 1].text].length;
      expect(chunks[k].cpStart).toBe(chunks[k - 1].cpStart + prevLen);
    }
  }

  /** round-trip:串回去必須完全等於原文(絕不丟字、絕不 trim)。 */
  function assertRoundTrip(content: string, chunks: readonly ContentChunk[]): void {
    expect(chunks.map((c) => c.text).join("")).toBe(content);
  }

  it("空字串 → []", () => {
    expect(chunkContent("")).toEqual([]);
  });

  it("短文不切:單一塊,cpStart=0,text=原文", () => {
    const content = "夜色漸深,他卻毫無睡意。";
    const chunks = chunkContent(content, 900);
    expect(chunks).toEqual([{ text: content, cpStart: 0 }]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("多段 \\n 邊界:在最後一個換行之後切(含 \\n)", () => {
    // max=5。「一二三\n」=4 cp,窗 [0,5) 內最後一個 \n 在 index 3 → 切到 4(含 \n)。
    const content = "一二三\n四五六\n七八";
    const chunks = chunkContent(content, 5);
    expect(chunks).toEqual([
      { text: "一二三\n", cpStart: 0 },
      { text: "四五六\n", cpStart: 4 },
      { text: "七八", cpStart: 8 },
    ]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("超長無 \\n:硬切到窗尾", () => {
    // 10 個漢字、無換行、max=4 → 4/4/2 硬切。
    const content = "零一二三四五六七八九";
    const chunks = chunkContent(content, 4);
    expect(chunks.map((c) => c.text)).toEqual(["零一二三", "四五六七", "八九"]);
    expect(chunks.map((c) => c.cpStart)).toEqual([0, 4, 8]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("\\n 正好落在 max 邊界(窗尾即換行):切到含該換行", () => {
    // max=4。窗 [0,4) = 「一二三\n」,最後一個 \n 在 index 3(=windowEnd-1)→ 切到 4。
    const content = "一二三\n四五";
    const chunks = chunkContent(content, 4);
    expect(chunks).toEqual([
      { text: "一二三\n", cpStart: 0 },
      { text: "四五", cpStart: 4 },
    ]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("換行就在塊首(nl===i):不在塊首切(避免空塊),改切到窗尾", () => {
    // 連續換行:第二塊起點正好是 \n。max=3。
    // cps: 0:一 1:二 2:三 3:\n 4:\n 5:四
    // 塊1 窗[0,3) 無 \n → 切到 3 = 「一二三」。
    // 塊2 起點 i=3,窗[3,6),最後 \n 在 index4>3 → 切到 5 = 「\n\n」。
    // 塊3 起點 i=5,窗[5,6) 無 \n → 「四」。
    const content = "一二三\n\n四";
    const chunks = chunkContent(content, 3);
    expect(chunks.map((c) => c.text)).toEqual(["一二三", "\n\n", "四"]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("絕不 trim:保留前後與段內的半形空格與換行(round-trip 不丟任何空白)", () => {
    // 含兩個 \n → max=900 一窗內會切在最後一個 \n 之後;重點是空白完整保留、無損。
    const content = "  前導空白\n  縮排段  \n尾段  ";
    const chunks = chunkContent(content, 900);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
    // 切點落在最後一個 \n 之後:第一塊以 \n 結尾,且尾段前導空白未被 trim。
    expect(chunks).toEqual([
      { text: "  前導空白\n  縮排段  \n", cpStart: 0 },
      { text: "尾段  ", cpStart: 15 },
    ]);
  });

  it("連續空行(純 \\n)也完整保留、round-trip 無損", () => {
    const content = "\n\n\n";
    const chunks = chunkContent(content, 2);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
    // 每塊都非空(無空塊)。
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
  });

  it("surrogate pair:用 [...] 切,非 BMP 字元不被拆成半個", () => {
    // 𠀀 (U+20000) 為 surrogate pair(UTF-16 佔 2 code unit、1 code point)。
    const content = "𠀀好𠀀世界";
    const chunks = chunkContent(content, 2);
    // 每塊 2 個 code point;無任何塊含落單的 surrogate(透過 [...] 重切驗證)。
    expect(chunks.map((c) => [...c.text].length)).toEqual([2, 2, 1]);
    expect(chunks.map((c) => c.cpStart)).toEqual([0, 2, 4]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("cpStart 落在 surrogate pair 邊界仍正確(code-point 而非 UTF-16 index)", () => {
    const content = "𠀀𠀀𠀀𠀀";
    const chunks = chunkContent(content, 1);
    // 4 個 code point,各自一塊;cpStart 必為 0/1/2/3(非 0/2/4/6)。
    expect(chunks.map((c) => c.cpStart)).toEqual([0, 1, 2, 3]);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("預設 maxCodePoints=900:>900 字會被切多塊", () => {
    const content = "字".repeat(2000);
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => [...c.text].length <= 900)).toBe(true);
    assertRoundTrip(content, chunks);
    assertContiguous(chunks);
  });

  it("round-trip 對多種輸入皆成立(含混合標點/換行/空白/surrogate)", () => {
    const cases = [
      "純文字無換行測試句子",
      "段一\n段二\n段三",
      "  含空白  \n  與換行  ",
      "𠀀混合BMP與非BMP好世界",
      "標點,測試。引號「你好」!?…",
      "\n",
      "a\nb\nc\nd\ne",
    ];
    for (const content of cases) {
      for (const max of [1, 2, 3, 5, 7, 900]) {
        const chunks = chunkContent(content, max);
        assertRoundTrip(content, chunks);
        assertContiguous(chunks);
        expect(chunks.every((c) => c.text.length > 0)).toBe(true);
      }
    }
  });
});
