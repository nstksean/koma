import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { getOrFetchBook } from "@/lib/books";
import { isInLibrary } from "@/lib/library";
import { getProgress } from "@/lib/progress";
import { LibraryButton } from "@/components/library-button";
import { ChapterList } from "@/components/chapter-list";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

export default async function BookPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source, id } = await params;
  const sourceBookId = decodeURIComponent(id);

  const data = await getOrFetchBook(source, sourceBookId).catch(() => null);
  if (!data) notFound();
  const { book, chapters } = data;

  const progress = await getProgress(book.id);
  const startIdx = progress?.chapterIdx ?? chapters[0]?.idx;
  const readHref =
    startIdx !== undefined
      ? `/read/${source}/${encodeURIComponent(sourceBookId)}/${startIdx}`
      : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="回首頁">
          <ArrowLeft />
        </Link>
        <ThemeToggle />
      </header>

      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{book.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[book.author, book.category].filter(Boolean).join(" · ") || "—"}
        </p>
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
