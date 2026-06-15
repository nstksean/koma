/**
 * spike-tts-eleven — ElevenLabs TTS「字級 timestamp」備選驗證骨架。
 *
 * 定位：Azure 是過渡期主暫代音源、IQT 是最終目標；ElevenLabs 是【備選】，
 *   因為它原生提供 char-level timestamp（`/v1/text-to-speech/{voice_id}/with-timestamps`
 *   回傳 `alignment.characters / character_start_times_seconds / character_end_times_seconds`），
 *   對「逐字卡拉OK」最對味，且回傳即是 per-char，不像 Azure 要靠 word boundary 推。
 *   留這支當「若 Azure 中文字級不夠準 / IQT 卡關」時的第三選項。
 *
 * ⚠️ TODO（填好即可真跑）：
 *   1) 設 `ELEVENLABS_API_KEY`（ElevenLabs 後台 → Profile → API Key）。
 *   2) 可選設 `ELEVENLABS_VOICE_ID`（未設用預設多語音色 ID）。
 *   3) 確認中文（多語模型 eleven_multilingual_v2 / eleven_v3）對中文逐字的 alignment 品質
 *      —— ElevenLabs 對中文的字級對齊歷史上不如英文穩，這是要實打驗的點。
 *
 * 跑法：  npm run spike:tts:eleven
 *   缺金鑰時印友善提示、exit 0，不 crash。不新增 npm dep；用 Node 內建 fetch。
 *   沿用 scripts/spike-ttkan.ts 風格。
 */

export {}; // 讓本檔為獨立 module(隔離 scope,避免與其他 spike script 的頂層宣告跨檔撞名)

const TEST_TEXT = "夜色漸深,他卻毫無睡意。";
const MODEL_ID = "eleven_multilingual_v2"; // 支援中文的多語模型
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs 公開預設音色（Rachel）；中文請換多語音色

/** ElevenLabs with-timestamps 回傳的 alignment 形狀（節錄）。 */
interface ElevenAlignment {
  readonly characters: string[];
  readonly character_start_times_seconds: number[];
  readonly character_end_times_seconds: number[];
}

interface ElevenResponse {
  readonly audio_base64?: string;
  readonly alignment?: ElevenAlignment;
  readonly normalized_alignment?: ElevenAlignment;
}

/** 與管線共用的目標形狀（與 spike-tts-iqt 一致，方便比較不同引擎輸出）。 */
interface CharTimestamp {
  readonly char: string;
  readonly charIndex: number;
  readonly startMs: number;
  readonly endMs: number;
}

function toCharTimestamps(a: ElevenAlignment | undefined): CharTimestamp[] {
  if (!a) return [];
  return a.characters.map((char, i) => ({
    char,
    charIndex: i,
    startMs: Math.round((a.character_start_times_seconds[i] ?? 0) * 1000),
    endMs: Math.round((a.character_end_times_seconds[i] ?? 0) * 1000),
  }));
}

async function callEleven(text: string, voiceId: string, key: string): Promise<ElevenResponse> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      // output_format 預設 mp3_44100_128；如需對齊管線可顯式指定。
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs 失敗 ${res.status} ${res.statusText} :: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as ElevenResponse;
}

async function main() {
  console.log("\n🧪 spike-tts-eleven — ElevenLabs 字級 timestamp 備選驗證");
  console.log("=".repeat(64));
  console.log(`測試文本：「${TEST_TEXT}」｜模型：${MODEL_ID}`);

  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;

  if (!key) {
    console.log("\n⚠️  未偵測到 ELEVENLABS_API_KEY，跳過真打（預期行為，非錯誤）。");
    console.log("   設定後即可真跑：");
    console.log("     ELEVENLABS_API_KEY = <ElevenLabs 後台 API Key>");
    console.log("     ELEVENLABS_VOICE_ID = <可選；中文建議用多語音色 ID>");
    console.log("   範例：ELEVENLABS_API_KEY=xxx npm run spike:tts:eleven");
    console.log("\n   驗證目標：");
    console.log("     [ ] with-timestamps 回傳 alignment.characters 對中文是否逐字對齊");
    console.log("     [ ] character_start/end_times_seconds 是否平滑、對齊音檔");
    console.log("     [ ] 中文多語模型的字級對齊品質（歷史上不如英文穩，需實打）");
    console.log("\n結論（待真打）：ElevenLabs 原生回 per-char alignment，最貼合逐字卡拉OK；留作備選。exit 0。");
    return;
  }

  console.log(`\n🔊 [callEleven] voice=${voiceId} …`);
  const resp = await callEleven(TEST_TEXT, voiceId, key);
  const audioBytes = resp.audio_base64 ? Buffer.from(resp.audio_base64, "base64").length : 0;
  const ts = toCharTimestamps(resp.alignment);
  console.log(`   ✅ 合成成功：audio≈${audioBytes} bytes｜alignment chars=${ts.length}`);
  console.log("\n── char timestamp（前 8 筆）──");
  ts.slice(0, 8).forEach((t) =>
    console.log(`   [${t.charIndex}] "${t.char}"  ${t.startMs}~${t.endMs}ms`),
  );
  const han = [...TEST_TEXT.replace(/[，。、！？\s]/g, "")].length;
  console.log(
    ts.length >= han
      ? `\n✅ alignment char 數(${ts.length}) ≥ 中文字數(${han}) → 字級對齊存在，人工確認時間平滑度。`
      : `\n🚩 alignment char 數(${ts.length}) < 中文字數(${han}) → 中文對齊可能不足，需複看。`,
  );
}

main().catch((e) => {
  console.error(`\n❌ spike-tts-eleven 失敗：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
