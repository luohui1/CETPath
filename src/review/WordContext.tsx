import { useEffect, useState } from "react";
import { sourceHref } from "@/lib/articles";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { NoteBlank } from "@phosphor-icons/react";
import type { VocabSource } from "@/lib/db";
import { loadLemma } from "@/lib/dict";
import { colorValue, marksForWord, NOTE_COLOR, type MarkRow } from "@/lib/marks";
import { loadPaperIndex } from "@/lib/papers";
import { shortTitle } from "@/lib/exportPdf";
import { HighlightSentence } from "@/components/HighlightSentence";

let titleCache: Map<string, string> | null = null;

/** 试卷 id → 短名（2024年12月四级第2套） */
function usePaperTitles() {
  const [titles, setTitles] = useState(titleCache);
  useEffect(() => {
    if (titleCache) return;
    loadPaperIndex().then((list) => {
      titleCache = new Map(list.map((p) => [p.id, shortTitle(p)]));
      setTitles(titleCache);
    }, () => {});
  }, []);
  return titles;
}

function GoLink({ to }: { to: string }) {
  return (
    <Link to={to} className="whitespace-nowrap text-[var(--blue)] hover:underline">
      在卷面上看
    </Link>
  );
}

/** 一条卷面批注：高亮按原色、下划线画线、便签带小黄块 */
function MarkText({ m, word }: { m: MarkRow; word: string }) {
  if (m.kind === "note")
    return (
      <span className="flex items-start gap-2">
        <span className="mt-[3px] flex size-4 flex-none items-center justify-center rounded-[4px] text-white" style={{ background: NOTE_COLOR }}>
          <NoteBlank className="size-2.5" weight="bold" />
        </span>
        <span className="line-clamp-3 whitespace-pre-line">{m.note}</span>
      </span>
    );
  return (
    <span className="serif">
      <span
        style={
          m.kind === "highlight"
            ? { background: `${colorValue(m.color)}b3`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
            : { textDecoration: `underline ${colorValue(m.color)} 1.5px`, textUnderlineOffset: 3 }
        }
      >
        <HighlightSentence sentence={m.text ?? word} word={word} className="[&_mark]:bg-transparent [&_mark]:px-0 [&_mark]:font-semibold" />
      </span>
      {m.note && <span className="ml-2 font-sans text-[14px] text-[var(--ink-700)]">{m.note}</span>}
    </span>
  );
}

/** 单词卡背面：这个词在做过的卷子里的原句，和你在卷面上对它做的批注；每条都能跳回卷面 */
export function WordContext({ word, sources }: { word: string; sources: VocabSource[] }) {
  const titles = usePaperTitles();
  const [lemma, setLemma] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    loadLemma().then(setLemma, () => setLemma({}));
  }, []);
  const marks = useLiveQuery(() => (lemma ? marksForWord(word, lemma) : []), [word, lemma]);
  const title = (id: string, fallback?: string) => titles?.get(id) ?? fallback ?? id;
  if (!sources.length && !marks?.length) return null;

  return (
    <div className="mt-4 space-y-4 border-t border-dashed border-[var(--line-control)] pt-4">
      {sources.length > 0 && (
        <section>
          <h3 className="t-label mb-1.5">真题原句</h3>
          <ul className="space-y-2.5">
            {sources.map((s, i) => (
              <li key={i} className="text-[15px] leading-6">
                <HighlightSentence sentence={s.sentence} word={word} className="serif" />
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[var(--ink-500)]">
                  <span>{title(s.paperId, s.paperTitle)}</span>
                  <GoLink to={sourceHref(s.paperId, `?sent=${encodeURIComponent(s.sentence)}`)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!marks?.length && (
        <section>
          <h3 className="t-label mb-1.5">卷面批注</h3>
          <ul className="space-y-2.5">
            {marks.slice(0, 6).map((m) => (
              <li key={m.id} className="text-[15px] leading-6">
                <MarkText m={m} word={word} />
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[var(--ink-500)]">
                  <span>
                    {title(m.paperId)} · 第 {m.page} 页
                  </span>
                  <GoLink to={`/paper/${m.paperId}?mark=${m.id}`} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
