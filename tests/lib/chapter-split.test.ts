import { describe, it, expect } from "vitest";
import { splitChapters } from "@/lib/chapter-split";

describe("splitChapters", () => {
  it("依「第N章」標題切分", () => {
    const text = [
      "第一章 開端",
      "這是第一章的內文。",
      "還有第二段。",
      "第二章 發展",
      "這是第二章的內文。",
    ].join("\n");
    const chs = splitChapters(text);
    expect(chs).toHaveLength(2);
    expect(chs[0].title).toBe("第一章 開端");
    expect(chs[0].body).toContain("第一章的內文");
    expect(chs[1].title).toBe("第二章 發展");
  });

  it("辨識序章 / 楔子 / 番外等特殊標題", () => {
    const text = [
      "楔子",
      "楔子內文。",
      "第1章 正文開始",
      "正文內文。",
      "番外 後日談",
      "番外內文。",
    ].join("\n");
    const titles = splitChapters(text).map((c) => c.title);
    expect(titles).toEqual(["楔子", "第1章 正文開始", "番外 後日談"]);
  });

  it("沒有任何標題時，整段歸為「正文」", () => {
    const chs = splitChapters("一段沒有章節標題的純文字。\n第二段。");
    expect(chs).toHaveLength(1);
    expect(chs[0].title).toBe("正文");
  });

  it("略過空白章節、修剪內文", () => {
    const text = "第一章\n\n\n第二章\n有內容";
    const chs = splitChapters(text);
    // 第一章沒內文 → 被濾掉，只留第二章
    expect(chs).toHaveLength(1);
    expect(chs[0].title).toBe("第二章");
    expect(chs[0].body).toBe("有內容");
  });

  it("過長的疑似標題行不被當成章節標題", () => {
    const longLine =
      "第一章這行其實超級長長長長長長長長長長長長長長長長長長長長長長長長長長長長到不可能是標題";
    const chs = splitChapters(`${longLine}\n內文`);
    expect(chs).toHaveLength(1);
    expect(chs[0].title).toBe("正文");
  });
});
