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

import { Check, Gauge, Loader2, Pause, Play } from "lucide-react";
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
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import { useTtsHighlight } from "./use-tts-highlight";

/** 變速檔位(下限 1×、上限 2×,防變調由 preservesPitch 處理)。dropdown 直選,非循環。 */
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

type PlayerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "error";

interface AudioPlayerProps {
  bookSource: string;
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
  bookSource,
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
  // 最新語速檔位:ensureLoaded 載入時從 ref 讀(而非 capture rateIdx),
  // 避免換速後 callback 全churn + 載入瞬間回退 1× 的競態。
  const rateIdxRef = useRef(1);
  // 在飛的 timestamps fetch:換章/卸載時 abort,避免 resolve 進已卸載元件。
  const abortRef = useRef<AbortController | null>(null);

  const mounted = useMounted();
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
  // 在 effect body 捕捉 audio(而非 cleanup 內讀 audioRef.current):此節點在
  // component 生命週期內穩定,捕捉到的即為卸載時的值;detached <audio> 仍會
  // 續播,故卸載務必 pause。mounted=false 首 commit 尚無 <audio>,提前 return。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    return () => {
      abortRef.current?.abort(); // 取消在飛的 timestamps fetch
      audio.pause();
      stop();
      onPlayingChange?.(false);
    };
    // 僅依 mounted(false→true 跑一次);stop/onPlayingChange 為穩定 callback,
    // 刻意排除以免身分變動誤觸卸載清理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /** 確保已抓 timestamp + 設好 audio.src(冪等,首播觸發 server 惰性合成可能數十秒)。回傳是否就緒。 */
  const ensureLoaded = useCallback(async (): Promise<boolean> => {
    const audio = audioRef.current;
    if (!audio) return false;
    if (loadedRef.current) return true;
    if (loadingRef.current) return false; // 合成進行中,忽略重複觸發
    loadingRef.current = true;
    setStatus("loading");
    setErrorMsg("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        ttsTimestampsUrl(bookSource, sourceBookId, idx, voice),
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`合成失敗(${res.status})`);
      const payload = (await res.json()) as TimestampsPayload;
      if (controller.signal.aborted) return false; // 已換章/卸載,丟棄結果不 setState
      charsRef.current = payload.charTimestamps;
      setChars(payload.charTimestamps);
      setDurationMs(payload.durationMs);
      // 此時 server 已完成合成,音檔秒回。
      audio.src = ttsAudioUrl(bookSource, sourceBookId, idx, voice);
      audio.preservesPitch = true; // 變速防變調
      audio.playbackRate = PLAYBACK_RATES[rateIdxRef.current]; // 讀最新檔位,非 capture
      loadedRef.current = true;
      return true;
    } catch {
      // 卸載 abort 不是錯誤,靜默丟棄(避免對已卸載元件 setState)。
      if (controller.signal.aborted) return false;
      setStatus("error");
      setErrorMsg("聽書合成失敗,請稍後再試。");
      onPlayingChange?.(false);
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [bookSource, sourceBookId, idx, voice, setChars, onPlayingChange]);

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
  // 在 effect 內更新 ref(不在 render 階段寫 ref);stableSeek 只在使用者點字
  // 事件時觸發,屆時 effect 早已跑完,ref 必為最新。
  useEffect(() => {
    seekRef.current = seekAndPlayToChar;
  }, [seekAndPlayToChar]);

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

  /** 從 dropdown 直選某檔位,即時套用到 audio(暫停/播放中皆可)。 */
  const handleRateSelect = useCallback((next: number) => {
    setRateIdx(next);
    rateIdxRef.current = next; // 同步 ref,供 ensureLoaded 載入時讀最新檔位
    const audio = audioRef.current;
    if (audio) {
      audio.preservesPitch = true;
      audio.playbackRate = PLAYBACK_RATES[next];
    }
  }, []);

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
  const rateLabel = `${PLAYBACK_RATES[rateIdx]}×`;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40">
      {/* 隱藏 <audio>:用 element ref 而非 new Audio(),便於事件掛載與 SSR 安全。 */}
      <audio ref={audioRef} preload="metadata" className="hidden" />

      <div className="mx-auto flex max-w-3xl flex-col gap-2 border-t border-border bg-card px-4 py-3 shadow-[var(--shadow-player)]">
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
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : isPlaying ? (
              <Pause />
            ) : (
              <Play />
            )}
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`語速 ${rateLabel},點擊調整`}
                className="min-w-[3.75rem] tabular-nums"
              >
                <Gauge />
                {rateLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-28"
              role="menu"
            >
              {PLAYBACK_RATES.map((rate, i) => {
                const selected = i === rateIdx;
                return (
                  <PopoverClose key={rate} asChild>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => handleRateSelect(i)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-sm tabular-nums outline-none transition-colors",
                        "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                        selected && "font-medium text-brand",
                      )}
                    >
                      {`${rate}×`}
                      {selected && <Check className="size-4" />}
                    </button>
                  </PopoverClose>
                );
              })}
            </PopoverContent>
          </Popover>

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
              "h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-brand",
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
            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
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
