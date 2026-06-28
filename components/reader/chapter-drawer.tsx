"use client";

import { List, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Dialog } from "radix-ui";
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

// Radix Dialog 已負責 Esc 關閉、背景 scroll-lock、focus trap、關閉還焦觸發鈕、
// aria-modal/role/labelledby、backdrop 與 SSR-safe portal —— 故全部不再手刻。
export function ChapterDrawer({
  source,
  sourceBookId,
  currentIdx,
}: ChapterDrawerProps) {
  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState<ChapterRef[] | null>(null);
  const [loading, setLoading] = useState(false);

  // 開啟目錄=使用者動作:首次開啟才延遲載入整本目錄,之後沿用已載入的清單。
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next || chapters || loading) return;
      setLoading(true);
      listChaptersAction(source, sourceBookId)
        .then((cs) => setChapters(cs.map((c) => ({ idx: c.idx, title: c.title }))))
        .catch(() => setChapters([]))
        .finally(() => setLoading(false));
    },
    [chapters, loading, source, sourceBookId],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="章節目錄">
          <List />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed right-0 top-0 z-50 flex h-full w-[min(22rem,88vw)] flex-col bg-background shadow-xl outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-3 pb-2 pt-safe-2">
            <Dialog.Title className="text-sm font-medium">章節目錄</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="關閉目錄">
                <X />
              </Button>
            </Dialog.Close>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
