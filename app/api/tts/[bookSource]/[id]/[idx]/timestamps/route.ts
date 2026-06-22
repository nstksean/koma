import { getChapterAudioMeta } from "@/lib/tts";
import type { TimestampsPayload } from "@/src/tts";

/**
 * 章節逐字 timestamp route:GET /api/tts/<bookSource>/<id>/<idx>/timestamps?voice=...
 *
 * 回前端高亮所需的最小資料（durationMs + includesPunctuation + charTimestamps）。
 * 與 audio route 共用 getChapterAudioMeta:首呼若未合成會一併觸發合成(命中秒回)。
 * 依賴 server-only orchestrator,必為 nodejs runtime。
 */
export const runtime = "nodejs";

const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

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
    const payload: TimestampsPayload = {
      durationMs: file.durationMs,
      includesPunctuation: file.includesPunctuation,
      charTimestamps: file.charTimestamps,
    };
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: unknown) {
    // 對外固定文案,完整錯誤只記在 server 端(同 audio route 的洩漏防護)。
    const isNotFound =
      error instanceof Error && error.message.includes("找不到");
    if (!isNotFound) console.error("[tts] timestamps route failed:", error);
    return new Response(isNotFound ? "找不到章節" : "聽書服務暫時無法使用", {
      status: isNotFound ? 404 : 500,
    });
  }
}
