/**
 * TTS route 共用的系統邊界驗證:audio route 與 timestamps route 的 params
 * 解析/驗證完全相同,抽出避免重複,並確保壞輸入一律以 400 失敗(fail fast)。
 *
 * 防護點:
 * - `decodeURIComponent` 對畸形 `%` 序列會 throw URIError —— 若不攔,會冒出成 500
 *   (內部錯誤),而非語意正確的 400(client error)。
 * - bookSource / slug 的非空與長度上限:擋空字串與異常長輸入,避免帶進下游 lookup
 *   與快取目錄。
 * - slug 危險字元:slug 會裸接進來源站外送 URL 與本地查找,擋路徑穿越 / SSRF。
 * - voice allowlist:voice 進去重 key 與快取目錄,不設限會被刷成無上限付費合成。
 */

const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";
const MAX_SEGMENT_LEN = 512; // bookSource / slug 長度上限

/**
 * 支援的 Azure 音色 allowlist。`voice` 進到去重 key 與落地快取目錄(<tmpdir>/koma-tts/.../<voice>/),
 * 若不設限,攻擊者可用 ?voice=a、?voice=b… 每次都 cache miss → 觸發無上限的「付費」
 * Azure 合成 + 在磁碟寫無數攻擊者命名目錄。未在清單內者一律退回預設(不拒絕,容錯且
 * 把所有未知值收斂到同一快取身分)。
 */
const SUPPORTED_VOICES: ReadonlySet<string> = new Set([
  "zh-TW-HsiaoChenNeural", // 預設:曉臻,台灣繁中女聲
  "zh-TW-YunJheNeural", // 雲哲,台灣繁中男聲
  "zh-CN-XiaoxiaoNeural", // 曉曉,簡中女聲(spike 用過)
]);

/**
 * slug 注入/路徑穿越防線:slug 會裸接進來源站外送 URL(ttkan
 * `${BASE}/novel/chapters/${slug}`)與本地查找,合法 slug 不含路徑/查詢/片段分隔、
 * 反斜線、空白、控制字元或 ".." 穿越。命中即視為 client error,擋在邊界。
 * 注意:合法 slug 可含連字號(ttkan 用拼音 slug 如 wo-de-shu),故不排除 `-`。
 */
function hasUnsafeSlugChar(slug: string): boolean {
  if (slug.includes("..")) return true;
  for (const ch of slug) {
    if (ch === "/" || ch === "\\" || ch === "?" || ch === "#") return true;
    if (ch <= " ") return true; // 空白與控制字元(code point <= 0x20)
  }
  return false;
}

export interface TtsRequestParams {
  readonly bookSource: string;
  readonly slug: string;
  readonly idxNum: number;
  readonly voice: string;
}

export type TtsParamsResult =
  | { readonly ok: true; readonly params: TtsRequestParams }
  | { readonly ok: false; readonly response: Response };

function badRequest(message: string): TtsParamsResult {
  return { ok: false, response: new Response(message, { status: 400 }) };
}

/**
 * 解析並驗證 TTS route 的路徑/查詢參數。
 * 全部通過才回 `{ ok: true, params }`,否則回帶 400 Response 的 `{ ok: false }`。
 * voice 不在 allowlist 內時收斂回預設(非 400),避免 typo 直接壞掉。
 */
export function parseTtsParams(
  raw: { bookSource: string; id: string; idx: string },
  requestUrl: string,
): TtsParamsResult {
  const { bookSource, id, idx } = raw;

  if (!bookSource || bookSource.length > MAX_SEGMENT_LEN) {
    return badRequest("bad bookSource");
  }

  let slug: string;
  try {
    slug = decodeURIComponent(id);
  } catch {
    // 畸形百分比編碼 → URIError,視為 client error(非 500)。
    return badRequest("bad id");
  }
  if (!slug || slug.length > MAX_SEGMENT_LEN || hasUnsafeSlugChar(slug)) {
    return badRequest("bad id");
  }

  // 只收純十進位自然數字串:Number("")/Number(" ")/Number("1e3") 會悄悄強制轉型
  // (空字串→0),故用正則擋在 Number() 之前,避免空/畸形 idx 被當成第 0 章。
  if (!/^\d+$/.test(idx)) {
    return badRequest("bad idx");
  }
  const idxNum = Number(idx);

  const voiceParam = new URL(requestUrl).searchParams.get("voice");
  const voice =
    voiceParam && SUPPORTED_VOICES.has(voiceParam) ? voiceParam : DEFAULT_VOICE;

  return { ok: true, params: { bookSource, slug, idxNum, voice } };
}
