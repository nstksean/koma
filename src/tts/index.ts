/**
 * TTS 音源層公開介面（階段 3）。上層（player / 同步器 / 快取）只從這裡 import。
 * 換源（Azure→IQT）= 新增一個實作 `AudioSourceProvider` 的 provider 檔，
 * 不動本 barrel 對外暴露的型別與同步器。見 docs/meta/plans/04-stage3-tts-pipeline.md。
 */

export type {
  TtsEngine,
  CharTimestamp,
  ChapterAudio,
  SynthesizeInput,
  AudioSourceProvider,
  AzureBoundary,
  TimestampsPayload,
  ChapterAudioMeta,
} from "./types";

export { azureWordsToChars } from "./azure-normalize";
export { activeCharIndex } from "./sync";
export { ttsAudioUrl, ttsTimestampsUrl } from "./urls";
// 注意：azure-synthesize 是 server-only，刻意不從此 barrel 匯出（勿在純測試/ client 環境 import）。
