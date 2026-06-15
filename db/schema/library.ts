import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { books } from "./books";

/**
 * library：書架。MVP 單機，userId 先固定 'local'（schema 已預留多使用者）。
 */
export const library = sqliteTable(
  "library",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().default("local"),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("uq_library_user_book").on(t.userId, t.bookId)],
);

export type LibraryEntry = typeof library.$inferSelect;
export type NewLibraryEntry = typeof library.$inferInsert;
