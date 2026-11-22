import { useEffect, useRef, useState } from "react";
import { getEntry, type DictEntry } from "./dict";

/** 批量取词典条目；词表变化时只补查新增的词 */
/** rev 变了（比如改了生词的释义）就整张表重查 */
export function useEntries(words: string[], rev = ""): Map<string, DictEntry | null> {
  const [map, setMap] = useState<Map<string, DictEntry | null>>(new Map());
  const key = words.join("|");
  const lastRev = useRef(rev);
  useEffect(() => {
    let cancelled = false;
    const stale = lastRev.current !== rev;
    lastRev.current = rev;
    const missing = stale ? words : words.filter((w) => !map.has(w));
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
  }, [key, rev]);
  return map;
}
