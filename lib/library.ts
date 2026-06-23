import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, library, progress, type Book } from "@/db/schema";
import { newId } from "./ids";

/** MVP 單機：固定使用者。階段 1 接帳號時改為實際 userId。 */
const USER = "local";

export interface LibraryItem {
  readonly book: Book;
  readonly addedAt: Date;
  readonly lastChapterIdx: number | null;
  readonly lastChapterTitle: string | null;
  readonly scrollRatio: number;
  readonly lastReadAt: Date | null;
}

export interface ContinueReading {
  readonly book: Book;
  readonly chapterIdx: number;
  readonly chapterTitle: string;
  readonly scrollRatio: number;
  readonly position: number; // 第幾章(1-based 序位)
  readonly totalChapters: number;
}

export async function addToLibrary(bookId: string): Promise<void> {
  await db
    .insert(library)
    .values({ id: newId(), userId: USER, bookId, addedAt: new Date() })
    .onConflictDoNothing({ target: [library.userId, library.bookId] });
}

export async function removeFromLibrary(bookId: string): Promise<void> {
  await db
    .delete(library)
    .where(and(eq(library.userId, USER), eq(library.bookId, bookId)));
}

export async function isInLibrary(bookId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: library.id })
    .from(library)
    .where(and(eq(library.userId, USER), eq(library.bookId, bookId)))
    .limit(1);
  return Boolean(row);
}

/** 書架列表，含「續讀」資訊；依「最近閱讀」排序（沒讀過的退回加入時間）。 */
export async function listLibrary(): Promise<readonly LibraryItem[]> {
  const rows = await db
    .select({
      book: books,
      addedAt: library.addedAt,
      lastChapterIdx: chapters.idx,
      lastChapterTitle: chapters.title,
      scrollRatio: progress.scrollRatio,
      lastReadAt: progress.updatedAt,
    })
    .from(library)
    .innerJoin(books, eq(library.bookId, books.id))
    .leftJoin(
      progress,
      and(eq(progress.bookId, books.id), eq(progress.userId, USER)),
    )
    .leftJoin(chapters, eq(chapters.id, progress.chapterId))
    .where(eq(library.userId, USER))
    .orderBy(desc(sql`COALESCE(${progress.updatedAt}, ${library.addedAt})`));

  return rows.map((r) => ({
    book: r.book,
    addedAt: r.addedAt,
    lastChapterIdx: r.lastChapterIdx,
    lastChapterTitle: r.lastChapterTitle,
    scrollRatio: r.scrollRatio ?? 0,
    lastReadAt: r.lastReadAt,
  }));
}

/** 全域「繼續上次閱讀」：最近一次有進度的書 + 章節(含 第X/Y章 序位)。 */
export async function getContinueReading(): Promise<ContinueReading | null> {
  const [row] = await db
    .select({
      book: books,
      chapterIdx: chapters.idx,
      chapterTitle: chapters.title,
      scrollRatio: progress.scrollRatio,
    })
    .from(progress)
    .innerJoin(books, eq(books.id, progress.bookId))
    .innerJoin(chapters, eq(chapters.id, progress.chapterId))
    .where(eq(progress.userId, USER))
    .orderBy(desc(progress.updatedAt))
    .limit(1);
  if (!row) return null;

  // 序位:同書中 idx 不大於本章者的數量(= getChapterView 的 pos+1);total = 全章數。
  const [counts] = await db
    .select({
      total: sql<number>`count(*)`,
      position: sql<number>`sum(case when ${chapters.idx} <= ${row.chapterIdx} then 1 else 0 end)`,
    })
    .from(chapters)
    .where(eq(chapters.bookId, row.book.id));

  return {
    ...row,
    position: counts?.position ?? 1,
    totalChapters: counts?.total ?? 1,
  };
}
