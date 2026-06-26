"use client";

import { List, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ChapterList } from "@/components/chapter-list";
import { listChaptersAction } from "@/app/actions";
import { useMounted } from "@/lib/use-mounted";

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
  const mounted = useMounted();
  const titleId = useId();
  // 開啟前的觸發按鈕,關閉後把焦點還回去(focus restore)。
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 開啟目錄=使用者動作,故在 handler 內取資料(而非 effect):首次開啟才延遲
  // 載入整本目錄,之後沿用已載入的清單。
  const handleOpen = useCallback(() => {
    setOpen(true);
    if (chapters || loading) return;
    setLoading(true);
    listChaptersAction(source, sourceBookId)
      .then((cs) => setChapters(cs.map((c) => ({ idx: c.idx, title: c.title }))))
      .catch(() => setChapters([]))
      .finally(() => setLoading(false));
  }, [chapters, loading, source, sourceBookId]);

  // Esc 關閉 + 鎖背景捲動 + 焦點移入抽屜、關閉時還回觸發按鈕(focus trap 起手式)。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 開啟後把焦點移入抽屜面板(讓鍵盤/螢幕報讀使用者進到對話框內)。
    panelRef.current?.focus();
    // 觸發鈕在 effect 執行當下就抓住(它常駐渲染、身分穩定),cleanup 用這份快照
    // 還焦,避免 cleanup 時讀到已變動的 ref.current(react-hooks/exhaustive-deps)。
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // 關閉後把焦點還回原本的觸發按鈕。
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label="章節目錄"
        onClick={handleOpen}
      >
        <List />
      </Button>

      {/* Portal 到 body：脫離有 backdrop-blur 的 header（否則 fixed 定位/堆疊會被困住）。 */}
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />
            <div
              ref={panelRef}
              tabIndex={-1}
              className="absolute right-0 top-0 flex h-full w-[min(22rem,88vw)] flex-col bg-background shadow-xl outline-none"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span id={titleId} className="text-sm font-medium">章節目錄</span>
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
