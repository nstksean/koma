"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { validateLoginInput } from "@/lib/login-validation";
import { claimGuestData } from "./actions";

const INPUT_CLASS =
  "h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * better-auth 回傳的英文錯誤碼 → 溫暖的繁中文案。對應的 code 來自
 * @better-auth/core BASE_ERROR_CODES;查不到的碼一律落到 generic 繁中,
 * 不把英文原文丟給使用者。
 */
const SIGNIN_ERROR_FALLBACK = "登入沒成功,再試一次好嗎?";
const SIGNUP_ERROR_FALLBACK = "註冊沒成功,再試一次好嗎?";
const AUTH_ERROR_COPY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email 或密碼不對喔,再確認一下",
  INVALID_PASSWORD: "密碼不對喔,再確認一下",
  INVALID_EMAIL: "這個 email 看起來怪怪的,再檢查一下",
  USER_NOT_FOUND: "找不到這個帳號,要不要改用 email 註冊?",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "找不到這個帳號,要不要改用 email 註冊?",
  USER_ALREADY_EXISTS: "這個 email 已經註冊過了,直接登入就好",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "這個 email 已經註冊過了,直接登入就好",
  PASSWORD_TOO_SHORT: "密碼至少要 8 碼喔",
  PASSWORD_TOO_LONG: "密碼太長了,換短一點的吧",
  EMAIL_NOT_VERIFIED: "這個 email 還沒驗證",
};

/** 把 better-auth 的 error 物件對應成繁中文案;未知碼落到對應模式的 generic。 */
function authErrorCopy(
  error: { code?: string } | null | undefined,
  mode: "signin" | "signup",
): string {
  const fallback = mode === "signup" ? SIGNUP_ERROR_FALLBACK : SIGNIN_ERROR_FALLBACK;
  const code = error?.code;
  return (code && AUTH_ERROR_COPY[code]) || fallback;
}

/** 接續訪客資料:session 可能尚未被 server 讀到 → 短暫重試幾次。 */
const CLAIM_MAX_ATTEMPTS = 4;
const CLAIM_RETRY_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface LoginFormProps {
  /** 登入完成後要返回的路徑(來自 ?from=),預設回首頁。 */
  from?: string;
}

export function LoginForm({ from = "/" }: LoginFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * 接續訪客書架+進度。先確認 server 真的成形 session(claimGuestData 仍判 guest
   * 代表 cookie 還沒讀到)→ 短暫重試。失敗不擋登入,但會以 toast 告知。
   */
  async function continueGuestData() {
    for (let attempt = 1; attempt <= CLAIM_MAX_ATTEMPTS; attempt++) {
      const result = await claimGuestData();
      if (result.status === "claimed") {
        toast.success("已把你的書架與進度帶進帳號");
        return;
      }
      if (result.status === "no-guest-data") return; // 沒東西可搬,正常
      if (result.status === "error") {
        toast.error("書架與進度沒接上,下次登入會自動再試");
        return;
      }
      // session-not-ready:稍候再試(最後一次就放棄,下次登入仍可重搬)。
      if (attempt < CLAIM_MAX_ATTEMPTS) await sleep(CLAIM_RETRY_MS);
    }
  }

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
        setError(authErrorCopy(error, mode));
        return;
      }
      // 先確認 session 真的成形,再搬訪客資料(否則 server 仍判 guest,資料會被漏掉)。
      await continueGuestData();
      router.push(from);
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
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={8}
          placeholder="密碼(至少 8 碼)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${INPUT_CLASS} w-full pr-12`}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
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
      <Link
        href="/unlock"
        className="w-fit text-sm text-muted-foreground hover:text-foreground"
      >
        忘記密碼?
      </Link>
    </form>
  );
}
