"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { validateLoginInput } from "@/lib/login-validation";
import { claimGuestData } from "./actions";

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
    const invalid = validateLoginInput(addr, password);
    if (invalid) {
      setError(invalid);
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
      // 接續訪客資料(書架+進度)到此帳號。失敗不擋登入——帳號已建立,
      // reassignOwner 冪等,下次登入會再試。
      try {
        await claimGuestData();
      } catch {
        // intentionally ignored: 接續可重試,不應阻斷登入
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
