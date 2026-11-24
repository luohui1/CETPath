import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import type { RootInfo } from "@/lib/roots";
import { cn } from "@/lib/utils";

/** 词根词缀一行：pre 之前 + dict 说；点"词源"展开词源说明、各语素来源和同根词 */
export function RootLine({ info, onWord, className }: { info: RootInfo; onWord?: (w: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const notes = info.m.filter((x) => x[2]);
  const more = !!(info.e || notes.length || info.s?.length);
  return (
    <div className={cn("rounded-[10px] bg-[var(--fill-quiet)] px-3 py-2", className)}>
      <div className="flex items-start gap-2">
        <span className="mt-[3px] flex-none text-[12px] text-[var(--ink-500)]">{info.m.length ? "词根" : "词源"}</span>
        <p className={cn("min-w-0 flex-1 text-[15px] leading-[1.6] text-[var(--ink)]", !info.m.length && !open && "line-clamp-1")}>
          {!info.m.length && !open && info.e}
          {info.m.map((x, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-[var(--ink-500)]">+</span>}
              <b className="serif font-semibold text-[var(--blue)]">{x[0]}</b>
              <span className="ml-1">{x[1]}</span>
            </span>
          ))}
        </p>
        {more && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="-my-1 -mr-1.5 inline-flex h-8 flex-none items-center gap-0.5 rounded-full px-2 text-[13px] text-[var(--ink-500)] hover:text-[var(--ink)]"
          >
            词源
            <CaretDown className={cn("size-3.5 transition", open && "rotate-180")} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 border-t border-[var(--line)] pt-2 text-[14px] leading-[1.65] text-[var(--ink-700)]">
          {notes.length > 0 && (
            <ul className="space-y-0.5">
              {notes.map((x, i) => (
                <li key={i}>
                  <b className="serif font-semibold text-[var(--ink)]">{x[0]}</b>：{x[2]}
                </li>
              ))}
            </ul>
          )}
          {info.e && <p>{info.e}</p>}
          {info.s && info.s.length > 0 && (
            <div>
              <span className="text-[12px] text-[var(--ink-500)]">同根词</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {info.s.map(([w, g]) =>
                  onWord ? (
                    <button key={w} type="button" onClick={() => onWord(w)} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-[13px] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--paper-100)]">
                      <b className="serif font-semibold text-[var(--ink)]">{w}</b>
                      <span className="text-[var(--ink-500)]">{g}</span>
                    </button>
                  ) : (
                    <span key={w} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
                      <b className="serif font-semibold text-[var(--ink)]">{w}</b>
                      <span className="text-[var(--ink-500)]">{g}</span>
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
          <p className="text-[11px] text-[var(--ink-500)]">词根词缀：OpenEtymology（CC BY-SA 4.0）</p>
        </div>
      )}
    </div>
  );
}
