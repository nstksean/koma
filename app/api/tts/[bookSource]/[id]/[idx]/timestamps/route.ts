import { getChapterAudioMeta } from "@/lib/tts";
import { getServerAuth } from "@/lib/auth-server";
import { QuotaError } from "@/lib/tts-quota";
import { checkTtsRate } from "@/lib/tts-rate-limit";
import type { TimestampsPayload } from "@/src/tts";
import { parseTtsParams } from "../parse-params";

/**
 * 章節逐字 timestamp route:GET /api/tts/<bookSource>/<id>/<idx>/timestamps?voice=...
 *
 * 回前端高亮所需的最小資料（durationMs + includesPunctuation + charTimestamps）。
 * 與 audio route 共用 getChapterAudioMeta:首呼若未合成會一併觸發合成(命中秒回)。
 * 依賴 server-only orchestrator,必為 nodejs runtime。
 */
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ bookSource: string; id: string; idx: string }> },
): Promise<Response> {
  const parsed = parseTtsParams(await ctx.params, req.url);
  if (!parsed.ok) return parsed.response;
  // 額度外第二道閘(與 audio route 共用同一身分計數,見 lib/tts-rate-limit)。
  const rate = checkTtsRate(req);
  if (!rate.ok) return rate.response;
  const { bookSource, slug, idxNum, voice } = parsed.params;
  // 統一身分入口(與 audio route 一致),讓 email 登入者額度計在 user:<id> 桶。
  const auth = await getServerAuth();

  try {
    const file = await getChapterAudioMeta(bookSource, slug, idxNum, auth, voice);
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
    if (error instanceof QuotaError) {
      return Response.json(
        { error: error.message, role: error.role, limit: error.limit },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    // 對外固定文案,完整錯誤只記在 server 端(同 audio route 的洩漏防護)。
    const isNotFound =
      error instanceof Error && error.message.includes("找不到");
    if (!isNotFound) console.error("[tts] timestamps route failed:", error);
    return new Response(isNotFound ? "貓翻遍了也沒這章" : "念書的貓走神了,待會再試", {
      status: isNotFound ? 404 : 500,
    });
  }
}
