import type { AzureBoundary, CharTimestamp } from "./types";

/**
 * 把段內「UTF-16 code-unit」offset 轉成「code-point」offset（04 §2.1.1）。
 *
 * 為什麼需要:Azure SDK 用 `privRawText.indexOf(text)` 算 `wordBoundary.textOffset`,
 * 而 JS `String.indexOf`/`.length` 皆為 UTF-16 語義。但整條高亮對齊鐵則是 charIndex
 * 落在 `[...text]` 的 **code-point** 索引空間（見 types.ts CharTimestamp.charIndex、
 * azure-synthesize.ts 索引對齊鐵則）。段內出現任一非 BMP 字（CJK Ext-B 如 𠀀、emoji,
 * 各佔 2 個 UTF-16 unit）時,其後所有 textOffset 會比 code-point index 多算 surrogate
 * 數,若直接相加會讓該段後續每字 charIndex 整段後移。本函式在進 `azureWordsToChars`
 * 前把 UTF-16 offset 淨化回 code-point offset,消除此偏移。
 *
 * 純函式。掃一次 `[...text]` 累加各字 `.length`（BMP=1、surrogate pair=2),回傳
 * 「`text` 前 `utf16Offset` 個 code-unit 內含幾個完整 code-point」。
 * 防禦:offset 落在 surrogate pair 內部 → 回該字 code-point index;offset 超界 → 夾到
 * 總 code-point 數;純 BMP 文字下恆等（offset 不變),故不影響既有中文正文。
 *
 * @param text        段內純文字（speakTextAsync 的輸入,textOffset 即相對它）。
 * @param utf16Offset SDK 給的 UTF-16 textOffset。
 */
export function utf16ToCodePointOffset(text: string, utf16Offset: number): number {
  let unit = 0; // 當前字 ch 的起始 UTF-16 offset
  let cp = 0; // 當前字 ch 的 code-point index
  for (const ch of text) {
    if (unit === utf16Offset) return cp; // 正落字邊界:回該字 cp index
    if (unit > utf16Offset) return cp - 1; // 落在前一字的 surrogate pair 內部:回前一字
    unit += ch.length; // BMP=1、surrogate pair=2
    cp += 1;
  }
  return cp; // offset >= text 的 UTF-16 長度 → 夾到總 code-point 數
}

/**
 * 把 Azure 詞級 wordBoundary 攤平成字級 `CharTimestamp[]`（04 §2.1.1）。
 * 一次做三件事：
 *   1. 過濾標點（只留 type === "Word"，呼應 includesPunctuation:false）；
 *   2. 依字數均分多字詞的時間到字級（2-char 詞誤差 <~175ms/字，視覺無感）；
 *   3. 把段內 code-point textOffset 正規化回全域純文字 code-point index。
 *
 * 純函式、無副作用。boundaries 本就按 startMs 遞增 → 輸出已排序，可直餵
 * `activeCharIndex` 的 binary search（§5.1）。
 *
 * ⚠️ 前置：`b.textOffset` 必須已是「段內 code-point offset」（由 synthesizeSegment
 * 以 utf16ToCodePointOffset 淨化;SDK 原始值是 UTF-16,直接用會在非 BMP 字後平移）。
 *
 * charIndex 採「含標點全文」的 code-point index 語意（Azure textOffset 淨化後即此），
 * 標點位置會在 Word-only 輸出中留 gap，與 §3.2 渲染建議
 * `[...text].map((c,i)=><span data-ci={i}>)`（標點掛 data-ci 但不高亮）對齊。
 *
 * 未來相容：IQT / ElevenLabs 若原生 per-char（wordLength=1），均分對它們是
 * no-op（每詞一字、均分=原值），免費複用同一條正規化路徑。
 *
 * @param boundaries Azure SDK wordBoundary 事件（或 Batch 的 `[n].word.json`，欄位同構）。
 * @param offsetBase SSML 前綴長度。用 speakTextAsync 純文字輸入時為 0；
 *                   用 speakSsmlAsync 時 = ssmlPrefix.length。算錯會整章 charIndex 平移錯位。
 *                   ⚠️ 亦可為「負值」:逐段合成(synthesizeAzureChapter)時呼叫端傳
 *                   `-cpStart`(段首在原文的 code-point index 取負),使
 *                   `textOffset - offsetBase` 變成「加回 cpStart」以還原全域 charIndex。
 *                   這是刻意的 sign overload,勿當成 bug「修正」(會整章平移)。見
 *                   tests/tts/stitch-integration.test.ts。
 */
export function azureWordsToChars(
  boundaries: readonly AzureBoundary[],
  offsetBase: number,
): readonly CharTimestamp[] {
  return boundaries
    .filter((b) => b.type === "Word")
    .flatMap((b): CharTimestamp[] => {
      const chars = [...b.text]; // code-point 切，避免 surrogate pair 出錯
      // 依字數均分。退化情形 durationMs=0（瞬時詞）→ per=0，每字仍保留 entry 與正確
      // charIndex（index 完整性優先），僅 startMs=endMs 相同，高亮會停在該詞末字。
      const per = b.durationMs / chars.length;
      return chars.map((c, k): CharTimestamp => {
        const start = b.startMs + per * k;
        return {
          char: c,
          charIndex: b.textOffset - offsetBase + k, // 正規化回純文字 index
          startMs: Math.round(start),
          endMs: Math.round(start + per),
        };
      });
    });
}
