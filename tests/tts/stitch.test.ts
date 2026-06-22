import { describe, it, expect } from "vitest";
import { BYTES_PER_MS, pcmBytesToMs, shiftCharTimestamps } from "@/src/tts/stitch";
import type { CharTimestamp } from "@/src/tts/types";

/**
 * stitch — PCM 時間軸工具(純函式)。
 * pcmBytesToMs 用 byte 數換算毫秒(Raw24Khz16BitMonoPcm = 48 bytes/ms);
 * shiftCharTimestamps 整體平移時間且不可變(回傳新陣列、保留 char/charIndex)。
 */
describe("stitch", () => {
  describe("BYTES_PER_MS", () => {
    it("= 48(24000Hz × 16bit × 1ch / 8 / 1000)", () => {
      expect(BYTES_PER_MS).toBe(48);
    });
  });

  describe("pcmBytesToMs", () => {
    it("48000 bytes → 1000 ms", () => {
      expect(pcmBytesToMs(48_000)).toBe(1000);
    });

    it("0 bytes → 0 ms", () => {
      expect(pcmBytesToMs(0)).toBe(0);
    });

    it("48 bytes → 1 ms", () => {
      expect(pcmBytesToMs(48)).toBe(1);
    });

    it("非整數毫秒亦如實換算(不四捨五入)", () => {
      expect(pcmBytesToMs(72)).toBe(1.5);
    });
  });

  describe("shiftCharTimestamps", () => {
    const base: readonly CharTimestamp[] = [
      { char: "夜", charIndex: 0, startMs: 0, endMs: 120 },
      { char: "色", charIndex: 1, startMs: 120, endMs: 250 },
    ];

    it("正值平移:start/end 同加 delta,char/charIndex 不變", () => {
      const shifted = shiftCharTimestamps(base, 1000);
      expect(shifted).toEqual([
        { char: "夜", charIndex: 0, startMs: 1000, endMs: 1120 },
        { char: "色", charIndex: 1, startMs: 1120, endMs: 1250 },
      ]);
    });

    it("delta=0:值不變", () => {
      const shifted = shiftCharTimestamps(base, 0);
      expect(shifted).toEqual(base);
    });

    it("空陣列 → 空陣列", () => {
      expect(shiftCharTimestamps([], 500)).toEqual([]);
    });

    it("不可變:回傳新陣列,且不原地改原陣列/元素", () => {
      const shifted = shiftCharTimestamps(base, 1000);
      expect(shifted).not.toBe(base);
      expect(shifted[0]).not.toBe(base[0]);
      // 原陣列元素時間未被改動。
      expect(base[0]).toEqual({ char: "夜", charIndex: 0, startMs: 0, endMs: 120 });
    });

    it("保留每筆 char 與 charIndex(只動時間)", () => {
      const shifted = shiftCharTimestamps(base, 333);
      expect(shifted.map((c) => c.char)).toEqual(["夜", "色"]);
      expect(shifted.map((c) => c.charIndex)).toEqual([0, 1]);
    });
  });
});
