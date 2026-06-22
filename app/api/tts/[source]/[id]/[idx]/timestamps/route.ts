import { getChapterAudioMeta } from "@/lib/tts";
import type { TimestampsPayload } from "@/src/tts";

/**
 * 章節逐字 timestamp route:GET /api/tts/<source>/<id>/<idx>/timestamps?voice=...
 *
 * 回前端高亮所需的最小資料（durationMs + includesPunctuation + charTimestamps）。
 * 與 audio route 共用 getChapterAudioMeta:首呼若未合成會一併觸發合成(命中秒回)。
 * 依賴 server-only orchestrator,必為 nodejs runtime。
 */
export const runtime = "nodejs";

const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ source: string; id: string; idx: string }> },
): Promise<Response> {
  const { source, id, idx } = await ctx.params;
  const slug = decodeURIComponent(id);
  const idxNum = Number(idx);

  // 系統邊界驗證:idx 必為整數。
  if (!Number.isInteger(idxNum)) {
    return new Response("bad idx", { status: 400 });
  }

  const voice = new URL(req.url).searchParams.get("voice") ?? DEFAULT_VOICE;

  try {
    const file = await getChapterAudioMeta(source, slug, idxNum, voice);
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
    const message = error instanceof Error ? error.message : "TTS 失敗";
    const status = message.includes("找不到") ? 404 : 500;
    return new Response(message, { status });
  }
}
