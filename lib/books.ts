import "server-only";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, type Book, type Chapter } from "@/db/schema";
import { getAdapter } from "@/src/sources";
import { newId } from "./ids";
import { resolveTitle } from "./title-overrides";

/** 書目/目錄快取存活時間：過期才回來源站重抓「最新章節」。 */
const BOOK_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const INSERT_CHUNK = 200;

/** 目錄列：不含 content（整章內文，數 KB~數十 KB），只取定位需要的欄位。 */
export interface ChapterMeta {
  readonly id: string;
  readonly idx: number;
  readonly title: string;
  readonly sourceUrl: string;
}

export interface BookWithChapters {
  readonly book: Book;
  readonly chapters: readonly ChapterMeta[];
}

export interface ChapterView {
  readonly book: Book;
  readonly chapter: Chapter;
  readonly content: string;
  readonly prevIdx: number | null;
  readonly nextIdx: number | null;
  readonly position: number; // 第幾章（1-based 序位，非來源頁碼）
  readonly totalChapters: number;
}

export interface ChapterRefLite {
  readonly idx: number;
  readonly title: string;
}

async function findBook(source: string, sourceBookId: string): Promise<Book | undefined> {
  const [row] = await db
    .select()
    .from(books)
    .where(and(eq(books.source, source), eq(books.sourceBookId, sourceBookId)))
    .limit(1);
  return row;
}

/** 載入目錄（projection：不含 content，避免整本內文 over-fetch）。 */
async function loadChapters(bookId: string): Promise<ChapterMeta[]> {
  return db
    .select({
      id: chapters.id,
      idx: chapters.idx,
      title: chapters.title,
      sourceUrl: chapters.sourceUrl,
    })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx));
}

/**
 * 取得書籍詳情 + 章節目錄。命中且未過期 → 直接讀 DB；否則回來源站重抓並 upsert。
 * 重抓只新增缺少的章節（保留已快取的 content）。
 */
export async function getOrFetchBook(
  source: string,
  sourceBookId: string,
): Promise<BookWithChapters> {
  const adapter = getAdapter(source);
  const existing = await findBook(source, sourceBookId);

  // 自帶書（無來源站 adapter）：只讀 DB，不抓取。
  if (!adapter) {
    if (!existing) throw new Error(`找不到本地書：${source}/${sourceBookId}`);
    return { book: existing, chapters: await loadChapters(existing.id) };
  }

  const fresh =
    existing && Date.now() - existing.fetchedAt.getTime() < BOOK_TTL_MS;
  if (existing && fresh) {
    return { book: existing, chapters: await loadChapters(existing.id) };
  }

  const [detail, refs] = await Promise.all([
    adapter.getBook(sourceBookId),
    adapter.getChapters(sourceBookId),
  ]);
  const now = new Date();
  const bookId = existing?.id ?? newId();
  const latestChapterTitle = refs.at(-1)?.title ?? null;
  const title = resolveTitle(source, sourceBookId, detail.title);

  // TODO(上架): BYO 書源 — 上架前改為不託管內容
  await db
    .insert(books)
    .values({
      id: bookId,
      source,
      sourceBookId,
      title,
      author: detail.author,
      cover: detail.cover,
      intro: detail.intro,
      category: detail.category,
      latestChapterTitle,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [books.source, books.sourceBookId],
      set: {
        title,
        author: detail.author,
        cover: detail.cover,
        intro: detail.intro,
        category: detail.category,
        latestChapterTitle,
        fetchedAt: now,
      },
    });

  // 只插入尚未存在的章節（不覆寫已抓的 content）。
  const known = new Set((await loadChapters(bookId)).map((c) => c.idx));
  const toInsert = refs
    .filter((r) => !known.has(r.idx))
    .map((r) => ({
      id: newId(),
      bookId,
      idx: r.idx,
      title: r.title,
      sourceUrl: r.url,
      content: null,
      fetchedAt: null,
    }));
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    await db.insert(chapters).values(toInsert.slice(i, i + INSERT_CHUNK));
  }

  const book = (await findBook(source, sourceBookId))!;
  return { book, chapters: await loadChapters(bookId) };
}

/**
 * 取得單一章節的閱讀檢視。content 為 null 時才回來源站抓並寫入快取。
 */
export async function getChapterView(
  source: string,
  sourceBookId: string,
  idx: number,
): Promise<ChapterView> {
  const adapter = getAdapter(source);

  // 確保 book + 章節目錄已存在（支援未經書頁的深連結）。
  let book = await findBook(source, sourceBookId);
  if (!book) {
    if (!adapter) throw new Error(`找不到本地書：${source}/${sourceBookId}`);
    book = (await getOrFetchBook(source, sourceBookId)).book;
  }

  // 目標章單獨取（含 content）；不存在 → 若有 adapter（如深連結尚未補目錄）補抓一次再試。
  let chapter = await findChapter(book.id, idx);
  if (!chapter && adapter) {
    await getOrFetchBook(source, sourceBookId);
    chapter = await findChapter(book.id, idx);
  }
  if (!chapter) throw new Error(`找不到章節 idx=${idx}`);

  let content = chapter.content;
  if (!content) {
    if (!adapter) throw new Error("本地書缺少內文");
    content = await adapter.getChapterContent(chapter.sourceUrl);
    // TODO(上架): BYO 書源 — 上架前改為不託管內容
    await db
      .update(chapters)
      .set({ content, fetchedAt: new Date() })
      .where(eq(chapters.id, chapter.id));
  }

  // prev/next/position/total 全用 SQL 算，避免把整本目錄載進記憶體再算。
  const [prevIdx, nextIdx, { position, totalChapters }] = await Promise.all([
    adjacentIdx(book.id, idx, "prev"),
    adjacentIdx(book.id, idx, "next"),
    countPosition(book.id, idx),
  ]);

  return { book, chapter, content, prevIdx, nextIdx, position, totalChapters };
}

/** 取單一章節（完整列，含 content）。 */
async function findChapter(
  bookId: string,
  idx: number,
): Promise<Chapter | undefined> {
  const [row] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.idx, idx)))
    .limit(1);
  return row;
}

/** 相鄰章 idx：prev = 小於 target 的最大 idx；next = 大於 target 的最小 idx。 */
async function adjacentIdx(
  bookId: string,
  idx: number,
  dir: "prev" | "next",
): Promise<number | null> {
  const [row] = await db
    .select({ idx: chapters.idx })
    .from(chapters)
    .where(
      and(
        eq(chapters.bookId, bookId),
        dir === "prev" ? lt(chapters.idx, idx) : gt(chapters.idx, idx),
      ),
    )
    .orderBy(dir === "prev" ? desc(chapters.idx) : asc(chapters.idx))
    .limit(1);
  return row?.idx ?? null;
}

/** 序位 + 全章數：position = idx 不大於本章者的數量（= 舊 pos+1），與 library.ts 同模式。 */
async function countPosition(
  bookId: string,
  idx: number,
): Promise<{ position: number; totalChapters: number }> {
  const [row] = await db
    .select({
      totalChapters: sql<number>`count(*)`,
      position: sql<number>`sum(case when ${chapters.idx} <= ${idx} then 1 else 0 end)`,
    })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  return {
    position: row?.position ?? 1,
    totalChapters: row?.totalChapters ?? 1,
  };
}

/** 章節目錄（只含 idx + title，輕量，給閱讀器目錄抽屜延遲載入用）。 */
export async function listChapterRefs(
  source: string,
  sourceBookId: string,
): Promise<readonly ChapterRefLite[]> {
  const book = await findBook(source, sourceBookId);
  if (book) {
    const rows = await loadChapters(book.id);
    return rows.map((c) => ({ idx: c.idx, title: c.title }));
  }
  // 尚未快取且有 adapter → 抓一次目錄。
  if (!getAdapter(source)) return [];
  const { chapters: chs } = await getOrFetchBook(source, sourceBookId);
  return chs.map((c) => ({ idx: c.idx, title: c.title }));
}
