"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, KeyRound, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// 寬鬆的 client 端格式檢查(純 UX);真正的驗證在 better-auth 伺服端。
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INPUT_CLASS =
  "h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function sendOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError("請輸入有效的 email");
      return;
    }
    start(async () => {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: addr,
        type: "sign-in",
      });
      if (error) {
        setError(error.message ?? "寄送失敗,請稍後再試");
        return;
      }
      setOtp("");
      setStep("otp");
    });
  }

  function verifyOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError("請輸入 6 位數驗證碼");
      return;
    }
    start(async () => {
      const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp });
      if (error) {
        setError(error.message ?? "驗證碼錯誤或已過期");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  const errorBox = error && (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {error}
    </p>
  );

  if (step === "email") {
    return (
      <form onSubmit={sendOtp} className="flex flex-col gap-3">
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
        {errorBox}
        <Button type="submit" disabled={pending} className="w-fit gap-2">
          <Mail className="size-4" />
          {pending ? "寄送中…" : "寄驗證碼"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyOtp} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        已寄驗證碼到 <span className="font-medium text-foreground">{email.trim()}</span>。
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        placeholder="6 位數驗證碼"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        className={`${INPUT_CLASS} tracking-[0.5em]`}
      />
      {errorBox}
      <Button type="submit" disabled={pending} className="w-fit gap-2">
        <KeyRound className="size-4" />
        {pending ? "驗證中…" : "登入"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setStep("email");
        }}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        改用其他 email
      </button>
    </form>
  );
}
