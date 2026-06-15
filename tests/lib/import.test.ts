import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

import { db } from "@/db";
import { books, chapters, library } from "@/db/schema";
import { importBook, LOCAL_SOURCE } from "@/lib/import";
import { isInLibrary } from "@/lib/library";
import { eq } from "drizzle-orm";
import { createTestDb, setActiveDb } from "@/tests/helpers/test-db";

const SAMPLE = [
  "第一章 開端",
  "這是第一章的內文。",
  "第二章 發展",
  "這是第二章的內文。",
  "第三章 高潮",
  "這是第三章的內文。",
].join("\n");

beforeEach(async () => {
  vi.clearAllMocks();
  setActiveDb(await createTestDb());
});

describe("importBook", () => {
  it("切章後寫入 book + chapters，並回傳章數與來源資訊", async () => {
    const result = await importBook({
      title: "我的書",
      author: "我",
      text: SAMPLE,
    });

    expect(result.source).toBe(LOCAL_SOURCE);
    expect(result.chapterCount).toBe(3);
    expect(result.sourceBookId).toBeTruthy();

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    expect(book.title).toBe("我的書");
    expect(book.author).toBe("我");
    expect(book.source).toBe(LOCAL_SOURCE);
    expect(book.category).toBe("自帶");
    expect(book.latestChapterTitle).toBe("第三章 高潮");

    const rows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, book.id));
    expect(rows).toHaveLength(3);
    // idx 為 1-based 連續，且內文已快取（content 非 null）。
    expect(rows.map((r) => r.idx).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.content && r.content.length > 0)).toBe(true);
    expect(rows.every((r) => r.fetchedAt !== null)).toBe(true);
  });

  it("匯入後自動加入書架", async () => {
    const result = await importBook({ title: "上架書", text: SAMPLE });

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    expect(await isInLibrary(book.id)).toBe(true);

    const libRows = await db.select().from(library);
    expect(libRows).toHaveLength(1);
  });

  it("沒有章節標題的純文字 → 全歸『正文』一章", async () => {
    const result = await importBook({
      title: "無標題書",
      text: "只有一段內文，沒有任何章節標記。\n第二段內文。",
    });

    expect(result.chapterCount).toBe(1);
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    const rows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, book.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("正文");
  });

  it("author 省略 → 存空字串", async () => {
    const result = await importBook({ title: "無作者", text: SAMPLE });
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    expect(book.author).toBe("");
  });

  it("author 前後空白 → trim", async () => {
    const result = await importBook({
      title: "有作者",
      author: "  老貓  ",
      text: SAMPLE,
    });
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    expect(book.author).toBe("老貓");
  });

  it("超過單批上限（>200 章）→ 分批寫入仍全數落地", async () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      [`第${i + 1}章 標題`, `內文 ${i + 1}`].join("\n"),
    ).join("\n");

    const result = await importBook({ title: "大書", text: many });

    expect(result.chapterCount).toBe(205);
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.sourceBookId, result.sourceBookId));
    const rows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, book.id));
    expect(rows).toHaveLength(205);
  });

  describe("輸入驗證（錯誤邊界）", () => {
    it("書名空白 → 丟「書名必填」，且不寫任何資料", async () => {
      await expect(importBook({ title: "   ", text: SAMPLE })).rejects.toThrow(
        "書名必填",
      );
      expect(await db.select().from(books)).toHaveLength(0);
    });

    it("內文空白 → 丟「內文不可為空」", async () => {
      await expect(
        importBook({ title: "書", text: "   \n  " }),
      ).rejects.toThrow("內文不可為空");
      expect(await db.select().from(books)).toHaveLength(0);
    });

    it("有內文但切不出任何章節 → 丟「解析不到任何內文」", async () => {
      // splitChapters 會把只有標題、無內文的段落過濾掉 → parts 為空。
      await expect(
        importBook({ title: "書", text: "第一章\n第二章\n第三章" }),
      ).rejects.toThrow("解析不到任何內文");
      expect(await db.select().from(books)).toHaveLength(0);
    });
  });
});
