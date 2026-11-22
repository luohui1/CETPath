import { useEffect, useState, type RefObject } from "react";
import { BookmarkSimple, Check, Lightbulb } from "@phosphor-icons/react";
import { lookup } from "@/lib/dict";
import { addToVocab } from "@/lib/learning";
import { lookupOnline } from "@/lib/youdao";
import { addMethod } from "@/lib/methods";
import type { Paper } from "@/lib/papers";

const EN = /^[A-Za-z][A-Za-z'’ -]*[A-Za-z]$|^[A-Za-z]$/;

/** 在 Agent 回答里选中一段：英文词或短语可加生词本，任何一段都能收进解题思路库 */
export function AnswerPick({ root, paper }: { root: RefObject<HTMLElement | null>; paper?: Paper }) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    const up = () => {
      const s = getSelection();
      const el = root.current;
      if (!s || s.isCollapsed || !el || !s.rangeCount) return setSel(null);
      const r = s.getRangeAt(0);
      const host = (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest("[data-answer]");
      if (!host || !el.contains(host)) return setSel(null);
      const text = s.toString().replace(/\s+/g, " ").trim();
      if (!text) return setSel(null);
      const b = r.getBoundingClientRect();
      setDone(null);
      setSel({ text, x: Math.min(Math.max(b.left + b.width / 2, 120), innerWidth - 120), y: b.top });
    };
    document.addEventListener("selectionchange", up);
    return () => document.removeEventListener("selectionchange", up);
  }, [root]);
  if (!sel) return null;
  const word = sel.text.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  const canVocab = EN.test(word) && word.split(/\s+/).length <= 6;
  const source = paper ? { paperId: paper.id, paperTitle: paper.title } : undefined;
  const addVocab = async () => {
    const phrase = /\s/.test(word);
    const r = phrase ? null : await lookup(word);
    if (r) await addToVocab(r.lemma);
    else {
      const online = await lookupOnline(word);
      await addToVocab(word.toLowerCase(), undefined, online?.entry.t ? online.entry : undefined);
    }
    setDone(`已加入生词本 · ${r?.lemma ?? word.toLowerCase()}`);
  };
  const addIdea = async () => {
    await addMethod({ text: sel.text, from: "agent", source });
    setDone("已收进解题思路库");
  };
  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 -translate-y-[calc(100%+8px)] items-center gap-1 rounded-full bg-[var(--ink)] p-1 text-[13px] text-white shadow-[var(--elev-2,0_4px_16px_rgba(0,0,0,.2))]"
      style={{ left: sel.x, top: Math.max(sel.y, 56) }}
      onPointerDown={(e) => e.preventDefault()}
    >
      {done ? (
        <span className="inline-flex h-8 items-center gap-1 px-3">
          <Check className="size-3.5" weight="bold" /> {done}
        </span>
      ) : (
        <>
          {canVocab && (
            <button type="button" onClick={() => void addVocab()} className="inline-flex h-8 items-center gap-1 rounded-full px-3 hover:bg-white/15">
              <BookmarkSimple className="size-3.5" weight="bold" /> 加入生词本
            </button>
          )}
          <button type="button" onClick={() => void addIdea()} className="inline-flex h-8 items-center gap-1 rounded-full px-3 hover:bg-white/15">
            <Lightbulb className="size-3.5" weight="bold" /> 收进思路库
          </button>
        </>
      )}
    </div>
  );
}

/** 整条回答收进思路库（回答下面的小按钮） */
export function SaveAnswer({ text, paper }: { text: string; paper?: Paper }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      disabled={saved}
      onClick={async () => {
        await addMethod({ text, from: "agent", source: paper ? { paperId: paper.id, paperTitle: paper.title } : undefined });
        setSaved(true);
      }}
      className="mt-1 inline-flex items-center gap-1 text-[12px] text-[var(--ink-500)] hover:text-[var(--blue)] disabled:text-[var(--blue)]"
    >
      {saved ? <Check className="size-3" weight="bold" /> : <Lightbulb className="size-3" />}
      {saved ? "已收进思路库" : "收进思路库"}
    </button>
  );
}
