import type { SourceAdapter } from "./types";
import { ttkanAdapter } from "./ttkan";

export type { SourceAdapter, SearchResult, ChapterRef, BookDetail } from "./types";

const adapters: Readonly<Record<string, SourceAdapter>> = Object.freeze({
  [ttkanAdapter.id]: ttkanAdapter,
});

/** 取得指定來源的 adapter；未知來源回傳 null（呼叫端負責處理）。 */
export function getAdapter(source: string): SourceAdapter | null {
  return adapters[source] ?? null;
}

/** MVP 預設來源。 */
export const DEFAULT_SOURCE = ttkanAdapter.id;
