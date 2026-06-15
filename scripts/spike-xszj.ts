/**
 * spike-xszj — 驗證 m.xszj.org（小說之家）「都地獄遊戲了，誰還當人啊」的【內文品質】。
 *
 * 背景：ttkan（現用源）對本書斷更在第 688 章；起點官方已連載到 ~917 章。
 *       m.xszj.org 站內序號已到 823（作者章號 744），章數足夠 —— 但內文需驗證。
 *
 * ⚠️ 結論（2026-06-15 跑出）：此源【內文不可用】。
 *    免費頁只給每章正文「開頭一小段」，其餘段落用【其他小說的隨機句子】填充
 *    （扶貧文、古言、《驚悚樂園》片段……），HTML 結構與正文 <p> 完全相同、無法用 selector 過濾。
 *    本 spike 用「首尾主題漂移」自動紅旗 + 攤開段落讓人目視確認。
 *
 * 跑法：  npx tsx scripts/spike-xszj.ts
 *
 * 這是拋棄式驗證腳本，不接進 src/sources/。
 */
import * as cheerio from "cheerio";

const BASE = "https://m.xszj.org";
const BOOK_ID = "386967"; // 都地獄遊戲了，誰還當人啊
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HERO = "劉正"; // 本書主角名 —— 正文應頻繁出現

// 取樣三章：第1章（免費試讀）、中段、最新章。chapterId 取自 /b/386967 與目錄頁。
const SAMPLES: ReadonlyArray<{ label: string; id: string }> = [
  { label: "第1章（反詐宣傳・免費試讀）", id: "15584077" },
  { label: "第817章（作者第737章）", id: "21137567" },
  { label: "第823章（作者第744章・最新）", id: "21140346" },
];

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`fetch 失敗 ${res.status} :: ${url}`);
  return res.text();
}

/** 抓單章內文：合併 ?page=2.. 子頁，回傳 {title, paras}。 */
async function fetchContent(
  id: string,
): Promise<{ title: string; paras: string[] }> {
  const paras: string[] = [];
  let title = "";
  for (let page = 1; page <= 6; page++) {
    const url = `${BASE}/b/${BOOK_ID}/c/${id}${page > 1 ? `?page=${page}` : ""}`;
    const $ = cheerio.load(await fetchHtml(url));
    if (page === 1) title = $("title").first().text().split("-")[0].trim();
    const $c = $("#content").first();
    $c.find("script, style").remove();
    const ps = $c
      .find("p")
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
      .filter((t) => !/小說之家|本書網址|請分享|請粘貼/.test(t));
    paras.push(...ps);
    const hasNext = $('a[href*="?page="]')
      .toArray()
      .some((a) => /下一[頁页]/.test($(a).text()));
    if (!hasNext) break;
  }
  return { title, paras };
}

/** 中文 2-gram 集合（污染偵測用的詞錨點）。 */
function bigrams(text: string): Set<string> {
  const han = text.replace(/[^一-龥]/g, "");
  const s = new Set<string>();
  for (let i = 0; i + 1 < han.length; i++) s.add(han.slice(i, i + 2));
  return s;
}

/**
 * 首尾主題漂移紅旗：正文首尾通常共享角色/場景詞；
 * 若整章是「不同小說隨機句填充」，前段與後段幾乎不共享任何詞。
 */
function topicDriftFlag(paras: string[]): {
  shared: number;
  drift: boolean;
  samples: string[];
} {
  if (paras.length < 6) return { shared: -1, drift: false, samples: [] };
  const head = bigrams(paras.slice(0, 3).join(""));
  const tail = bigrams(paras.slice(-3).join(""));
  const shared = [...head].filter((g) => tail.has(g)).length;
  return { shared, drift: shared <= 1, samples: [] };
}

async function main() {
  console.log("\n🧪 xszj 內文品質 spike — 都地獄遊戲了，誰還當人啊\n" + "=".repeat(60));
  for (const s of SAMPLES) {
    const { title, paras } = await fetchContent(s.id);
    const full = paras.join("");
    const heroHits = (full.match(new RegExp(HERO, "g")) ?? []).length;
    const { shared, drift } = topicDriftFlag(paras);

    console.log(`\n📄 ${s.label}`);
    console.log(`   title：${title}`);
    console.log(
      `   段落數=${paras.length}  正文字數=${full.length}  主角「${HERO}」=${heroHits} 次  首尾共享詞=${shared}`,
    );
    console.log(`   ─ 前 4 段 ─`);
    paras.slice(0, 4).forEach((p, i) => console.log(`   [${i}] ${p.slice(0, 64)}`));
    console.log(`   ─ 後 4 段 ─`);
    paras.slice(-4).forEach((p, i) =>
      console.log(`   [${paras.length - 4 + i}] ${p.slice(0, 64)}`),
    );
    console.log(
      drift
        ? `   🚩 主題漂移：前段與後段幾乎不共享詞彙 → 後段疑為其他小說填充句`
        : `   ✅ 首尾主題連貫`,
    );
  }
  console.log(
    "\n" +
      "=".repeat(60) +
      "\n判讀：若最新章觸發 🚩 而第1章未觸發 → 證明 xszj 對連載段內文做了反爬閹割，內文不可用。",
  );
}

main().catch((e) => {
  console.error(`\n❌ spike 失敗：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
