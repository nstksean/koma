import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const VIEW_W = 140;
const VIEW_H = 90;

export interface KomaCatProps {
  /** 寬度(px);高度依 140:90 比例自動換算。 */
  size?: number;
  className?: string;
  /**
   * 給定文字時,貓是「有意義的圖」(role=img + aria-label);
   * 省略時為純裝飾(aria-hidden),交由鄰近文字描述。
   */
  label?: string;
  /** 章末「睡著」的輕微呼吸動畫;尊重 prefers-reduced-motion(見 globals.css)。 */
  breathing?: boolean;
  style?: CSSProperties;
}

/**
 * Koma 品牌角色 —— 單線條蜷睡貓。
 *
 * 沿用 `/design-consultation` 核准的 inline SVG `#cat-curl`(DESIGN.md Brand Character)。
 * stroke 走 `currentColor`,故只要包一層 `text-brand` 就隨主題(貓眼霧綠 / 燈光琥珀 /
 * 紙上琥珀)上色。DESIGN 指示「少量、稀有」使用:字標旁、空狀態、載入、章末。
 */
export function KomaCat({
  size = 96,
  className,
  label,
  breathing = false,
  style,
}: KomaCatProps) {
  const height = Math.round((size * VIEW_H) / VIEW_W);
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={size}
      height={height}
      className={cn(breathing && "koma-cat-breathe", className)}
      style={style}
      {...a11y}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 蜷起的身體與尾巴 */}
        <path d="M112 72 C134 56 126 22 90 20 C50 18 24 40 30 66 C34 82 56 84 66 74 C76 64 70 48 56 50 C46 51 46 62 54 64" />
        {/* 兩隻耳朵 */}
        <path d="M84 22 l4 -13 l11 9" />
        <path d="M101 20 l11 -8 l2 13" />
        {/* 閉眼的弧(睡著) */}
        <path d="M92 40 q5 4 11 0" />
      </g>
    </svg>
  );
}
