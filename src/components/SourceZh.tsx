import { useEffect, useState } from "react";
import type { VocabSource } from "@/lib/db";
import { sourceZh } from "@/lib/sourceZh";
import { cn } from "@/lib/utils";

/** 生词出处句下面的一行中文译文 */
export function SourceZh({ word, s, className }: { word: string; s: VocabSource; className?: string }) {
  const [zh, setZh] = useState<string | null | undefined>(s.zh);
  useEffect(() => {
    let off = false;
    setZh(s.zh);
    if (!s.zh)
      sourceZh(s).then(
        (z) => !off && setZh(z),
        () => !off && setZh(null),
      );
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, s.paperId, s.sentence, s.zh]);
  if (zh === undefined) return <div className={cn("text-[13px] text-[var(--ink-500)]", className)}>译文加载中…</div>;
  if (!zh) return null;
  return <div className={cn("text-[14px] leading-relaxed text-[var(--ink-700)]", className)}>{zh}</div>;
}
