import { describe, expect, it } from "vitest";

import { parseTtsParams } from "@/app/api/tts/[bookSource]/[id]/[idx]/parse-params";

const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";
const URL_BASE = "https://x/api/tts/ttkan/slug/0";

/** 包裝:預設給合法 raw,個別測試只覆寫關心的欄位。 */
function parse(
  raw: Partial<{ bookSource: string; id: string; idx: string }> = {},
  query = "",
) {
  return parseTtsParams(
    { bookSource: "ttkan", id: "wo-de-shu", idx: "0", ...raw },
    `${URL_BASE}${query}`,
  );
}

describe("parseTtsParams — 合法輸入", () => {
  it("全合法 → ok,params 正確", () => {
    const r = parse();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params).toEqual({
        bookSource: "ttkan",
        slug: "wo-de-shu",
        idxNum: 0,
        voice: DEFAULT_VOICE,
      });
    }
  });

  it("拼音 slug 的連字號合法(不誤擋 `-`)", () => {
    const r = parse({ id: "doupo-cangqiong" });
    expect(r.ok && r.params.slug).toBe("doupo-cangqiong");
  });

  it("URL-encoded 的合法 slug 會 decode", () => {
    const r = parse({ id: encodeURIComponent("我的書") });
    expect(r.ok && r.params.slug).toBe("我的書");
  });
});

describe("parseTtsParams — bookSource 邊界", () => {
  it("空 bookSource → 400", async () => {
    const r = parse({ bookSource: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("超長 bookSource → 400", () => {
    const r = parse({ bookSource: "a".repeat(513) });
    expect(r.ok).toBe(false);
  });
});

describe("parseTtsParams — slug 注入/穿越防線(SSRF)", () => {
  it("畸形百分比編碼 → 400(非 500;decodeURIComponent 會 throw)", () => {
    const r = parse({ id: "%E0%A4%A" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("路徑穿越 `..` → 400", () => {
    expect(parse({ id: ".." }).ok).toBe(false);
    expect(parse({ id: "a/../b" }).ok).toBe(false);
  });

  it.each(["a/b", "a\\b", "a?b", "a#b", "a b", "a\tb"])(
    "危險字元 %j → 400",
    (id) => {
      expect(parse({ id }).ok).toBe(false);
    },
  );

  it("decode 後變空字串 → 400", () => {
    expect(parse({ id: "" }).ok).toBe(false);
  });

  it("超長 slug → 400", () => {
    expect(parse({ id: "a".repeat(513) }).ok).toBe(false);
  });
});

describe("parseTtsParams — idx 邊界", () => {
  it("idx=0 合法", () => {
    expect(parse({ idx: "0" }).ok).toBe(true);
  });

  it.each(["-1", "1.5", "abc", ""])("非自然數 idx %j → 400", (idx) => {
    expect(parse({ idx }).ok).toBe(false);
  });
});

describe("parseTtsParams — voice allowlist(防付費刷)", () => {
  it("allowlist 內的 voice 採用", () => {
    const r = parse({}, "?voice=zh-CN-XiaoxiaoNeural");
    expect(r.ok && r.params.voice).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("allowlist 外的 voice 收斂回預設(不 400,容錯)", () => {
    const r = parse({}, "?voice=evil-unbounded-voice");
    expect(r.ok && r.params.voice).toBe(DEFAULT_VOICE);
  });

  it("無 voice query → 預設", () => {
    const r = parse();
    expect(r.ok && r.params.voice).toBe(DEFAULT_VOICE);
  });
});
