/**
 * SourceAdapter — 書源抽象介面（階段 2 書源化的接縫）。
 * MVP 只有一個實作（TtkanAdapter）；上層 API / 頁面只依賴此介面。
 * 所有回傳皆為 immutable plain object（遵守 coding-style 不可變原則）。
 */

export interface SearchResult {
  readonly source: string;
  readonly sourceBookId: string; // slug
  readonly title: string;
  readonly author: string;
  readonly url: string;
}

export interface ChapterRef {
  readonly idx: number;
  readonly title: string;
  readonly url: string;
}

export interface BookDetail {
  readonly source: string;
  readonly sourceBookId: string;
  readonly title: string;
  readonly author: string;
  readonly category: string;
  readonly cover: string | null;
  readonly intro: string | null;
}

export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;

  search(keyword: string): Promise<readonly SearchResult[]>;
  getBook(sourceBookId: string): Promise<BookDetail>;
  getChapters(sourceBookId: string): Promise<readonly ChapterRef[]>;
  getChapterContent(chapterUrl: string): Promise<string>;
}
