"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redeemCodeAction, type UnlockState } from "./actions";

const initialState: UnlockState = {};

export function UnlockForm() {
  const [state, formAction, pending] = useActionState(
    redeemCodeAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Input name="code" required autoComplete="off" placeholder="貼上邀請碼" />
      {state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit gap-2">
        <KeyRound className="size-4" />
        {pending ? "驗證中…" : "解鎖"}
      </Button>
    </form>
  );
}
