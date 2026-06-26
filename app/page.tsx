import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ChevronRight, Search, Upload, UserRound } from "lucide-react";
import { getContinueReading, listLibrary, type LibrarySort } from "@/lib/library";
import { getServerAuth } from "@/lib/auth-server";
import { ThemeToggle } from "@/components/theme-toggle";
import { KomaCat } from "@/components/brand/koma-cat";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = { admin: "管理員", member: "會員", guest: "訪客" };

// 書架排序選項(query param ?sort=)。預設 recent,沿用既有「最近閱讀」行為。
const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySort; label: string }> = [
  { value: "recent", label: "最近閱讀" },
  { value: "title", label: "書名" },
  { value: "added", label: "加入時間" },
];

function parseSort(raw: string | undefined): LibrarySort {
  return SORT_OPTIONS.some((o) => o.value === raw) ? (raw as LibrarySort) : "recent";
}

async function searchAction(formData: FormData) {
  "use server";
  const q = String(formData.get("q") ?? "").trim();
  if (q) redirect(`/search?q=${encodeURIComponent(q)}`);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam);
  const [items, cont, auth] = await Promise.all([
    listLibrary(sort),
    getContinueReading(),
    getServerAuth(),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            <KomaCat size={38} stretch className="-mb-1 text-brand" />
            Koma
          </h1>
          <p className="text-sm text-muted-foreground">零廣告 · 乾淨 · 中文小說閱讀器</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/unlock"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            aria-label="帳號與聽書額度"
          >
            <UserRound /> {ROLE_LABEL[auth.role] ?? auth.role}
          </Link>
          <ThemeToggle />
        </div>
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
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(cont.scrollRatio * 100)}%` }}
                />
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                第 {cont.position} / {cont.totalChapters} 章
              </span>
            </span>
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">書架</h2>
          {items.length > 0 && (
            <div className="flex items-center gap-1" role="group" aria-label="書架排序">
              {SORT_OPTIONS.map((o) => (
                <Link
                  key={o.value}
                  href={o.value === "recent" ? "/" : `/?sort=${o.value}`}
                  aria-current={sort === o.value ? "true" : undefined}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition-colors",
                    sort === o.value
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-muted-foreground">
            <KomaCat size={104} className="mx-auto mb-3 text-brand/70" />
            <p className="mb-5">書架是空的。搜尋一本書加入書架，或匯入自己的書。</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/search" className={buttonVariants({ variant: "default" })}>
                <Search /> 搜尋書籍
              </Link>
              <Link href="/import" className={buttonVariants({ variant: "outline" })}>
                <Upload /> 匯入自帶書
              </Link>
            </div>
          </div>
        ) : (
          <ul
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
          >
            {items.map((item) => {
              const { book } = item;
              const href =
                item.lastChapterIdx !== null
                  ? `/read/${book.source}/${encodeURIComponent(book.sourceBookId)}/${item.lastChapterIdx}`
                  : `/book/${book.source}/${encodeURIComponent(book.sourceBookId)}`;
              const subtitle = item.lastChapterTitle
                ? `續讀：${item.lastChapterTitle}`
                : book.author || "尚未開始";
              return (
                <li key={book.id}>
                  <Link href={href} className="group block">
                    {/* 書封來自來源站；無封面則以圖示佔位。 */}
                    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-border bg-muted transition-colors group-hover:border-primary/60">
                      {book.cover ? (
                        <Image
                          src={book.cover}
                          alt={`《${book.title}》封面`}
                          fill
                          sizes="(max-width: 640px) 45vw, 150px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <BookOpen className="size-8" />
                        </div>
                      )}
                    </div>
                    <span className="mt-2 block truncate text-sm font-medium" title={book.title}>
                      {book.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {subtitle}
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
