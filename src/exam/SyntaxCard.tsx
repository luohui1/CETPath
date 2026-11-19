import { Fragment } from "react";
import { syntaxRuns, type SyntaxEntry } from "@/lib/syntax";
import { cn } from "@/lib/utils";
import { CardSection } from "./cardParts";

/*
 * 一句长难句的解析：原句上直接画结构（主干加粗、按成分上色下划线；修饰成分用 [ ] 括起来，右上角编号），
 * 下面依次是主干一行、修饰成分（编号对得上原句里的括号）、难点、按结构拆开的译文。
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
  const len = (k: number) => e.parts[k].t.length;
  return (
    <p className={cn("serif text-[17px] leading-[2.1] text-[var(--ink)]", className)}>
      {runs.map((r, i) => (
        <Fragment key={i}>
          {[...r.opens]
            .sort((a, b) => len(b) - len(a))
            .map((k) => (
              <span key={`o${k}`} className="font-sans text-[var(--star-ink)]">
                [<span className="mr-0.5 align-[0.35em] text-[12px] leading-none font-semibold">{NUM[k] ?? k + 1}</span>
              </span>
            ))}
          {r.main ? (
            <b className="font-semibold underline decoration-2 underline-offset-[5px]" style={{ textDecorationColor: roleColor(r.main) }}>
              {r.text}
            </b>
          ) : (
            <span className={r.inParts.length ? "text-[var(--ink-700)]" : undefined}>{r.text}</span>
          )}
          {[...r.closes]
            .sort((a, b) => len(a) - len(b))
            .map((k) => (
              <span key={`c${k}`} className="font-sans text-[var(--star-ink)]">
                ]
              </span>
            ))}
        </Fragment>
      ))}
    </p>
  );
}

/** 成分小章：主干成分按颜色分；修饰成分（从句、插入语……）一律和原句里的括号一个颜色 */
export function RoleTag({ r, part }: { r: string; part?: boolean }) {
  const c = part ? "var(--star-ink)" : roleColor(r);
  return (
    <span className="inline-flex h-6 flex-none items-center rounded-full px-2 text-[12px] font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 10%, transparent)` }}>
      {r}
    </span>
  );
}

export function SyntaxCard({ e }: { e: SyntaxEntry }) {
  return (
    <div className="space-y-3">
      <figure className="rounded-[10px] bg-[var(--paper-50)] px-3.5 py-2 shadow-[inset_2px_0_0_var(--blue-line),inset_0_0_0_1px_var(--line-soft)]">
        <SyntaxSentence e={e} />
      </figure>
      <CardSection label={<>译文<span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">AI 解析</span></>}>
        <p className="text-[17px] leading-[1.7] text-[var(--ink)]">{e.zh}</p>
      </CardSection>
      <CardSection label="主干">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[15px] leading-[1.5]">
          {e.main.map((m, i) => (
            <span key={i} className="inline-flex max-w-full items-center gap-1.5">
              {i > 0 && <span className="text-[var(--ink-300)]">+</span>}
              <RoleTag r={m.r} />
              <span className="serif min-w-0 text-[var(--ink)]">{m.t}</span>
            </span>
          ))}
        </div>
      </CardSection>
      <CardSection label="难点">
        <ul className="space-y-1 text-[15px] leading-[1.6] text-[var(--ink-700)]">
          {e.points.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.7em] size-1 flex-none rounded-full bg-[var(--ink-300)]" />
              {x}
            </li>
          ))}
        </ul>
      </CardSection>
      {e.parts.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)]">
            <span className="transition-transform group-open:rotate-90">›</span>修饰成分 <span className="num">{e.parts.length}</span> 处
          </summary>
          <div className="mt-2">
          <ol className="space-y-2">
            {e.parts.map((p, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[1.6]">
                <span className="w-5 flex-none font-semibold text-[var(--star-ink)]">{NUM[k] ?? k + 1}</span>
                <span className="min-w-0">
                  <span className="font-semibold text-[var(--ink)]">{p.r}</span>
                  {p.of && (
                    <span className="text-[var(--ink-500)]">
                      ，修饰 <span className="serif text-[var(--ink-700)]">{p.of}</span>
                    </span>
                  )}
                  {p.note && <span className="text-[var(--ink-500)]">（{p.note}）</span>}
                  <span className="serif block text-[var(--ink-700)]">{p.t}</span>
                </span>
              </li>
            ))}
          </ol>
          </div>
        </details>
      )}
    </div>
  );
}
