"use client";

/**
 * 逐字高亮驅動 hook（Workstream D 核心,imperative）。
 *
 * 設計要點(凍結契約):
 * - 高亮「絕不」走 per-span React state。每幀只動 ≤2 個 DOM 節點(remove 舊、add 新),
 *   多數幀為 no-op(中文一字 ~100ms 才換一次),故對 React 樹零干擾。
 * - 時間軸恆為 1.0× ms。變速直接用 `audio.currentTime`(media time),
 *   「不」縮放 timestamp —— `activeCharIndex` 收的就是 media 毫秒。
 * - charTimestamps 的 `charIndex` 對齊 reader-content 的 `<span data-ci={i}>`
 *   (i = 字在 `[...content]` 的 code-point index);取字用 `chars[ans].charIndex`。
 *
 * 對外只暴露三個命令式 handle:啟動 loop、停止 loop、立即重算一次(seek 後即使
 * 暫停也要 toggle)。狀態(charsRef / 高亮節點)全握在 ref,不觸發渲染。
 */

import { useCallback, useEffect, useRef } from "react";
import { activeCharIndex } from "@/src/tts";
import type { CharTimestamp } from "@/src/tts";
import { DATA_CI, TTS_ACTIVE_CLASS } from "./tts-dom";

/** 距視窗上/下緣多少比例內視為「接近邊緣」,觸發 auto-scroll 置中。 */
const SCROLL_EDGE_RATIO = 0.25;
/** 偵測到使用者手動捲動後,暫停 auto-scroll 的時長(ms)。 */
const USER_SCROLL_PAUSE_MS = 2500;

interface UseTtsHighlightArgs {
  /** reader-content 的內文容器(同一顆 ref 也給了 reader-content)。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 播放音檔的 <audio> element ref。 */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /**
   * 點字「從這裡開始聽」:把被點字的 charIndex 交給 player 處理
   * (載入若尚未 → seek 到該字 → 播放)。hook 本身不碰載入/播放狀態。
   */
  onSeekToChar?: (charIndex: number) => void;
}

interface TtsHighlightHandle {
  /** 設定本章逐字 timing(首播載入完成後呼叫一次)。 */
  setChars: (chars: readonly CharTimestamp[]) => void;
  /** 啟動 rAF 高亮迴圈(play 時呼叫)。 */
  start: () => void;
  /** 停止 rAF(pause / ended / unmount 時呼叫),保留現有高亮。 */
  stop: () => void;
  /** 立即依當前 currentTime 重算一次高亮(seek 後即使暫停也要呼叫)。 */
  refresh: () => void;
}

export function useTtsHighlight({
  containerRef,
  audioRef,
  onSeekToChar,
}: UseTtsHighlightArgs): TtsHighlightHandle {
  const charsRef = useRef<readonly CharTimestamp[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  // auto-scroll 抑制:使用者手動捲動後在此時間戳前暫停程式捲動。
  const suppressScrollUntilRef = useRef<number>(0);

  /** active 字接近視窗邊緣才平滑置中;否則不動,避免每字都跳。 */
  const maybeAutoScroll = useCallback((el: HTMLElement) => {
    if (Date.now() < suppressScrollUntilRef.current) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const topEdge = vh * SCROLL_EDGE_RATIO;
    const bottomEdge = vh * (1 - SCROLL_EDGE_RATIO);
    if (rect.top < topEdge || rect.bottom > bottomEdge) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  /** 依給定 media 毫秒 toggle 高亮 class(單次,非迴圈)。 */
  const applyHighlight = useCallback(
    (ms: number) => {
      const chars = charsRef.current;
      if (chars.length === 0) return;
      const ans = activeCharIndex(chars, ms);
      if (ans < 0) return;
      const ci = chars[ans].charIndex;
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[${DATA_CI}="${ci}"]`,
      );
      if (el === lastActiveRef.current) return; // 多數幀走這條 no-op
      lastActiveRef.current?.classList.remove(TTS_ACTIVE_CLASS);
      el?.classList.add(TTS_ACTIVE_CLASS);
      lastActiveRef.current = el ?? null;
      if (el) maybeAutoScroll(el);
    },
    [containerRef, maybeAutoScroll],
  );

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const loop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) applyHighlight(audio.currentTime * 1000);
    rafRef.current = requestAnimationFrame(loop);
  }, [audioRef, applyHighlight]);

  const start = useCallback(() => {
    if (rafRef.current !== null) return; // 已在跑,避免雙重 loop
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const refresh = useCallback(() => {
    const audio = audioRef.current;
    if (audio) applyHighlight(audio.currentTime * 1000);
  }, [audioRef, applyHighlight]);

  const setChars = useCallback((chars: readonly CharTimestamp[]) => {
    charsRef.current = chars;
  }, []);

  // 點字 seek(事件委派,單一 listener)+ 使用者手動捲動偵測。
  // 掛在 containerRef 上,隨容器存在期間生效。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const span = target?.closest<HTMLElement>(`[${DATA_CI}]`);
      if (!span) return;
      const raw = span.getAttribute(DATA_CI);
      if (raw === null) return;
      const ci = Number(raw);
      if (Number.isNaN(ci)) return;
      // 交給 player:載入(若尚未)→ seek 到該字 → 播放。點到標點/空白也行
      // (player 會對到下一個有聲字),故此處不過濾。
      onSeekToChar?.(ci);
    };

    const onUserScroll = () => {
      suppressScrollUntilRef.current = Date.now() + USER_SCROLL_PAUSE_MS;
    };

    container.addEventListener("click", onClick);
    // 手動捲動偵測掛 window:wheel/touch 多由視窗層接收。passive 不阻擋捲動。
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true });

    return () => {
      container.removeEventListener("click", onClick);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchstart", onUserScroll);
    };
  }, [containerRef, onSeekToChar]);

  // unmount:停 rAF、清高亮 class、清 chars。換章因 reader-view 用 key 重掛本元件,
  // 理論上自動重置;此 cleanup 為保險(確保不殘留前章高亮節點)。
  useEffect(() => {
    return () => {
      stop();
      lastActiveRef.current?.classList.remove(TTS_ACTIVE_CLASS);
      lastActiveRef.current = null;
      charsRef.current = [];
    };
  }, [stop]);

  return { setChars, start, stop, refresh };
}
