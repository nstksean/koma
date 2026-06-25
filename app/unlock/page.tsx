import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

import { getServerAuth } from "@/lib/auth-server";
import { getQuotaStatus } from "@/lib/tts-quota";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { UnlockForm } from "./unlock-form";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理員",
  member: "會員",
  guest: "訪客",
};

export const dynamic = "force-dynamic"; // 依 cookie/IP 算身分,不可靜態快取

export default async function UnlockPage() {
  const auth = await getServerAuth();
  const quota = await getQuotaStatus(auth);
  const unlimited = quota.limit === Infinity;

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link
          href="/"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="回首頁"
        >
          <ArrowLeft />
        </Link>
        <ThemeToggle />
      </header>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">解鎖聽書</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        聽書(語音合成朗讀)為會員功能。用 email 登入或貼上邀請碼即可解鎖,並獲得每日聽書額度。
      </p>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">目前身分</p>
        <p className="text-lg font-medium text-brand">
          {ROLE_LABEL[auth.role] ?? auth.role}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {auth.role === "guest"
            ? "聽書尚未解鎖,登入或貼碼即可開啟"
            : unlimited
              ? "今日聽書:無限"
              : `今日聽書:剩 ${quota.remaining} / ${quota.limit} 章`}
        </p>
      </section>

      {auth.role === "guest" ? (
        <div className="flex flex-col gap-4">
          <Link href="/login" className={buttonVariants({ className: "w-fit gap-2" })}>
            <Mail className="size-4" />
            用 email 登入(跨裝置同步)
          </Link>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            或貼邀請碼
            <span className="h-px flex-1 bg-border" />
          </div>
          <UnlockForm />
        </div>
      ) : (
        <LogoutButton />
      )}
    </main>
  );
}
