/**
 * TtkanAdapter — 天天看小說 (tw.ttkan.co)
 * 由 scripts/spike-ttkan.ts 收斂而來（spike 已親自跑通整條鏈路）。
 *
 * 結構：
 *   搜尋   GET /novel/search?language=tw&q={kw}  → a[href^="/novel/chapters/"]
 *   書頁   GET /novel/chapters/{slug}            → <title>《書名》最新章節，{作者} 作品 - {分類} - 天天看小說
 *   內文   GET /novel/pagea/{slug}_{n}.html      → div.content（結束於 #div_content_end）
 *
 * 解析函式（parse*）刻意與 fetch 分離 → 可對 HTML fixture 寫單元測試（TDD 接縫）。
 */
import * as cheerio from "cheerio";
import type {
  BookDetail,
  ChapterRef,
  SearchResult,
  SourceAdapter,
} from "./types";

export const SOURCE = "ttkan";
const BASE = "https://tw.ttkan.co";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** server-side fetch，含 UA 與錯誤處理（不可從 client 直打來源站）。 */
async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`fetch 失敗 ${res.status} ${res.statusText} :: ${url}`);
  }
  return res.text();
}

/** 從 /novel/chapters/{slug} 反推 slug。 */
function slugFromChaptersHref(href: string): string {
  return href.replace(/^.*\/novel\/chapters\//, "").replace(/\/$/, "");
}

// ---- 純解析函式（吃 HTML 字串，不碰網路，給 fixture 測試）----

export function parseSearch(html: string): readonly SearchResult[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  $('a[href^="/novel/chapters/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const slug = slugFromChaptersHref(href);
    if (!slug || seen.has(slug)) return;
    const title = $(el).text().trim();
    if (!title) return;
    seen.add(slug);
    out.push({
      source: SOURCE,
      sourceBookId: slug,
      title,
      author: "",
      url: `${BASE}${href}`,
    });
  });
  return Object.freeze(out);
}

export function parseBook(html: string, slug: string): BookDetail {
  const $ = cheerio.load(html);
  // <title>《暴力學徒》 最新章節， 唐川 作品 - 都市小說 - 天天看小說</title>
  const raw = $("title").first().text();
  const m = raw.match(/《(.+?)》.*?，\s*(.+?)\s*作品\s*-\s*(.+?)\s*-/);
  const title = m?.[1] ?? $("h1").first().text().trim();
  const author = m?.[2]?.trim() ?? "";
  const category = m?.[3]?.trim() ?? "";
  const cover =
    $('img[src*="cover"], .novel_info img, .book_cover img')
      .first()
      .attr("src") ?? null;
  const intro =
    $(".description, .intro, .novel_info .summary").first().text().trim() ||
    null;
  return Object.freeze({
    source: SOURCE,
    sourceBookId: slug,
    title,
    author,
    category,
    cover: cover ? (cover.startsWith("http") ? cover : `${BASE}${cover}`) : null,
    intro,
  });
}

export function parseChapters(html: string): readonly ChapterRef[] {
  const $ = cheerio.load(html);
  const out: ChapterRef[] = [];
  $('a[href^="/novel/pagea/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const title = $(el).text().trim();
    const idxMatch = href.match(/_(\d+)\.html$/);
    if (!idxMatch || !title) return;
    out.push({ idx: Number(idxMatch[1]), title, url: `${BASE}${href}` });
  });
  // 依 idx 去重 + 排序（同頁可能出現上/下分頁清單）。
  const uniq = new Map<number, ChapterRef>();
  for (const c of out) if (!uniq.has(c.idx)) uniq.set(c.idx, c);
  return Object.freeze([...uniq.values()].sort((a, b) => a.idx - b.idx));
}

export function parseContent(html: string): string {
  const $ = cheerio.load(html);
  const $content = $("div.content").first();
  $content.find("script, style, #div_content_end").remove();
  return $content
    .text()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^=+$/.test(l)) // 去 ==== 分隔線
    .filter((l) => !/天天看小說|請記住本站|ttkan|章節報錯|分享給朋友/i.test(l))
    .join("\n");
}

// ---- Adapter（fetch + parse 組合）----

export const ttkanAdapter: SourceAdapter = {
  id: SOURCE,
  name: "天天看小說",
  baseUrl: BASE,

  async search(keyword: string): Promise<readonly SearchResult[]> {
    const url = `${BASE}/novel/search?language=tw&q=${encodeURIComponent(keyword)}`;
    return parseSearch(await fetchHtml(url));
  },

  async getBook(slug: string): Promise<BookDetail> {
    return parseBook(await fetchHtml(`${BASE}/novel/chapters/${slug}`), slug);
  },

  async getChapters(slug: string): Promise<readonly ChapterRef[]> {
    return parseChapters(await fetchHtml(`${BASE}/novel/chapters/${slug}`));
  },

  async getChapterContent(chapterUrl: string): Promise<string> {
    return parseContent(await fetchHtml(chapterUrl));
  },
};
