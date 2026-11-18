import { Fragment } from "react";
import { cn } from "@/lib/utils";

/* 原来的查词浮层（WordPopover）在 G 轮换成了做题页底部的答题条（src/exam/AnswerBar.tsx），别的页没在用，删了；
   这里放释义的显示：做题页查词卡、生词面板、复习、生词本共用 */

export interface LookupSource {
  paperId: string;
  paperTitle: string;
}

/** 一行释义：词性（n. vt. & vi.）、领域（[法] [医]）、意思 */
export interface Sense {
  pos?: string;
  domain?: string;
  text: string;
}

export function parseSense(line: string): Sense {
  // 词典里中文意思之间用的是英文逗号：显示时换成中文的
  const zh = (t: string) => t.replace(/,\s*/g, "，");
  const pos = line.match(/^([a-z]+\.(?:\s*&\s*[a-z]+\.)?)\s*(.*)$/);
  if (pos) return { pos: pos[1].replace(/\s+/g, " "), text: zh(pos[2]) };
  const dom = line.match(/^\[([^\]]{1,6})\]\s*(.*)$/);
  if (dom) return { domain: dom[1], text: zh(dom[2]) };
  return { text: zh(line) };
}

/** 一行概要用：第一个不带领域的义项，意思只留前 n 个 */
export function firstSense(lines: string[], n = 4): Sense | null {
  const list = lines.map(parseSense);
  const s = list.find((x) => !x.domain) ?? list[0];
  if (!s) return null;
  const parts = s.text.split(/[,，;；]\s*/).filter(Boolean);
  return { ...s, text: parts.slice(0, n).join("，") };
}

const PosTag = ({ s }: { s: Sense }) =>
  s.pos ? (
    <span className="font-serif text-[15px] text-[var(--ink-500)] italic">{s.pos}</span>
  ) : s.domain ? (
    <span className="rounded-[4px] bg-[var(--paper-200)] px-1 text-[13px] leading-[20px] text-[var(--ink-500)]">{s.domain}</span>
  ) : null;

/** 释义：左边一列词性（领域是小灰标），右边意思。2026-11-12 用户嫌查词的意思太小"都没看到"，14px 调到 16px */
export function DefinitionLines({ lines, className }: { lines: string[]; className?: string }) {
  const list = lines.map(parseSense);
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2", className)}>
      {list.map((s, i) => (
        <Fragment key={i}>
          <dt className="text-right">
            <PosTag s={s} />
          </dt>
          <dd className="text-[16px] leading-[1.65] text-[var(--ink)]">{s.text}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * 查词条上的释义概要：前两个义项（不带领域的优先），每个只留前 n 个意思；17px 墨色，单独占一行，一眼能看到。
 * 两个都短就并排一行，长了换行
 */
export function BriefSenses({ lines, max = 2, n = 4, className }: { lines: string[]; max?: number; n?: number; className?: string }) {
  const all = lines.map(parseSense);
  const plain = all.filter((s) => !s.domain);
  const list = (plain.length ? plain : all).slice(0, max).map((s) => ({ ...s, text: s.text.split(/[,，;；]\s*/).filter(Boolean).slice(0, n).join("，") }));
  if (!list.length) return null;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[17px] leading-[1.6] text-[var(--ink)]", className)}>
      {list.map((s, i) => (
        <span key={i} className="min-w-0">
          {(s.pos || s.domain) && (
            <span className="mr-1.5">
              <PosTag s={s} />
            </span>
          )}
          {s.text}
        </span>
      ))}
    </div>
  );
}

/** 一行释义概要：词性 + 第一个义项的前几个意思（列表、查词条上用） */
export function SenseLine({ lines, n, className }: { lines: string[]; n?: number; className?: string }) {
  const s = firstSense(lines, n);
  if (!s) return null;
  return (
    <div className={cn("flex min-w-0 items-baseline gap-1.5 text-[14px] text-[var(--ink-700)]", className)}>
      <PosTag s={s} />
      <span className="min-w-0 truncate">{s.text}</span>
    </div>
  );
}
