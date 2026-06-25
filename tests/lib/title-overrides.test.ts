import { describe, expect, it } from "vitest";

import { resolveTitle } from "@/lib/title-overrides";

describe("resolveTitle — 書名覆寫表", () => {
  it("命中覆寫:回傳正確書名,忽略 fetchedTitle", () => {
    expect(
      resolveTitle(
        "ttkan",
        "doudiyuyouxile_sheihaidangrena-youjiul",
        "地獄遊戲：從大都會開始（Error）",
      ),
    ).toBe("都地獄遊戲了，誰還當人啊");
  });

  it("無覆寫:去掉尾端殘留的「（Error）」雜訊(含前後空白)", () => {
    expect(resolveTitle("ttkan", "other-book", "某書（Error）")).toBe("某書");
    expect(resolveTitle("ttkan", "other-book", "某書 （Error） ")).toBe("某書");
  });

  it("無覆寫且無「（Error）」:原樣回傳 fetchedTitle", () => {
    expect(resolveTitle("ttkan", "other-book", "正常書名")).toBe("正常書名");
  });

  it("僅有「（Error）」:strip 後為空 → 退回原 fetchedTitle(不回空字串)", () => {
    expect(resolveTitle("ttkan", "other-book", "（Error）")).toBe("（Error）");
  });
});
