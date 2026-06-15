"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChapterDrawer } from "@/components/reader/chapter-drawer";
import { saveProgressAction } from "@/app/actions";
import { cn } from "@/lib/utils";

interface ReaderViewProps {
  source: string;
  sourceBookId: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  content: string;
  idx: number;
  prevIdx: number | null;
  nextIdx: number | null;
  position: number;
  totalChapters: number;
  initialScrollRatio: number;
}

type FontFamily = "serif" | "sans";

interface ReaderSettings {
  fontSize: number; // rem
  lineHeight: number;
  fontFamily: FontFamily;
}

const SETTINGS_KEY = "koma:reader";
const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 1.125,
  lineHeight: 1.9,
  fontFamily: "serif",
};
const FONT_MIN = 0.875;
const FONT_MAX = 1.75;
const LH_MIN = 1.4;
const LH_MAX = 2.4;
const SAVE_DELAY = 800;

function loadSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* 壞掉的設定就用預設 */
  }
  return DEFAULT_SETTINGS;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function ReaderView({
  source,
  sourceBookId,
  bookId,
  bookTitle,
  chapterId,
  chapterTitle,
  content,
  idx,
  prevIdx,
  nextIdx,
  position,
  totalChapters,
  initialScrollRatio,
}: ReaderViewProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafPending = useRef(false);

  const chapterHref = (n: number) =>
    `/read/${source}/${encodeURIComponent(sourceBookId)}/${n}`;

  useEffect(() => setSettings(loadSettings()), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* 忽略寫入失敗 */
    }
  }, [settings]);

  // 還原上次捲動位置。
  useEffect(() => {
    if (initialScrollRatio <= 0) return;
    const id = requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * initialScrollRatio });
    });
    return () => cancelAnimationFrame(id);
  }, [initialScrollRatio, chapterId]);

  const flushProgress = useCallback(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    void saveProgressAction(bookId, chapterId, ratio).catch(() => {});
  }, [bookId, chapterId]);

  // 捲動：更新進度條 + debounce 存進度；離開頁面即時存。
  useEffect(() => {
    function updatePct() {
      rafPending.current = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollPct(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0);
    }
    function onScroll() {
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(updatePct);
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushProgress, SAVE_DELAY);
    }
    function onHide() {
      if (document.visibilityState === "hidden") flushProgress();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    updatePct();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushProgress();
    };
  }, [flushProgress]);

  // 鍵盤左右鍵翻章（在輸入框內時不攔截）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && prevIdx !== null) router.push(chapterHref(prevIdx));
      if (e.key === "ArrowRight" && nextIdx !== null) router.push(chapterHref(nextIdx));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevIdx, nextIdx]);

  const paragraphs = content.split("\n").filter(Boolean);

  return (
    <div className="min-h-dvh">
      {/* 章內閱讀進度條 */}
      <div className="fixed left-0 top-0 z-20 h-[3px] w-full bg-transparent">
        <div
          className="h-full bg-primary transition-[width] duration-150"
          style={{ width: `${scrollPct}%` }}
        />
      </div>

      {/* 頂部工具列 */}
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-background/85 px-3 py-2 backdrop-blur">
        <Link
          href={`/book/${source}/${encodeURIComponent(sourceBookId)}`}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="回書籍頁"
        >
          <ArrowLeft />
        </Link>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-muted-foreground">{bookTitle}</span>
          <span className="text-xs text-muted-foreground/70">
            第 {position} / {totalChapters} 章
          </span>
        </span>
        <ChapterDrawer source={source} sourceBookId={sourceBookId} currentIdx={idx} />
        <Button
          variant="ghost"
          size="icon"
          aria-label="閱讀設定"
          onClick={() => setShowSettings((v) => !v)}
        >
          <Settings2 />
        </Button>
        <ThemeToggle />
      </header>

      {/* 設定面板 */}
      {showSettings && (
        <div className="border-b border-border bg-card px-4 py-3 text-sm">
          <SettingRow
            label="字級"
            value={`${Math.round(settings.fontSize * 16)}px`}
            onDec={() =>
              setSettings((s) => ({ ...s, fontSize: round(Math.max(FONT_MIN, s.fontSize - 0.0625)) }))
            }
            onInc={() =>
              setSettings((s) => ({ ...s, fontSize: round(Math.min(FONT_MAX, s.fontSize + 0.0625)) }))
            }
          />
          <SettingRow
            label="行距"
            value={settings.lineHeight.toFixed(1)}
            onDec={() =>
              setSettings((s) => ({ ...s, lineHeight: round(Math.max(LH_MIN, s.lineHeight - 0.1)) }))
            }
            onInc={() =>
              setSettings((s) => ({ ...s, lineHeight: round(Math.min(LH_MAX, s.lineHeight + 0.1)) }))
            }
          />
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground">字型</span>
            <div className="flex gap-2">
              <Button
                variant={settings.fontFamily === "serif" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSettings((s) => ({ ...s, fontFamily: "serif" }))}
              >
                明體
              </Button>
              <Button
                variant={settings.fontFamily === "sans" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSettings((s) => ({ ...s, fontFamily: "sans" }))}
              >
                黑體
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 內文 */}
      <article
        className={cn(
          "reader-content mx-auto max-w-2xl px-5 py-8",
          settings.fontFamily === "serif" ? "font-serif" : "font-sans",
        )}
        style={
          {
            "--reader-font-size": `${settings.fontSize}rem`,
            "--reader-line-height": String(settings.lineHeight),
          } as React.CSSProperties
        }
      >
        <h1 className="mb-6 text-xl font-semibold">{chapterTitle}</h1>
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-5 indent-8">
            {p}
          </p>
        ))}
      </article>

      {/* 上下章 */}
      <nav className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 pb-16">
        {prevIdx !== null ? (
          <Link href={chapterHref(prevIdx)} className={cn(buttonVariants({ variant: "outline" }), "flex-1")}>
            <ChevronLeft /> 上一章
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {nextIdx !== null ? (
          <Link href={chapterHref(nextIdx)} className={cn(buttonVariants({ variant: "outline" }), "flex-1")}>
            下一章 <ChevronRight />
          </Link>
        ) : (
          <span className="flex-1 text-center text-sm text-muted-foreground">已是最新章節</span>
        )}
      </nav>
    </div>
  );
}

function SettingRow({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" className="size-8" aria-label={`減少${label}`} onClick={onDec}>
          <Minus />
        </Button>
        <span className="w-14 text-center tabular-nums">{value}</span>
        <Button variant="outline" size="icon" className="size-8" aria-label={`增加${label}`} onClick={onInc}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}
