"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Search } from "lucide-react";
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

const RENDER_CAP = 300;

export function ChapterList({
  source,
  sourceBookId,
  chapters,
  currentIdx,
  onNavigate,
}: ChapterListProps) {
  const [query, setQuery] = useState("");
  const [asc, setAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q
      ? chapters.filter((c) => c.title.includes(q) || String(c.idx).includes(q))
      : chapters;
    return [...list].sort((a, b) => (asc ? a.idx - b.idx : b.idx - a.idx));
  }, [chapters, query, asc]);

  const shown = filtered.slice(0, RENDER_CAP);
  const href = (idx: number) =>
    `/read/${source}/${encodeURIComponent(sourceBookId)}/${idx}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋章節（標題或章號）"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setAsc((a) => !a)}
          aria-label={asc ? "改為倒序" : "改為正序"}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input hover:bg-accent"
        >
          {asc ? <ArrowDownAZ className="size-4" /> : <ArrowUpAZ className="size-4" />}
        </button>
      </div>

      <p className="px-3 pb-1 text-xs text-muted-foreground">
        共 {filtered.length} 章
        {filtered.length > RENDER_CAP ? `（顯示前 ${RENDER_CAP}，請用搜尋縮小）` : ""}
      </p>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {shown.map((c) => (
          <li key={c.idx}>
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
