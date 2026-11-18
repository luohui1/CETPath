import { useEffect, useRef } from "react";
import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import type { PdfWordsPage } from "@/lib/papers";

/** 一处命中：哪一页、从第几个词到第几个词 */
export interface FindHit {
  page: number;
  range: [number, number];
}

const MAX_HITS = 500;

/** 词的写法统一成小写、去掉标点（保留撇号和连字符），方便比较 */
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'-]+/g, "")
    .replace(/^['-]+|['-]+$/g, "");

/** 每页的单词拼成一行文字，记下每个词的起点，用来查词组 */
export interface PageText {
  text: string;
  starts: number[]; // 每个词在 text 里的起点；去掉标点后是空的词为 -1
  index: number[]; // text 里第 k 个词对应原来的单词序号
}

export function pageTexts(pages: PdfWordsPage[]): PageText[] {
  return pages.map((p) => {
    let text = "";
    const starts: number[] = [];
    const index: number[] = [];
    p.w.forEach(([t], i) => {
      const k = norm(t);
      if (!k) return;
      if (text) text += " ";
      starts.push(text.length);
      index.push(i);
      text += k;
    });
    return { text, starts, index };
  });
}

/**
 * 卷面查找：不区分大小写，从词首开始匹配（econom 能找到 economy、economic），
 * 输入几个词就找相邻的这几个词（词组）。band：专项训练只在截取的范围里找
 */
export function findInPages(texts: PageText[], pages: PdfWordsPage[], query: string, first: number, last: number, band?: (page: number) => [number, number] | null): FindHit[] {
  const q = query.split(/\s+/).map(norm).filter(Boolean).join(" ");
  if (!q) return [];
  const hits: FindHit[] = [];
  for (let n = first; n <= last && hits.length < MAX_HITS; n++) {
    const pt = texts[n - 1];
    if (!pt) continue;
    const lim = band?.(n);
    let from = 0;
    for (;;) {
      const at = pt.text.indexOf(q, from);
      if (at < 0) break;
      from = at + 1;
      // 只认从词首开始的
      const k = lower(pt.starts, at);
      if (pt.starts[k] !== at) continue;
      const end = lower(pt.starts, at + q.length - 1);
      const range: [number, number] = [pt.index[k], pt.index[end]];
      if (lim) {
        const y = pages[n - 1].w[range[0]][2];
        if (y < lim[0] || y > lim[1]) continue;
      }
      hits.push({ page: n, range });
      if (hits.length >= MAX_HITS) break;
    }
  }
  return hits;
}

/** 最后一个 ≤ x 的位置 */
function lower(list: number[], x: number) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 做题页自己的查找条：浮在卷面右上角，不挡工具栏。Enter 下一个，Shift+Enter 上一个，Esc 关闭 */
export function FindBar({ query, count, index, onQuery, onStep, onClose, focusKey, top = 8 }: { query: string; count: number; index: number; onQuery: (q: string) => void; onStep: (dir: 1 | -1) => void; onClose: () => void; focusKey: number; top?: number }) {
  const input = useRef<HTMLInputElement>(null);
  // 再按一次 Ctrl+F：回到输入框并全选
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  const status = !query.trim() ? "" : count ? `${index + 1} / ${count >= MAX_HITS ? `${MAX_HITS}+` : count}` : "没有找到";

  return (
    <div role="search" style={{ top }} className="no-print absolute right-4 z-30 flex h-11 w-[340px] max-w-[calc(100%-32px)] items-center gap-0.5 rounded-[12px] bg-white pr-1 pl-3.5 shadow-[var(--elev-2)]">
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (count) onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="在卷面查找"
        aria-label="在卷面查找"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent font-serif text-[15px] outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-[var(--ink-300)]"
      />
      <span className="num shrink-0 px-2 text-[13px] whitespace-nowrap text-[var(--ink-500)]" aria-live="polite">
        {status}
      </span>
      <button type="button" className="gr-iconbtn size-8" onClick={() => onStep(-1)} disabled={!count} aria-label="上一个" title="上一个（Shift Enter）">
        <CaretUp className="size-4" />
      </button>
      <button type="button" className="gr-iconbtn size-8" onClick={() => onStep(1)} disabled={!count} aria-label="下一个" title="下一个（Enter）">
        <CaretDown className="size-4" />
      </button>
      <button type="button" className="gr-iconbtn size-8" onClick={onClose} aria-label="关闭查找" title="关闭（Esc）">
        <X className="size-4" />
      </button>
    </div>
  );
}
