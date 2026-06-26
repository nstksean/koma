import { KomaCat } from "@/components/brand/koma-cat";

/**
 * 搜尋頁的 loading skeleton。
 * server action 觸發 SearchPage 重新渲染（await searchBooks）時撐住等待感，
 * 版面對齊 app/search/page.tsx（max-w-2xl、列表 divide-border）。
 */
const ROW_COUNT = 6;

export default function SearchLoading() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-6 pt-safe-6" aria-busy="true">
      {/* header：返回鍵 + 搜尋框 + 主題切換 */}
      <div className="mb-6 flex items-center gap-2">
        <div className="size-11 shrink-0 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
        <div className="h-11 flex-1 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
        <div className="size-11 shrink-0 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
      </div>

      {/* 結果筆數列 */}
      <div className="mb-4 h-4 w-32 animate-pulse motion-reduce:animate-none rounded bg-muted" />

      {/* 結果列表 */}
      <ul className="divide-y divide-border">
        {Array.from({ length: ROW_COUNT }, (_, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <div className="size-5 shrink-0 animate-pulse motion-reduce:animate-none rounded bg-muted" />
            <div
              className="h-4 animate-pulse motion-reduce:animate-none rounded bg-muted"
              style={{ width: `${55 + ((i * 7) % 35)}%` }}
            />
          </li>
        ))}
      </ul>

      {/* 載入時的品牌貓(DESIGN:載入是貓的出現點之一);筆順描繪帶出陪伴感。 */}
      <div className="mt-10 flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <KomaCat size={72} drawing className="text-brand" />
        <span>貓正在翻書…</span>
      </div>
    </main>
  );
}
