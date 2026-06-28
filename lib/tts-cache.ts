import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

/**
 * TTS 落地快取的容量上限淘汰（LRU by mtime）。
 *
 * 開章自動 prefetch 會在每次進章合成並寫 <tmpdir>/koma-tts/<book>/<voice>/<slug>/<idx>.{mp3,json}，
 * 一本書上千章 → 不淘汰會無上限長。這裡只做一件事：超過上限就由舊到新砍掉整個 entry
 * （mp3+json 一起，故不會自製 orphan；冷章被砍後下次進章按需重合成即可）。
 *
 * ponytail: 用「總量上限」單一機制涵蓋 review 提的 unbounded growth + orphan sweep
 *   ——以 entry 為單位淘汰天生不留 orphan，毋須另開 orphan sweep。
 *   崩潰中途寫入留下的零星 orphan 由同一個上限一併吃掉，不另外處理。
 */

/** 每個 entry 的兩個檔（<idx>.mp3 + <idx>.json）合視為一個淘汰單位。 */
interface CacheEntry {
  readonly files: readonly string[];
  readonly size: number; // bytes(wav+json 總和)
  readonly mtimeMs: number; // entry 內最新檔的 mtime,作為 LRU 排序鍵
}

/** 預設上限：1GB,可用 TTS_CACHE_MAX_MB 覆寫。一章 mp3 約 1–2MB,1GB ≈ 500–1000 章熱快取。 */
function defaultMaxBytes(): number {
  const mb = Number(process.env.TTS_CACHE_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 1024) * 1024 * 1024;
}

/** 遞迴收集目錄下所有檔的絕對路徑。 */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walk(full)));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

/**
 * 把所有檔依「去副檔名的完整路徑」分組成 entry。
 * key = <dir>/<idx>，故同 idx 跨書不會誤併（用完整路徑，非單純 basename）。
 */
async function collectEntries(files: readonly string[]): Promise<CacheEntry[]> {
  const groups = new Map<string, { files: string[]; size: number; mtimeMs: number }>();
  for (const file of files) {
    const ext = path.extname(file);
    if (ext !== ".mp3" && ext !== ".json") continue; // 只認快取自家檔
    const key = file.slice(0, -ext.length);
    let s;
    try {
      s = await stat(file);
    } catch {
      continue; // 競態下被別人刪了,跳過
    }
    const g = groups.get(key) ?? { files: [], size: 0, mtimeMs: 0 };
    g.files.push(file);
    g.size += s.size;
    g.mtimeMs = Math.max(g.mtimeMs, s.mtimeMs);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * 若快取總量超過上限,由舊到新淘汰整個 entry 直到 <= 上限。永不對呼叫端丟錯
 * （快取維護失敗不該讓合成結果失敗）。
 *
 * @param root     快取根目錄(預設由呼叫端傳 lib/tts 的 CACHE_ROOT)
 * @param maxBytes 上限 bytes,預設 TTS_CACHE_MAX_MB 或 1GB
 */
export async function pruneCache(
  root: string,
  maxBytes: number = defaultMaxBytes(),
): Promise<void> {
  let files: string[];
  try {
    files = await walk(root);
  } catch {
    return; // root 不存在 / 無法讀 → 無事可做
  }

  const entries = await collectEntries(files);
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= maxBytes) return;

  // 最舊的先砍（mtime 升冪）。
  // ponytail: 每次寫入做一次 O(n) 掃描;n 為熱快取章數(數百),合成本身已耗秒,可忽略。
  //   章數真大到掃描有感再換成「目錄索引/分桶」——目前 YAGNI。
  const oldestFirst = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of oldestFirst) {
    if (total <= maxBytes) break;
    try {
      await Promise.all(entry.files.map((f) => rm(f, { force: true })));
      total -= entry.size;
    } catch {
      // 單一 entry 刪除失敗(權限/競態)不致命,跳過繼續壓低總量。
    }
  }
}
