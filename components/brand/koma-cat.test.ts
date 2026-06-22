import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KomaCat } from "@/components/brand/koma-cat";

// 品牌貓是 Koma 的記憶點本體(DESIGN.md「一隻陪你夜讀的貓」)。
// 這支測試釘住「沿用設計核准的 #cat-curl 資產 + 可主題上色 + 無障礙」三件事。
describe("KomaCat", () => {
  it("renders the design-approved single-line #cat-curl path", () => {
    const html = renderToStaticMarkup(createElement(KomaCat));
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 140 90"');
    // #cat-curl 的招牌身體曲線(DESIGN.md Brand Character)——不可被換成別的貓
    expect(html).toContain("M112 72");
  });

  it("is single-colour line art driven by currentColor (themeable via --brand)", () => {
    const html = renderToStaticMarkup(createElement(KomaCat));
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
    expect(html).not.toContain('fill="#"); // 無實心填色,純線條');
  });

  it("is decorative by default (aria-hidden, no role)", () => {
    const html = renderToStaticMarkup(createElement(KomaCat));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it("becomes a labelled image when given a label", () => {
    const html = renderToStaticMarkup(createElement(KomaCat, { label: "貓睡著了" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="貓睡著了"');
    expect(html).not.toContain("aria-hidden");
  });

  it("honours an explicit size, keeping the 140:90 ratio", () => {
    const html = renderToStaticMarkup(createElement(KomaCat, { size: 140 }));
    expect(html).toContain('width="140"');
    expect(html).toContain('height="90"');
  });

  it("opts into the breathing animation only when asked", () => {
    const plain = renderToStaticMarkup(createElement(KomaCat));
    expect(plain).not.toContain("koma-cat-breathe");
    const sleepy = renderToStaticMarkup(createElement(KomaCat, { breathing: true }));
    expect(sleepy).toContain("koma-cat-breathe");
  });

  it("opts into the stretch (伸懶腰) animation only when asked", () => {
    const plain = renderToStaticMarkup(createElement(KomaCat));
    expect(plain).not.toContain("koma-cat-stretch");
    const stretching = renderToStaticMarkup(createElement(KomaCat, { stretch: true }));
    expect(stretching).toContain("koma-cat-stretch");
  });

  it("opts into the 筆順 draw (loading) animation only when asked", () => {
    const plain = renderToStaticMarkup(createElement(KomaCat));
    expect(plain).not.toContain("koma-cat-draw");
    const drawing = renderToStaticMarkup(createElement(KomaCat, { drawing: true }));
    expect(drawing).toContain("koma-cat-draw");
    // 筆順描繪靠 pathLength=1 正規化各筆長度;少了它 dashoffset 動畫會錯亂。
    expect(drawing).toContain('pathLength="1"');
  });
});
