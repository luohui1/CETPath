import { useEffect, useState } from "react";
import { getEntry, type DictEntry } from "./dict";

/** 批量取词典条目；词表变化时只补查新增的词 */
export function useEntries(words: string[]): Map<string, DictEntry | null> {
  const [map, setMap] = useState<Map<string, DictEntry | null>>(new Map());
  const key = words.join("|");
  useEffect(() => {
    let cancelled = false;
    const missing = words.filter((w) => !map.has(w));
    if (!missing.length) return;
    Promise.all(missing.map((w) => getEntry(w).then((e) => [w, e ?? null] as const, () => [w, null] as const))).then((pairs) => {
      if (cancelled) return;
      setMap((prev) => {
        const next = new Map(prev);
        for (const [w, e] of pairs) next.set(w, e);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // 只在词表内容变化时补查
  }, [key]);
  return map;
}
