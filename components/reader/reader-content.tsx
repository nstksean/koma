"use client";

import React from "react";

import { cn } from "@/lib/utils";
import { DATA_CI } from "@/components/reader/tts-dom";

interface ReaderContentProps {
  /** 整章原文。逐字 span 的編號對齊 server 對 [...content] 的 code-point index。 */
  content: string;
  /** 由 reader-view 傳入字型 class(font-serif / font-sans)。字級行距不在此設,走外層 .reader-content CSS 變數。 */
  className?: string;
  /** 掛在根 div;播放器用它 querySelector 找字高亮、掛 click 委派做點字 seek。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 逐字渲染:把整章原文攤成可高亮的 span 序列,索引對齊 server timestamp。
 *
 * 索引對齊鐵則(整個功能正確性根源):
 * - 對 [...content] 單次走訪(展開運算子,正確處理 surrogate pair),維護全域遞增 index `i`(從 0)。
 * - 遇到 '\n':結束當前段落,i 仍 +1(換行佔一個 code-point index),但不輸出 span。
 * - 其餘每個 code-point(含標點、含半形空格):輸出帶 data-ci=i 的 span,然後 i++。
 * - 嚴禁 split('\n') / filter(Boolean) / 各段重新從 0 編號 —— 會與 server index 對不上、高亮全錯位。
 *
 * 連續空行(連續 '\n')→ 輸出空 <p>(i 仍照常為每個 '\n' 前進,對齊優先於視覺)。
 */
function buildParagraphs(content: string): React.ReactElement[] {
  const paragraphs: React.ReactElement[] = [];
  let current: React.ReactElement[] = [];
  let i = 0;

  // 段落收尾:把累積的 span 收成一個 <p>(同 reader-view 既有視覺:mb-5 indent-8)。
  const flush = (paragraphKey: number) => {
    paragraphs.push(
      <p key={`p-${paragraphKey}`} className="mb-5 indent-8">
        {current}
      </p>,
    );
    current = [];
  };

  for (const ch of content) {
    if (ch === "\n") {
      flush(i);
      i += 1; // 換行佔一個 index,但不輸出 span
      continue;
    }
    current.push(
      <span key={i} {...{ [DATA_CI]: i }}>
        {ch}
      </span>,
    );
    i += 1;
  }
  // 收尾最後一段(原文無結尾換行時仍要輸出)
  flush(i);

  return paragraphs;
}

/**
 * React.memo:渲染後不因播放重渲染。高亮全走 DOM class(播放器在 containerRef 上操作),不經 React。
 * props(content / className / containerRef)穩定、不每幀變,因此不需自訂比較函式。
 */
export const ReaderContent = React.memo(function ReaderContent({
  content,
  className,
  containerRef,
}: ReaderContentProps) {
  // useMemo:content 不變時不重建龐大的 span 陣列(單章最多約 4500 字)。
  const paragraphs = React.useMemo(() => buildParagraphs(content), [content]);

  return (
    <div ref={containerRef} className={cn(className)}>
      {paragraphs}
    </div>
  );
});
