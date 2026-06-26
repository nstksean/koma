import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { books } from "./books";

/**
 * library：書架。每位擁有者一桶,user_id 存 dataOwner key
 * (登入者 `user:<id>`、guest `guest:<cookie>`)。欄位 default "local" 是早期單機殘留,
 * runtime 一律由 getServerDataOwner() 帶真實 key,實際不會落到 default。
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
