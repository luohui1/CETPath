import { Fragment } from "react";
import { syntaxRuns, type SyntaxEntry } from "@/lib/syntax";
import { cn } from "@/lib/utils";

/*
 * 一句长难句的解析，从骨架到细节：
 * 1. 主干：主语 → 谓语 → 宾语/表语，一块块排开，下面写成分名；
 * 2. 原句：主干的词按成分上色加粗，修饰成分保持原色、开头一个小编号（不用括号和底色，免得满屏符号）；
 * 3. 译文；4. 修饰成分逐条（编号对得上原句）；5. 怎么拆（难点）。
 */

const SUBJ = new Set(["主语", "形式主语", "真正主语"]);
const VERB = new Set(["谓语"]);

/** 主干成分的颜色：主语蓝、谓语红、其余（宾语、表语、补足语）绿 */
function roleColor(r: string) {
  return SUBJ.has(r) ? "var(--blue)" : VERB.has(r) ? "var(--danger)" : "var(--success)";
}

const NUM = "①②③④⑤⑥⑦⑧";

export function SyntaxSentence({ e, className }: { e: SyntaxEntry; className?: string }) {
  const runs = syntaxRuns(e);
  return (
    <p className={cn("serif text-[17px] leading-[2] text-[var(--ink-700)]", className)}>
      {runs.map((r, i) => (
        <Fragment key={i}>
          {r.opens.map((k) => (
            <sup key={k} className="mr-0.5 font-sans text-[11px] font-semibold text-[var(--mark-ink)]">
              {NUM[k] ?? k + 1}
            </sup>
          ))}
          <span
            className={cn(r.main && "font-semibold underline decoration-[1.5px] underline-offset-[5px]")}
            style={r.main ? { color: roleColor(r.main), textDecorationColor: `color-mix(in oklab, ${roleColor(r.main)} 45%, transparent)` } : undefined}
          >
            {r.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** 成分小章：主干成分按颜色分；修饰成分一律荧光笔的颜色 */
export function RoleTag({ r, part }: { r: string; part?: boolean }) {
  const c = part ? "var(--mark-ink)" : roleColor(r);
  return (
    <span className="inline-flex h-5 flex-none items-center rounded-full px-1.5 text-[11px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 9%, transparent)` }}>
      {r}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[12px] font-semibold tracking-[0.04em] text-[var(--ink-500)]">{children}</h4>;
}

/** onRemove：Agent 标的长难句可以删 */
export function SyntaxCard({ e, onRemove }: { e: SyntaxEntry; onRemove?: () => void }) {
  return (
    <div className="min-w-0 space-y-5 pb-1 [overflow-wrap:anywhere]">
      {/* 主干：一句话的骨架 */}
      <section>
        <Label>主干</Label>
        <div className="flex flex-wrap items-start gap-x-1 gap-y-2">
          {e.main.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="px-0.5 pt-1.5 text-[var(--ink-300)]">→</span>}
              <span className="flex max-w-full min-w-0 flex-col rounded-[10px] px-2.5 py-1.5" style={{ background: `color-mix(in oklab, ${roleColor(m.r)} 7%, white)` }}>
                <span className="serif text-[16px] leading-[1.35] font-semibold" style={{ color: roleColor(m.r) }}>
                  {m.t}
                </span>
                <span className="text-[11px] text-[var(--ink-500)]">{m.r}</span>
              </span>
            </Fragment>
          ))}
        </div>
      </section>

      {/* 原句：结构画在句子上 */}
      <section>
        <Label>原句</Label>
        <SyntaxSentence e={e} />
      </section>

      <section>
        <Label>译文</Label>
        <p className="text-[16px] leading-[1.75] text-[var(--ink)]">{e.zh}</p>
      </section>

      {e.parts.length > 0 && (
        <section>
          <Label>修饰成分</Label>
          <ol className="space-y-2.5">
            {e.parts.map((p, k) => (
              <li key={k} className="flex gap-2.5">
                <span className="mt-[1px] flex size-5 flex-none items-center justify-center rounded-full bg-[var(--mark-tint)] text-[12px] font-semibold text-[var(--mark-ink)]">{k + 1}</span>
                <div className="min-w-0 text-[14px] leading-[1.6]">
                  <div>
                    <span className="font-semibold text-[var(--ink)]">{p.r}</span>
                    {p.of && (
                      <span className="text-[var(--ink-500)]">
                        {" "}
                        · 修饰 <span className="serif text-[var(--ink-700)]">{p.of}</span>
                      </span>
                    )}
                    {p.note && <span className="text-[var(--ink-500)]">（{p.note}）</span>}
                  </div>
                  <div className="serif text-[15px] text-[var(--ink-700)]">{p.t}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <Label>怎么拆</Label>
        <ul className="space-y-1.5">
          {e.points.map((x, i) => (
            <li key={i} className="flex gap-2 text-[14px] leading-[1.65] text-[var(--ink-700)]">
              <span className="mt-[0.6em] size-1.5 flex-none rounded-full bg-[var(--blue-line)]" />
              {x}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line-soft)] pt-3 text-[12px] text-[var(--ink-500)]">
        <span>AI 生成的解析，仅供参考</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="hover:text-[var(--danger)]">
            删掉这条 AI 标的长难句
          </button>
        )}
      </div>
    </div>
  );
}
