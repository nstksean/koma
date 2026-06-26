"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 「重新整理」重試:來源站暫時性故障時,重新觸發 Server Component 的抓書流程
 * (router.refresh 會重跑 server render,而非整頁硬重載)。
 */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="default"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      重新整理
    </Button>
  );
}
