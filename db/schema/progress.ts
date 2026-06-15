import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { books } from "./books";
import { chapters } from "./chapters";

/**
 * progress：閱讀進度。每位使用者每本書一筆（記到哪一章、章內捲動比例）。
 */
export const progress = sqliteTable(
  "progress",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().default("local"),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    scrollRatio: real("scroll_ratio").notNull().default(0), // 0~1 章內位置
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("uq_progress_user_book").on(t.userId, t.bookId)],
);

export type Progress = typeof progress.$inferSelect;
export type NewProgress = typeof progress.$inferInsert;
