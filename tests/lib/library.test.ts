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
import {
  addToLibrary,
  isInLibrary,
  listLibrary,
  removeFromLibrary,
} from "@/lib/library";
import { saveProgress } from "@/lib/progress";
import { createTestDb, setActiveDb } from "@/tests/helpers/test-db";

async function seedBook(id: string, title: string) {
  await db.insert(books).values({
    id,
    source: "ttkan",
    sourceBookId: id,
    title,
    author: "作者",
    category: "玄幻",
    cover: null,
    intro: null,
    latestChapterTitle: null,
    fetchedAt: new Date(),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  setActiveDb(await createTestDb());
});

describe("addToLibrary / isInLibrary / removeFromLibrary", () => {
  it("加入後在書架；未加入的書不在書架", async () => {
    await seedBook("b1", "書一");
    await seedBook("b2", "書二");

    await addToLibrary("b1");

    expect(await isInLibrary("b1")).toBe(true);
    expect(await isInLibrary("b2")).toBe(false);
  });

  it("移除後不在書架", async () => {
    await seedBook("b1", "書一");
    await addToLibrary("b1");

    await removeFromLibrary("b1");

    expect(await isInLibrary("b1")).toBe(false);
  });

  it("重複加入同一本不報錯且不重複（onConflictDoNothing）", async () => {
    await seedBook("b1", "書一");

    await addToLibrary("b1");
    await addToLibrary("b1");

    expect(await listLibrary()).toHaveLength(1);
  });
});

describe("listLibrary", () => {
  it("帶出續讀資訊：有進度回最後章節 + 捲動比例，無進度回 0 / null", async () => {
    await seedBook("b1", "有進度的書");
    await seedBook("b2", "沒進度的書");
    await db.insert(chapters).values({
      id: "c1",
      bookId: "b1",
      idx: 5,
      title: "第5章",
      sourceUrl: "u5",
      content: null,
      fetchedAt: null,
    });
    await addToLibrary("b1");
    await addToLibrary("b2");
    await saveProgress("b1", "c1", 0.4);

    const items = await listLibrary();
    const withProgress = items.find((i) => i.book.id === "b1")!;
    const without = items.find((i) => i.book.id === "b2")!;

    expect(withProgress.lastChapterIdx).toBe(5);
    expect(withProgress.lastChapterTitle).toBe("第5章");
    expect(withProgress.scrollRatio).toBeCloseTo(0.4);

    expect(without.lastChapterIdx).toBeNull();
    expect(without.lastChapterTitle).toBeNull();
    expect(without.scrollRatio).toBe(0);
  });

  it("依 addedAt 由新到舊排序", async () => {
    await seedBook("old", "舊書");
    await seedBook("new", "新書");
    // 直接寫入可控的 addedAt（addToLibrary 內部用 new Date() 難以保證順序）。
    await db.insert(library).values([
      { id: "l-old", userId: "local", bookId: "old", addedAt: new Date(1_000) },
      { id: "l-new", userId: "local", bookId: "new", addedAt: new Date(2_000) },
    ]);

    const items = await listLibrary();

    expect(items.map((i) => i.book.id)).toEqual(["new", "old"]);
  });
});
