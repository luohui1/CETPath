import { Fragment, useState } from "react";
import { syntaxRuns, type SyntaxEntry } from "@/lib/syntax";
import { cn } from "@/lib/utils";

/*
 * 一句长难句的解析，和 Agent 的句子结构图同一套色块：
 * ① 句子结构：原句按成分铺色块（主语蓝、谓语红、宾表绿、从句紫、短语橙、插入/同位灰），点色块看作用；
 * ② 主干；③ 译文；④ 修饰成分（编号对得上原句）；⑤ 怎么拆。
 */

type Kind = "subj" | "verb" | "obj" | "clause" | "phrase" | "extra";
const KIND: Record<Kind, { name: string; block: string; dot: string }> = {
  subj: { name: "主语", block: "bg-[#dbe8ff] text-[#1d4fb8]", dot: "bg-[#1d4fb8]" },
  verb: { name: "谓语", block: "bg-[#ffe1e1] text-[#b42318]", dot: "bg-[#b42318]" },
  obj: { name: "宾语/表语", block: "bg-[#ddf5e3] text-[#18794e]", dot: "bg-[#18794e]" },
  clause: { name: "从句", block: "bg-[#f1e6ff] text-[#6b3fb8]", dot: "bg-[#6b3fb8]" },
  phrase: { name: "短语", block: "bg-[#fff1d6] text-[#a15c07]", dot: "bg-[#a15c07]" },
  extra: { name: "插入/同位/并列", block: "bg-[var(--paper-100)] text-[var(--ink-700)]", dot: "bg-[var(--ink-500)]" },
};
const KIND_ORDER: Kind[] = ["subj", "verb", "obj", "clause", "phrase", "extra"];

function mainKind(r: string): Kind {
  return r.includes("主语") ? "subj" : r === "谓语" ? "verb" : "obj";
}
function partKind(r: string): Kind {
  return r.includes("从句") ? "clause" : /短语|分词|不定式|动名词|独立主格/.test(r) ? "phrase" : "extra";
}

const NUM = "①②③④⑤⑥⑦⑧";

/** 原句切成色块：同一成分连着的几段并成一块；在修饰成分里的按最里层那个上色 */
function blocks(e: SyntaxEntry) {
  const len = (k: number) => e.parts[k].t.length;
  const out: { text: string; kind: Kind | null; key: string; part: number | null; role: string; opens: number[] }[] = [];
  for (const r of syntaxRuns(e)) {
    const part = r.inParts.length ? r.inParts.reduce((a, b) => (len(b) < len(a) ? b : a)) : null;
    const kind = part != null ? partKind(e.parts[part].r) : r.main ? mainKind(r.main) : null;
    const key = part != null ? `p${part}` : r.main ? `m${r.main}` : "";
    const prev = out.at(-1);
    if (prev && key && prev.key === key && !r.opens.length) prev.text += r.text;
    else out.push({ text: r.text, kind, key, part, role: part != null ? e.parts[part].r : (r.main ?? ""), opens: [...r.opens].sort((a, b) => len(b) - len(a)) });
  }
  return out;
}

export function SyntaxSentence({ e, className }: { e: SyntaxEntry; className?: string }) {
  const [on, setOn] = useState<number | null>(null);
  const bs = blocks(e);
  const used = KIND_ORDER.filter((k) => bs.some((b) => b.kind === k));
  const cur = on != null ? bs[on] : null;
  const curPart = cur?.part != null ? e.parts[cur.part] : null;
  return (
    <div className={className}>
      <p className="serif text-[16px] leading-[2.05] text-[var(--ink)]">
        {bs.map((b, i) => (
          <Fragment key={i}>
            {b.opens.map((k) => (
              <sup key={k} className="mr-px font-sans text-[11px] font-semibold text-[var(--ink-500)]">
                {NUM[k] ?? k + 1}
              </sup>
            ))}
            {b.kind && /^\s/.test(b.text) && " "}
            {b.kind ? (
              <span
                role="button"
                tabIndex={0}
                onClick={() => setOn(on === i ? null : i)}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter" && ev.key !== " ") return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  setOn(on === i ? null : i);
                }}
                className={cn(
                  "cursor-pointer rounded-[5px] px-[3px] py-[2px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
                  KIND[b.kind].block,
                  (b.kind === "subj" || b.kind === "verb" || b.kind === "obj") && "font-semibold",
                  on === i && "ring-2 ring-[var(--blue)]",
                )}
              >
                {b.text.trim()}
              </span>
            ) : (
              b.text
            )}
            {b.kind && /\s$/.test(b.text) && " "}
          </Fragment>
        ))}
      </p>
      {cur?.kind && (
        <p className="mt-2 rounded-[8px] bg-[var(--paper-100)] px-2.5 py-2 text-[13px] leading-[1.6] text-[var(--ink-700)]">
          <b className="text-[var(--ink)]">{cur.role}</b>
          {curPart?.of && <> · 修饰 <span className="serif">{curPart.of}</span></>}
          {curPart?.note && <> · {curPart.note}</>}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--ink-500)]">
        {used.map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn("size-2.5 rounded-[3px]", KIND[k].block)} />
            {KIND[k].name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 成分小章，颜色和句子色块一致 */
export function RoleTag({ r, part }: { r: string; part?: boolean }) {
  return <span className={cn("inline-flex h-5 flex-none items-center rounded-[5px] px-1.5 text-[11px] font-semibold", KIND[part ? partKind(r) : mainKind(r)].block)}>{r}</span>;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="px-3.5 py-3">
      <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--ink)]">
        <span className="grid size-5 flex-none place-items-center rounded-full bg-[var(--blue)] text-[11px] font-semibold text-white">{n}</span>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** onRemove：Agent 标的长难句可以删 */
export function SyntaxCard({ e, onRemove }: { e: SyntaxEntry; onRemove?: () => void }) {
  let n = 0;
  return (
    <div className="min-w-0 space-y-3 pb-1 [overflow-wrap:anywhere]">
      <div className="overflow-hidden rounded-[14px] bg-white ring-1 ring-[var(--line)]">
        <div className="flex items-center gap-2 bg-[var(--paper-100)] px-3.5 py-2">
          <span className="flex-1 text-[13px] font-medium text-[var(--ink-700)]">句子结构 · 点色块看作用</span>
          <span className="text-[11px] text-[var(--ink-500)]">AI 解析，仅供参考</span>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          <Section n={++n} title="原句">
            <SyntaxSentence e={e} />
          </Section>

          <Section n={++n} title="主干">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {e.main.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-[13px] text-[var(--ink-300)]">→</span>}
                  <span className={cn("inline-flex max-w-full min-w-0 items-baseline gap-1.5 rounded-[8px] px-2 py-1", KIND[mainKind(m.r)].block)}>
                    <span className="flex-none text-[11px] font-semibold opacity-80">{m.r}</span>
                    <span className="serif min-w-0 text-[15px] leading-[1.4] font-semibold">{m.t}</span>
                  </span>
                </Fragment>
              ))}
            </div>
          </Section>

          <Section n={++n} title="译文">
            <p className="rounded-[8px] bg-[#f6f9ff] px-3 py-2 text-[15px] leading-[1.75] text-[var(--ink)]">{e.zh}</p>
          </Section>

          {e.parts.length > 0 && (
            <Section n={++n} title={`修饰成分 · ${e.parts.length} 处`}>
              <ol className="space-y-2">
                {e.parts.map((p, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="w-4 flex-none pt-[3px] text-[13px] font-semibold text-[var(--ink-500)]">{NUM[k] ?? k + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-[var(--ink-500)]">
                        <RoleTag r={p.r} part />
                        {p.of && (
                          <span>
                            修饰 <span className="serif text-[14px] text-[var(--ink-700)]">{p.of}</span>
                          </span>
                        )}
                        {p.note && <span>· {p.note}</span>}
                      </div>
                      <p className={cn("serif mt-1 border-l-[3px] pl-2.5 text-[14px] leading-[1.6] text-[var(--ink-700)]", partKind(p.r) === "clause" ? "border-[#d9c4f7]" : partKind(p.r) === "phrase" ? "border-[#f5d49a]" : "border-[var(--line)]")}>{p.t}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <Section n={++n} title="怎么拆">
            <ul className="space-y-1.5">
              {e.points.map((x, i) => (
                <li key={i} className="flex gap-2 text-[14px] leading-[1.65] text-[var(--ink-700)]">
                  <span className="mt-[0.65em] size-1.5 flex-none rounded-full bg-[var(--blue)]" />
                  {x}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {onRemove && (
        <button type="button" onClick={onRemove} className="px-1 text-[12px] text-[var(--ink-500)] hover:text-[var(--danger)]">
          删掉这条 AI 标的长难句
        </button>
      )}
    </div>
  );
}
