import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth-server", () => ({
  getServerAuth: async () => ({ role: "guest", identity: "local" }),
  getServerDataOwner: async () => "local",
}));

vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { books, chapters, library, progress } from "@/db/schema";
import {
  addToLibrary,
  isInLibrary,
  listLibrary,
  reassignOwner,
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

describe("reassignOwner（guest → user 接續）", () => {
  it("搬書架+進度;撞書時保留 target 既有那筆,清空來源桶", async () => {
    await seedBook("b1", "兩邊都有的書");
    await seedBook("b2", "只有 guest 的書");
    await db.insert(chapters).values([
      { id: "c1", bookId: "b1", idx: 1, title: "第1章", sourceUrl: "u1", content: null, fetchedAt: null },
      { id: "c2", bookId: "b1", idx: 2, title: "第2章", sourceUrl: "u2", content: null, fetchedAt: null },
    ]);

    // guest 桶:b1(進度到 c1/0.3)、b2
    await db.insert(library).values([
      { id: "lg1", userId: "guest:g", bookId: "b1", addedAt: new Date(1_000) },
      { id: "lg2", userId: "guest:g", bookId: "b2", addedAt: new Date(2_000) },
    ]);
    await db.insert(progress).values({
      id: "pg1", userId: "guest:g", bookId: "b1", chapterId: "c1", scrollRatio: 0.3, updatedAt: new Date(1_000),
    });
    // user 桶已有 b1(進度到 c2/0.9)→ 與 guest 的 b1 撞書,應保留 user 既有那筆
    await db.insert(library).values({ id: "lu1", userId: "user:u", bookId: "b1", addedAt: new Date(500) });
    await db.insert(progress).values({
      id: "pu1", userId: "user:u", bookId: "b1", chapterId: "c2", scrollRatio: 0.9, updatedAt: new Date(500),
    });

    await reassignOwner("guest:g", "user:u");

    // 來源桶清空
    expect(await db.select().from(library).where(eq(library.userId, "guest:g"))).toHaveLength(0);
    expect(await db.select().from(progress).where(eq(progress.userId, "guest:g"))).toHaveLength(0);

    // user 桶:保留 b1 + 接收 b2
    const userLib = await db.select().from(library).where(eq(library.userId, "user:u"));
    expect(userLib.map((r) => r.bookId).sort()).toEqual(["b1", "b2"]);

    // b1 進度保留 user 既有(c2/0.9),沒被 guest 的 c1/0.3 蓋掉
    const [b1prog] = await db
      .select()
      .from(progress)
      .where(and(eq(progress.userId, "user:u"), eq(progress.bookId, "b1")));
    expect(b1prog.chapterId).toBe("c2");
    expect(b1prog.scrollRatio).toBeCloseTo(0.9);
  });

  it("from===to / 空來源 → no-op 不報錯", async () => {
    await seedBook("b1", "書一");
    await db.insert(library).values({ id: "l1", userId: "user:u", bookId: "b1", addedAt: new Date(1_000) });

    await reassignOwner("user:u", "user:u"); // 同擁有者
    await reassignOwner("guest:none", "user:u"); // 來源無資料

    expect(await db.select().from(library).where(eq(library.userId, "user:u"))).toHaveLength(1);
  });
});
