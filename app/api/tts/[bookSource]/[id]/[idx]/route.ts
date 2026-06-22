import { open, readFile, stat } from "node:fs/promises";

import { getChapterAudioMeta } from "@/lib/tts";

/**
 * 章節音訊串流 route：GET /api/tts/<bookSource>/<id>/<idx>?voice=...
 *
 * 確保該章已合成並落地（getChapterAudioMeta 命中秒回/否則合成），再回 wav bytes。
 * 依賴 Azure SDK + node:fs/crypto,必為 nodejs runtime(不可 Edge)。
 *
 * 支援 HTTP Range（206）—— `<audio>` 要能 seek 到「尚未下載」的位置(點字/拖進度條)
 * 必須靠 Range,否則瀏覽器只能在已緩衝區段內 seek,跳轉會被打回起點。
 */
export const runtime = "nodejs";

const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";
const IMMUTABLE = "public, max-age=31536000, immutable";

/** 解析 `Range: bytes=start-end`(end 可省)。回 null 表無/不合法 Range。 */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== "";
  const hasEnd = m[2] !== "";
  let start: number;
  let end: number;
  if (hasStart) {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : size - 1;
  } else if (hasEnd) {
    // suffix range: bytes=-N → 最後 N bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  end = Math.min(end, size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/** 讀檔的指定 byte 區段(只讀需要的部分,不整檔載入)。 */
async function readSlice(
  path: string,
  start: number,
  length: number,
): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return buf;
  } finally {
    await fh.close();
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ bookSource: string; id: string; idx: string }> },
): Promise<Response> {
  const { bookSource, id, idx } = await ctx.params;
  const slug = decodeURIComponent(id);
  const idxNum = Number(idx);

  // 系統邊界驗證:idx 必為整數。
  if (!Number.isInteger(idxNum)) {
    return new Response("bad idx", { status: 400 });
  }

  const voice = new URL(req.url).searchParams.get("voice") ?? DEFAULT_VOICE;

  try {
    const file = await getChapterAudioMeta(bookSource, slug, idxNum, voice);
    const { size } = await stat(file.wavPath);
    const range = parseRange(req.headers.get("range"), size);

    // 有 Range → 206 部分內容(只讀該區段)。
    if (range) {
      const { start, end } = range;
      const length = end - start + 1;
      const slice = await readSlice(file.wavPath, start, length);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(length),
          "Cache-Control": IMMUTABLE,
        },
      });
    }

    // 無 Range → 整檔 200,但聲明 Accept-Ranges(讓瀏覽器知道可 seek)。
    const buffer = await readFile(file.wavPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": IMMUTABLE,
      },
    });
  } catch (error: unknown) {
    // 找不到章節/書（getChapterView throw「找不到…」）→ 404,其餘 → 500。
    // 對外只回固定文案,完整錯誤記在 server 端 —— 內部訊息(Azure 細節、env 提示、
    // fs 路徑)不可洩漏給 client。404 屬預期 client error,不記 log 避免噪音。
    const isNotFound =
      error instanceof Error && error.message.includes("找不到");
    if (!isNotFound) console.error("[tts] audio route failed:", error);
    return new Response(isNotFound ? "找不到章節" : "聽書服務暫時無法使用", {
      status: isNotFound ? 404 : 500,
    });
  }
}
