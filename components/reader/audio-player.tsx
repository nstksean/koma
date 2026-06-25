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

import { Check, Gauge, Loader2, Moon, Pause, Play, Repeat } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Link from "next/link";
import { ttsAudioUrl, ttsTimestampsUrl } from "@/src/tts";
import { describeFailure, GENERIC_SYNTH_FAILED } from "@/lib/tts-failure";
import type { CharTimestamp, TimestampsPayload } from "@/src/tts";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import { parsePosMs, parseRateIdx } from "@/lib/audio-prefs";
import { useTtsHighlight } from "./use-tts-highlight";

/** 變速檔位(下限 1×、上限 2×,防變調由 preservesPitch 處理)。dropdown 直選,非循環。 */
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_VOICE = "zh-TW-HsiaoChenNeural";

/** 語速持久化 key(全域偏好,跨書跨章);逐章播放位置另用 posStorageKey。 */
const RATE_KEY = "koma:rate";
/** 自動續播下一章偏好(全域)。 */
const AUTONEXT_KEY = "koma:autonext";
/** 跨章交棒旗標(sessionStorage):章末自動翻頁後,新章掛載即接著播。 */
const AUTOPLAY_FLAG = "koma:autoplay";
/** 睡眠定時選項(分鐘)。 */
const SLEEP_OPTIONS = [15, 30, 60] as const;

/** 使用者面提示文案(集中管理,避免重複字串漂移)。 */
const TTS_MESSAGES = {
  synthFailed: GENERIC_SYNTH_FAILED, // 細分原因見 describeFailure;此為退路
  playFailed: "播放失敗,請再試一次。",
  quotaExhausted: "今日聽書額度已用完,請解鎖或明日再試。",
} as const;

/**
 * 變速防變調:現代瀏覽器用 `preservesPitch`,舊版 iOS Safari 用 `webkitPreservesPitch`
 * 前綴版 —— 不設前綴版,舊 iOS 變速會變調(chipmunk)。iOS 為優先平台,兩個都設。
 */
function setPreservesPitch(audio: HTMLAudioElement): void {
  audio.preservesPitch = true;
  (audio as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
    true;
}

function loadAutoNext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTONEXT_KEY) === "1";
  } catch {
    return false;
  }
}

/** 從 localStorage 還原上次語速檔位(SSR / 隱私模式回退 1.0×)。 */
function loadRateIdx(): number {
  if (typeof window === "undefined") return 1;
  try {
    return parseRateIdx(window.localStorage.getItem(RATE_KEY), PLAYBACK_RATES.length);
  } catch {
    return 1;
  }
}

/** 逐章「上次聽到哪」的本機 key(device-local,不進 DB)。 */
function posStorageKey(source: string, slug: string, idx: number): string {
  return `koma:pos:${source}:${slug}:${idx}`;
}

/**
 * 首播載入逾時。合成為逐段序列(900 code points/段),極長章 + 偶發重試最壞約 40s,
 * 故設 45s 留一點 margin 不誤砍正常合成 —— 逾時純為解開 iOS 背景化 / 鎖屏 / 斷網時
 * fetch 永不 settle 的死結(否則卡在 loading,點擊與 ensureLoaded 都被守門擋住,只能
 * refresh),這也是真卡死時使用者盯轉圈圈的上限,故不再放大。逾時 abort 不影響 server
 * 端合成(仍會完成並落地),重按即命中快取(或附上同一 inflight 工作)秒回。
 */
const PREFETCH_TIMEOUT_MS = 45_000;

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
  nextIdx: number | null; // 下一章序位(null = 最後一章,無法自動續播)
  voice?: string;
  containerRef: React.RefObject<HTMLDivElement | null>; // reader-content 內文容器
  onPlayingChange?: (playing: boolean) => void; // 給 reader-view 做進度互斥
  onRequestNext?: () => void; // 章末自動續播:請 reader-view 導到下一章
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
  nextIdx,
  voice = DEFAULT_VOICE,
  containerRef,
  onPlayingChange,
  onRequestNext,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 是否已抓過 timestamp + 設過 audio.src(後續 play/pause 不重抓)。
  const loadedRef = useRef(false);
  const loadingRef = useRef(false); // 載入(合成)進行中,避免重複觸發
  const charsRef = useRef<readonly CharTimestamp[]>([]); // 點字 seek 用:找 charIndex→startMs
  // 指向最新 seekAndPlayToChar(避免把它直接傳進 hook 造成定義循環依賴)。
  const seekRef = useRef<(charIndex: number) => void>(() => {});
  // 在飛的 timestamps fetch:換章/卸載時 abort,避免 resolve 進已卸載元件。
  const abortRef = useRef<AbortController | null>(null);

  // 逐章播放位置的本機 key(props 對單一實例固定;換章由 key={chapterId} 重掛)。
  const posKey = posStorageKey(bookSource, sourceBookId, idx);

  const mounted = useMounted();
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [quotaHit, setQuotaHit] = useState(false); // 429 額度用完:錯誤列改顯示 /unlock 入口而非「重試」

  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0); // 進度條/時間顯示(非每幀,用 timeupdate)
  // 語速:從 localStorage 還原上次選擇,跨章/重開都記得(ainowcast 的播放器其實沒存,
  // 每次重置成 1×;這裡直接做持久化)。ref 供 ensureLoaded 載入時讀最新檔位避免競態。
  const [rateIdx, setRateIdx] = useState(loadRateIdx);
  const rateIdxRef = useRef(rateIdx);

  // 自動續播下一章(全域偏好)。autoNext / nextIdx / onRequestNext 用 ref 餵 onEnded,
  // 避免它們變動就重掛 timeupdate/ended listener(ref 在下方 effect 同步,不在 render 寫)。
  const [autoNext, setAutoNext] = useState(loadAutoNext);
  const autoNextRef = useRef(autoNext);
  const nextIdxRef = useRef(nextIdx);
  const onRequestNextRef = useRef(onRequestNext);
  useEffect(() => {
    autoNextRef.current = autoNext;
    nextIdxRef.current = nextIdx;
    onRequestNextRef.current = onRequestNext;
  });
  // 睡眠定時:sleepMin = 選的分鐘數(供 UI 高亮);sleepEndsAt = 截止 wall-clock ms
  // (倒數來源);sleepRemainingMs = 顯示用剩餘。三者皆 null/0 = 關閉。
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState(0);

  /** 存下這次聽到哪(本機,逐章)。currentTime<=0 不存,避免覆蓋成 0。 */
  const savePos = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.currentTime <= 0) return;
    try {
      window.localStorage.setItem(posKey, String(Math.floor(audio.currentTime * 1000)));
    } catch {
      /* 隱私模式 / 配額滿:忽略,純屬本機便利功能 */
    }
  }, [posKey]);

  /** 章末播畢:清掉位置,下次從頭播。 */
  const clearPos = useCallback(() => {
    try {
      window.localStorage.removeItem(posKey);
    } catch {
      /* 忽略 */
    }
  }, [posKey]);

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

  /** 暫停 + 收尾(停高亮、通知互斥、存位置)。手動暫停與睡眠定時共用。 */
  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stop();
    setStatus("paused");
    onPlayingChange?.(false);
    savePos();
  }, [stop, onPlayingChange, savePos]);

  /** 從已就緒的音檔播放(play→啟動高亮);play 失敗顯示錯誤。多處共用。 */
  const playLoaded = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await audio.play();
      setStatus("playing");
      onPlayingChange?.(true);
      start();
    } catch (err: unknown) {
      console.error("[tts] 播放失敗:", err);
      setStatus("error");
      setErrorMsg(TTS_MESSAGES.playFailed);
      toast.error(TTS_MESSAGES.playFailed);
      onPlayingChange?.(false);
    }
  }, [start, onPlayingChange]);

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
      onPlayingChange?.(false);
      clearPos(); // 播畢:本章下次從頭
      // 自動續播:還有下一章就交棒給 reader-view 導頁,新章掛載即接著播。
      if (autoNextRef.current && nextIdxRef.current !== null) {
        try {
          window.sessionStorage.setItem(AUTOPLAY_FLAG, "1");
        } catch {
          /* 忽略:擋下只是不自動播,使用者點一下即可 */
        }
        onRequestNextRef.current?.();
        return;
      }
      setPositionMs(audio.duration * 1000); // 歸位到章末,否則進度條停在差一點
      setStatus("paused");
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [mounted, stop, onPlayingChange, clearPos]);

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
      savePos(); // 換章/離開:存下聽到哪
      audio.pause();
      stop();
      onPlayingChange?.(false);
    };
    // 僅依 mounted(false→true 跑一次);stop/onPlayingChange 為穩定 callback,
    // 刻意排除以免身分變動誤觸卸載清理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /**
   * 確保已抓 timestamp + 設好 audio.src(冪等,首播觸發 server 惰性合成可能數十秒)。回傳是否就緒。
   * @param userInitiated 使用者主動觸發(按播放/點字)時為 true:失敗會顯示錯誤提示;
   *   背景 prefetch(false)失敗則靜默退回 idle,播放鈕仍可按,按下重載即秒回。
   */
  const ensureLoaded = useCallback(
    async (userInitiated = false): Promise<boolean> => {
      const audio = audioRef.current;
      if (!audio) return false;
      if (loadedRef.current) return true;
      if (loadingRef.current) return false; // 合成進行中,忽略重複觸發
      loadingRef.current = true;
      setStatus("loading");
      setErrorMsg("");
      setQuotaHit(false);
      const controller = new AbortController();
      abortRef.current = controller;
      // timedOut 區分「逾時 abort(可復原)」與「卸載 abort(靜默丟棄)」——兩者都會
      // 讓 controller.signal.aborted=true,只能靠此旗標分辨。
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, PREFETCH_TIMEOUT_MS);
      try {
        const res = await fetch(
          ttsTimestampsUrl(bookSource, sourceBookId, idx, voice),
          { signal: controller.signal },
        );
        // 額度用完(429):非暫時性,重試無用 —— 顯示 server 文案 + /unlock 入口,
        // 不走下方泛用錯誤路徑(那只給「重試」)。背景 prefetch 僅 admin(無限)觸發、
        // 不會 429,故此處不分 userInitiated。
        if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          const msg = body?.error ?? TTS_MESSAGES.quotaExhausted;
          setStatus("error");
          setErrorMsg(msg);
          setQuotaHit(true);
          // 額度用完也彈 toast(top-center 比底部錯誤列更顯眼);錯誤列仍保留
          // /unlock 入口。背景 prefetch 僅 admin(無限)觸發、不會 429,故不分 userInitiated。
          toast.error(msg);
          onPlayingChange?.(false);
          return false;
        }
        if (!res.ok) throw new Error(`合成失敗(${res.status})`);
        const payload = (await res.json()) as TimestampsPayload;
        // 已換章/卸載或逾時:丟進 catch 統一處理(直接 return false 會卡在 loading)。
        if (controller.signal.aborted) throw new Error("aborted");
        charsRef.current = payload.charTimestamps;
        setChars(payload.charTimestamps);
        setDurationMs(payload.durationMs);
        // 此時 server 已完成合成,音檔秒回。
        audio.src = ttsAudioUrl(bookSource, sourceBookId, idx, voice);
        setPreservesPitch(audio);
        audio.playbackRate = PLAYBACK_RATES[rateIdxRef.current]; // 讀最新檔位,非 capture
        loadedRef.current = true;
        // 還原上次聽到的位置(逐章,本機)。在 setStatus("ready") 前 await seek 完成,
        // 否則 loadAndPlay 會先從 0 播再跳,出現一小段雜音。
        let savedRaw: string | null = null;
        try {
          savedRaw = window.localStorage.getItem(posKey);
        } catch {
          /* 忽略 */
        }
        const savedMs = parsePosMs(savedRaw, payload.durationMs);
        if (savedMs > 0) {
          await whenSeekable(audio);
          audio.currentTime = savedMs / 1000;
          setPositionMs(savedMs);
        }
        setStatus("ready"); // 合成完、未播:播放鈕轉可按(loadAndPlay 隨後覆寫為 playing)
        return true;
      } catch (err: unknown) {
        // 卸載 abort(非逾時):元件已走,靜默丟棄不 setState。
        if (controller.signal.aborted && !timedOut) return false;
        // 記錄失敗原因(逾時 / 網路 / HTTP 細分),含技術細節供除錯,不外洩到 UI。
        // 背景 prefetch 失敗也記,但不彈 toast(沒在看的使用者不該被驚動)。
        const { user, log } = describeFailure(err, timedOut);
        console.error("[tts] 合成失敗:", log, err);
        // 逾時 / 網路 / HTTP 錯誤 → 可復原。背景 prefetch 靜默退回 idle(鈕仍可按),
        // 唯使用者主動觸發才彈錯誤列 + toast。
        if (userInitiated) {
          setStatus("error");
          setErrorMsg(user);
          toast.error(user);
          onPlayingChange?.(false);
        } else {
          setStatus("idle");
        }
        return false;
      } finally {
        clearTimeout(timer);
        loadingRef.current = false;
      }
    },
    [bookSource, sourceBookId, idx, voice, posKey, setChars, onPlayingChange],
  );

  /** 播放鈕:確保載入 → 從目前位置播(首播為 0)。 */
  const loadAndPlay = useCallback(async () => {
    if (!(await ensureLoaded(true))) return;
    await playLoaded();
  }, [ensureLoaded, playLoaded]);

  /**
   * 章末自動續播:載入新章 → 嘗試直接播。與 loadAndPlay 差別在於 play() 被 autoplay
   * policy 擋下時「靜默」退回 ready(不彈錯誤),使用者點一下即播 —— 屬漸進增強。
   */
  const autoContinuePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!(await ensureLoaded(true))) return; // 合成失敗仍會自己顯示錯誤
    try {
      await audio.play();
      setStatus("playing");
      onPlayingChange?.(true);
      start();
    } catch {
      setStatus("ready"); // autoplay 被擋:不視為錯誤
    }
  }, [ensureLoaded, start, onPlayingChange]);

  /** 點字「從這裡開始聽」:載入(若需要)→ seek 到該字(點到標點/空白則對到下一個有聲字)→ 播放。 */
  const seekAndPlayToChar = useCallback(
    async (charIndex: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!(await ensureLoaded(true))) return;
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
      } catch (err: unknown) {
        console.error("[tts] 播放失敗:", err);
        setStatus("error");
        setErrorMsg(TTS_MESSAGES.playFailed);
        toast.error(TTS_MESSAGES.playFailed);
        onPlayingChange?.(false);
      }
    },
    [ensureLoaded, start, refresh, onPlayingChange],
  );

  // 不做開章自動合成:聽書為顯式功能,合成一律由使用者按播放觸發(loadAndPlay)。
  // 「聽書模式」由 reader-view 的開關決定是否掛載本元件;掛載後維持 idle,不預取 TTS,
  // 避免「光是翻開章節」就燒 Azure 合成成本(本元件出現 ≠ 立即合成)。

  // 章末自動續播交棒:上一章 onEnded 設了旗標 → 新章掛載即接著播(消費後即清旗標)。
  useEffect(() => {
    if (!mounted) return;
    let armed = false;
    try {
      armed = window.sessionStorage.getItem(AUTOPLAY_FLAG) === "1";
      if (armed) window.sessionStorage.removeItem(AUTOPLAY_FLAG);
    } catch {
      /* 忽略 */
    }
    if (armed) void autoContinuePlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // 讓 hook 的點字委派(stableSeek)呼叫到最新的 seekAndPlayToChar。
  // 在 effect 內更新 ref(不在 render 階段寫 ref);stableSeek 只在使用者點字
  // 事件時觸發,屆時 effect 早已跑完,ref 必為最新。
  useEffect(() => {
    seekRef.current = seekAndPlayToChar;
  }, [seekAndPlayToChar]);

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    // 合成中(已有一次 loadAndPlay 在進行):忽略重複點擊,就緒後它會自動播。
    if (status === "loading") return;

    if (status === "playing") {
      pausePlayback(); // 暫停 + 存位置
      return;
    }

    // error 後重試 = 走完整載入流程。
    if (!loadedRef.current || status === "error") {
      await loadAndPlay();
      return;
    }

    // 後續 resume:不重抓。
    await playLoaded();
  }, [status, loadAndPlay, playLoaded, pausePlayback]);

  // 背景化 / 切走分頁時也存一次位置(行動裝置最常見的「離開」,卸載未必觸發)。
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") savePos();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [savePos]);

  // 睡眠定時:每秒更新剩餘;到點暫停並關閉(走 wall-clock,背景化也準)。
  useEffect(() => {
    if (sleepEndsAt === null) {
      setSleepRemainingMs(0);
      return;
    }
    const tick = () => {
      const left = sleepEndsAt - Date.now();
      if (left <= 0) {
        setSleepMin(null);
        setSleepEndsAt(null);
        pausePlayback();
      } else {
        setSleepRemainingMs(left);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepEndsAt, pausePlayback]);

  /** 切換「自動續播下一章」並持久化。 */
  const handleToggleAutoNext = useCallback(() => {
    setAutoNext((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(AUTONEXT_KEY, next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }, []);

  /** 選睡眠定時(分鐘;null = 關閉)。 */
  const handleSleepSelect = useCallback((min: number | null) => {
    setSleepMin(min);
    setSleepEndsAt(min === null ? null : Date.now() + min * 60_000);
  }, []);

  /** 從 dropdown 直選某檔位,即時套用到 audio(暫停/播放中皆可)。 */
  const handleRateSelect = useCallback((next: number) => {
    setRateIdx(next);
    rateIdxRef.current = next; // 同步 ref,供 ensureLoaded 載入時讀最新檔位
    try {
      window.localStorage.setItem(RATE_KEY, String(next)); // 持久化:下次重開記得
    } catch {
      /* 隱私模式 / 配額滿:忽略,語速仍即時生效只是不持久 */
    }
    const audio = audioRef.current;
    if (audio) {
      setPreservesPitch(audio);
      audio.playbackRate = PLAYBACK_RATES[next];
    }
  }, []);

  /** 進度條拖動:設 currentTime(media time),即時重算高亮(暫停時亦然)。 */
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const valueMs = Number(e.target.value);
      setPositionMs(valueMs); // 視覺立即跟手
      // 守門:metadata 未載入(readyState=0)時設 currentTime 會被打回 0,
      // 等 seekable 再套用(與 seekAndPlayToChar 同模式)。
      const apply = () => {
        audio.currentTime = valueMs / 1000;
        refresh();
      };
      if (audio.readyState >= 1) apply();
      else void whenSeekable(audio).then(apply);
    },
    [refresh],
  );

  const isLoading = status === "loading";
  const isPlaying = status === "playing";
  const isError = status === "error";
  const rateLabel = `${PLAYBACK_RATES[rateIdx]}×`;
  const sleepActive = sleepEndsAt !== null;
  const nightActive = sleepActive || autoNext; // 任一夜讀選項開啟 → 月亮鈕染色

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
            // ponytail: 主控鈕放大為 48px 圓鈕 + 24px 字符(原 40px 方殼內 16px 字符太空)
            className="size-12 rounded-full [&_svg]:size-6"
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

          {/* 夜讀選項:睡眠定時 + 自動續播下一章(貓陪你夜讀)。 */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={
                  sleepActive
                    ? `睡眠定時剩 ${formatTime(sleepRemainingMs)},點擊調整夜讀選項`
                    : "夜讀選項:睡眠定時、自動續播"
                }
                className={cn("gap-1.5 tabular-nums", nightActive && "text-brand")}
              >
                <Moon />
                {sleepActive && (
                  <span className="text-xs">{formatTime(sleepRemainingMs)}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-48">
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                睡眠定時
              </p>
              {[null, ...SLEEP_OPTIONS].map((min) => {
                const selected = sleepMin === min;
                return (
                  <button
                    key={min ?? "off"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => handleSleepSelect(min)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-sm tabular-nums outline-none transition-colors",
                      "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                      selected && "font-medium text-brand",
                    )}
                  >
                    {min === null ? "關閉" : `${min} 分`}
                    {selected && <Check className="size-4" />}
                  </button>
                );
              })}

              <div className="my-1 border-t border-border" />

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={autoNext}
                onClick={handleToggleAutoNext}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none transition-colors",
                  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                  autoNext && "font-medium text-brand",
                )}
              >
                <Repeat className="size-4 shrink-0" />
                <span className="flex-1 text-left">自動續播下一章</span>
                {autoNext && <Check className="size-4 shrink-0" />}
              </button>
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
            {quotaHit ? (
              <Link
                href="/unlock"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "h-6 px-2 text-xs",
                )}
              >
                解鎖
              </Link>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handlePlayPause}
              >
                重試
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
