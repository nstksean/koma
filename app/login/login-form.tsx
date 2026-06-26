"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// 寬鬆的 client 端格式檢查(純 UX);真正的驗證在 better-auth 伺服端。
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INPUT_CLASS =
  "h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError("請輸入有效的 email");
      return;
    }
    if (password.length < 8) {
      setError("密碼至少 8 碼");
      return;
    }
    start(async () => {
      const { error } =
        mode === "signup"
          ? await authClient.signUp.email({
              email: addr,
              password,
              // 沒有顯示用名稱欄位 → 用 email 的 @ 前段帶過(name 為必填)。
              name: addr.split("@")[0],
            })
          : await authClient.signIn.email({ email: addr, password });
      if (error) {
        setError(error.message ?? (mode === "signup" ? "註冊失敗" : "Email 或密碼錯誤"));
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={INPUT_CLASS}
      />
      <input
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        required
        minLength={8}
        placeholder="密碼(至少 8 碼)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={INPUT_CLASS}
      />
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit gap-2">
        {mode === "signup" ? <Mail className="size-4" /> : <KeyRound className="size-4" />}
        {pending ? "處理中…" : mode === "signup" ? "註冊並登入" : "登入"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode((m) => (m === "signin" ? "signup" : "signin"));
        }}
        className="w-fit text-sm text-muted-foreground hover:text-foreground"
      >
        {mode === "signin" ? "還沒有帳號?改用 email 註冊" : "已有帳號?改為登入"}
      </button>
    </form>
  );
}
