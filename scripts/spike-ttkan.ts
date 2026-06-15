/**
 * ttkan live smoke test — 對真實站台跑通整條鏈路（search → book → chapters → content）。
 *
 * 解析邏輯已收斂進 src/sources/ttkan.ts（並有 fixture 單元測試）。
 * 本 script 只負責「打真實網路、目視確認來源站沒改版」，當作偶爾手動跑的回歸檢查。
 *
 *   npm run spike            # 預設搜「斗破蒼穹」
 *   npm run spike -- 詭秘之主
 */
import { ttkanAdapter } from "../src/sources/ttkan";

async function main() {
  const keyword = process.argv[2] ?? "斗破蒼穹";
  console.log(`\n🔍 [search] 關鍵字：「${keyword}」`);
  const results = await ttkanAdapter.search(keyword);
  console.log(`   命中 ${results.length} 本，前 5：`);
  results.slice(0, 5).forEach((r, i) => console.log(`   ${i + 1}. ${r.title}  (${r.sourceBookId})`));
  if (results.length === 0) throw new Error("搜尋 0 命中 — selector 可能過期");

  const target = results[0];
  console.log(`\n📖 [getBook] ${target.sourceBookId}`);
  const book = await ttkanAdapter.getBook(target.sourceBookId);
  console.log(`   書名：${book.title}｜作者：${book.author}｜分類：${book.category}`);

  console.log(`\n📚 [getChapters]`);
  const chapters = await ttkanAdapter.getChapters(target.sourceBookId);
  console.log(`   共 ${chapters.length} 章。首章：${chapters[0]?.title}｜末章：${chapters.at(-1)?.title}`);
  if (chapters.length === 0) throw new Error("章節 0 筆 — selector 可能過期");

  const first = chapters[0];
  console.log(`\n📄 [getChapterContent] ${first.title}`);
  const content = await ttkanAdapter.getChapterContent(first.url);
  const lines = content.split("\n");
  console.log(`   段落數：${lines.length}｜字數：${content.length}`);
  lines.slice(0, 3).forEach((l) => console.log(`   ${l.slice(0, 70)}`));

  console.log(`\n✅ SMOKE 通過：search → book → chapters → content 全鏈路可抓，內文乾淨。`);
}

main().catch((e) => {
  console.error(`\n❌ SMOKE 失敗：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
