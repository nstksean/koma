import "server-only";
import { DEFAULT_SOURCE, getAdapter, type SearchResult } from "@/src/sources";

export async function searchBooks(
  keyword: string,
  source: string = DEFAULT_SOURCE,
): Promise<readonly SearchResult[]> {
  const adapter = getAdapter(source);
  if (!adapter) throw new Error(`未知書源：${source}`);
  if (!keyword.trim()) return [];
  return adapter.search(keyword.trim());
}
