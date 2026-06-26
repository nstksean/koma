import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, library, progress, type Book } from "@/db/schema";
import { getServerDataOwner } from "@/lib/auth-server";
import { newId } from "./ids";

/** 書架排序方式:最近閱讀(預設) / 書名 / 加入時間。 */
export type LibrarySort = "recent" | "title" | "added";

/** 書架/進度的擁有者(member/admin 各自一桶,guest 按每瀏覽器 cookie id)。 */
async function currentUserId(): Promise<string> {
  return getServerDataOwner();
}

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

export interface LibraryStats {
  readonly saved: number; // 書架收藏本數
  readonly read: number; // 開過(有閱讀進度)的本數
}

/** 個人頁的暖心統計:書架幾本、讀過幾本。兩個 count,擁有者隔離同其餘查詢。 */
export async function getLibraryStats(): Promise<LibraryStats> {
  const userId = await currentUserId();
  const [saved] = await db
    .select({ n: sql<number>`count(*)` })
    .from(library)
    .where(eq(library.userId, userId));
  const [read] = await db
    .select({ n: sql<number>`count(*)` })
    .from(progress)
    .where(eq(progress.userId, userId));
  return { saved: saved?.n ?? 0, read: read?.n ?? 0 };
}

export async function addToLibrary(bookId: string): Promise<void> {
  const userId = await currentUserId();
  await db
    .insert(library)
    .values({ id: newId(), userId, bookId, addedAt: new Date() })
    .onConflictDoNothing({ target: [library.userId, library.bookId] });
}

export async function removeFromLibrary(bookId: string): Promise<void> {
  const userId = await currentUserId();
  await db
    .delete(library)
    .where(and(eq(library.userId, userId), eq(library.bookId, bookId)));
}

export async function isInLibrary(bookId: string): Promise<boolean> {
  const userId = await currentUserId();
  const [row] = await db
    .select({ id: library.id })
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.bookId, bookId)))
    .limit(1);
  return Boolean(row);
}

/**
 * 書架列表，含「續讀」資訊。
 * 排序:recent=最近閱讀(沒讀過的退回加入時間,預設) / title=書名 / added=加入時間。
 */
export async function listLibrary(
  sort: LibrarySort = "recent",
): Promise<readonly LibraryItem[]> {
  const userId = await currentUserId();
  const orderBy =
    sort === "title"
      ? [asc(books.title)]
      : sort === "added"
        ? [desc(library.addedAt)]
        : [desc(sql`COALESCE(${progress.updatedAt}, ${library.addedAt})`)];
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
      and(eq(progress.bookId, books.id), eq(progress.userId, userId)),
    )
    .leftJoin(chapters, eq(chapters.id, progress.chapterId))
    .where(eq(library.userId, userId))
    .orderBy(...orderBy);

  return rows.map((r) => ({
    book: r.book,
    addedAt: r.addedAt,
    lastChapterIdx: r.lastChapterIdx,
    lastChapterTitle: r.lastChapterTitle,
    scrollRatio: r.scrollRatio ?? 0,
    lastReadAt: r.lastReadAt,
  }));
}

/**
 * 把某擁有者的書架+進度接續給另一個擁有者(guest 登入後搬到 user:<id>)。
 * 撞書(unique user_id+book_id)時保留 target 既有那筆:UPDATE OR IGNORE 跳過該筆,
 * 再刪掉沒搬成的來源殘列。空來源 / from===to → no-op。冪等:可重跑(下次登入再試)。
 */
export async function reassignOwner(from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  await db.run(sql`UPDATE OR IGNORE library SET user_id = ${to} WHERE user_id = ${from}`);
  await db.run(sql`DELETE FROM library WHERE user_id = ${from}`);
  await db.run(sql`UPDATE OR IGNORE progress SET user_id = ${to} WHERE user_id = ${from}`);
  await db.run(sql`DELETE FROM progress WHERE user_id = ${from}`);
}

/** 全域「繼續上次閱讀」：最近一次有進度的書 + 章節(含 第X/Y章 序位)。 */
export async function getContinueReading(): Promise<ContinueReading | null> {
  const userId = await currentUserId();
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
    .where(eq(progress.userId, userId))
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
