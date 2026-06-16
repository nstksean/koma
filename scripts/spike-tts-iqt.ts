/**
 * spike-tts-iqt — 自家 IQT TTS「字級 timestamp」驗證骨架。【整個產品最高槓桿的未驗證項】
 *
 * ⚠️ TODO（填好即可真跑）：
 *   1) 填入 IQT TTS endpoint（`IQT_TTS_ENDPOINT`）與認證（`IQT_TTS_KEY` 或團隊指定的 header 方式）。
 *   2) 對齊 IQT 實際的 request schema（下方 buildRequest）與 response schema（下方 parseResponse）。
 *      —— 目前是依「預期規格」寫的占位；拿到 API 文件後對齊欄位名即可。
 *   3) 確認 IQT 是否在合成時回傳 char-level timestamp（中文逐字）。這是 gating dependency：
 *      若 IQT 吐不出對齊音檔的 char-level timestamp，逐字卡拉OK這個核心賣點就不存在
 *      （見 docs/meta/plans/mvp-stage0-plan.md §8.5、docs/meta/plans/04-stage3-tts-pipeline.md）。
 *
 * 為什麼這支最重要：Azure/ElevenLabs 已證「字級 timestamp 技術可行」，但「自家 IQT 能否吐得出」
 *   仍是單一最高槓桿的未知數。過渡期用 Azure 暫代，最終要換成 IQT —— 換源只動「音源 provider」，
 *   不動 player/同步/高亮（介面切點見 docs/meta/plans/04 §「音源 Provider 抽象」）。本 spike 就是驗 IQT 那一端。
 *
 * 跑法：  npm run spike:tts:iqt
 *   缺 env（IQT_TTS_ENDPOINT / IQT_TTS_KEY）時印友善提示、exit 0，不 crash。
 *
 * 不新增 npm dep；用 Node 內建 fetch。沿用 scripts/spike-ttkan.ts 風格。
 */

export {}; // 讓本檔為獨立 module(隔離 scope,避免與其他 spike script 的頂層宣告跨檔撞名)

const TEST_TEXT = "夜色漸深,他卻毫無睡意。";

/** 與管線共用的目標形狀：char-level timestamp（之後換源時 player/高亮看的就是這個）。 */
interface CharTimestamp {
  readonly char: string;
  readonly charIndex: number; // 原文 char index
  readonly startMs: number;
  readonly endMs: number;
}

interface IqtSynthesisResult {
  readonly audioBytes: number;
  readonly contentType: string;
  readonly timestamps: CharTimestamp[]; // 期望：每個中文字一筆
  readonly raw: unknown; // 保留原始回傳供人工檢視欄位定義
}

/** TODO：對齊 IQT 實際 request schema。 */
function buildRequest(text: string): { url: string; init: RequestInit } {
  const endpoint = process.env.IQT_TTS_ENDPOINT!;
  const key = process.env.IQT_TTS_KEY!;
  return {
    url: endpoint,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // TODO：IQT 認證方式待確認（Bearer? x-api-key? 簽章?）
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        // TODO：欄位名以 IQT API 文件為準。以下為「我們需要的東西」的占位：
        text,
        language: "zh",
        voice: "default",
        enableCharTimestamp: true, // ← 關鍵：要求字級 timestamp
        outputFormat: "mp3",
      }),
    },
  };
}

/** TODO：對齊 IQT 實際 response schema，把回傳正規化成 CharTimestamp[]。 */
function parseResponse(_raw: unknown): CharTimestamp[] {
  // TODO：拿到實際回傳後，在此把 IQT 的 timestamp 欄位 map 成 CharTimestamp。
  // 重點驗證：(1) 是否「字級」（每漢字一筆，非整句/整詞）；
  //          (2) startMs/endMs 是否對齊輸出音檔毫秒；(3) charIndex 定義（是否含標點/換行）。
  return [];
}

async function callIqt(text: string): Promise<IqtSynthesisResult> {
  const { url, init } = buildRequest(text);
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`IQT TTS 失敗 ${res.status} ${res.statusText} :: ${detail.slice(0, 200)}`);
  }
  // TODO：若 IQT 回 multipart（audio + json）或回 audio URL，需調整這裡的解析。
  const raw: unknown = await res.json().catch(() => ({}));
  return {
    audioBytes: -1, // TODO：依實際回傳（內嵌 base64？另開 audio URL？）填入
    contentType: res.headers.get("content-type") ?? "?",
    timestamps: parseResponse(raw),
    raw,
  };
}

async function main() {
  console.log("\n🧩 spike-tts-iqt — 自家 IQT TTS 字級 timestamp 驗證【最高槓桿未驗證項】");
  console.log("=".repeat(64));
  console.log(`測試文本：「${TEST_TEXT}」`);

  const endpoint = process.env.IQT_TTS_ENDPOINT;
  const key = process.env.IQT_TTS_KEY;

  if (!endpoint || !key) {
    console.log("\n⚠️  未偵測到 IQT 認證環境變數，跳過真打（預期行為，非錯誤）。");
    console.log("   填好後即可真跑：");
    console.log("     IQT_TTS_ENDPOINT = <IQT TTS 合成 endpoint>");
    console.log("     IQT_TTS_KEY      = <IQT 認證金鑰 / token>");
    console.log("   並對齊本檔 TODO：buildRequest（request schema）/ parseResponse（response schema）。");
    console.log("\n   驗證目標（拿到 API 後逐項打勾）：");
    console.log("     [ ] 合成時回傳 char-level timestamp（中文逐字，每漢字一筆）");
    console.log("     [ ] startMs/endMs 對齊輸出音檔毫秒");
    console.log("     [ ] charIndex 定義明確（含/不含標點、換行）");
    console.log("     [ ] 長文（整章）可一次合成或需分段（影響 per-chapter 管線）");
    console.log("\n⛔ 這是整個逐字卡拉OK產品的 gating dependency：驗不出 → 核心賣點不存在。exit 0。");
    return;
  }

  console.log("\n🔊 [callIqt] 呼叫 IQT TTS …");
  const result = await callIqt(TEST_TEXT);
  console.log(`   content-type=${result.contentType}｜audioBytes=${result.audioBytes}`);
  console.log(`   解析到 ${result.timestamps.length} 筆 char timestamp`);
  console.log("\n── 原始回傳（人工檢視欄位定義）──");
  console.log(JSON.stringify(result.raw, null, 2).slice(0, 1200));
  console.log("\n── 正規化後 char timestamp（前 8 筆）──");
  result.timestamps.slice(0, 8).forEach((t) =>
    console.log(`   [${t.charIndex}] "${t.char}"  ${t.startMs}~${t.endMs}ms`),
  );
  const looksCharLevel =
    result.timestamps.length >= [...TEST_TEXT.replace(/[，。、！？\s]/g, "")].length;
  console.log(
    looksCharLevel
      ? "\n✅ 初判：timestamp 數 ≥ 中文字數 → 像字級（仍需人工確認 startMs 對齊音檔）。"
      : "\n🚩 初判：timestamp 數少於中文字數 → 可能是整詞/整句級，非字級，需追 IQT 團隊。",
  );
}

main().catch((e) => {
  console.error(`\n❌ spike-tts-iqt 失敗：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
