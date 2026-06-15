import "server-only";
import { db } from "@/db";
import { books, chapters } from "@/db/schema";
import { newId } from "./ids";
import { addToLibrary } from "./library";
import { splitChapters } from "./chapter-split";

/** 自帶書的來源代號（無 fetch adapter，內文由使用者提供）。 */
export const LOCAL_SOURCE = "local";

const INSERT_CHUNK = 200;

export interface ImportInput {
  readonly title: string;
  readonly author?: string;
  readonly text: string;
}

export interface ImportResult {
  readonly source: string;
  readonly sourceBookId: string;
  readonly chapterCount: number;
}

/** 匯入一本自帶書：切章 → 寫 books/chapters → 加入書架。 */
export async function importBook(input: ImportInput): Promise<ImportResult> {
  const title = input.title.trim();
  if (!title) throw new Error("書名必填");
  if (!input.text.trim()) throw new Error("內文不可為空");

  const parts = splitChapters(input.text);
  if (parts.length === 0) throw new Error("解析不到任何內文");

  const bookId = newId();
  const sourceBookId = bookId; // local 書以 id 當 slug
  const now = new Date();

  await db.insert(books).values({
    id: bookId,
    source: LOCAL_SOURCE,
    sourceBookId,
    title,
    author: input.author?.trim() || "",
    cover: null,
    intro: null,
    category: "自帶",
    latestChapterTitle: parts[parts.length - 1]?.title ?? null,
    fetchedAt: now,
  });

  const rows = parts.map((p, i) => ({
    id: newId(),
    bookId,
    idx: i + 1,
    title: p.title,
    sourceUrl: "",
    content: p.body,
    fetchedAt: now,
  }));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(chapters).values(rows.slice(i, i + INSERT_CHUNK));
  }

  await addToLibrary(bookId);

  return { source: LOCAL_SOURCE, sourceBookId, chapterCount: rows.length };
}
