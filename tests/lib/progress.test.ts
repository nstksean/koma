import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth-server", () => ({
  getServerAuth: async () => ({ role: "guest", identity: "local" }),
}));

vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

import { db } from "@/db";
import { books, chapters } from "@/db/schema";
import { getProgress, saveProgress } from "@/lib/progress";
import { createTestDb, setActiveDb } from "@/tests/helpers/test-db";

async function seedBookWithChapters() {
  await db.insert(books).values({
    id: "b1",
    source: "ttkan",
    sourceBookId: "b1",
    title: "書",
    author: "作者",
    category: "玄幻",
    cover: null,
    intro: null,
    latestChapterTitle: null,
    fetchedAt: new Date(),
  });
  await db.insert(chapters).values([
    { id: "c1", bookId: "b1", idx: 1, title: "第1章", sourceUrl: "u1", content: null, fetchedAt: null },
    { id: "c2", bookId: "b1", idx: 2, title: "第2章", sourceUrl: "u2", content: null, fetchedAt: null },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  setActiveDb(await createTestDb());
});

describe("saveProgress / getProgress", () => {
  it("尚無進度時 getProgress 回 null", async () => {
    await seedBookWithChapters();
    expect(await getProgress("b1")).toBeNull();
  });

  it("存進度後可讀回章節序號與捲動比例", async () => {
    await seedBookWithChapters();

    await saveProgress("b1", "c2", 0.5);

    const p = await getProgress("b1");
    expect(p).not.toBeNull();
    expect(p!.chapterId).toBe("c2");
    expect(p!.chapterIdx).toBe(2);
    expect(p!.scrollRatio).toBeCloseTo(0.5);
  });

  it("scrollRatio 超出 [0,1] 會被夾住", async () => {
    await seedBookWithChapters();

    await saveProgress("b1", "c1", 1.5);
    expect((await getProgress("b1"))!.scrollRatio).toBe(1);

    await saveProgress("b1", "c1", -0.3);
    expect((await getProgress("b1"))!.scrollRatio).toBe(0);
  });

  it("每本書每位使用者只一筆：再存會 upsert 覆蓋（換章）", async () => {
    await seedBookWithChapters();

    await saveProgress("b1", "c1", 0.2);
    await saveProgress("b1", "c2", 0.8);

    const p = await getProgress("b1");
    expect(p!.chapterId).toBe("c2");
    expect(p!.chapterIdx).toBe(2);
    expect(p!.scrollRatio).toBeCloseTo(0.8);
  });
});
