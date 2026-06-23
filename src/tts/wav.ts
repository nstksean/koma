/**
 * PCM 串接 + WAV 封裝(純函式,無副作用、無 server-only 依賴,故可單測)。
 *
 * 記憶體取捨:全章 TTS 合成不先把各段 merge 成一份全章 PCM 再 concat 成 WAV
 * (那會多一份全章拷貝),而是 pcmPartsToWav 直接 `Buffer.concat([header, ...parts])`
 * 一次封裝 —— Buffer.concat 只配置一份目標、逐段 copy,省掉中間 merged 全章拷貝。
 */

/**
 * WAV 大小欄位皆 UInt32LE。最緊的約束是 RIFF chunk size = 36 + dataLen 也要
 * 塞得進 32-bit,故 data 上界是 (2^32-1) - 36,而非 2^32-1。
 */
const MAX_WAV_DATA_BYTES = 0xff_ff_ff_ff - 36;

/** 各段 PCM byteLength 加總(不複製;給 WAV header 與 durationMs 用)。 */
export function pcmTotalBytes(parts: readonly Uint8Array[]): number {
  return parts.reduce((n, p) => n + p.byteLength, 0);
}

/**
 * 依序串接多段 PCM 成單一 Uint8Array(回傳新陣列,不改動輸入)。
 * 純邏輯、可單測;封裝 WAV 走 pcmPartsToWav 更省記憶體,這支保留給需要 raw 串接的場景。
 */
export function concatPcm(parts: readonly Uint8Array[]): Uint8Array {
  const total = pcmTotalBytes(parts);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * 把多段 PCM 直接封成單一可播 WAV Buffer(44-byte header + data),
 * 不先 merge 成全章 PCM —— 省一份全章拷貝(見檔頭記憶體取捨)。
 *
 * @throws 總 PCM bytes 超過 32-bit WAV 上界時 fail fast(優於下游隱晦 RangeError)。
 */
export function pcmPartsToWav(
  parts: readonly Uint8Array[],
  sampleRate: number,
): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const dataLen = pcmTotalBytes(parts);
  if (dataLen > MAX_WAV_DATA_BYTES) {
    throw new Error(
      `PCM 總長 ${dataLen} bytes 超過 WAV 32-bit 大小欄位上界(${MAX_WAV_DATA_BYTES});章節過長。`,
    );
  }

  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
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
  header.writeUInt32LE(dataLen, 40);

  // 直接 [header, ...parts]:Buffer.concat 只配置一份目標、逐段 copy,
  // 不需要先把 parts merge 成一份全章 PCM(省一份全章拷貝)。
  return Buffer.concat([header, ...parts], 44 + dataLen);
}
