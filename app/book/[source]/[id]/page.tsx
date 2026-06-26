import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CloudOff } from "lucide-react";
import { getOrFetchBook, type BookWithChapters } from "@/lib/books";
import { isInLibrary } from "@/lib/library";
import { getProgress } from "@/lib/progress";
import { LibraryButton } from "@/components/library-button";
import { ChapterList } from "@/components/chapter-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { RetryButton } from "./retry-button";

/**
 * 判斷抓書失敗是否屬於「來源站確實沒有這本書」(→ 真 404),
 * 而非暫時性的來源故障(網路 / 5xx / 解析失敗 → 可重試)。
 * 來源 adapter 以 `fetch 失敗 <status> ...` 帶出 HTTP 狀態;
 * 404/410 視為 not-found,其餘(含本地書缺漏)一律當暫時性錯誤可重試。
 */
function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/找不到本地書/.test(msg)) return true; // 自帶書且 DB 無此筆 → 真的不存在
  return /fetch 失敗 (404|410)\b/.test(msg);
}

export default async function BookPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source, id } = await params;
  const sourceBookId = decodeURIComponent(id);

  let data: BookWithChapters;
  try {
    data = await getOrFetchBook(source, sourceBookId);
  } catch (err) {
    if (isNotFoundError(err)) notFound();
    // 來源站暫時性故障:不要當 404,給「重新整理」重試入口。
    return <BookFetchError />;
  }
  const { book, chapters } = data;

  const progress = await getProgress(book.id);
  const startIdx = progress?.chapterIdx ?? chapters[0]?.idx;
  const readHref =
    startIdx !== undefined
      ? `/read/${source}/${encodeURIComponent(sourceBookId)}/${startIdx}`
      : null;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-6 pt-safe-6">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="回首頁">
          <ArrowLeft />
        </Link>
        <ThemeToggle />
      </header>

      <section className="mb-6">
        <div className="flex gap-4">
          {/* 書封來自來源站（next.config images.remotePatterns 已放行）；無封面則以圖示佔位。 */}
          <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            {book.cover ? (
              <Image
                src={book.cover}
                alt={`《${book.title}》封面`}
                fill
                sizes="96px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <BookOpen className="size-8" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{book.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[book.author, book.category].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
        {book.intro && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
            {book.intro}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {readHref && (
            <Link href={readHref} className={buttonVariants({ variant: "default" })}>
              <BookOpen />
              {progress ? "續讀" : "開始閱讀"}
            </Link>
          )}
          <LibraryButton bookId={book.id} initialInLibrary={await isInLibrary(book.id)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          章節目錄（{chapters.length}）
        </h2>
        <div className="h-[60vh] overflow-hidden rounded-md border border-border">
          <ChapterList
            source={source}
            sourceBookId={sourceBookId}
            chapters={chapters.map((c) => ({ idx: c.idx, title: c.title }))}
            currentIdx={progress?.chapterIdx}
          />
        </div>
      </section>
    </main>
  );
}

/** 來源站暫時性故障的友善錯誤頁:不洩漏來源站名稱,提供「重新整理」重試。 */
function BookFetchError() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-6 pt-safe-6">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="回首頁">
          <ArrowLeft />
        </Link>
        <ThemeToggle />
      </header>

      <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
        <CloudOff className="mx-auto mb-3 size-10 text-muted-foreground/70" />
        <p className="mb-1 font-medium text-foreground">暫時讀取不到這本書</p>
        <p className="mb-5 text-sm">可能是連線不穩或來源暫時無回應，稍後再試一次。</p>
        <div className="flex justify-center">
          <RetryButton />
        </div>
      </div>
    </main>
  );
}
