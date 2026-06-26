"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { importBookAction, type ImportState } from "@/app/actions";

const initialState: ImportState = {};

export function ImportForm() {
  const [state, formAction, pending] = useActionState(
    importBookAction,
    initialState,
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    // 順手把 TXT 內容塞進 textarea，讓使用者看得到。
    try {
      const txt = await file.text();
      if (textRef.current) textRef.current.value = txt;
    } catch {
      // 讀檔失敗:提示使用者,內容仍會交給 server 端用 file 物件處理。
      toast.error("讀取檔案失敗，將改用上傳的檔案匯入");
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          name="title"
          required
          placeholder="書名（必填）"
          className="h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          name="author"
          placeholder="作者（選填）"
          className="h-10 rounded-md border border-input bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <Upload className="size-4" />
        {fileName ? `已選：${fileName}` : "選擇 .txt 檔（或直接貼上）"}
        <input
          type="file"
          name="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={onPickFile}
        />
      </label>

      <textarea
        ref={textRef}
        name="text"
        rows={16}
        placeholder="把整本小說的純文字貼在這裡。會自動依「第N章 / 序章 / 楔子 / 番外」等標題切分章節。"
        className="resize-y rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "匯入中…" : "匯入並加入書架"}
      </Button>
    </form>
  );
}
