import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getServerAuth } from "@/lib/auth-server";
import { getQuotaStatus } from "@/lib/tts-quota";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { UnlockForm } from "./unlock-form";
import { signOutAction } from "./actions";

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

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">解鎖聽書額度</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        貼上邀請碼即可提高每日聽書(語音合成)額度。沒有碼也能用訪客額度試聽。
      </p>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">目前身分</p>
        <p className="text-lg font-medium text-brand">
          {ROLE_LABEL[auth.role] ?? auth.role}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {unlimited
            ? "今日聽書:無限"
            : `今日聽書:剩 ${quota.remaining} / ${quota.limit} 章`}
        </p>
      </section>

      {auth.role === "guest" ? (
        <UnlockForm />
      ) : (
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="w-fit">
            登出
          </Button>
        </form>
      )}
    </main>
  );
}
