"use client";

import { useEffect } from "react";
import { resolveSwipe } from "@/lib/swipe";

interface PageTurnOverlayProps {
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * 分頁模式的「換章互動層」:左右邊緣熱區點擊 + 全頁水平 swipe。
 * 不自己 router.push,方向交給 reader-view 傳入的 onPrev/onNext。
 * 點左 / 往右滑 = 上一章;點右 / 往左滑 = 下一章。中間 40% 不放元素,留給選字與捲動。
 */
export function PageTurnOverlay({ onPrev, onNext, canPrev, canNext }: PageTurnOverlayProps) {
  // swipe:passive 監聽,不 preventDefault → 垂直捲動照常。多指忽略。
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onStart(e: TouchEvent) {
      if (e.touches.length > 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }
    function onEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dir = resolveSwipe(t.clientX - startX, t.clientY - startY);
      if (dir === "next" && canNext) onNext();
      if (dir === "prev" && canPrev) onPrev();
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [onPrev, onNext, canPrev, canNext]);

  // 熱區:左右各 30vw 的透明點擊區,z 低於 header(z-10),工具列仍可點。
  return (
    <>
      {canPrev && (
        <button
          type="button"
          aria-label="上一章"
          onClick={onPrev}
          className="fixed left-0 top-0 z-[5] h-dvh w-[30vw] cursor-w-resize bg-transparent"
        />
      )}
      {canNext && (
        <button
          type="button"
          aria-label="下一章"
          onClick={onNext}
          className="fixed right-0 top-0 z-[5] h-dvh w-[30vw] cursor-e-resize bg-transparent"
        />
      )}
    </>
  );
}
