import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ImportForm } from "@/components/import-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="回首頁">
          <ArrowLeft />
        </Link>
        <ThemeToggle />
      </header>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">匯入自帶書</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        貼上純文字或上傳 .txt，App 會切成章節、加入書架，之後就能像其他書一樣閱讀（含進度記憶、日夜模式）。
      </p>

      <ImportForm />
    </main>
  );
}
