"use client";

/**
 * TTS 聽書播放器列(Workstream D)。固定底部、portal 到 body
 * (脫離 header 的 backdrop-blur 堆疊脈絡,沿用 chapter-drawer 模式)。
 *
 * 職責:play/pause、變速、進度 seek、首播 loading/error UI,以及把逐字高亮
 * 驅動委派給 useTtsHighlight。高亮本身全走 imperative DOM(見該 hook),
 * 本元件只在 play/pause/seek/ended 邊界呼叫 hook 的 start/stop/refresh。
 *
 * 時間軸契約:timestamp 恆為 1.0× ms;變速只設 `audio.playbackRate`,
 * 進度與高亮一律以 `audio.currentTime`(media time)為準,不縮放 timestamp。
 */

import { Gauge, Loader2, Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ttsAudioUrl, ttsTimestampsUrl } from "@/src/tts";
import type { CharTimestamp, TimestampsPayload } from "@/src/tts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTtsHighlight } from "./use-tts-highlight";

/** 變速循環檔位(上限 2×,防變調由 preservesPitch 處理)。 */
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

type PlayerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "error";

interface AudioPlayerProps {
  source: string;
  sourceBookId: string; // = slug
  idx: number; // 章序;換章時 reader-view 用 key={chapterId} 重掛本元件
  voice?: string;
  containerRef: React.RefObject<HTMLDivElement | null>; // reader-content 內文容器
  onPlayingChange?: (playing: boolean) => void; // 給 reader-view 做進度互斥
}

/**
 * 等到 <audio> 至少載入 metadata(readyState>=1)才能可靠設 currentTime。
 * 剛設 src 時 readyState=0,直接設 currentTime 會被瀏覽器打回 0(seek 失效)。
 */
function whenSeekable(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      audio.removeEventListener("loadedmetadata", on);
      resolve();
    };
    audio.addEventListener("loadedmetadata", on);
  });
}

/** 毫秒 → mm:ss(NaN/負值守門,首播 durationMs 未知時顯示 00:00)。 */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer({
  source,
  sourceBookId,
  idx,
  voice = DEFAULT_VOICE,
  containerRef,
  onPlayingChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 是否已抓過 timestamp + 設過 audio.src(後續 play/pause 不重抓)。
  const loadedRef = useRef(false);
  const loadingRef = useRef(false); // 載入(合成)進行中,避免重複觸發
  const charsRef = useRef<readonly CharTimestamp[]>([]); // 點字 seek 用:找 charIndex→startMs
  // 指向最新 seekAndPlayToChar(避免把它直接傳進 hook 造成定義循環依賴)。
  const seekRef = useRef<(charIndex: number) => void>(() => {});

  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0); // 進度條/時間顯示(非每幀,用 timeupdate)
  const [rateIdx, setRateIdx] = useState(1); // 預設 1.0×

  // 穩定包裝:hook 的點字委派一律呼叫 seekRef.current(最新 seekAndPlayToChar)。
  const stableSeek = useCallback(
    (charIndex: number) => seekRef.current(charIndex),
    [],
  );
  const { setChars, start, stop, refresh } = useTtsHighlight({
    containerRef,
    audioRef,
    onSeekToChar: stableSeek,
  });

  useEffect(() => setMounted(true), []);

  // <audio> 生命週期事件:進度顯示、結束處理。
  // 用 timeupdate(~4Hz)更新進度條 state —— 高亮另走 rAF,兩者刻意分離。
  // ⚠️ `mounted` 必須在 deps:`<audio>` 在 mounted=false 的首 render 不存在
  // (component 回 null),audioRef.current 為 null;唯有 mounted→true 重掛此
  // effect 時 audio 才存在、listener 才綁得上。漏掉 mounted → 進度條不動、章末
  // onEnded 不觸發(過去因 onPlayingChange 身分不穩才偶然被救,見 reader-view)。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPositionMs(audio.currentTime * 1000);
    const onEnded = () => {
      stop();
      setStatus("paused");
      onPlayingChange?.(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [mounted, stop, onPlayingChange]);

  // 卸載(換章/離開閱讀器):暫停音檔並停 rAF。高亮 class 清除由 hook 的
  // cleanup 負責;此處只管音檔與播放狀態通知。
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) audio.pause();
      stop();
      onPlayingChange?.(false);
    };
    // 僅在 unmount 執行;stop/onPlayingChange 為穩定 ref-backed callback。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 確保已抓 timestamp + 設好 audio.src(冪等,首播觸發 server 惰性合成可能數十秒)。回傳是否就緒。 */
  const ensureLoaded = useCallback(async (): Promise<boolean> => {
    const audio = audioRef.current;
    if (!audio) return false;
    if (loadedRef.current) return true;
    if (loadingRef.current) return false; // 合成進行中,忽略重複觸發
    loadingRef.current = true;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(ttsTimestampsUrl(source, sourceBookId, idx, voice));
      if (!res.ok) throw new Error(`合成失敗(${res.status})`);
      const payload = (await res.json()) as TimestampsPayload;
      charsRef.current = payload.charTimestamps;
      setChars(payload.charTimestamps);
      setDurationMs(payload.durationMs);
      // 此時 server 已完成合成,音檔秒回。
      audio.src = ttsAudioUrl(source, sourceBookId, idx, voice);
      audio.preservesPitch = true; // 變速防變調
      audio.playbackRate = PLAYBACK_RATES[rateIdx];
      loadedRef.current = true;
      return true;
    } catch {
      setStatus("error");
      setErrorMsg("聽書合成失敗,請稍後再試。");
      onPlayingChange?.(false);
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [source, sourceBookId, idx, voice, rateIdx, setChars, onPlayingChange]);

  /** 播放鈕:確保載入 → 從目前位置播(首播為 0)。 */
  const loadAndPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!(await ensureLoaded())) return;
    try {
      await audio.play();
      setStatus("playing");
      onPlayingChange?.(true);
      start();
    } catch {
      setStatus("error");
      setErrorMsg("播放失敗,請再試一次。");
      onPlayingChange?.(false);
    }
  }, [ensureLoaded, start, onPlayingChange]);

  /** 點字「從這裡開始聽」:載入(若需要)→ seek 到該字(點到標點/空白則對到下一個有聲字)→ 播放。 */
  const seekAndPlayToChar = useCallback(
    async (charIndex: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!(await ensureLoaded())) return;
      const chars = charsRef.current;
      if (chars.length === 0) return;
      const entry =
        chars.find((c) => c.charIndex >= charIndex) ?? chars[chars.length - 1];
      await whenSeekable(audio); // 等 metadata,否則 currentTime 會被打回 0
      audio.currentTime = entry.startMs / 1000;
      setPositionMs(entry.startMs);
      try {
        await audio.play();
        setStatus("playing");
        onPlayingChange?.(true);
        start();
        refresh(); // 立即把高亮挪到該字
      } catch {
        setStatus("error");
        setErrorMsg("播放失敗,請再試一次。");
        onPlayingChange?.(false);
      }
    },
    [ensureLoaded, start, refresh, onPlayingChange],
  );

  // 讓 hook 的點字委派(stableSeek)呼叫到最新的 seekAndPlayToChar。
  seekRef.current = seekAndPlayToChar;

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === "loading") return; // 合成中:忽略重複點擊

    if (status === "playing") {
      audio.pause();
      stop();
      setStatus("paused");
      onPlayingChange?.(false);
      return;
    }

    // error 後重試 = 走完整載入流程。
    if (!loadedRef.current || status === "error") {
      await loadAndPlay();
      return;
    }

    // 後續 resume:不重抓。
    try {
      await audio.play();
      setStatus("playing");
      onPlayingChange?.(true);
      start();
    } catch {
      setStatus("error");
      setErrorMsg("播放失敗,請再試一次。");
      onPlayingChange?.(false);
    }
  }, [status, stop, start, loadAndPlay, onPlayingChange]);

  /** 變速 cycle:0.75→1→1.25→1.5→2→回 0.75。即時套用到 audio。 */
  const handleRateCycle = useCallback(() => {
    const next = (rateIdx + 1) % PLAYBACK_RATES.length;
    setRateIdx(next);
    const audio = audioRef.current;
    if (audio) {
      audio.preservesPitch = true;
      audio.playbackRate = PLAYBACK_RATES[next];
    }
  }, [rateIdx]);

  /** 進度條拖動:設 currentTime(media time),即時重算高亮(暫停時亦然)。 */
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const valueMs = Number(e.target.value);
      audio.currentTime = valueMs / 1000;
      setPositionMs(valueMs);
      refresh();
    },
    [refresh],
  );

  const isLoading = status === "loading";
  const isPlaying = status === "playing";
  const isError = status === "error";
  const rateLabel = `${PLAYBACK_RATES[rateIdx].toFixed(2).replace(/0$/, "")}×`;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40">
      {/* 隱藏 <audio>:用 element ref 而非 new Audio(),便於事件掛載與 SSR 安全。 */}
      <audio ref={audioRef} preload="metadata" className="hidden" />

      <div className="mx-auto flex max-w-3xl flex-col gap-2 border-t border-border bg-card px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.12)]">
        {/* 第一列:控制鈕 + 時間 + 進度條 */}
        <div className="flex items-center gap-3">
          <Button
            variant="default"
            size="icon"
            aria-label={isPlaying ? "暫停" : "播放"}
            disabled={isLoading}
            onClick={handlePlayPause}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" />
            ) : isPlaying ? (
              <Pause />
            ) : (
              <Play />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            aria-label="調整語速"
            onClick={handleRateCycle}
            className="min-w-[3.75rem] tabular-nums"
          >
            <Gauge />
            {rateLabel}
          </Button>

          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTime(positionMs)}
          </span>

          <input
            type="range"
            min={0}
            max={durationMs || 0}
            value={Math.min(positionMs, durationMs || 0)}
            step={100}
            onChange={handleSeek}
            disabled={durationMs === 0}
            aria-label="播放進度"
            className={cn(
              "h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-[var(--brand)]",
              durationMs === 0 && "cursor-not-allowed opacity-50",
            )}
          />

          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTime(durationMs)}
          </span>
        </div>

        {/* 第二列:首播 loading / error 的克制提示(沿用 muted 風格)。 */}
        {isLoading && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            合成中…(首次聆聽需稍候)
          </p>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <span>{errorMsg}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handlePlayPause}
            >
              重試
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
