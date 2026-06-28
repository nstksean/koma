import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
// SDK 內部模組(barrel 未匯出);用來強制走 npm `ws`,見下方 forceNpmWebSocket。
import { WebsocketMessageAdapter } from "microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common.browser/WebsocketMessageAdapter.js";
import type { AzureBoundary, CharTimestamp } from "./types";

/**
 * 強制 Azure SDK 用 npm `ws` 套件,而非 Node 的全域 WebSocket。
 *
 * Node ≥22(Vercel 預設 Node 24)暴露實驗性的全域 `WebSocket`(undici)。SDK 一偵測到
 * 全域 WebSocket 就優先用它(WebsocketMessageAdapter.js:71),但 undici 的 WebSocket 在
 * Vercel serverless 連 `wss://...speech.microsoft.com` 會間歇性以 1006 斷線
 * (「Unable to contact server」)→ 整條聽書 500。SDK 為此預留 forceNpmWebSocket 旗標,
 * 設 true 即改用穩定的 `ws`(SDK 既有相依)。server-only 模組,無人靠全域 WebSocket,安全。
 */
WebsocketMessageAdapter.forceNpmWebSocket = true;
import { azureWordsToChars, utf16ToCodePointOffset } from "./azure-normalize";
import { chunkContent, type ContentChunk } from "./chunk";
import { shiftCharTimestamps } from "./stitch";

/**
 * Azure 合成引擎產物(一章)。server-only:依賴 process.env 與 Node-only SDK,
 * 不可被 bundle 進 client,故本檔不從 src/tts/index.ts barrel 匯出。
 */
export interface AzureChapterResult {
  readonly mp3: Buffer; // 完整章節 MP3(各段 MP3 直接 Buffer.concat 串接)
  readonly charTimestamps: readonly CharTimestamp[]; // 全域 charIndex、全域 ms、按 startMs 遞增
  readonly durationMs: number; // = 各段 SDK audioDuration 累加
}

// 24kHz/48kbps mono MP3:取代舊 Raw24Khz16BitMonoPcm(384kbps WAV)→ 檔案小約 8×。
// ponytail: 48kbps 對單聲道語音夠用;要更高音質改 Audio24Khz96KBitRateMonoMp3。
const OUTPUT_FORMAT = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
const MAX_CODE_POINTS = 900; // 每段 code-point 上限(避開 Azure 單次音長上限)
const MAX_ATTEMPTS = 4; // 單段合成失敗重試上限(429 並發限制需多幾次讓連線槽空出)
const RETRY_BASE_MS = 250; // 一般錯誤退避基數(指數退避 + jitter)
// Azure 並發/速率上限(429)的退避基數。免費 F0 只允許 1 條並發連線:同實例多章
// 或跨實例同章一起合成時,落敗者會收到 wss 握手 429。一般 250ms 退避遠不夠等對方
// 那條(整章約 10–15s)釋出,故 429 改用較長退避(上限 MAX_BACKOFF_MS,仍在前端
// 45s 逾時內)。長治本仍是升級 Azure 方案(S0,200 並發)或改共享快取見部署文件。
const RATE_LIMIT_BASE_MS = 1_500;
const MAX_BACKOFF_MS = 6_000; // 退避上限,避免單段拖爆前端 45s 逾時
const TICKS_PER_MS = 10_000; // SDK 100-ns tick → ms

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** wss 握手被 Azure 以 429 拒絕(並發/速率上限)→ 用較長退避。 */
function isRateLimited(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes("429");
}

/** 指數退避 + 隨機 jitter;429 用較長基數並夾上限,避免對 Azure 連發重試加劇 throttle。 */
function backoffDelayMs(attempt: number, rateLimited: boolean): number {
  const base = rateLimited ? RATE_LIMIT_BASE_MS : RETRY_BASE_MS;
  const exp = Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return exp + Math.floor(Math.random() * base);
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

/**
 * 單段合成結果:該段 MP3 bytes + 段內(textOffset 從 0 起算)的 wordBoundary
 * + 該段真實時長(SDK audioDuration,格式無關 —— 取代舊「PCM byte 數換算」)。
 */
interface SegmentResult {
  readonly audio: Uint8Array;
  readonly durationMs: number;
  readonly boundaries: readonly AzureBoundary[];
}

/**
 * 用 SDK 合成單段純文字 → MP3 bytes + 沿途收集 wordBoundary(段內相對)。
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
    cfg.speechSynthesisOutputFormat = OUTPUT_FORMAT;
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
            const audio = new Uint8Array(result.audioData);
            // audioDuration 是 SDK 回報的該段真實渲染時長(ticks),與輸出格式無關 ——
            // 改用壓縮格式後不能再靠 byteLength 換算時長,這才是正確的跨段時間軸來源。
            const durationMs = result.audioDuration / TICKS_PER_MS;
            resolve({ audio, durationMs, boundaries: [...collected] });
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
        await sleep(backoffDelayMs(attempt, isRateLimited(err)));
      }
    }
  }
  throw new Error(
    `Azure 單段合成連續 ${MAX_ATTEMPTS} 次失敗:${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * 逐段合成的累積結果:各段 MP3(順序保留)、各段已平移成全章絕對時間的
 * charTimestamp,及全章總時長(各段 durationMs 累加)。
 */
interface ChunkSynthesis {
  readonly parts: readonly Uint8Array[];
  readonly charBatches: readonly (readonly CharTimestamp[])[];
  readonly totalMs: number;
}

/**
 * 逐段序列合成(不可並行):保音檔順序 + 避 Azure 併發限制。
 * 每段 wordBoundary → azureWordsToChars(-cpStart) 得全域 charIndex →
 * shiftCharTimestamps(+cumulativeMs) 得全章絕對時間。cumulativeMs 用各段
 * SDK audioDuration 累積(絕不用 boundary ms):那才是該段對音檔貢獻的真實時長。
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
    // 純空白/換行段:跳過合成,貢獻 0 音檔、0 boundary。cpStart 已由 chunkContent
    // 處理,charIndex 索引空間不受影響(後續段照樣對齊),無需補。
    if (chunk.text.trim() === "") continue;

    const { audio, durationMs, boundaries } = await synthesizeSegmentWithRetry(
      key,
      region,
      voice,
      chunk.text,
    );

    // 段內 textOffset 從 0 起算 → 傳 -cpStart 還原成全域 charIndex;
    // 段內相對時間 + 該段在音檔的起始 offset(cumulativeMs)→ 全章絕對時間。
    const segChars = azureWordsToChars(boundaries, -chunk.cpStart);
    charBatches.push(shiftCharTimestamps(segChars, cumulativeMs));

    parts.push(audio);
    cumulativeMs += durationMs;
  }

  return { parts, charBatches, totalMs: cumulativeMs };
}

/**
 * 把一章已清洗純文字合成成「音檔 + 逐字 timestamp」(04 §2.1.1 / §3)。
 *
 * 流程:chunkContent → synthesizeChunks(逐段序列合成 + 全章時間平移)→
 * Buffer.concat 把各段 MP3 直接串接成全章音檔。
 *
 * ⚠️ MP3 串接的已知天花板:每段 MP3 在解碼時各帶 ~編碼器前導靜音(encoder delay),
 * 串接處可能有極小間隙,使播放時間軸與 charTimestamps 隨段數累積微小偏移。章節分段
 * 大(MAX_CODE_POINTS=900,每段數分鐘),seam 少,通常無感;上線前用真實音檔驗一次
 * 高亮同步即可。若偏移有感,升級路徑:改回 PCM→自己封 WAV,或改 Opus/WebM 容器串接。
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
  const { parts, charBatches, totalMs } = await synthesizeChunks(
    chunks,
    key,
    region,
    voice,
  );

  // 各段 MP3 直接串接成全章音檔;durationMs = 各段 SDK audioDuration 累加。
  const mp3 = Buffer.concat(parts);
  // 各段 shifted 攤平:段序即時間序,天然按 startMs 遞增。
  const charTimestamps: readonly CharTimestamp[] = charBatches.flat();

  return { mp3, charTimestamps, durationMs: totalMs };
}
