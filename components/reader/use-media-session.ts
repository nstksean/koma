"use client";

/**
 * 把 TTS 聽書接上 iOS / Android 鎖屏 + 控制中心的「正在播放」(Web MediaSession API)。
 * 鎖屏顯示:書名(artist)、章節名(title)、封面(artwork);系統的播放/暫停/
 * 快轉快退/進度條控制回呼進播放器。iOS Safari 16+ / Android Chrome 支援;不支援者整段 no-op。
 *
 * 設計:回呼存進 ref(永遠最新),action handler 只在掛載設一次保持穩定,卸載(換章)
 * 時清掉 handler + metadata,避免殘留上一章資訊。metadata / playbackState / positionState
 * 各自隨依賴變動更新。
 */

import { useEffect, useRef } from "react";

/** 鎖屏快轉/快退預設步長(秒);OS 傳 seekOffset 時以其為準。 */
const SEEK_STEP_S = 10;

interface MediaSessionConfig {
  /** 章節名(鎖屏標題)。 */
  title: string;
  /** 書名(鎖屏 artist 行)。 */
  artist: string;
  /** 是否播放中(驅動鎖屏播放/暫停圖示)。 */
  playing: boolean;
  durationMs: number;
  positionMs: number;
  /** 播放倍速(OS 用它在兩次 positionState 之間內插進度條)。 */
  rate: number;
  onPlay: () => void;
  onPause: () => void;
  /** 跳到指定毫秒(鎖屏進度條拖動 / 快轉快退共用)。 */
  onSeek: (ms: number) => void;
  /** 上一章(鎖屏上一首);undefined = 已是首章,不顯示按鈕。 */
  onPrevTrack?: () => void;
  /** 下一章(鎖屏下一首);undefined = 已是末章,不顯示按鈕。 */
  onNextTrack?: () => void;
}

function hasMediaSession(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function useMediaSession({
  title,
  artist,
  playing,
  durationMs,
  positionMs,
  rate,
  onPlay,
  onPause,
  onSeek,
  onPrevTrack,
  onNextTrack,
}: MediaSessionConfig): void {
  // 回呼 + 當下位置放 ref:action handler 只設一次,卻永遠呼叫到最新值,
  // 否則鎖屏的快退會用到掛載當下的舊 positionMs。每次 render 後同步。
  const latest = useRef({
    onPlay,
    onPause,
    onSeek,
    onPrevTrack,
    onNextTrack,
    positionMs,
  });
  useEffect(() => {
    latest.current = {
      onPlay,
      onPause,
      onSeek,
      onPrevTrack,
      onNextTrack,
      positionMs,
    };
  });

  // action handlers:掛載設一次,卸載(換章/離開)清除並抹掉 metadata。
  // 上一首/下一首只在掛載時有對應章節才註冊(本元件以 key={chapterId} 逐章重掛,
  // 故 prev/next 在單次掛載期間恆定);無則設 null = 鎖屏不顯示該按鈕。
  useEffect(() => {
    if (!hasMediaSession()) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => latest.current.onPlay());
    ms.setActionHandler("pause", () => latest.current.onPause());
    ms.setActionHandler("seekbackward", (d) =>
      latest.current.onSeek(
        latest.current.positionMs - (d.seekOffset ?? SEEK_STEP_S) * 1000,
      ),
    );
    ms.setActionHandler("seekforward", (d) =>
      latest.current.onSeek(
        latest.current.positionMs + (d.seekOffset ?? SEEK_STEP_S) * 1000,
      ),
    );
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) latest.current.onSeek(d.seekTime * 1000);
    });
    ms.setActionHandler(
      "previoustrack",
      latest.current.onPrevTrack ? () => latest.current.onPrevTrack?.() : null,
    );
    ms.setActionHandler(
      "nexttrack",
      latest.current.onNextTrack ? () => latest.current.onNextTrack?.() : null,
    );
    return () => {
      for (const action of [
        "play",
        "pause",
        "seekbackward",
        "seekforward",
        "seekto",
        "previoustrack",
        "nexttrack",
      ] as const) {
        ms.setActionHandler(action, null);
      }
      ms.metadata = null;
      ms.playbackState = "none";
    };
  }, []);

  // metadata:書名 / 章節名變動時更新。
  useEffect(() => {
    if (!hasMediaSession()) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: "Koma 聽書",
    });
  }, [title, artist]);

  // playbackState:鎖屏顯示正確的播放/暫停圖示。
  useEffect(() => {
    if (!hasMediaSession()) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  // positionState:鎖屏進度條。positionMs 約 4Hz 更新,setPositionState 成本低,
  // OS 會用 playbackRate 在更新之間內插。
  // ponytail: 4Hz 直更夠用;真要省可改成只在 seek / load / rate 變時設。
  useEffect(() => {
    if (!hasMediaSession()) return;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: durationMs / 1000,
        playbackRate: rate,
        position: Math.min(positionMs, durationMs) / 1000,
      });
    } catch {
      /* position > duration 等非法值:忽略 */
    }
  }, [durationMs, positionMs, rate]);
}
