import Link from "next/link";
import { ArrowLeft, Mail, BookHeart, BookOpen, Moon } from "lucide-react";

import { getServerAuth, getServerUser } from "@/lib/auth-server";
import { getQuotaStatus } from "@/lib/tts-quota";
import { getLibraryStats } from "@/lib/library";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { UnlockForm } from "./unlock-form";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理員",
  member: "會員",
  guest: "訪客",
};

/** 註冊至今天數(當天 = 第 1 天)。給「貓陪你夜讀第 N 天」暖心文案用。 */
function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000) + 1;
}

export const dynamic = "force-dynamic"; // 依 cookie/IP 算身分,不可靜態快取

/** 只接受站內相對路徑(// 也擋,防 open redirect);否則回首頁。 */
function safeFrom(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [auth, params] = await Promise.all([getServerAuth(), searchParams]);
  const [user, quota, stats] = await Promise.all([
    getServerUser(),
    getQuotaStatus(auth),
    getLibraryStats(),
  ]);
  const unlimited = quota.limit === Infinity;
  // email 登入者拿真名;沒名字 / 邀請碼登入就用身分標籤,訪客顯示「訪客」。
  const greetName = user?.name?.trim() || ROLE_LABEL[auth.role] || auth.role;
  const from = safeFrom(params.from);

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link
          href={from}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="返回"
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
        <p className="text-lg font-medium">
          嗨，{greetName}
          <span className="ml-2 align-middle text-xs text-muted-foreground">
            {ROLE_LABEL[auth.role] ?? auth.role}
          </span>
        </p>

        {/* 帳號資訊：email 登入者才有 email / 加入時間 */}
        {user && (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <Mail className="size-4 shrink-0" />
              {user.email}
            </p>
            <p className="flex items-center gap-2">
              <Moon className="size-4 shrink-0" />
              貓陪你夜讀第 {daysSince(user.createdAt)} 天
            </p>
          </div>
        )}

        {/* 暖心統計：書架 / 讀過幾本 */}
        <div className="mt-3 flex gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <BookHeart className="size-4 shrink-0" />
            書架 <span className="font-medium text-brand">{stats.saved}</span> 本
          </span>
          <span className="flex items-center gap-1.5">
            <BookOpen className="size-4 shrink-0" />
            讀過 <span className="font-medium text-brand">{stats.read}</span> 本
          </span>
        </div>

        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          {auth.role === "guest"
            ? "聽書尚未解鎖,登入或貼碼即可開啟"
            : unlimited
              ? "今日聽書:無限"
              : `今日聽書:剩 ${quota.remaining} / ${quota.limit} 章`}
        </p>
      </section>

      {auth.role === "guest" ? (
        <div className="flex flex-col gap-4">
          <Link
            href={from === "/" ? "/login" : `/login?from=${encodeURIComponent(from)}`}
            className={buttonVariants({ className: "w-fit gap-2" })}
          >
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
