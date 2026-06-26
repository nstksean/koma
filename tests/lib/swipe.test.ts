import { describe, it, expect } from "vitest";
import { resolveSwipe } from "@/lib/swipe";

describe("resolveSwipe", () => {
  it("往左滑(dx<0)= next", () => {
    expect(resolveSwipe(-80, 10)).toBe("next");
  });

  it("往右滑(dx>0)= prev", () => {
    expect(resolveSwipe(80, 10)).toBe("prev");
  });

  it("位移未過閾值 → null", () => {
    expect(resolveSwipe(30, 10)).toBeNull();
  });

  it("垂直主導 → null(留給捲動)", () => {
    expect(resolveSwipe(80, 100)).toBeNull();
  });

  it("恰等於閾值即生效", () => {
    expect(resolveSwipe(50, 0)).toBe("prev");
  });

  it("水平與垂直相等時 → null(不夠水平主導)", () => {
    expect(resolveSwipe(60, 60)).toBeNull();
  });

  it("threshold 參數可調", () => {
    expect(resolveSwipe(80, 10, 100)).toBeNull();
    expect(resolveSwipe(120, 10, 100)).toBe("prev");
  });
});
