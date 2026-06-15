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

vi.mock("@/src/sources", () => ({
  getAdapter: (source: string) => (source === "ttkan" ? fakeAdapter : null),
  DEFAULT_SOURCE: "ttkan",
}));

import { searchBooks } from "@/lib/search";

const SOURCE = "ttkan";

function hit(slug: string, title: string) {
  return {
    source: SOURCE,
    sourceBookId: slug,
    title,
    author: "",
    url: `https://tw.ttkan.co/novel/chapters/${slug}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchBooks", () => {
  it("有結果 → 原樣回傳 adapter 的搜尋結果", async () => {
    const results = [hit("doupocangqiong", "鬥破蒼穹"), hit("wujidanshen", "武極")];
    fakeAdapter.search.mockResolvedValue(results);

    const out = await searchBooks("鬥破", SOURCE);

    expect(fakeAdapter.search).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.search).toHaveBeenCalledWith("鬥破");
    expect(out).toEqual(results);
  });

  it("不帶 source → 套用 DEFAULT_SOURCE", async () => {
    fakeAdapter.search.mockResolvedValue([]);

    await searchBooks("關鍵字");

    expect(fakeAdapter.search).toHaveBeenCalledTimes(1);
  });

  it("關鍵字前後空白 → trim 後才送進 adapter", async () => {
    fakeAdapter.search.mockResolvedValue([]);

    await searchBooks("  鬥破  ", SOURCE);

    expect(fakeAdapter.search).toHaveBeenCalledWith("鬥破");
  });

  it("空字串 / 全空白關鍵字 → 直接回空陣列，不打 adapter", async () => {
    expect(await searchBooks("", SOURCE)).toEqual([]);
    expect(await searchBooks("   ", SOURCE)).toEqual([]);
    expect(fakeAdapter.search).not.toHaveBeenCalled();
  });

  it("未知書源 → 丟「未知書源」錯誤", async () => {
    await expect(searchBooks("鬥破", "unknown")).rejects.toThrow(
      "未知書源：unknown",
    );
    expect(fakeAdapter.search).not.toHaveBeenCalled();
  });

  it("adapter fetch 失敗 → 錯誤往上拋（不被吞掉）", async () => {
    fakeAdapter.search.mockRejectedValue(
      new Error("fetch 失敗 503 Service Unavailable :: https://tw.ttkan.co"),
    );

    await expect(searchBooks("鬥破", SOURCE)).rejects.toThrow("fetch 失敗 503");
  });
});
