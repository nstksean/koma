import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pruneCache } from "@/lib/tts-cache";

// 在臨時目錄鋪出 data/tts 風格的 <book>/<voice>/<slug>/<idx>.{mp3,json} 結構。
// 每個 entry 給定 mp3 大小與 mtime(秒),好驗 LRU(by mtime)淘汰順序。
async function writeEntry(
  root: string,
  rel: string,
  idx: number,
  mp3Bytes: number,
  mtimeSec: number,
): Promise<{ mp3: string; json: string }> {
  const dir = path.join(root, rel);
  await mkdir(dir, { recursive: true });
  const mp3 = path.join(dir, `${idx}.mp3`);
  const json = path.join(dir, `${idx}.json`);
  await writeFile(mp3, Buffer.alloc(mp3Bytes, 1));
  await writeFile(json, JSON.stringify({ idx }));
  const t = new Date(mtimeSec * 1000);
  await utimes(mp3, t, t);
  await utimes(json, t, t);
  return { mp3, json };
}

let tmp: string;
afterEach(async () => {
  if (tmp && existsSync(tmp)) await rm(tmp, { recursive: true, force: true });
});

describe("pruneCache", () => {
  it("總量未超過上限時不刪任何檔", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tts-cache-"));
    const a = await writeEntry(tmp, "ttkan/v/book1", 1, 100, 1000);
    const b = await writeEntry(tmp, "ttkan/v/book1", 2, 100, 2000);

    await pruneCache(tmp, 10_000); // cap 遠大於 200B

    expect(existsSync(a.mp3)).toBe(true);
    expect(existsSync(b.mp3)).toBe(true);
  });

  it("超過上限時由舊到新淘汰整個 entry(mp3+json 一起),直到 <= cap", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tts-cache-"));
    // 三個 entry 各 1000B mp3,mtime 遞增(old→new)。cap=2500 → 須砍掉最舊那個。
    const oldE = await writeEntry(tmp, "ttkan/v/book1", 1, 1000, 1000);
    const midE = await writeEntry(tmp, "ttkan/v/book1", 2, 1000, 2000);
    const newE = await writeEntry(tmp, "ttkan/v/book2", 1, 1000, 3000);

    await pruneCache(tmp, 2500);

    // 最舊的整個 entry(mp3+json)被砍,不留 orphan
    expect(existsSync(oldE.mp3)).toBe(false);
    expect(existsSync(oldE.json)).toBe(false);
    // 較新的兩個保留
    expect(existsSync(midE.mp3)).toBe(true);
    expect(existsSync(newE.mp3)).toBe(true);
  });

  it("root 不存在時靜默返回不丟錯", async () => {
    await expect(
      pruneCache(path.join(os.tmpdir(), "tts-cache-does-not-exist-xyz"), 100),
    ).resolves.toBeUndefined();
  });
});
