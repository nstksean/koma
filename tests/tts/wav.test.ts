import { describe, it, expect } from "vitest";
import { concatPcm, pcmTotalBytes, pcmPartsToWav } from "@/src/tts/wav";

/**
 * wav — PCM 串接 + WAV 封裝(純函式,無副作用、無 server-only 依賴)。
 *
 * concatPcm:依序串多段 PCM 成單一 Uint8Array(順序、總長、空輸入)。
 * pcmTotalBytes:各段 byteLength 加總(給 header 與 durationMs 用,不複製)。
 * pcmPartsToWav:把多段 PCM 直接封成可解析的 WAV Buffer(44-byte header + data),
 *   省掉「先 merge 再 concat」那一份全章拷貝。
 */

/** 解析 WAV header 欄位,驗證封裝正確(little-endian)。 */
function parseWavHeader(buf: Buffer) {
  return {
    riff: buf.toString("ascii", 0, 4),
    riffSize: buf.readUInt32LE(4),
    wave: buf.toString("ascii", 8, 12),
    fmt: buf.toString("ascii", 12, 16),
    fmtSize: buf.readUInt32LE(16),
    audioFormat: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bitsPerSample: buf.readUInt16LE(34),
    data: buf.toString("ascii", 36, 40),
    dataSize: buf.readUInt32LE(40),
  };
}

describe("wav", () => {
  describe("pcmTotalBytes", () => {
    it("加總各段 byteLength", () => {
      expect(pcmTotalBytes([new Uint8Array(3), new Uint8Array(5)])).toBe(8);
    });

    it("空輸入 → 0", () => {
      expect(pcmTotalBytes([])).toBe(0);
    });

    it("含空段 → 仍正確加總", () => {
      expect(pcmTotalBytes([new Uint8Array(0), new Uint8Array(7)])).toBe(7);
    });
  });

  describe("concatPcm", () => {
    it("依序串接(順序保留)", () => {
      const a = Uint8Array.of(1, 2);
      const b = Uint8Array.of(3, 4, 5);
      expect(Array.from(concatPcm([a, b]))).toEqual([1, 2, 3, 4, 5]);
    });

    it("總長 = 各段 byteLength 之和", () => {
      const parts = [new Uint8Array(10), new Uint8Array(20), new Uint8Array(5)];
      expect(concatPcm(parts).byteLength).toBe(35);
    });

    it("空輸入 → 長度 0 的 Uint8Array", () => {
      const out = concatPcm([]);
      expect(out).toBeInstanceOf(Uint8Array);
      expect(out.byteLength).toBe(0);
    });

    it("含空段不影響其他段順序", () => {
      const out = concatPcm([Uint8Array.of(9), new Uint8Array(0), Uint8Array.of(8, 7)]);
      expect(Array.from(out)).toEqual([9, 8, 7]);
    });

    it("不可變:不改動輸入段", () => {
      const a = Uint8Array.of(1, 2);
      concatPcm([a]);
      expect(Array.from(a)).toEqual([1, 2]);
    });
  });

  describe("pcmPartsToWav", () => {
    const SR = 24_000;

    it("header 欄位正確(mono / 16-bit / 指定 sampleRate)", () => {
      const parts = [Uint8Array.of(0, 1, 2, 3)];
      const wav = pcmPartsToWav(parts, SR);
      const h = parseWavHeader(wav);
      expect(h.riff).toBe("RIFF");
      expect(h.wave).toBe("WAVE");
      expect(h.fmt).toBe("fmt ");
      expect(h.fmtSize).toBe(16);
      expect(h.audioFormat).toBe(1); // PCM
      expect(h.channels).toBe(1);
      expect(h.sampleRate).toBe(SR);
      expect(h.bitsPerSample).toBe(16);
      expect(h.blockAlign).toBe(2); // 1ch × 16bit / 8
      expect(h.byteRate).toBe(SR * 2);
      expect(h.data).toBe("data");
    });

    it("dataSize = 總 PCM bytes;riffSize = 36 + dataSize", () => {
      const parts = [new Uint8Array(4), new Uint8Array(6)];
      const wav = pcmPartsToWav(parts, SR);
      const h = parseWavHeader(wav);
      expect(h.dataSize).toBe(10);
      expect(h.riffSize).toBe(46);
      expect(wav.byteLength).toBe(44 + 10);
    });

    it("多段 PCM 在 data 區依序拼接,內容與 concatPcm 一致", () => {
      const parts = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)];
      const wav = pcmPartsToWav(parts, SR);
      expect(Array.from(wav.subarray(44))).toEqual([1, 2, 3, 4, 5]);
      expect(Array.from(wav.subarray(44))).toEqual(Array.from(concatPcm(parts)));
    });

    it("空 PCM → 仍是合法 44-byte header、dataSize=0", () => {
      const wav = pcmPartsToWav([], SR);
      const h = parseWavHeader(wav);
      expect(wav.byteLength).toBe(44);
      expect(h.dataSize).toBe(0);
      expect(h.riffSize).toBe(36);
    });

    it("PCM byteLength 超過 32-bit WAV 上界 → fail fast 丟錯(非隱晦 RangeError)", () => {
      // 偽造一段宣稱超大的 PCM:用 stub byteLength,避免真的配置 4GB 記憶體。
      const huge = { byteLength: 0xff_ff_ff_ff } as unknown as Uint8Array;
      expect(() => pcmPartsToWav([huge], SR)).toThrow(/PCM.*上界|exceeds|too large/i);
    });
  });
});
