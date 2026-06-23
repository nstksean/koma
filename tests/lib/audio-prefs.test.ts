import { describe, expect, it } from "vitest";
import { parsePosMs, parseRateIdx } from "@/lib/audio-prefs";

describe("parseRateIdx", () => {
  const LEN = 5;
  it("接受範圍內整數", () => {
    expect(parseRateIdx("0", LEN)).toBe(0);
    expect(parseRateIdx("3", LEN)).toBe(3);
    expect(parseRateIdx("4", LEN)).toBe(4);
  });
  it("超界 / 非整數 / null / 髒值回退預設", () => {
    expect(parseRateIdx("5", LEN)).toBe(1); // == len,越界
    expect(parseRateIdx("-1", LEN)).toBe(1);
    expect(parseRateIdx("1.5", LEN)).toBe(1);
    expect(parseRateIdx(null, LEN)).toBe(1);
    expect(parseRateIdx("abc", LEN)).toBe(1);
    expect(parseRateIdx("", LEN)).toBe(1); // 擋空字串,不被 Number("")===0 帶到 index 0
  });
  it("自訂 fallback", () => {
    expect(parseRateIdx(null, LEN, 2)).toBe(2);
  });
});

describe("parsePosMs", () => {
  const DUR = 60_000;
  it("接受 0<pos<duration", () => {
    expect(parsePosMs("12345", DUR)).toBe(12345);
  });
  it("0 / 負 / 超過章長 / null / 髒值回 0", () => {
    expect(parsePosMs("0", DUR)).toBe(0);
    expect(parsePosMs("-5", DUR)).toBe(0);
    expect(parsePosMs("60000", DUR)).toBe(0); // == duration
    expect(parsePosMs("99999", DUR)).toBe(0);
    expect(parsePosMs(null, DUR)).toBe(0);
    expect(parsePosMs("abc", DUR)).toBe(0);
  });
});
