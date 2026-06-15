import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ChevronRight, Search, Upload } from "lucide-react";
import { getContinueReading, listLibrary } from "@/lib/library";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

async function searchAction(formData: FormData) {
  "use server";
  const q = String(formData.get("q") ?? "").trim();
  if (q) redirect(`/search?q=${encodeURIComponent(q)}`);
}

export default async function HomePage() {
  const [items, cont] = await Promise.all([listLibrary(), getContinueReading()]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🐈 Koma</h1>
          <p className="text-sm text-muted-foreground">零廣告 · 乾淨 · 中文小說閱讀器</p>
        </div>
        <ThemeToggle />
      </header>

      {cont && (
        <Link
          href={`/read/${cont.book.source}/${encodeURIComponent(cont.book.sourceBookId)}/${cont.chapterIdx}`}
          className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <BookOpen className="size-6 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">繼續閱讀</span>
            <span className="block truncate font-medium">{cont.book.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{cont.chapterTitle}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <form action={searchAction} className="mb-8 flex gap-2">
        <input
          name="q"
          type="search"
          placeholder="搜尋書名或作者…"
          className="h-11 flex-1 rounded-md border border-input bg-transparent px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" className={buttonVariants({ variant: "default", size: "lg" })}>
          <Search /> 搜尋
        </button>
      </form>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">書架</h2>
          <Link
            href="/import"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <Upload className="size-4" /> 匯入自帶書
          </Link>
        </div>
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
            <BookOpen className="mx-auto mb-2 size-8 opacity-50" />
            <p>書架是空的。搜尋一本書，加入書架後就會出現在這裡。</p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {items.map((item) => {
              const { book } = item;
              const href =
                item.lastChapterIdx !== null
                  ? `/read/${book.source}/${encodeURIComponent(book.sourceBookId)}/${item.lastChapterIdx}`
                  : `/book/${book.source}/${encodeURIComponent(book.sourceBookId)}`;
              return (
                <li key={book.id}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:bg-accent/50"
                  >
                    <BookOpen className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{book.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.lastChapterTitle
                          ? `續讀：${item.lastChapterTitle}`
                          : (book.author || "尚未開始")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
