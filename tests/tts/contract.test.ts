import { describe, it, expect } from "vitest";
import {
  activeCharIndex,
  azureWordsToChars,
  type AudioSourceProvider,
  type AzureBoundary,
  type ChapterAudio,
} from "@/src/tts";

/**
 * 換源切點契約（04 §2 / §6）：任何 provider 輸出統一的 ChapterAudio，
 * 同步器只認這個形狀。本測試證明骨架端到端連通 —— mock provider 產出
 * ChapterAudio，charTimestamps 直接餵 activeCharIndex 命中正確字。
 */
describe("AudioSourceProvider 契約 → 同步器", () => {
  // 模擬 Azure provider：內部用 azureWordsToChars 把詞級 boundary 攤成字級。
  const fakeAzureProvider: AudioSourceProvider = {
    id: "azure",
    async synthesizeChapter(input) {
      const boundaries: readonly AzureBoundary[] = [
        { text: "夜色", textOffset: 0, wordLength: 2, startMs: 0, durationMs: 400, type: "Word" },
        { text: "深", textOffset: 2, wordLength: 1, startMs: 400, durationMs: 200, type: "Word" },
        // 標點 boundary：provider 過濾掉、不進 charTimestamps（includesPunctuation:false）
        { text: "。", textOffset: 3, wordLength: 1, startMs: 0, durationMs: 0, type: "Punctuation" },
      ];
      const charTimestamps = azureWordsToChars(boundaries, 0);
      return {
        schemaVersion: 1,
        bookId: input.bookId,
        chapterId: input.chapterId,
        source: "azure",
        voice: input.voice,
        audioFileUrl: "456.mp3",
        durationMs: 600,
        includesPunctuation: false,
        charTimestamps,
      };
    },
  };

  it("provider 輸出 ChapterAudio，同步器可直接消費其 charTimestamps", async () => {
    const audio: ChapterAudio = await fakeAzureProvider.synthesizeChapter({
      bookId: 123,
      chapterId: 456,
      plainText: "夜色深",
      voice: "zh-CN-XiaoxiaoNeural",
    });

    expect(audio.source).toBe("azure");
    // 標點被 provider 濾掉，charTimestamps 只含可高亮的漢字
    expect(audio.charTimestamps.map((c) => c.char).join("")).toBe("夜色深");
    expect(audio.includesPunctuation).toBe(false);

    // 換源切點主張：上層（同步器）只認 ChapterAudio.charTimestamps，不知道音源是誰。
    const idx = activeCharIndex(audio.charTimestamps, 450); // 「深」期間
    expect(audio.charTimestamps[idx].char).toBe("深");
  });
});
