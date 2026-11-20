import { createContext, Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { loadLemma } from "@/lib/dict";
import { cn } from "@/lib/utils";

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const BLANK_RE = /\{\{(\d+)\}\}/g;

/** 取出 index 所在的那句话 */
export function sentenceAt(text: string, index: number): string {
  const clean = text.replace(BLANK_RE, "____");
  const ends = /[.!?。！？]["”’)]?(?=\s|$)/g;
  let start = 0;
  let end = clean.length;
  let m: RegExpExecArray | null;
  while ((m = ends.exec(clean))) {
    const stop = m.index + m[0].length;
    if (stop <= index) start = stop;
    else {
      end = stop;
      break;
    }
  }
  return clean.slice(start, end).trim();
}

export interface WordClick {
  word: string;
  sentence: string;
  rect: DOMRect;
  el?: HTMLElement; // 正文里的词（结构化文本）有元素；原卷上的词没有，用页码和序号
  page?: number;
  index?: number;
  nth?: number; // 原卷上的词：它是这句里第几个（从 0 数）同样开头的词，原句里只加粗这一处
}

interface WordCtx {
  onWord?: (hit: WordClick) => void;
  marks: boolean;
}

const Ctx = createContext<WordCtx>({ marks: false });

/** 生词本里的词（原形）和词形还原表，用来在正文里标出生词 */
export function useVocabMarks(enabled: boolean) {
  const words = useLiveQuery(() => (enabled ? db.vocab.toCollection().primaryKeys() : []), [enabled]);
  const [lemma, setLemma] = useState<Record<string, string> | null>(null);
  // 词形表 170KB：生词本是空的就不下；有生词也等几秒再下，别和卷面第一页抢带宽（慢网下第一页要先出来）
  const hasWords = !!words?.length;
  useEffect(() => {
    if (!enabled || !hasWords) return;
    const t = window.setTimeout(() => loadLemma().then(setLemma, () => setLemma({})), 4000);
    return () => clearTimeout(t);
  }, [enabled, hasWords]);
  // 同一份词表返回同一个对象：考场每次渲染都把它传给每一页，换了对象每页都要重画
  const key = words?.join("\n") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ vocab: new Set(words ?? []), lemma: lemma ?? {} }), [key, lemma]);
}

const MarksCtx = createContext<{ vocab: Set<string>; lemma: Record<string, string> }>({ vocab: new Set(), lemma: {} });

export function WordTextProvider({
  onWord,
  marks,
  children,
}: {
  onWord?: (hit: WordClick) => void;
  marks: boolean;
  children: ReactNode;
}) {
  const markData = useVocabMarks(marks);
  const value = useMemo(() => ({ onWord, marks }), [onWord, marks]);
  return (
    <Ctx.Provider value={value}>
      <MarksCtx.Provider value={markData}>{children}</MarksCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * 把一段英文渲染成可点击查词的文本。
 * 点击用事件委托，避免给每个词绑定回调。
 */
export const WordText = memo(function WordText({
  text,
  renderBlank,
  className,
  as: Tag = "span",
  trigger = "click",
  ranges,
}: {
  text: string;
  renderBlank?: (num: number) => ReactNode;
  className?: string;
  as?: "span" | "p" | "div";
  /** hold：点一下留给外层（比如听力面板里点句子定位），长按或右键才查词 */
  trigger?: "click" | "hold";
  /** 给一段字符范围 [a, b) 里的词加样式（外刊的高亮、划线） */
  ranges?: { a: number; b: number; cls: string }[];
}) {
  const { onWord, marks } = useContext(Ctx);
  const { vocab, lemma } = useContext(MarksCtx);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);

  const fire = (el: HTMLElement) => {
    if (!onWord) return;
    const offset = Number(el.dataset.o);
    onWord({ word: el.textContent ?? "", sentence: sentenceAt(text, offset), rect: el.getBoundingClientRect(), el });
  };
  const wordAt = (e: { target: EventTarget | null }) => (e.target as HTMLElement).closest<HTMLElement>(".w");

  const onClick = (e: MouseEvent) => {
    if (trigger === "hold") {
      // 刚长按过：这次点击不再往上冒（外层会当成"点句子"）
      if (held.current) {
        held.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const el = wordAt(e);
    if (el) fire(el);
  };
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const onPointerDown = (e: PointerEvent) => {
    const el = wordAt(e);
    cancelHold();
    held.current = false;
    if (!el || !onWord) return;
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        held.current = true;
        hold.current = null;
        fire(el);
      }, 450),
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) cancelHold();
  };
  const onContextMenu = (e: MouseEvent) => {
    const el = wordAt(e);
    if (!el || !onWord) return;
    e.preventDefault();
    cancelHold();
    if (!held.current) fire(el);
    held.current = true;
  };

  const parts: ReactNode[] = [];
  let last = 0;
  const pushWords = (chunk: string, base: number) => {
    let i = 0;
    for (const m of chunk.matchAll(WORD_RE)) {
      if (m.index! > i) parts.push(chunk.slice(i, m.index));
      const w = m[0];
      const lower = w.toLowerCase().replace(/’/g, "'");
      const marked = marks && (vocab.has(lower) || vocab.has(lemma[lower] ?? ""));
      parts.push(
        <span key={base + m.index!} className={cn("w", marked && "is-vocab", ranges?.filter((r) => base + m.index! >= r.a && base + m.index! < r.b).map((r) => r.cls))} data-o={base + m.index!}>
          {w}
        </span>,
      );
      i = m.index! + w.length;
    }
    if (i < chunk.length) parts.push(chunk.slice(i));
  };
  for (const m of text.matchAll(BLANK_RE)) {
    pushWords(text.slice(last, m.index), last);
    parts.push(<Fragment key={`b${m.index}`}>{renderBlank ? renderBlank(Number(m[1])) : `____(${m[1]})`}</Fragment>);
    last = m.index! + m[0].length;
  }
  pushWords(text.slice(last), last);

  if (trigger === "hold") {
    return (
      <Tag className={cn(className, "select-none [-webkit-touch-callout:none]")} onClick={onClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onContextMenu={onContextMenu}>
        {parts}
      </Tag>
    );
  }
  return (
    <Tag className={className} onClick={onWord ? onClick : undefined}>
      {parts}
    </Tag>
  );
});
