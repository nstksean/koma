"use client";

import { useSyncExternalStore } from "react";

/**
 * 是否已在 client 掛載完成(取代 `useEffect(() => setMounted(true), [])`)。
 *
 * 用 useSyncExternalStore 表達「server 快照恆 false、client 快照恆 true」的
 * 不變 store:語意與舊的 setMounted 守門等價(SSR + 首次 hydration = false,
 * 之後 = true),但不在 effect 內同步 setState,故不觸發
 * react-hooks/set-state-in-effect,也少一次 render。
 *
 * 用途:SSR 安全地延後 client-only 行為(createPortal、讀 localStorage、
 * 避免 hydration 不一致的 icon/樣式)。
 */
const subscribe = (): (() => void) => () => {};
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
