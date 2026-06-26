"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Crosshair, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ChapterRef {
  idx: number;
  title: string;
}

interface ChapterListProps {
  source: string;
  sourceBookId: string;
  chapters: readonly ChapterRef[];
  currentIdx?: number;
  onNavigate?: () => void;
}

// ponytail: fixed 100-chapter window; revisit only if someone wants a configurable size.
const CHUNK = 100;

export function ChapterList({
  source,
  sourceBookId,
  chapters,
  currentIdx,
  onNavigate,
}: ChapterListProps) {
  const [query, setQuery] = useState("");
  const [asc, setAsc] = useState(true);
  const [winStart, setWinStart] = useState(0);
  // 「跳到目前章」按下後待捲動到目前章那列(等切換到正確 window 後的下一次 render)。
  // 用 ref 而非 state:它只是個一次性旗標,不需觸發 render。
  const pendingJumpRef = useRef(false);
  const currentRowRef = useRef<HTMLLIElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q
      ? chapters.filter((c) => c.title.includes(q) || String(c.idx).includes(q))
      : chapters;
    return [...list].sort((a, b) => (asc ? a.idx - b.idx : b.idx - a.idx));
  }, [chapters, query, asc]);

  // Reset to the first window whenever the result set changes shape.
  useEffect(() => setWinStart(0), [query, asc]);

  const windowed = filtered.length > CHUNK;
  const start = winStart < filtered.length ? winStart : 0;
  const shown = windowed ? filtered.slice(start, start + CHUNK) : filtered;
  const href = (idx: number) =>
    `/read/${source}/${encodeURIComponent(sourceBookId)}/${idx}`;

  // 目前章在 filtered 中是否存在(可能被搜尋過濾掉)。
  const hasCurrent =
    currentIdx !== undefined &&
    filtered.some((c) => c.idx === currentIdx);

  // 切換到包含目前章的 window,標記待捲動。
  function jumpToCurrent() {
    if (currentIdx === undefined) return;
    const pos = filtered.findIndex((c) => c.idx === currentIdx);
    if (pos < 0) return;
    const targetWin = windowed ? Math.floor(pos / CHUNK) * CHUNK : 0;
    pendingJumpRef.current = true;
    if (targetWin === start) flushJump();
    else setWinStart(targetWin); // window 變更會重 render,由下方 effect 接手捲動
  }

  // 把目前章那列捲進可視範圍(已在正確 window 才有 ref)。
  function flushJump() {
    if (!pendingJumpRef.current) return;
    pendingJumpRef.current = false;
    currentRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // window 切到位後,把目前章那列捲進可視範圍。
  useEffect(flushJump, [start]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋章節（標題或章號）"
            className="h-11 w-full pl-8 pr-3 text-sm"
          />
        </div>
        {hasCurrent && (
          <button
            type="button"
            onClick={jumpToCurrent}
            aria-label="跳到目前章"
            title="跳到目前章"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input text-primary transition-colors hover:bg-accent active:bg-accent"
          >
            <Crosshair className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setAsc((a) => !a)}
          aria-label={asc ? "改為倒序" : "改為正序"}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input transition-colors hover:bg-accent active:bg-accent"
        >
          {asc ? <ArrowDownAZ className="size-4" /> : <ArrowUpAZ className="size-4" />}
        </button>
      </div>

      <p className="px-3 pb-1 text-xs text-muted-foreground">
        共 {filtered.length} 章
        {windowed && shown.length > 0
          ? `（${shown[0].idx}–${shown[shown.length - 1].idx}）`
          : ""}
      </p>

      {windowed && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {Array.from(
            { length: Math.ceil(filtered.length / CHUNK) },
            (_, i) => i * CHUNK,
          ).map((s) => {
            const a = filtered[s].idx;
            const b = filtered[Math.min(s + CHUNK, filtered.length) - 1].idx;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setWinStart(s)}
                className={cn(
                  "shrink-0 rounded-full border border-input px-3 py-1.5 text-xs transition-colors hover:bg-accent active:bg-accent",
                  start === s && "bg-accent font-medium",
                )}
              >
                {a}–{b}
              </button>
            );
          })}
        </div>
      )}

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {shown.map((c) => (
          <li key={c.idx} ref={currentIdx === c.idx ? currentRowRef : undefined}>
            <Link
              href={href(c.idx)}
              onClick={onNavigate}
              className={cn(
                "block px-3 py-2.5 text-sm transition-colors hover:bg-accent/50",
                currentIdx === c.idx && "bg-accent font-medium",
              )}
            >
              {c.title}
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            查無章節
          </li>
        )}
      </ul>
    </div>
  );
}
