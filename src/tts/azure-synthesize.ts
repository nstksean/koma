import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { AzureBoundary, CharTimestamp } from "./types";
import { azureWordsToChars, utf16ToCodePointOffset } from "./azure-normalize";
import { chunkContent, type ContentChunk } from "./chunk";
import { pcmBytesToMs, shiftCharTimestamps } from "./stitch";
import { pcmPartsToWav, pcmTotalBytes } from "./wav";

/**
 * Azure 合成引擎產物(一章)。server-only:依賴 process.env 與 Node-only SDK,
 * 不可被 bundle 進 client,故本檔不從 src/tts/index.ts barrel 匯出。
 */
export interface AzureChapterResult {
  readonly wav: Buffer; // 完整 WAV(44-byte header + PCM)
  readonly charTimestamps: readonly CharTimestamp[]; // 全域 charIndex、全域 ms、按 startMs 遞增
  readonly durationMs: number; // = pcmBytesToMs(總 PCM bytes)
}

const SAMPLE_RATE = 24_000; // Raw24Khz16BitMonoPcm
const MAX_CODE_POINTS = 900; // 每段 code-point 上限(避開 Azure 單次音長上限)
const MAX_ATTEMPTS = 3; // 單段合成失敗重試上限
const RETRY_BASE_MS = 250; // 重試退避基數(指數退避 + jitter)
const TICKS_PER_MS = 10_000; // SDK 100-ns tick → ms

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 指數退避 + 隨機 jitter:避免對 Azure 連發重試加劇 throttle / thundering herd。 */
function backoffDelayMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * RETRY_BASE_MS);
}

/**
 * 把 SDK 的 boundaryType enum 映射成 AzureBoundary.type 字串(沿用 spike 的
 * boundaryTypeLabel)。⚠️ 若未映射成 "Word",azureWordsToChars 的
 * filter(type==="Word") 會濾光 → 整章空 charTimestamps(最易踩的雷)。
 * 非三類時退化為 "Word":boundaryType 未知時保守視為可高亮字,寧可保留 entry。
 */
function boundaryTypeLabel(
  t: sdk.SpeechSynthesisBoundaryType,
): AzureBoundary["type"] {
  switch (t) {
    case sdk.SpeechSynthesisBoundaryType.Word:
      return "Word";
    case sdk.SpeechSynthesisBoundaryType.Punctuation:
      return "Punctuation";
    case sdk.SpeechSynthesisBoundaryType.Sentence:
      return "Sentence";
    default:
      return "Word";
  }
}

/** 單段合成結果:raw PCM bytes + 段內(textOffset 從 0 起算)的 wordBoundary。 */
interface SegmentResult {
  readonly pcm: Uint8Array;
  readonly boundaries: readonly AzureBoundary[];
}

/**
 * 用 SDK 合成單段純文字 → raw PCM + 沿途收集 wordBoundary(段內相對)。
 * 不給 AudioConfig,從 result.audioData 取 bytes;finally close。
 */
function synthesizeSegment(
  key: string,
  region: string,
  voice: string,
  text: string,
): Promise<SegmentResult> {
  return new Promise((resolve, reject) => {
    const cfg = sdk.SpeechConfig.fromSubscription(key, region);
    cfg.speechSynthesisVoiceName = voice;
    cfg.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
    // 顯式打開 wordBoundary(防 SDK 版本差異)。
    cfg.setProperty(
      sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary,
      "true",
    );

    const synthesizer = new sdk.SpeechSynthesizer(cfg);
    const collected: AzureBoundary[] = [];

    synthesizer.wordBoundary = (_s, e) => {
      // e.textOffset/wordLength 是 UTF-16 code-unit 值(SDK 以 privRawText.indexOf
      // 計算)。下游 charIndex 對齊鐵則是 code-point 索引,故在源頭就把 textOffset
      // 淨化成段內 code-point offset;否則段內任一非 BMP 字會讓其後高亮整段平移。
      collected.push({
        text: e.text,
        textOffset: utf16ToCodePointOffset(text, e.textOffset), // 段內 code-point offset
        wordLength: e.wordLength,
        startMs: e.audioOffset / TICKS_PER_MS,
        durationMs: typeof e.duration === "number" ? e.duration / TICKS_PER_MS : 0,
        type: boundaryTypeLabel(e.boundaryType),
      });
    };

    synthesizer.speakTextAsync(
      text,
      (result) => {
        try {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const pcm = new Uint8Array(result.audioData);
            resolve({ pcm, boundaries: [...collected] });
          } else {
            const detail = result.errorDetails ?? `reason=${result.reason}`;
            reject(new Error(`Azure 合成未完成:${detail}`));
          }
        } catch (err) {
          reject(err);
        } finally {
          synthesizer.close();
        }
      },
      (err) => {
        synthesizer.close();
        reject(new Error(`speakTextAsync 失敗:${err}`));
      },
    );
  });
}

/** 單段合成 + 重試(最多 MAX_ATTEMPTS 次)。 */
async function synthesizeSegmentWithRetry(
  key: string,
  region: string,
  voice: string,
  text: string,
): Promise<SegmentResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await synthesizeSegment(key, region, voice, text);
    } catch (err) {
      lastErr = err;
      // 逐次失敗記在 server 端(含脈絡),不靜默吞掉;非末次則退避後重試。
      console.error(
        `[tts] Azure 單段合成失敗(attempt ${attempt}/${MAX_ATTEMPTS}, voice=${voice}, len=${text.length}):`,
        err instanceof Error ? err.message : String(err),
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }
  throw new Error(
    `Azure 單段合成連續 ${MAX_ATTEMPTS} 次失敗:${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** 逐段合成的累積結果:各段 PCM(順序保留)+ 各段已平移成全章絕對時間的 charTimestamp。 */
interface ChunkSynthesis {
  readonly parts: readonly Uint8Array[];
  readonly charBatches: readonly (readonly CharTimestamp[])[];
}

/**
 * 逐段序列合成(不可並行):保 PCM 順序 + 避 Azure 併發限制。
 * 每段 wordBoundary → azureWordsToChars(-cpStart) 得全域 charIndex →
 * shiftCharTimestamps(+cumulativeMs) 得全章絕對時間。cumulativeMs 只用
 * pcmBytesToMs 累積(絕不用 boundary ms):PCM 長度才是該段真實貢獻時長。
 */
async function synthesizeChunks(
  chunks: readonly ContentChunk[],
  key: string,
  region: string,
  voice: string,
): Promise<ChunkSynthesis> {
  const parts: Uint8Array[] = [];
  const charBatches: (readonly CharTimestamp[])[] = [];
  let cumulativeMs = 0;

  for (const chunk of chunks) {
    // 純空白/換行段:跳過合成,貢獻 0 PCM、0 boundary。cpStart 已由 chunkContent
    // 處理,charIndex 索引空間不受影響(後續段照樣對齊),無需補。
    if (chunk.text.trim() === "") continue;

    const { pcm, boundaries } = await synthesizeSegmentWithRetry(
      key,
      region,
      voice,
      chunk.text,
    );

    // 段內 textOffset 從 0 起算 → 傳 -cpStart 還原成全域 charIndex;
    // 段內相對時間 + 該段在音檔的起始 offset(cumulativeMs)→ 全章絕對時間。
    const segChars = azureWordsToChars(boundaries, -chunk.cpStart);
    charBatches.push(shiftCharTimestamps(segChars, cumulativeMs));

    parts.push(pcm);
    cumulativeMs += pcmBytesToMs(pcm.byteLength);
  }

  return { parts, charBatches };
}

/**
 * 把一章已清洗純文字合成成「音檔 + 逐字 timestamp」(04 §2.1.1 / §3)。
 *
 * 流程:chunkContent → synthesizeChunks(逐段序列合成 + 全章時間平移)→
 * pcmPartsToWav 直接把各段 PCM 封成 WAV(不先 merge 成全章 PCM,省一份全章拷貝)。
 *
 * 索引對齊鐵則:charTimestamps.charIndex 落在 [...plainText] 的 code-point 索引空間,
 * 與渲染端 [...chapterContent] 逐字編號一致。
 *
 * @param plainText 章節已清洗純文字(charIndex 索引空間 = [...plainText],含標點含 \n)
 * @param voice     Azure 音色 id(如 "zh-TW-HsiaoChenNeural")
 */
export async function synthesizeAzureChapter(
  plainText: string,
  voice: string,
): Promise<AzureChapterResult> {
  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;
  if (!key || !region) {
    throw new Error(
      "缺少 Azure 認證環境變數:請設定 AZURE_TTS_KEY 與 AZURE_TTS_REGION。",
    );
  }

  const chunks = chunkContent(plainText, MAX_CODE_POINTS);
  const { parts, charBatches } = await synthesizeChunks(chunks, key, region, voice);

  // 各段 PCM 直接封成 WAV(省掉中間 merged 全章拷貝);durationMs 用累計 byteLength。
  const wav = pcmPartsToWav(parts, SAMPLE_RATE);
  const durationMs = pcmBytesToMs(pcmTotalBytes(parts));
  // 各段 shifted 攤平:段序即時間序,天然按 startMs 遞增。
  const charTimestamps: readonly CharTimestamp[] = charBatches.flat();

  return { wav, charTimestamps, durationMs };
}
