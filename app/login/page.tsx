import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getServerAuth } from "@/lib/auth-server";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic"; // 依身分判斷,不可靜態快取

/** 只接受站內相對路徑(// 也擋,防 open redirect);否則回首頁。 */
function safeFrom(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  // 已登入(非訪客)就不必再登入,導向帳號頁。
  const [auth, params] = await Promise.all([getServerAuth(), searchParams]);
  if (auth.role !== "guest") redirect("/unlock");

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

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">登入 Koma</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        用 email 與密碼登入或註冊。登入後聽書額度與進度跨裝置同步。
      </p>

      <LoginForm from={from} />

      <p className="mt-6 text-sm text-muted-foreground">
        有邀請碼?{" "}
        <Link href="/unlock" className="text-brand underline-offset-4 hover:underline">
          改用邀請碼解鎖
        </Link>
      </p>
    </main>
  );
}
