/**
 * spike-tts-iqt — 自家 IQT TTS（voai.ai VoiceAPI v1）「字級 timestamp」驗證。【整個產品最高槓桿的未驗證項】
 *
 * 結論（2026-06-16 真打）：⛔ **voai.ai VoiceAPI v1 不回傳任何 timestamp。**
 *   `/TTS/Speech`（簡易）與 `/TTS/generate-voice`（進階）都只回 `audio/wav` 二進位音檔,
 *   回應 header 僅有 `x-bit-depth / x-channels / x-sample-rate / x-used-quota`,
 *   body 是純 RIFF/WAVE PCM —— 沒有 word/char boundary、沒有 subtitle/SRT/VTT、沒有 alignment。
 *   整份 OpenAPI spec（/swagger/tts/swagger.json）grep timestamp|subtitle|align|boundary|word|mark 全無。
 *   → 逐字卡拉OK高亮【無法】直接靠 IQT 的 timestamp 驅動。前進路線見本檔結尾「VERDICT」與
 *     docs/meta/plans/04-stage3-tts-pipeline.md（forced alignment / 內部請 voai 團隊加字幕輸出）。
 *
 * 本 spike 仍保留為「可重跑的真打驗證」:任何時候跑 `npm run spike:tts:iqt` 都會重新打 API、
 *   印出回應形狀,讓「IQT 是否已新增 timestamp 輸出」這件事隨時可被重新確認。
 *
 * API 摘要(實測):
 *   base   = IQT_TTS_ENDPOINT（例 https://connect.voai.ai）
 *   auth   = header `x-api-key: <IQT_TTS_KEY>`              （非 Bearer）
 *   配額   = GET  /Key/Usage        → { data: { total, current, expiration } }
 *   配音員 = GET  /TTS/GetSpeaker    → models[].speakers[]（依 model version 分組:Classic/Neo/Sota+）
 *   合成   = POST /TTS/Speech        → audio/wav（version 為必填!speaker/style 須與 version 對應）
 *
 * 跑法:  npm run spike:tts:iqt      （憑證讀 .env.local;缺 env 則友善退出 exit 0,不真打）
 * 不新增 npm dep;用 Node 內建 fetch。沿用 scripts/spike-ttkan.ts / spike-tts-azure.ts 風格。
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export {}; // 讓本檔為獨立 module(隔離 scope,避免與其他 spike script 的頂層宣告跨檔撞名)

const TEST_TEXT = "夜色漸深,他卻毫無睡意。"; // 與 Azure spike 同文本,方便對照
const SPEAKER = "雨榛";
const STYLE = "預設";
const MODEL_VERSION = "Classic"; // /TTS/Speech 的 version 為必填,且須與 speaker 所屬 model 對應

/** 與管線共用的目標形狀:char-level timestamp（換源後 player/高亮看的就是這個）。 */
interface CharTimestamp {
  readonly char: string;
  readonly charIndex: number;
  readonly startMs: number;
  readonly endMs: number;
}

interface IqtSpeechResult {
  readonly status: number;
  readonly contentType: string;
  readonly audioBytes: number;
  readonly headers: Readonly<Record<string, string>>;
  /** 從回應任何位置(header / body)解析得到的 char-level timestamp;voai v1 實測為空。 */
  readonly timestamps: readonly CharTimestamp[];
  readonly savedTo: string | null;
}

function baseUrl(): string {
  return process.env.IQT_TTS_ENDPOINT!.replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  return { "x-api-key": process.env.IQT_TTS_KEY! };
}

/** 回應裡是否藏有 timestamp/字幕線索(header 名或 content-type)。voai v1 實測:沒有。 */
function findTimestampSignals(
  contentType: string,
  headers: Readonly<Record<string, string>>,
): string[] {
  const re = /(timestamp|subtitle|caption|srt|vtt|align|boundary|word|mark|offset|phoneme|viseme)/i;
  const hits: string[] = [];
  if (re.test(contentType)) hits.push(`content-type=${contentType}`);
  for (const [k, v] of Object.entries(headers)) {
    if (re.test(k)) hits.push(`${k}: ${v}`);
  }
  // 若 body 是 JSON / multipart(非 audio/*),也視為「可能帶 timestamp」的訊號
  if (!/^audio\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    hits.push(`non-audio body (${contentType}) — 需人工檢查是否含對齊資料`);
  }
  return hits;
}

async function getUsage(): Promise<string> {
  const res = await fetch(`${baseUrl()}/Key/Usage`, { headers: authHeaders() });
  if (!res.ok) return `(讀取失敗 ${res.status})`;
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> };
  return JSON.stringify(json.data ?? json);
}

async function callSpeech(text: string): Promise<IqtSpeechResult> {
  const res = await fetch(`${baseUrl()}/TTS/Speech`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ version: MODEL_VERSION, text, speaker: SPEAKER, style: STYLE }),
  });

  const contentType = res.headers.get("content-type") ?? "?";
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`IQT/voai TTS 失敗 ${res.status} ${res.statusText} :: ${detail.slice(0, 300)}`);
  }

  let audioBytes = -1;
  let savedTo: string | null = null;
  if (/^audio\//i.test(contentType) || /octet-stream/i.test(contentType)) {
    const buf = Buffer.from(await res.arrayBuffer());
    audioBytes = buf.byteLength;
    const dir = mkdtempSync(join(tmpdir(), "koma-iqt-tts-"));
    savedTo = join(dir, "output.wav");
    writeFileSync(savedTo, buf);
  }

  return { status: res.status, contentType, audioBytes, headers, timestamps: [], savedTo };
}

async function main(): Promise<void> {
  console.log("\n🧩 spike-tts-iqt — 自家 IQT TTS（voai.ai）字級 timestamp 驗證【最高槓桿未驗證項】");
  console.log("=".repeat(68));
  console.log(`測試文本:「${TEST_TEXT}」｜speaker=${SPEAKER}/${STYLE}｜version=${MODEL_VERSION}`);

  const endpoint = process.env.IQT_TTS_ENDPOINT;
  const key = process.env.IQT_TTS_KEY;
  if (!endpoint || !key) {
    console.log("\n⚠️  未偵測到 IQT 認證環境變數,跳過真打（預期行為,非錯誤）。");
    console.log("   於 .env.local 填好後即可真跑:");
    console.log("     IQT_TTS_ENDPOINT = https://connect.voai.ai");
    console.log("     IQT_TTS_KEY      = <voai API key>（送 header x-api-key）");
    console.log("\n⛔ 這是整個逐字卡拉OK產品的 gating dependency。exit 0。");
    return;
  }

  console.log(`\n💳 [Key/Usage] 配額:${await getUsage()}`);

  console.log("\n🔊 [TTS/Speech] 合成中 …");
  const r = await callSpeech(TEST_TEXT);
  console.log(`   status=${r.status}｜content-type=${r.contentType}｜audioBytes=${r.audioBytes}`);
  console.log("   回應 header:");
  for (const [k, v] of Object.entries(r.headers)) console.log(`     ${k}: ${v}`);
  if (r.savedTo) console.log(`   音檔已存:${r.savedTo}`);

  const signals = findTimestampSignals(r.contentType, r.headers);
  console.log(`\n   解析到 ${r.timestamps.length} 筆 char timestamp`);
  console.log(
    signals.length
      ? `   ⚠️ 發現可能的 timestamp 訊號(需追查):\n     - ${signals.join("\n     - ")}`
      : "   未發現任何 timestamp / subtitle / alignment 訊號(回應為純音檔)。",
  );

  console.log("\n" + "─".repeat(68));
  if (r.timestamps.length === 0 && signals.length === 0) {
    console.log("🛑 VERDICT:voai.ai VoiceAPI v1【不提供 timestamp】—— 回應僅 audio/wav 純音檔。");
    console.log("   ⇒ 逐字卡拉OK高亮無法直接靠 IQT timestamp 驅動。前進路線(擇一):");
    console.log("     A. forced alignment:把 IQT 音檔 + 已知原文丟對齊器(whisperX / MFA / CTC)");
    console.log("        反推 char/word 級 timestamp —— TTS 不吐字幕時的業界標準解法。");
    console.log("     B. 內部請 voai/IQT 團隊加「字幕/word-boundary 輸出」(你在 IQT,可直接提需求)。");
    console.log("     C. 暫代音源續用 Azure(已驗證可吐詞級 boundary,見 spike-tts-azure)。");
    console.log("   → 換源切點 AudioSourceProvider 不變;受影響的是『timestamp 從哪來』那一步。");
  } else {
    console.log("✅/⚠️ 回應帶非音檔資料或 timestamp 訊號 —— 請依上方逐筆人工確認欄位定義。");
  }
}

main().catch((e) => {
  console.error(`\n❌ spike-tts-iqt 失敗:${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
