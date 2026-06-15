import { notFound } from "next/navigation";
import { getChapterView } from "@/lib/books";
import { getProgress } from "@/lib/progress";
import { ReaderView } from "@/components/reader/reader-view";

export default async function ReadPage({
  params,
}: {
  params: Promise<{ source: string; id: string; idx: string }>;
}) {
  const { source, id, idx } = await params;
  const sourceBookId = decodeURIComponent(id);
  const idxNum = Number(idx);
  if (!Number.isInteger(idxNum)) notFound();

  const view = await getChapterView(source, sourceBookId, idxNum).catch(() => null);
  if (!view) notFound();

  const prog = await getProgress(view.book.id);
  const initialScrollRatio =
    prog && prog.chapterId === view.chapter.id ? prog.scrollRatio : 0;

  return (
    <ReaderView
      source={source}
      sourceBookId={sourceBookId}
      bookId={view.book.id}
      bookTitle={view.book.title}
      chapterId={view.chapter.id}
      chapterTitle={view.chapter.title}
      content={view.content}
      idx={view.chapter.idx}
      prevIdx={view.prevIdx}
      nextIdx={view.nextIdx}
      position={view.position}
      totalChapters={view.totalChapters}
      initialScrollRatio={initialScrollRatio}
    />
  );
}
