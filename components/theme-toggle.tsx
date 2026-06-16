"use client";

import { Flame, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// 三主題循環(DESIGN:預設貓眼 → 暖夜 → 淨紙)。
const THEMES = [
  { id: "cat-eye-dusk", label: "貓眼", Icon: Moon },
  { id: "ember-night", label: "暖夜", Icon: Flame },
  { id: "clean-paper", label: "淨紙", Icon: Sun },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const found = THEMES.findIndex((t) => t.id === theme);
  const current = THEMES[found === -1 ? 0 : found];
  const next = THEMES[(found === -1 ? 0 : found) + 1] ?? THEMES[0];
  const Icon = current.Icon;

  return (
    <Button
      variant="ghost"
      size="icon"
      title={`主題：${current.label}`}
      aria-label={`切換主題（目前 ${current.label}，點擊切到 ${next.label}）`}
      onClick={() => setTheme(next.id)}
    >
      {/* 未掛載前固定渲染 Moon,避免 hydration 不一致。 */}
      {mounted ? <Icon /> : <Moon />}
    </Button>
  );
}
