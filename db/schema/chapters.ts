import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { books } from "./books";

/**
 * chapters：章節目錄 + 內文快取。content 首次讀取才填（之後直接讀 DB）。
 */
export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(), // 章節序號（來源站的頁碼）
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull(),
    content: text("content"), // null = 尚未抓取內文
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("uq_chapters_book_idx").on(t.bookId, t.idx)],
);

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
