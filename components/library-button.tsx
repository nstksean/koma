"use client";

import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addToLibraryAction, removeFromLibraryAction } from "@/app/actions";

interface LibraryButtonProps {
  bookId: string;
  initialInLibrary: boolean;
}

export function LibraryButton({ bookId, initialInLibrary }: LibraryButtonProps) {
  const [inLibrary, setInLibrary] = useState(initialInLibrary);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !inLibrary;
    setInLibrary(next); // 樂觀更新
    startTransition(async () => {
      try {
        if (next) await addToLibraryAction(bookId);
        else await removeFromLibraryAction(bookId);
      } catch {
        setInLibrary(!next); // 失敗回滾
      }
    });
  }

  return (
    <Button
      variant={inLibrary ? "secondary" : "default"}
      onClick={toggle}
      disabled={pending}
    >
      {inLibrary ? <BookmarkCheck /> : <BookmarkPlus />}
      {inLibrary ? "已在書架" : "加入書架"}
    </Button>
  );
}
