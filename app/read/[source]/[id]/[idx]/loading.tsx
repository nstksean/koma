import { KomaCat } from "@/components/brand/koma-cat";

/**
 * 翻章載入態。read 頁是 fully dynamic(章節/進度/權限都打 DB),沒有這個
 * Suspense 邊界時 App Router 會「按住舊頁」直到新 RSC 到齊 —— 那就是點下一章
 * 後的延遲感。加了 loading.tsx,點擊瞬間即顯示這層,延遲被遮在 fallback 後面。
 * 版面對齊 reader-view(sticky header + max-w-2xl 內文),換頁不跳版。
 */
const LINE_COUNT = 8;

export default function ReadLoading() {
  return (
    <div className="min-h-dvh" aria-busy="true">
      {/* 頂部工具列骨架 */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/85 px-3 py-2 backdrop-blur">
        <div className="size-10 shrink-0 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="h-3.5 w-32 animate-pulse motion-reduce:animate-none rounded bg-muted" />
          <div className="h-3 w-20 animate-pulse motion-reduce:animate-none rounded bg-muted" />
        </div>
        <div className="size-10 shrink-0 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
        <div className="size-10 shrink-0 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
      </header>

      {/* 內文骨架 */}
      <article className="mx-auto max-w-2xl px-5 py-8">
        <div className="mb-8 h-7 w-1/2 animate-pulse motion-reduce:animate-none rounded bg-muted" />
        <div className="space-y-4">
          {Array.from({ length: LINE_COUNT }, (_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse motion-reduce:animate-none rounded bg-muted"
              style={{ width: `${70 + ((i * 11) % 30)}%` }}
            />
          ))}
        </div>
      </article>

      {/* 載入時的品牌貓(DESIGN:載入是貓的出現點之一)。 */}
      <div className="mx-auto mt-4 flex max-w-2xl flex-col items-center gap-2 px-5 text-sm text-muted-foreground">
        <KomaCat size={72} drawing className="text-brand" />
        <span>貓正在翻頁…</span>
      </div>
    </div>
  );
}
