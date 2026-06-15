"use client";

import { List, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ChapterList } from "@/components/chapter-list";
import { listChaptersAction } from "@/app/actions";

interface ChapterRef {
  idx: number;
  title: string;
}

interface ChapterDrawerProps {
  source: string;
  sourceBookId: string;
  currentIdx: number;
}

export function ChapterDrawer({
  source,
  sourceBookId,
  currentIdx,
}: ChapterDrawerProps) {
  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState<ChapterRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 開啟時才延遲載入目錄（避免每次進閱讀器都塞整本目錄）。
  useEffect(() => {
    if (!open || chapters || loading) return;
    setLoading(true);
    listChaptersAction(source, sourceBookId)
      .then((cs) => setChapters(cs.map((c) => ({ idx: c.idx, title: c.title }))))
      .catch(() => setChapters([]))
      .finally(() => setLoading(false));
  }, [open, chapters, loading, source, sourceBookId]);

  // Esc 關閉 + 鎖背景捲動。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="章節目錄"
        onClick={() => setOpen(true)}
      >
        <List />
      </Button>

      {/* Portal 到 body：脫離有 backdrop-blur 的 header（否則 fixed 定位/堆疊會被困住）。 */}
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-0 flex h-full w-[min(22rem,88vw)] flex-col bg-background shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-medium">章節目錄</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="關閉目錄"
                  onClick={() => setOpen(false)}
                >
                  <X />
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                {loading || !chapters ? (
                  <p className="p-4 text-sm text-muted-foreground">載入中…</p>
                ) : (
                  <ChapterList
                    source={source}
                    sourceBookId={sourceBookId}
                    chapters={chapters}
                    currentIdx={currentIdx}
                    onNavigate={() => setOpen(false)}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
