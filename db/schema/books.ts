import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * books：抓回來的書。跨來源以 (source, sourceBookId) 唯一識別。
 */
export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(), // "ttkan"
    sourceBookId: text("source_book_id").notNull(), // slug
    title: text("title").notNull(),
    author: text("author").notNull().default(""),
    cover: text("cover"),
    intro: text("intro"),
    category: text("category").notNull().default(""),
    latestChapterTitle: text("latest_chapter_title"),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("uq_books_source_book").on(t.source, t.sourceBookId)],
);

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
