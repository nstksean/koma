/**
 * spike-tts-azure — Azure 雲端 TTS 中文「字級 timestamp」驗證（Speech SDK 版）。
 *
 * 背景（見 docs/meta/plans/mvp-stage0-plan.md §8.5、docs/meta/plans/04-stage3-tts-pipeline.md）：
 *   階段 3 聽書 = 預合成 audio file + char-level timestamp → native plugin 播 + 前端逐字高亮。
 *   過渡期先用 Azure 當「暫代音源」（之後換自家 IQT 只換音源、不重寫 player/同步/高亮）。
 *   核心賣點是逐字卡拉OK高亮，需要【字級】timestamp —— 中文無空格，必須確認 Azure 的
 *   WordBoundary 對中文是落在「單字（char）」還是「整詞」級別。本 spike 就驗這件事。
 *
 * 為什麼這版改用 SDK（與舊版純 REST 不同）：
 *   純 REST 同步 endpoint（/cognitiveservices/v1）只回 audio bytes，【不吐 WordBoundary 事件】，
 *   所以舊版只能驗「連通性」、把字級落點標 PENDING。本版改走
 *   microsoft-cognitiveservices-speech-sdk —— 它的 synthesizer.wordBoundary callback 會即時吐：
 *     - audioOffset：相對音檔起點的時間（100-ns tick，÷10000 = ms）
 *     - textOffset ：該 boundary 對應原文的 char index（UTF-16 起算）
 *     - wordLength ：這個 boundary 涵蓋幾個 char  ← 中文若每字=1 即「落字級」的判據
 *     - text       ：boundary 的文字片段
 *     - boundaryType：Word / Punctuation / Sentence（用來解釋標點為何不單獨成一字）
 *   這是「眼見為憑」一次釘死字級未知數的最短路；屬拋棄式 spike，故允許這支 devDep。
 *   （production 管線之後可改走 Batch synthesis 的 [n].word.json，欄位與這裡完全同構。）
 *
 * 跑法：  AZURE_TTS_KEY=<key> AZURE_TTS_REGION=<region> npm run spike:tts:azure
 *   需要環境變數（未設則印友善提示、以 exit 0 退出，不 crash）：
 *     AZURE_TTS_KEY     —— Azure Portal → komaTTS resource → 「Keys and Endpoint」的 KEY 1 / KEY 2
 *     AZURE_TTS_REGION  —— 同頁的 Location/Region，例 eastasia / japaneast / eastus
 *
 * 這是拋棄式驗證腳本，不接進 src/。沿用 scripts/spike-ttkan.ts 風格（async main + 結尾 catch）。
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

const TEST_TEXT = "夜色漸深,他卻毫無睡意。";
const VOICE = "zh-CN-XiaoxiaoNeural"; // 中文女聲；換 zh-TW-HsiaoChenNeural 可測台灣中文
// SDK 列舉對應舊版字串 "audio-24khz-48kbitrate-mono-mp3"
const OUT_FORMAT = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;

const TICKS_PER_MS = 10_000; // 100-ns tick → ms

/** 一筆實測 boundary：直接對應管線 timestamp JSON 的來源欄位。 */
interface CapturedBoundary {
  readonly text: string;
  readonly textOffsetCharIndex: number; // 原文 char index（UTF-16）
  readonly wordLengthChars: number; // 涵蓋幾個 char —— 中文若=1 即「字級」
  readonly startMs: number; // audioOffset_tick / 10000
  readonly durationMs: number; // duration_tick / 10000（0 表 SDK 未提供）
  readonly boundaryType: string; // Word / Punctuation / Sentence
}

function ssmlFor(text: string): string {
  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" `,
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">`,
    `<voice name="${VOICE}">${text}</voice></speak>`,
  ].join("");
}

function boundaryTypeLabel(t: sdk.SpeechSynthesisBoundaryType): string {
  switch (t) {
    case sdk.SpeechSynthesisBoundaryType.Word:
      return "Word";
    case sdk.SpeechSynthesisBoundaryType.Punctuation:
      return "Punctuation";
    case sdk.SpeechSynthesisBoundaryType.Sentence:
      return "Sentence";
    default:
      return `Other(${t})`;
  }
}

/**
 * 用 SDK 合成 TEST_TEXT，沿途收集 wordBoundary 事件。
 * 回傳實測 boundary 陣列 + 合成出的 mp3 bytes。
 */
function synthesizeWithBoundaries(
  key: string,
  region: string,
): Promise<{ boundaries: CapturedBoundary[]; audio: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechSynthesisVoiceName = VOICE;
    speechConfig.speechSynthesisOutputFormat = OUT_FORMAT;
    // 訂閱 wordBoundary 即會自動開啟 boundary 事件；此屬性顯式打開以防 SDK 版本差異。
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary,
      "true",
    );

    // Node 無預設喇叭：不給 AudioConfig，改從 result.audioData 取 bytes。
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    const collected: CapturedBoundary[] = [];
    synthesizer.wordBoundary = (_s, e) => {
      collected.push({
        text: e.text,
        textOffsetCharIndex: e.textOffset,
        wordLengthChars: e.wordLength,
        startMs: e.audioOffset / TICKS_PER_MS,
        // e.duration 在不同 SDK 版本為 tick（number）；缺值時記 0。
        durationMs: typeof e.duration === "number" ? e.duration / TICKS_PER_MS : 0,
        boundaryType: boundaryTypeLabel(e.boundaryType),
      });
    };

    synthesizer.speakSsmlAsync(
      ssmlFor(TEST_TEXT),
      (result) => {
        try {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const audio = new Uint8Array(result.audioData);
            synthesizer.close();
            resolve({ boundaries: [...collected], audio });
          } else {
            const detail = result.errorDetails ?? `reason=${result.reason}`;
            synthesizer.close();
            reject(new Error(`合成未完成：${detail}`));
          }
        } catch (err) {
          reject(err);
        }
      },
      (err) => {
        synthesizer.close();
        reject(new Error(`speakSsmlAsync 失敗：${err}`));
      },
    );
  });
}

/** 判定：扣掉標點/句界後，每個「字級 Word boundary」是否都 wordLength=1。 */
function verdictCharLevel(boundaries: readonly CapturedBoundary[]): {
  pass: boolean;
  wordCount: number;
  multiCharWords: CapturedBoundary[];
} {
  const words = boundaries.filter((b) => b.boundaryType === "Word");
  const multiCharWords = words.filter((b) => b.wordLengthChars !== 1);
  return {
    pass: words.length > 0 && multiCharWords.length === 0,
    wordCount: words.length,
    multiCharWords,
  };
}

function printBoundaryTable(boundaries: readonly CapturedBoundary[]): void {
  console.log("\n── 實測 wordBoundary 事件（共 " + boundaries.length + " 筆）──");
  console.log("   idx  off  len  type         start~end(ms)   text");
  boundaries.forEach((b, i) => {
    const end = (b.startMs + b.durationMs).toFixed(0);
    const row =
      `   [${String(i).padStart(2)}] ` +
      `${String(b.textOffsetCharIndex).padStart(3)} ` +
      `${String(b.wordLengthChars).padStart(3)}  ` +
      `${b.boundaryType.padEnd(11)} ` +
      `${b.startMs.toFixed(0).padStart(5)}~${end.padStart(5)}   ` +
      `"${b.text}"`;
    console.log(row);
  });
}

async function main() {
  console.log("\n🎙️  spike-tts-azure（SDK 版）— Azure 中文字級 timestamp 驗證\n" + "=".repeat(64));
  console.log(`測試文本：「${TEST_TEXT}」（${[...TEST_TEXT].length} 個 code point）`);
  console.log(`語音：${VOICE}｜輸出格式：Audio24Khz48KBitRateMonoMp3`);

  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;

  if (!key || !region) {
    console.log("\n⚠️  未偵測到 Azure 認證環境變數，跳過真打（這是預期行為，非錯誤）。");
    console.log("   需要設定以下兩個環境變數後重跑：");
    console.log("     AZURE_TTS_KEY     = <komaTTS resource 的 KEY 1 / KEY 2>");
    console.log("     AZURE_TTS_REGION  = <resource 的 Location/Region，例 eastasia / japaneast>");
    console.log("   取得：Azure Portal → komaTTS resource → 左側『Keys and Endpoint』。");
    console.log("   範例：AZURE_TTS_KEY=xxx AZURE_TTS_REGION=eastasia npm run spike:tts:azure");
    console.log("\n（SDK import 已成功載入，腳本可執行；設好 env 重跑即真打驗字級。）exit 0。");
    return; // 友善退出，非錯誤
  }

  console.log("\n🔊 [synthesize] 用 SDK 合成並收集 wordBoundary 事件 …");
  const { boundaries, audio } = await synthesizeWithBoundaries(key, region);
  console.log(`   ✅ 合成成功：${audio.byteLength} bytes mp3，收到 ${boundaries.length} 筆 boundary。`);

  // 存檔讓你能實際聽 + 確認音檔有效。
  const dir = mkdtempSync(join(tmpdir(), "koma-tts-"));
  const audioPath = join(dir, "azure-spike.mp3");
  writeFileSync(audioPath, audio);
  console.log(`   🎧 音檔已存：${audioPath}（可直接播放確認）`);

  printBoundaryTable(boundaries);

  const v = verdictCharLevel(boundaries);
  console.log("\n── 結論：char-level（字級）判定 ──");
  console.log(`   Word 類 boundary 數：${v.wordCount}（原文非標點漢字數應相近）`);
  if (v.pass) {
    console.log("   ✅ PASS：每個 Word boundary 都 wordLength=1 → Azure 對中文【落在字級】。");
    console.log("      → 卡拉OK逐字高亮可行：textOffset=原文 char index、audioOffset÷10000=ms。");
  } else if (v.wordCount === 0) {
    console.log("   ⚠️ 沒收到 Word 類 boundary —— 檢查 SDK 版本 / RequestWordBoundary 設定。");
  } else {
    console.log("   ❌ 有 Word boundary 的 wordLength≠1（落在『詞級』而非字級）：");
    v.multiCharWords.forEach((b) =>
      console.log(`      off=${b.textOffsetCharIndex} len=${b.wordLengthChars} "${b.text}"`),
    );
    console.log("      → 需在管線端把詞級 boundary 再切到字級（依字數均分時間，或改音源）。");
  }
}

main().catch((e) => {
  console.error(`\n❌ spike-tts-azure 失敗：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
