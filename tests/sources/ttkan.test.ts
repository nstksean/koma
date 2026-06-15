import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseSearch,
  parseBook,
  parseChapters,
  parseContent,
} from "@/src/sources/ttkan";

const FIX = path.join(process.cwd(), "tests/fixtures/ttkan");
const read = (f: string) => readFileSync(path.join(FIX, f), "utf-8");

const SLUG = "doupocangqiong-tiancantudou";

describe("ttkan parseSearch", () => {
  const results = parseSearch(read("search-doupo.html"));

  it("回傳至少一筆結果", () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it("每筆結構完整且去重", () => {
    const slugs = new Set<string>();
    for (const r of results) {
      expect(r.source).toBe("ttkan");
      expect(r.sourceBookId).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\/tw\.ttkan\.co\/novel\/chapters\//);
      expect(slugs.has(r.sourceBookId)).toBe(false); // 不重複
      slugs.add(r.sourceBookId);
    }
  });

  it("命中目標書（鬥破蒼穹）", () => {
    expect(results.some((r) => r.sourceBookId === SLUG)).toBe(true);
  });
});

describe("ttkan parseBook", () => {
  const book = parseBook(read(`book-${SLUG}.html`), SLUG);

  it("解析出書名 / 作者 / 分類", () => {
    expect(book.title).toContain("破蒼穹");
    expect(book.author).toBe("天蠶土豆");
    expect(book.category).toBe("玄幻小說");
    expect(book.sourceBookId).toBe(SLUG);
  });
});

describe("ttkan parseChapters", () => {
  const chapters = parseChapters(read(`book-${SLUG}.html`));

  it("回傳多章且依 idx 遞增排序", () => {
    expect(chapters.length).toBeGreaterThan(1);
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].idx).toBeGreaterThan(chapters[i - 1].idx);
    }
  });

  it("每章有 idx / title / pagea url", () => {
    for (const c of chapters) {
      expect(Number.isInteger(c.idx)).toBe(true);
      expect(c.title).toBeTruthy();
      expect(c.url).toMatch(/\/novel\/pagea\/.+_\d+\.html$/);
    }
  });
});

describe("ttkan parseContent", () => {
  const content = parseContent(read("content-chapter1.html"));

  it("抽出非空內文（多段）", () => {
    expect(content.length).toBeGreaterThan(100);
    expect(content.split("\n").length).toBeGreaterThan(1);
  });

  it("清掉來源站雜訊（導流 / 報錯字樣）", () => {
    expect(content).not.toMatch(/天天看小說|請記住本站|ttkan/i);
    expect(content).not.toMatch(/章節報錯|分享給朋友/);
  });
});
