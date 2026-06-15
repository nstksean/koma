"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addToLibrary, removeFromLibrary } from "@/lib/library";
import { saveProgress } from "@/lib/progress";
import { importBook } from "@/lib/import";
import { listChapterRefs, type ChapterRefLite } from "@/lib/books";

export async function addToLibraryAction(bookId: string): Promise<void> {
  await addToLibrary(bookId);
  revalidatePath("/");
}

export async function removeFromLibraryAction(bookId: string): Promise<void> {
  await removeFromLibrary(bookId);
  revalidatePath("/");
}

export async function saveProgressAction(
  bookId: string,
  chapterId: string,
  scrollRatio: number,
): Promise<void> {
  await saveProgress(bookId, chapterId, scrollRatio);
}

export async function listChaptersAction(
  source: string,
  sourceBookId: string,
): Promise<readonly ChapterRefLite[]> {
  return listChapterRefs(source, sourceBookId);
}

export interface ImportState {
  error?: string;
}

export async function importBookAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const title = String(formData.get("title") ?? "");
  const author = String(formData.get("author") ?? "");
  const file = formData.get("file");
  let text = String(formData.get("text") ?? "");
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  }

  let result;
  try {
    result = await importBook({ title, author, text });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "匯入失敗" };
  }

  revalidatePath("/");
  redirect(`/book/${result.source}/${encodeURIComponent(result.sourceBookId)}`);
}
