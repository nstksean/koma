import { beforeEach, describe, expect, it, vi } from "vitest";

// fakeAdapter 在 vi.mock 工廠中被引用 → 必須以 vi.hoisted 提升。
const { fakeAdapter } = vi.hoisted(() => ({
  fakeAdapter: {
    id: "ttkan",
    name: "天天看小說",
    baseUrl: "https://tw.ttkan.co",
    search: vi.fn(),
    getBook: vi.fn(),
    getChapters: vi.fn(),
    getChapterContent: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", async () => {
  const helper =
    await vi.importActual<typeof import("@/tests/helpers/test-db")>(
      "@/tests/helpers/test-db",
    );
  return { db: helper.activeDbProxy };
});

vi.mock("@/src/sources", () => ({
  getAdapter: (source: string) => (source === "ttkan" ? fakeAdapter : null),
  DEFAULT_SOURCE: "ttkan",
}));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters } from "@/db/schema";
import { getChapterView, getOrFetchBook } from "@/lib/books";
import { createTestDb, setActiveDb } from "@/tests/helpers/test-db";

const SOURCE = "ttkan";
const SLUG = "doupocangqiong";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    source: SOURCE,
    sourceBookId: SLUG,
    title: "鬥破蒼穹",
    author: "天蠶土豆",
    category: "玄幻",
    cover: "https://img/cover.jpg",
    intro: "三十年河東",
    ...overrides,
  };
}

function ref(idx: number) {
  return { idx, title: `第${idx}章`, url: `https://tw.ttkan.co/c/${SLUG}/${idx}` };
}

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  vi.clearAllMocks();
  setActiveDb(await createTestDb());
});

describe("getOrFetchBook", () => {
  it("DB 無此書 → 回來源站抓取並寫入 book + 章節目錄", async () => {
    fakeAdapter.getBook.mockResolvedValue(detail());
    fakeAdapter.getChapters.mockResolvedValue([ref(1), ref(2), ref(3)]);

    const { book, chapters: chs } = await getOrFetchBook(SOURCE, SLUG);

    expect(fakeAdapter.getBook).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.getChapters).toHaveBeenCalledTimes(1);
    expect(book.title).toBe("鬥破蒼穹");
    expect(book.latestChapterTitle).toBe("第3章");
    expect(chs.map((c) => c.idx)).toEqual([1, 2, 3]); // 依 idx 遞增
    // 目錄階段不抓內文：目錄回傳已不含 content（projection），直接查 DB 驗證。
    const stored = await db.select().from(chapters);
    expect(stored.every((c) => c.content === null)).toBe(true);
  });

  it("命中且未過期 → 直接讀 DB，不打來源站", async () => {
    await db.insert(books).values({
      id: "b1",
      source: SOURCE,
      sourceBookId: SLUG,
      title: "鬥破蒼穹",
      author: "天蠶土豆",
      category: "玄幻",
      cover: null,
      intro: null,
      latestChapterTitle: "第2章",
      fetchedAt: new Date(), // 剛抓，新鮮
    });
    await db.insert(chapters).values([
      { id: "c1", bookId: "b1", idx: 1, title: "第1章", sourceUrl: "u1", content: null, fetchedAt: null },
      { id: "c2", bookId: "b1", idx: 2, title: "第2章", sourceUrl: "u2", content: null, fetchedAt: null },
    ]);

    const { book, chapters: chs } = await getOrFetchBook(SOURCE, SLUG);

    expect(fakeAdapter.getBook).not.toHaveBeenCalled();
    expect(fakeAdapter.getChapters).not.toHaveBeenCalled();
    expect(book.id).toBe("b1");
    expect(chs).toHaveLength(2);
  });

  it("未知書源（無 adapter 且 DB 無此書）→ 丟『找不到本地書』", async () => {
    await expect(getOrFetchBook("unknown", "x")).rejects.toThrow(
      "找不到本地書",
    );
  });

  it("adapter getBook 失敗 → 錯誤往上拋且不寫入 book", async () => {
    fakeAdapter.getBook.mockRejectedValue(new Error("fetch 失敗 500"));
    fakeAdapter.getChapters.mockResolvedValue([ref(1)]);

    await expect(getOrFetchBook(SOURCE, SLUG)).rejects.toThrow("fetch 失敗 500");
    expect(await db.select().from(books)).toHaveLength(0);
  });

  it("命中但已過期 → 重抓、更新 book、只補缺章，且不覆寫已快取內文", async () => {
    const stale = new Date(Date.now() - 7 * HOUR); // 超過 6h TTL
    await db.insert(books).values({
      id: "b1",
      source: SOURCE,
      sourceBookId: SLUG,
      title: "鬥破蒼穹",
      author: "天蠶土豆",
      category: "玄幻",
      cover: null,
      intro: null,
      latestChapterTitle: "第1章",
      fetchedAt: stale,
    });
    await db.insert(chapters).values({
      id: "c1",
      bookId: "b1",
      idx: 1,
      title: "第1章",
      sourceUrl: "u1",
      content: "已快取內文",
      fetchedAt: stale,
    });

    fakeAdapter.getBook.mockResolvedValue(detail({ author: "土豆" }));
    fakeAdapter.getChapters.mockResolvedValue([ref(1), ref(2), ref(3)]);

    const { book, chapters: chs } = await getOrFetchBook(SOURCE, SLUG);

    expect(fakeAdapter.getBook).toHaveBeenCalledTimes(1);
    expect(book.id).toBe("b1"); // 沿用既有列
    expect(book.author).toBe("土豆"); // 詳情被更新
    expect(book.latestChapterTitle).toBe("第3章"); // 最新章更新
    expect(book.fetchedAt.getTime()).toBeGreaterThan(stale.getTime());

    expect(chs.map((c) => c.idx)).toEqual([1, 2, 3]);
    // 目錄回傳不含 content（projection）；改查 DB 驗「不覆寫已快取內文、新章為 null」。
    const [c1row] = await db.select().from(chapters).where(eq(chapters.idx, 1));
    expect(c1row.content).toBe("已快取內文"); // 關鍵：不被覆寫
    const [c2row] = await db.select().from(chapters).where(eq(chapters.idx, 2));
    expect(c2row.content).toBeNull(); // 新補的章
  });

});

describe("getChapterView", () => {
  async function seedFreshBook() {
    await db.insert(books).values({
      id: "b1",
      source: SOURCE,
      sourceBookId: SLUG,
      title: "鬥破蒼穹",
      author: "天蠶土豆",
      category: "玄幻",
      cover: null,
      intro: null,
      latestChapterTitle: "第3章",
      fetchedAt: new Date(),
    });
    await db.insert(chapters).values([
      { id: "c1", bookId: "b1", idx: 1, title: "第1章", sourceUrl: "u1", content: null, fetchedAt: null },
      { id: "c2", bookId: "b1", idx: 2, title: "第2章", sourceUrl: "u2", content: null, fetchedAt: null },
      { id: "c3", bookId: "b1", idx: 3, title: "第3章", sourceUrl: "u3", content: null, fetchedAt: null },
    ]);
  }

  it("內文為 null → 抓一次並寫快取；二次讀取走 DB（不再打來源站）", async () => {
    await seedFreshBook();
    fakeAdapter.getChapterContent.mockResolvedValue("第二章內文……");

    const first = await getChapterView(SOURCE, SLUG, 2);
    expect(first.content).toBe("第二章內文……");
    expect(first.prevIdx).toBe(1);
    expect(first.nextIdx).toBe(3);
    expect(first.totalChapters).toBe(3);
    expect(fakeAdapter.getChapterContent).toHaveBeenCalledTimes(1);

    const second = await getChapterView(SOURCE, SLUG, 2);
    expect(second.content).toBe("第二章內文……");
    expect(fakeAdapter.getChapterContent).toHaveBeenCalledTimes(1); // 仍是 1：走快取
  });

  it("深連結（DB 尚無此書）→ 自動補抓 book + 目錄後回傳該章", async () => {
    fakeAdapter.getBook.mockResolvedValue(detail());
    fakeAdapter.getChapters.mockResolvedValue([ref(1), ref(2), ref(3)]);
    fakeAdapter.getChapterContent.mockResolvedValue("深連結內文");

    const view = await getChapterView(SOURCE, SLUG, 2);

    expect(fakeAdapter.getBook).toHaveBeenCalledTimes(1);
    expect(view.book.title).toBe("鬥破蒼穹");
    expect(view.chapter.idx).toBe(2);
    expect(view.content).toBe("深連結內文");
    expect(view.prevIdx).toBe(1);
    expect(view.nextIdx).toBe(3);
  });

  it("第一章 → prevIdx 為 null、nextIdx 指向下一章、position=1", async () => {
    await seedFreshBook();
    fakeAdapter.getChapterContent.mockResolvedValue("內文");
    const view = await getChapterView(SOURCE, SLUG, 1);
    expect(view.prevIdx).toBeNull();
    expect(view.nextIdx).toBe(2);
    expect(view.position).toBe(1);
    expect(view.totalChapters).toBe(3);
  });

  it("最後一章 → nextIdx 為 null、position=total", async () => {
    await seedFreshBook();
    fakeAdapter.getChapterContent.mockResolvedValue("內文");
    const view = await getChapterView(SOURCE, SLUG, 3);
    expect(view.prevIdx).toBe(2);
    expect(view.nextIdx).toBeNull();
    expect(view.position).toBe(3);
    expect(view.totalChapters).toBe(3);
  });

  it("idx 非連續（缺號）→ prev/next 取相鄰實存 idx、position 為序位非 idx", async () => {
    await db.insert(books).values({
      id: "bgap",
      source: SOURCE,
      sourceBookId: SLUG,
      title: "缺號書",
      author: "a",
      category: "",
      cover: null,
      intro: null,
      latestChapterTitle: "第50章",
      fetchedAt: new Date(),
    });
    // idx 跳號：10、20、50。對 idx=20：prev=10、next=50、position=2/3。
    await db.insert(chapters).values([
      { id: "g1", bookId: "bgap", idx: 10, title: "第10章", sourceUrl: "u10", content: "c10", fetchedAt: new Date() },
      { id: "g2", bookId: "bgap", idx: 20, title: "第20章", sourceUrl: "u20", content: "c20", fetchedAt: new Date() },
      { id: "g3", bookId: "bgap", idx: 50, title: "第50章", sourceUrl: "u50", content: "c50", fetchedAt: new Date() },
    ]);
    const view = await getChapterView(SOURCE, SLUG, 20);
    expect(view.content).toBe("c20"); // 只回目標章內文
    expect(view.prevIdx).toBe(10);
    expect(view.nextIdx).toBe(50);
    expect(view.position).toBe(2);
    expect(view.totalChapters).toBe(3);
    // 解耦驗證：目標章內文與相鄰章無關，不受其他章 content 干擾。
    expect(view.chapter.idx).toBe(20);
  });

  it("單章書 → prev/next 皆 null、position=total=1", async () => {
    await db.insert(books).values({
      id: "bsolo",
      source: SOURCE,
      sourceBookId: SLUG,
      title: "單章書",
      author: "a",
      category: "",
      cover: null,
      intro: null,
      latestChapterTitle: "唯一章",
      fetchedAt: new Date(),
    });
    await db.insert(chapters).values({
      id: "s1", bookId: "bsolo", idx: 1, title: "唯一章", sourceUrl: "us", content: "only", fetchedAt: new Date(),
    });
    const view = await getChapterView(SOURCE, SLUG, 1);
    expect(view.prevIdx).toBeNull();
    expect(view.nextIdx).toBeNull();
    expect(view.position).toBe(1);
    expect(view.totalChapters).toBe(1);
  });

  it("章節 idx 不存在 → 丟錯", async () => {
    await seedFreshBook();
    await expect(getChapterView(SOURCE, SLUG, 99)).rejects.toThrow(
      "找不到章節 idx=99",
    );
  });

  it("內文為 null 且 adapter 抓取失敗 → 錯誤往上拋且不寫入快取", async () => {
    await seedFreshBook();
    fakeAdapter.getChapterContent.mockRejectedValue(
      new Error("fetch 失敗 502"),
    );

    await expect(getChapterView(SOURCE, SLUG, 2)).rejects.toThrow(
      "fetch 失敗 502",
    );
    // 抓取失敗 → DB 內該章 content 仍為 null（未被寫入髒資料）。
    const [c2] = await db.select().from(chapters).where(eq(chapters.idx, 2));
    expect(c2.content).toBeNull();
  });
});

// 無對應 adapter 的來源 = 自帶書（BYO）：只讀 DB，不回任何來源站抓取。
describe("本地書（無 adapter 的來源）", () => {
  const LOCAL = "local";

  async function seedLocalBook(content: string | null) {
    await db.insert(books).values({
      id: "lb1",
      source: LOCAL,
      sourceBookId: "my-book",
      title: "自帶的書",
      author: "我",
      category: "",
      cover: null,
      intro: null,
      latestChapterTitle: "第1章",
      fetchedAt: new Date(0), // 即使「過期」也不該觸發抓取
    });
    await db.insert(chapters).values({
      id: "lc1",
      bookId: "lb1",
      idx: 1,
      title: "第1章",
      sourceUrl: "",
      content,
      fetchedAt: content ? new Date() : null,
    });
  }

  it("getOrFetchBook：DB 有 → 直接讀 DB（即便過期也不抓）", async () => {
    await seedLocalBook("本地內文");
    const { book, chapters: chs } = await getOrFetchBook(LOCAL, "my-book");
    expect(book.id).toBe("lb1");
    expect(chs).toHaveLength(1);
  });

  it("getOrFetchBook：DB 無 → 丟『找不到本地書』", async () => {
    await expect(getOrFetchBook(LOCAL, "missing")).rejects.toThrow(
      "找不到本地書",
    );
  });

  it("getChapterView：有內文 → 直接回，不嘗試抓取", async () => {
    await seedLocalBook("本地內文");
    const view = await getChapterView(LOCAL, "my-book", 1);
    expect(view.content).toBe("本地內文");
    expect(fakeAdapter.getChapterContent).not.toHaveBeenCalled();
  });

  it("getChapterView：內文為 null → 丟『本地書缺少內文』", async () => {
    await seedLocalBook(null);
    await expect(getChapterView(LOCAL, "my-book", 1)).rejects.toThrow(
      "本地書缺少內文",
    );
  });

  it("getChapterView：DB 無此書 → 丟『找不到本地書』", async () => {
    await expect(getChapterView(LOCAL, "missing", 1)).rejects.toThrow(
      "找不到本地書",
    );
  });
});
