import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * 書籍詳情載入骨架。對齊書頁版面(max-w-2xl):封面、書名、簡介、章節列。
 * 無共用 Skeleton 元件,直接以 animate-pulse 方塊呈現;間距比照 DESIGN spacing。
 */
export default function BookLoading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6" aria-busy="true" aria-label="載入中">
      <header className="mb-4 flex items-center justify-between">
        <span className={buttonVariants({ variant: "ghost", size: "icon" })} aria-hidden>
          <ArrowLeft />
        </span>
      </header>

      <section className="mb-6">
        <div className="flex gap-4">
          {/* 封面占位(3/4 比例,對齊書頁封面) */}
          <div className="aspect-[3/4] w-24 shrink-0 animate-pulse rounded-md border border-border bg-muted" />
          <div className="min-w-0 flex-1 space-y-3 py-1">
            <div className="h-7 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
        {/* 簡介占位 */}
        <div className="mt-3 space-y-2">
          <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-5/6 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="h-10 w-28 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-28 animate-pulse rounded-md bg-muted" />
        </div>
      </section>

      <section>
        <div className="mb-2 h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-[60vh] overflow-hidden rounded-md border border-border">
          <ul className="divide-y divide-border">
            {Array.from({ length: 10 }, (_, i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
