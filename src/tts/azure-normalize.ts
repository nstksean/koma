import type { AzureBoundary, CharTimestamp } from "./types";

/**
 * 把 Azure 詞級 wordBoundary 攤平成字級 `CharTimestamp[]`（04 §2.1.1）。
 * 一次做三件事：
 *   1. 過濾標點（只留 type === "Word"，呼應 includesPunctuation:false）；
 *   2. 依字數均分多字詞的時間到字級（2-char 詞誤差 <~175ms/字，視覺無感）；
 *   3. 把 SSML-relative 的 textOffset 正規化回純文字 code-point index。
 *
 * 純函式、無副作用。boundaries 本就按 startMs 遞增 → 輸出已排序，可直餵
 * `activeCharIndex` 的 binary search（§5.1）。
 *
 * charIndex 採「含標點全文」的 code-point index 語意（Azure textOffset 即此），
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
