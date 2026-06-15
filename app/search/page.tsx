import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { searchBooks } from "@/lib/search";
import { DEFAULT_SOURCE, type SearchResult } from "@/src/sources";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const keyword = (q ?? "").trim();

  let results: readonly SearchResult[] = [];
  let error: string | null = null;
  if (keyword) {
    try {
      results = await searchBooks(keyword);
    } catch (e) {
      error = e instanceof Error ? e.message : "搜尋失敗";
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-center gap-2">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="回首頁">
          <ArrowLeft />
        </Link>
        <form action="/search" className="flex flex-1 gap-2">
          <input
            name="q"
            type="search"
            defaultValue={keyword}
            placeholder="搜尋書名或作者…"
            className="h-10 flex-1 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button type="submit" className={buttonVariants({ variant: "default" })}>
            搜尋
          </button>
        </form>
        <ThemeToggle />
      </header>

      {keyword && (
        <p className="mb-4 text-sm text-muted-foreground">
          「{keyword}」 — {error ? "發生錯誤" : `${results.length} 筆結果`}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border">
        {results.map((r) => (
          <li key={`${r.source}:${r.sourceBookId}`}>
            <Link
              href={`/book/${r.source}/${encodeURIComponent(r.sourceBookId)}`}
              className="flex items-center gap-3 py-3 transition-colors hover:bg-accent/50"
            >
              <BookOpen className="size-5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{r.title}</span>
            </Link>
          </li>
        ))}
      </ul>

      {keyword && !error && results.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">查無結果，換個關鍵字試試。</p>
      )}

      {!keyword && (
        <p className="py-12 text-center text-muted-foreground">
          輸入關鍵字開始搜尋（來源：{DEFAULT_SOURCE}）。
        </p>
      )}
    </main>
  );
}
