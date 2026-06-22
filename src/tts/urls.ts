/**
 * TTS route URL 建構器（凍結接縫，client-safe 純函式）。
 * server 端 route 路徑由檔案結構決定（app/api/tts/[bookSource]/[id]/[idx]/...），
 * client 端用這裡建構同構 URL，避免兩邊字串漂移。
 */

/** 章節音檔（WAV）route。直接餵 `<audio src>`。 */
export function ttsAudioUrl(
  bookSource: string,
  slug: string,
  idx: number,
  voice: string,
): string {
  const q = new URLSearchParams({ voice });
  return `/api/tts/${encodeURIComponent(bookSource)}/${encodeURIComponent(slug)}/${idx}?${q}`;
}

/** 章節逐字 timestamp（JSON）route。`fetch().json()` 得 `TimestampsPayload`。 */
export function ttsTimestampsUrl(
  bookSource: string,
  slug: string,
  idx: number,
  voice: string,
): string {
  const q = new URLSearchParams({ voice });
  return `/api/tts/${encodeURIComponent(bookSource)}/${encodeURIComponent(slug)}/${idx}/timestamps?${q}`;
}
