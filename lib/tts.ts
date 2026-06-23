import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { getChapterView } from "@/lib/books";
import { pruneCache } from "@/lib/tts-cache";
import { refundQuota, tryConsumeQuota, quotaEnforced } from "@/lib/tts-quota";
import type { Auth } from "@/lib/auth";
import { synthesizeAzureChapter } from "@/src/tts/azure-synthesize";
import type { CharTimestamp } from "@/src/tts";

/**
 * 章節音訊 orchestrator（server-only）。
 *
 * 負責「合成 → 落地快取 → 命中秒回」：route handler 只呼叫 getChapterAudioMeta，
 * 拿到落地 wav 絕對路徑與逐字 timestamp。換音源（Azure→IQT）時本檔的快取/去重
 * 邏輯不動，只換 synthesize 來源。詳見 docs/meta/plans/04-stage3-tts-pipeline.md §4。
 *
 * 依賴 node:fs / node:crypto + Azure SDK，故 runtime 必為 "nodejs"（route 已設）。
 */

/** Azure 預設音色（zh-TW 女聲）。 */
const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

/** 快取 json schema 版本：日後改 charIndex 約定/欄位時用來作廢舊檔。 */
const SCHEMA_VERSION = 1 as const;

/** 快取根目錄：data/tts/<bookSource>/<voiceSafe>/<slugSafe>/<idx>.{wav,json}。 */
const CACHE_ROOT = path.join(process.cwd(), "data", "tts");

/**
 * route handler 拿到的章節音訊（落地後）。
 * `wavPath` 給 audio route `fs.readFile`；其餘給 timestamps route。
 */
export interface ChapterAudioFile {
  readonly wavPath: string; // 落地 wav 絕對路徑
  readonly durationMs: number;
  readonly includesPunctuation: false; // Azure 不給標點 boundary，恆 false
  readonly charTimestamps: readonly CharTimestamp[];
}

/**
 * 落地快取 json 形狀（schemaVersion=1）。textHash 用來偵測來源純文字變動 →
 * 內容換了（例如書源重抓）就視為 miss、重新合成。
 */
interface CacheMeta {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly engine: "azure";
  readonly voice: string;
  readonly audioFile: string; // 相對檔名 "<idx>.wav"
  readonly durationMs: number;
  readonly includesPunctuation: false;
  readonly textHash: string;
  readonly synthesizedAt: number;
  readonly charTimestamps: readonly CharTimestamp[];
}

/**
 * in-process 去重：同 key 合成進行中時共用同一 Promise，
 * 防雙擊重複合成 + 並發寫同一檔的競態。完成（成功或失敗）後從 map 移除。
 */
const inflight = new Map<string, Promise<ChapterAudioFile>>();

/** sanitize 路徑片段：只留安全字元，防路徑穿越（../、絕對路徑、null byte 等）。 */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** SHA-256 hex of 純文字，用來偵測來源內容變動。 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 嘗試讀取並驗證既有快取；命中且有效回 ChapterAudioFile,否則回 null（視為 miss）。 */
async function readCache(
  dir: string,
  idx: number,
  expectedHash: string,
): Promise<ChapterAudioFile | null> {
  const jsonPath = path.join(dir, `${idx}.json`);
  const wavPath = path.join(dir, `${idx}.wav`);
  if (!existsSync(jsonPath) || !existsSync(wavPath)) return null;

  let meta: CacheMeta;
  try {
    const raw = await readFile(jsonPath, "utf8");
    meta = JSON.parse(raw) as CacheMeta;
  } catch (err) {
    // 壞檔（截斷/非 JSON）→ 當 miss，後續重新合成覆寫。
    // 記 server 端(不靜默吞掉):持續損壞會在 log 顯形,而非無聲重合成。
    console.warn("[tts] 快取 meta 損壞,當 miss 處理:", jsonPath, err);
    return null;
  }

  if (
    meta.schemaVersion !== SCHEMA_VERSION ||
    meta.textHash !== expectedHash ||
    typeof meta.durationMs !== "number" ||
    !Array.isArray(meta.charTimestamps)
  ) {
    return null;
  }

  return {
    wavPath,
    durationMs: meta.durationMs,
    includesPunctuation: false,
    charTimestamps: meta.charTimestamps as readonly CharTimestamp[],
  };
}

/** miss 時實際合成並落地（wav + json），回 ChapterAudioFile。 */
async function synthesizeAndCache(
  dir: string,
  idx: number,
  content: string,
  voice: string,
  textHash: string,
): Promise<ChapterAudioFile> {
  const result = await synthesizeAzureChapter(content, voice);
  // 計費足跡:只有 miss→真正合成才送 Azure(cache hit 不收費),故在此記字元數。
  // grep '[tts] synth' 加總 chars 即可估算實際付費用量;權威數字仍看 Azure Portal。
  console.info(`[tts] synth chars=${content.length} voice=${voice} idx=${idx}`);

  await mkdir(dir, { recursive: true });
  const wavPath = path.join(dir, `${idx}.wav`);
  const jsonPath = path.join(dir, `${idx}.json`);

  const meta: CacheMeta = {
    schemaVersion: SCHEMA_VERSION,
    engine: "azure",
    voice,
    audioFile: `${idx}.wav`,
    durationMs: result.durationMs,
    includesPunctuation: false,
    textHash,
    synthesizedAt: Date.now(),
    charTimestamps: result.charTimestamps,
  };

  // 先寫 wav 再寫 json：json 是「就緒」標記，避免讀到 json 卻無 wav。
  await writeFile(wavPath, result.wav);
  await writeFile(jsonPath, JSON.stringify(meta), "utf8");

  // 寫完才壓上限：prefetch 每進章合成,不淘汰會無上限長。pruneCache 永不丟錯。
  await pruneCache(CACHE_ROOT);

  return {
    wavPath,
    durationMs: result.durationMs,
    includesPunctuation: false,
    charTimestamps: result.charTimestamps,
  };
}

/**
 * 取得章節音訊 meta（確保已合成並落地）。命中快取秒回,否則合成後落地再回。
 *
 * @param bookSource 書源 id（czbooks/ttkan/local…），作為快取第一層目錄
 * @param slug       來源書 id（= getChapterView 的 sourceBookId）
 * @param idx        章節 idx（來源頁碼，非序位）
 * @param auth       請求者身分（額度把關;cache 命中不計、不檢查）
 * @param voice      Azure 音色 id,預設 zh-TW-HsiaoChenNeural
 */
export async function getChapterAudioMeta(
  bookSource: string,
  slug: string,
  idx: number,
  auth: Auth,
  voice: string = DEFAULT_VOICE,
): Promise<ChapterAudioFile> {
  // 三個路徑片段都 sanitize：bookSource 同樣來自 URL，未過濾會讓
  // path.join(CACHE_ROOT, bookSource, …) 被 "../" 穿越到快取根目錄外。
  const sourceSafe = sanitizeSegment(bookSource);
  const voiceSafe = sanitizeSegment(voice);
  const slugSafe = sanitizeSegment(slug);
  // 去重 key 用 sanitize 後的片段，與落地目錄身分一致：避免兩個清洗後撞同目錄、
  // 但 key 不同而並發寫同一檔的競態。
  const key = `${sourceSafe}|${voiceSafe}|${slugSafe}|${idx}`;

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<ChapterAudioFile> => {
    // 重用 getChapterView 取已清洗純文字（含 DB/來源站快取邏輯,別自己裸 SQL）。
    // ⚠️ 餵「原始」bookSource/slug：adapter 查找靠的是真實 id，不能用 sanitize 後的值。
    const view = await getChapterView(bookSource, slug, idx);
    const content = view.content;
    // 空/全空白章節不合成:否則會產出 44-byte 空 WAV 並永久快取成「有效」結果。
    // 含「找不到」字樣 → route 對應為 404(非 500),且不落地快取。
    if (!content || content.trim() === "") {
      throw new Error("找不到章節內文");
    }
    const textHash = hashContent(content);

    const dir = path.join(CACHE_ROOT, sourceSafe, voiceSafe, slugSafe);

    const hit = await readCache(dir, idx, textHash);
    if (hit) return hit; // cache 命中：不檢查、不消耗額度（重播/拖進度條免費）

    // 預設強制額度(只有 test / 顯式 opt-out 才放行,見 quotaEnforced)。
    const enforce = quotaEnforced();
    // miss → 真要送 Azure 付費合成。先「原子預扣」一格額度:檢查+扣減同一條 SQL,
    // 消除 assert→consume 的 TOCTOU(超額丟 QuotaError → route 回 429)。
    if (enforce) await tryConsumeQuota(auth);
    try {
      return await synthesizeAndCache(dir, idx, content, voice, textHash);
    } catch (err) {
      // 合成失敗 → 把預扣的額度退回(沒真的付費就不該扣),再把原錯往上拋。
      if (enforce) await refundQuota(auth);
      throw err;
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
