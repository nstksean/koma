/**
 * [demo / 階段3 暫代] 用 Azure TTS 合成某一章內文 → 串成單一 WAV → 印出路徑供播放。
 * 不在 reader 裡、無逐字高亮，只是讓你「現在就聽到聲音」的暫代音源驗證。
 * 章節內文需已快取在本地 DB（content 非 null）。
 *
 *   tsx --env-file-if-exists=.env.local scripts/play-chapter-azure.ts <source> <slug> <idx> [voice]
 *   e.g. tsx --env-file-if-exists=.env.local scripts/play-chapter-azure.ts ttkan fengwuyaodeshiyanrizhi-fennudesongshu 271
 *
 * 需要 .env.local：AZURE_TTS_KEY / AZURE_TTS_REGION（缺則友善退出）。
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

const [, , source, slug, idxArg, voiceArg] = process.argv;
const idx = Number(idxArg);
const VOICE = voiceArg || "zh-TW-HsiaoChenNeural"; // 台灣中文女聲；zh-CN-XiaoxiaoNeural 為大陸女聲
const SAMPLE_RATE = 24_000;
const OUT_FORMAT = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm; // 無 header 的 raw PCM，方便串接
const MAX_CHARS = 900; // 每次合成的字數上限（避開 Azure 單次音長上限）

if (!source || !slug || !Number.isFinite(idx)) {
  console.error(
    "用法：tsx scripts/play-chapter-azure.ts <source> <slug> <idx> [voice]",
  );
  process.exit(1);
}

/** 把章節內文依段落切成 ≤MAX_CHARS 的塊。 */
function chunkText(text: string): string[] {
  const paras = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 1 > MAX_CHARS) {
      chunks.push(buf);
      buf = "";
    }
    // 單段就超長：硬切。
    if (p.length > MAX_CHARS) {
      for (let i = 0; i < p.length; i += MAX_CHARS) chunks.push(p.slice(i, i + MAX_CHARS));
      continue;
    }
    buf = buf ? `${buf}\n${p}` : p;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** 合成單一塊 → raw PCM bytes。 */
function synth(key: string, region: string, text: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const cfg = sdk.SpeechConfig.fromSubscription(key, region);
    cfg.speechSynthesisVoiceName = VOICE;
    cfg.speechSynthesisOutputFormat = OUT_FORMAT;
    const synthesizer = new sdk.SpeechSynthesizer(cfg); // 不給 AudioConfig → 從 result.audioData 取 bytes
    synthesizer.speakTextAsync(
      text,
      (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          const audio = new Uint8Array(result.audioData);
          synthesizer.close();
          resolve(audio);
        } else {
          const detail = result.errorDetails ?? `reason=${result.reason}`;
          synthesizer.close();
          reject(new Error(`合成未完成：${detail}`));
        }
      },
      (err) => {
        synthesizer.close();
        reject(new Error(`speakTextAsync 失敗：${err}`));
      },
    );
  });
}

/** 串接多段 PCM + 加 44-byte WAV header → 單一可播 WAV。 */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

async function main() {
  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;
  if (!key || !region) {
    console.log("⚠️ 未設定 AZURE_TTS_KEY / AZURE_TTS_REGION（.env.local），跳過。");
    process.exit(0);
  }

  const db = createClient({
    url: `file:${path.join(process.cwd(), "data", "blackcat.db")}`,
  });
  const res = await db.execute({
    sql: `SELECT c.title, c.content FROM chapters c
          JOIN books b ON b.id = c.book_id
          WHERE b.source = ? AND b.source_book_id = ? AND c.idx = ?`,
    args: [source, slug, idx],
  });
  const row = res.rows[0];
  if (!row) throw new Error(`找不到章節：${source}/${slug} idx=${idx}`);
  const content = (row.content as string | null) ?? "";
  if (!content.trim()) throw new Error("該章內文尚未快取（content 為空）");

  const chunks = chunkText(content);
  console.log(`🎙️  ${row.title}｜${content.length} 字 → ${chunks.length} 段合成｜音色 ${VOICE}`);

  const parts: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`   合成第 ${i + 1}/${chunks.length} 段 …`);
    const pcm = await synth(key, region, chunks[i]);
    parts.push(pcm);
    console.log(` ✅ ${pcm.byteLength} bytes`);
  }

  const totalLen = parts.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    merged.set(p, off);
    off += p.length;
  }
  const wav = pcmToWav(merged, SAMPLE_RATE);

  const outPath = path.join(tmpdir(), `koma-ch${idx}-${slug}.wav`);
  writeFileSync(outPath, wav);
  const seconds = totalLen / ((SAMPLE_RATE * 16 * 1) / 8);
  console.log(`\n🎧 完成：${outPath}`);
  console.log(`   時長約 ${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒，${(wav.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   播放：afplay "${outPath}"`);
}

main().catch((e) => {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
