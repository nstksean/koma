import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// 基底 = 全站共用輸入框樣式(原 login-form 的 INPUT_CLASS)。
// 高度/內距/寬度等差異交給呼叫端用 className 覆寫,twMerge 會處理衝突。
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
