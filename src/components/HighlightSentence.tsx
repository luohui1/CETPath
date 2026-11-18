import { useEffect, useState } from "react";
import { loadLemma } from "@/lib/dict";

/** 在句子里高亮某个词（包括它的变形，如 study / studies / studied） */
export function HighlightSentence({ sentence, word, className }: { sentence: string; word: string; className?: string }) {
  const [lemma, setLemma] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    loadLemma().then(setLemma, () => setLemma({}));
  }, []);
  const parts = sentence.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const lower = p.toLowerCase();
        const hit = i % 2 === 1 && (lower === word || lemma?.[lower] === word);
        return hit ? (
          <mark key={i} className="rounded-[3px] bg-[var(--mark)] px-0.5 text-text">
            {p}
          </mark>
        ) : (
          p
        );
      })}
    </span>
  );
}
