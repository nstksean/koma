"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { signOutAction } from "./actions";

/**
 * 雙系統登出:兩條 session cookie 各自獨立,須都清,最後才導頁。
 *   1. authClient.signOut() —— 撤銷 better-auth DB session + 清 better-auth cookie(best-effort)。
 *   2. signOutAction()      —— 清舊 HMAC koma_session + role hint。
 *   3. 導回 /unlock + refresh。
 * 對只有其中一種 session 的人,另一個呼叫是無害的 no-op。
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      className="w-fit gap-2"
      onClick={() =>
        start(async () => {
          try {
            await authClient.signOut();
          } catch {
            // best-effort:better-auth 登出失敗不擋舊系統清理與導頁。
          }
          await signOutAction();
          router.push("/unlock");
          router.refresh();
        })
      }
    >
      <LogOut className="size-4" />
      {pending ? "登出中…" : "登出"}
    </Button>
  );
}
