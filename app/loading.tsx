import { KomaCat } from "@/components/brand/koma-cat";

/**
 * 全站路由切換的載入態(root segment 的 Suspense fallback)。
 * 品牌貓以「筆順」一筆一筆現身(DESIGN Motion:載入是貓的出現點之一),
 * 帶出陪伴感而非冷冰冰的 spinner。各路由若有自己的 loading.tsx 會覆寫此檔
 * (例:app/search/loading.tsx 用骨架 + 同一隻筆順貓)。
 */
export default function Loading() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
      aria-busy="true"
    >
      <KomaCat size={104} drawing label="載入中" className="text-brand" />
      <span className="text-sm text-muted-foreground">貓伸了個懶腰…</span>
    </main>
  );
}
