/**
 * TTS 音源層契約（換源切點，純 TS）。
 *
 * 兩層解耦：音源層（Azure / IQT / ElevenLabs）輸出統一的 `ChapterAudio`，
 * 播放管線層（PlayerEngine + 逐字高亮同步器）只認這個形狀。換音源
 * （Azure→IQT）= 只換實作 `AudioSourceProvider` 的那一個檔，player /
 * 同步 / 高亮一行不動。詳見 docs/meta/plans/04-stage3-tts-pipeline.md §2 / §3。
 *
 * 所有回傳皆為 immutable plain object（遵守 coding-style 不可變原則）。
 */

/** 已驗證的音源引擎 id（快取鍵的一部分，見 §4）。 */
export type TtsSource = "azure" | "iqt" | "eleven";

/**
 * 逐字 timing 的最小單位。`startMs`/`endMs` 對齊 audio 檔的「1.0× 毫秒」
 * 時間軸（變速不改寫，見 §5.2）。`charIndex` 的定義見 §3.2：針對「該章
 * 純文字、依 includesPunctuation 決定是否含標點」的 code-point index。
 */
export interface CharTimestamp {
  readonly char: string; // 單一漢字（或標點，視 includesPunctuation 而定）
  /**
   * 在「該章純文字（含標點）」中的 code-point index（§3.2）。
   * ⚠️ 索引空間恆含標點位置：標點佔一個 index 但通常無對應 CharTimestamp（不高亮），
   * 故 Word-only 輸出在標點處會留 gap。渲染端須 `[...text].map((c,i)=>data-ci={i})`
   * 對「含標點全文」編號，再對沒有 entry 的字（標點）略過高亮 —— 不可先去標點再編號。
   */
  readonly charIndex: number;
  readonly startMs: number; // 對齊 audio 的起始毫秒
  readonly endMs: number; // 結束毫秒（通常 = 下一字 startMs）
}

/**
 * 一章的合成產物 —— 任何音源都輸出這個形狀，上層只認它（§2 / §3.1）。
 */
export interface ChapterAudio {
  readonly schemaVersion: 1;
  readonly bookId: number;
  readonly chapterId: number;
  readonly source: TtsSource; // 哪個引擎合成的（快取鍵的一部分）
  readonly voice: string; // 音色 id
  readonly audioFileUrl: string; // 落地後的本機 / CDN 音檔路徑
  readonly durationMs: number;
  /**
   * 標點是否「擁有 CharTimestamp entry」（§3.2）。Azure 不單獨給標點 boundary →
   * `false`（標點無 entry、不高亮）。⚠️ 注意：`false` **不代表** charIndex 是
   * 去標點後的索引 —— charIndex 永遠是「含標點全文」的 code-point index（見
   * CharTimestamp.charIndex）。provider 與渲染必須共用此約定，否則整章 index 錯位。
   */
  readonly includesPunctuation: boolean;
  readonly charTimestamps: readonly CharTimestamp[]; // 逐字 timing（按 startMs 遞增）
}

/** `synthesizeChapter` 的輸入（已清洗的章節純文字，沿用 02 的清洗結果）。 */
export interface SynthesizeInput {
  readonly bookId: number;
  readonly chapterId: number;
  readonly plainText: string;
  readonly voice: string;
}

/**
 * 音源抽象：換源只換實作這個介面的檔，player / 高亮不動（§2 / §6）。
 * 各 provider 內部「timing 從哪來」不同（Azure=詞級 boundary 均分；
 * IQT=forced alignment；Eleven=原生 per-char），但對上層形狀一致。
 */
export interface AudioSourceProvider {
  readonly id: TtsSource;
  /** 把一章純文字合成成「音檔 + 逐字 timestamp」。 */
  synthesizeChapter(input: SynthesizeInput): Promise<ChapterAudio>;
}

/**
 * Azure Speech SDK `wordBoundary` 事件的最小形狀（spike 實測欄位，§2.1.1）。
 * ⚠️ Azure 對中文落「詞級」非字級，且 textOffset 為 SSML-relative。
 * 正規化由 `azureWordsToChars` 處理（src/tts/azure-normalize.ts）。
 */
export interface AzureBoundary {
  readonly text: string; // 該 boundary 文字，中文可能 1–2 字
  readonly textOffset: number; // ⚠️ 相對整個 SSML 字串（含前綴），非純文字
  readonly wordLength: number; // 涵蓋 char 數；僅供參考，azureWordsToChars 以 [...text].length 為準
  readonly startMs: number; // audioOffset / 10000
  readonly durationMs: number; // duration / 10000
  readonly type: "Word" | "Punctuation" | "Sentence";
}

// ── 里程碑 A（web 前景聽書）client-facing 契約（凍結接縫，§平行契約 2） ──
// 這些型別是 server（lib/tts.ts、route）與 client（audio-player）的耦合面。
// 不含 server-only 依賴，故 client component 可安全 import。

/**
 * timestamps route（`/api/tts/.../timestamps`）回傳形狀，亦為 client 高亮所需的最小資料。
 * charTimestamps 按 startMs 遞增（直接餵 `activeCharIndex`）。
 */
export interface TimestampsPayload {
  readonly durationMs: number;
  readonly includesPunctuation: boolean;
  readonly charTimestamps: readonly CharTimestamp[];
}

/**
 * orchestrator（`getChapterAudioMeta`）對外回傳的章節音訊 meta。
 * `audioUrl` 直接餵 `<audio src>`；其餘欄位同 `TimestampsPayload`。
 */
export interface ChapterAudioMeta extends TimestampsPayload {
  readonly source: TtsSource; // 合成引擎（"azure"），非書源
  readonly voice: string;
  readonly audioUrl: string;
}
