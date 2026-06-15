import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, progress } from "@/db/schema";
import { newId } from "./ids";

const USER = "local";

export interface ReadingProgress {
  readonly chapterId: string;
  readonly chapterIdx: number;
  readonly scrollRatio: number;
}

export async function getProgress(
  bookId: string,
): Promise<ReadingProgress | null> {
  const [row] = await db
    .select({
      chapterId: progress.chapterId,
      chapterIdx: chapters.idx,
      scrollRatio: progress.scrollRatio,
    })
    .from(progress)
    .innerJoin(chapters, eq(chapters.id, progress.chapterId))
    .where(and(eq(progress.userId, USER), eq(progress.bookId, bookId)))
    .limit(1);
  return row ?? null;
}

/** 寫入閱讀進度（每位使用者每本書一筆，upsert）。 */
export async function saveProgress(
  bookId: string,
  chapterId: string,
  scrollRatio: number,
): Promise<void> {
  const clamped = Math.min(1, Math.max(0, scrollRatio));
  const now = new Date();
  await db
    .insert(progress)
    .values({
      id: newId(),
      userId: USER,
      bookId,
      chapterId,
      scrollRatio: clamped,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.bookId],
      set: { chapterId, scrollRatio: clamped, updatedAt: now },
    });
}
