import { useEffect, useState } from "react";
import { getRoots, type RootInfo } from "@/lib/roots";
import { familiesOf, LV_COLOR, mine, NO_MEM, type Family, type Mem } from "@/lib/rootFamilies";
import { phrasesOf } from "@/lib/phrases";
import { confusablesOf, type Confusable } from "@/lib/confusables";
import { LEVELS } from "@/lib/learning";
import { cn } from "@/lib/utils";

/** 记忆等级的小圆点；生词本里还没背的是空心圈 */
export function LevelDot({ m, className }: { m?: Mem; className?: string }) {
  const lv = m?.lv ?? 0;
  return (
    <i
      className={cn("inline-block size-2.5 flex-none rounded-full", className)}
      style={lv === 0 && m?.vocab ? { boxShadow: "inset 0 0 0 2px var(--blue)" } : { background: LV_COLOR[lv] }}
      title={lv === 0 && m?.vocab ? "生词本里，还没背" : LEVELS[lv].label}
    />
  );
}

/** 记忆等级：5 格信号条，越满记得越久 */
export function LevelMeter({ lv, className }: { lv: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)} title={`${LEVELS[lv].label}：${LEVELS[lv].hint}`} aria-label={`记忆等级 ${LEVELS[lv].label}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="w-[4px] rounded-[1px]" style={{ height: 4 + i * 2, background: i <= lv ? LV_COLOR[Math.max(lv, 2)] : "var(--paper-300)" }} />
      ))}
    </span>
  );
}

/** 词里的词根部分标蓝：pre<b>dict</b>ion */
export function RootedWord({ w, root, className }: { w: string; root?: string; className?: string }) {
  const i = root ? w.indexOf(root.toLowerCase()) : -1;
  return (
    <span className={cn("serif whitespace-nowrap", className)}>
      {i < 0 || !root ? (
        w
      ) : (
        <>
          {w.slice(0, i)}
          <b className="font-semibold text-[var(--blue)]">{w.slice(i, i + root.length)}</b>
          {w.slice(i + root.length)}
        </>
      )}
    </span>
  );
}

/** 词怎么拼出来的：pre 之前 + dict 说 → 预言 */
export function Formula({ parts, root, result, size = "md" }: { parts: readonly (readonly [string, string, string?])[]; root?: string; result?: string; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[var(--ink-300)]">+</span>}
          <span className={cn("rounded-[9px] text-center", size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5", root && p[0].toLowerCase() === root ? "bg-[var(--blue)] text-white" : "bg-[var(--fill-quiet)] shadow-[inset_0_0_0_1px_var(--line)]")}>
            <span className={cn("serif block leading-tight font-semibold", size === "sm" ? "text-[15px]" : "text-[17px]")}>{p[0]}</span>
            <span className="block text-[12px] leading-tight opacity-75">{p[1]}</span>
          </span>
        </span>
      ))}
      {result && (
        <>
          <span className="px-0.5 text-[var(--ink-300)]">→</span>
          <span className="text-[15px] font-medium">{result}</span>
        </>
      )}
    </div>
  );
}

interface Data {
  roots: RootInfo | null;
  fams: Family[];
  phrases: { phrase: string; trans: string }[];
  confusables: Confusable[];
}

/**
 * 一个词的记忆树：树干是这个词怎么拼出来的（词根词缀），往下三根枝：
 * 同根词（认识一个词根带出一串）、短语（没有词根可拆的词靠搭配记）、易混词（对比着记，带区分要点）。
 * 叶子上的圆点是记忆等级，自己背过的词先列。
 */
export function MemoryTree({
  word,
  memory,
  compact,
  onWord,
  hideFormula,
}: {
  word: string;
  memory: Map<string, Mem> | null;
  compact?: boolean;
  onWord?: (w: string) => void;
  hideFormula?: boolean;
}) {
  const [d, setD] = useState<Data | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setD(null);
    setTip(null);
    Promise.all([getRoots(word).catch(() => null), familiesOf(word).catch(() => []), phrasesOf(word, compact ? 3 : 5).catch(() => []), confusablesOf(word).catch(() => [])]).then(
      ([roots, fams, phrases, confusables]) => !off && setD({ roots, fams, phrases, confusables }),
    );
    return () => {
      off = true;
    };
  }, [word, compact]);
  if (!d) return null;

  const mem = (w: string) => memory?.get(w) ?? NO_MEM;
  const fam = d.fams[0];
  const kin = fam
    ? fam.w
        .filter((x) => x[0] !== word)
        .sort((a, b) => Number(mine(mem(b[0]))) - Number(mine(mem(a[0]))) || Number(!a[4]) - Number(!b[4]) || (a[4] || 1e6) - (b[4] || 1e6))
        .slice(0, compact ? 5 : 8)
    : (d.roots?.s ?? []).map(([w, g]) => [w, g] as [string, string]);
  const parts = d.roots?.m ?? [];
  const branches = [
    kin.length > 0 && {
      key: "kin",
      label: fam ? (
        <>
          同根 <b className="serif text-[var(--blue)]">{fam.r}</b> {fam.g}
        </>
      ) : (
        "同根"
      ),
      leaves: kin.map((x) => ({ w: x[0], g: x[1], root: fam?.r })),
    },
    d.phrases.length > 0 && { key: "phrase", label: "短语", leaves: d.phrases.map((p) => ({ w: p.phrase, g: p.trans, phrase: true })) },
    d.confusables.length > 0 && { key: "conf", label: "易混", leaves: d.confusables.map((c) => ({ w: c.word, g: c.brief, conf: c })) },
  ].filter(Boolean) as { key: string; label: React.ReactNode; leaves: { w: string; g: string; root?: string; phrase?: boolean; conf?: Confusable }[] }[];
  if (!branches.length && !parts.length && !d.roots?.e) return null;
  const open = d.confusables.find((c) => c.word === tip);

  return (
    <div className="text-[14px]">
      {!hideFormula && (parts.length > 0 || d.roots?.e) && (
        <div className="mb-3">
          {parts.length > 0 ? <Formula parts={parts} root={fam?.r} size={compact ? "sm" : "md"} /> : <p className="line-clamp-2 leading-[1.6] text-[var(--ink-700)]">{d.roots?.e}</p>}
        </div>
      )}
      {branches.length > 0 && (
        <ul className="relative space-y-2.5 pl-5 before:absolute before:top-1 before:bottom-3 before:left-[5px] before:w-px before:bg-[var(--line-control)]">
          {branches.map((b) => (
            <li key={b.key} className="relative">
              <span className="absolute top-[9px] -left-5 h-px w-4 bg-[var(--line-control)]" />
              <span className="absolute top-[6px] -left-[18px] size-[7px] rounded-full bg-white shadow-[inset_0_0_0_1.5px_var(--ink-300)]" />
              <div className="mb-1 text-[12px] text-[var(--ink-500)]">{b.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {b.leaves.map((l) => {
                  const m = mem(l.w);
                  const Tag = onWord || l.conf?.tip ? "button" : "span";
                  return (
                    <Tag
                      key={l.w}
                      {...(Tag === "button"
                        ? {
                            type: "button" as const,
                            onClick: () => (l.conf?.tip ? setTip(tip === l.w ? null : l.w) : !l.phrase && onWord?.(l.w)),
                          }
                        : {})}
                      className={cn(
                        "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-left shadow-[inset_0_0_0_1px_var(--line)]",
                        Tag === "button" && "transition hover:shadow-[inset_0_0_0_1.5px_var(--blue)]",
                        tip === l.w && "shadow-[inset_0_0_0_1.5px_var(--blue)]",
                      )}
                    >
                      {!l.phrase && <LevelDot m={m} />}
                      <RootedWord w={l.w} root={l.root} className="text-[15px] text-[var(--ink)]" />
                      <span className="truncate text-[13px] text-[var(--ink-500)]">{l.g}</span>
                      {l.conf?.tip && <span className="text-[12px] text-[var(--blue)]">区分</span>}
                    </Tag>
                  );
                })}
              </div>
              {b.key === "conf" && open?.tip && (
                <div className="mt-2 rounded-[10px] bg-[var(--fill-quiet)] px-3 py-2 text-[13px] leading-[1.6] text-[var(--ink-700)]">
                  <p className="serif text-[14px] text-[var(--ink)]">{open.tip.tip}</p>
                  {open.tip.wrong && (
                    <p className="mt-1">
                      <s className="serif text-[var(--red)] decoration-[var(--red)]">{open.tip.wrong}</s>
                      <span className="mx-1.5 text-[var(--ink-300)]">→</span>
                      <span className="serif text-[var(--ink)]">{open.tip.right}</span>
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-[var(--ink-500)]">易混提示：Lexkite（CC BY 4.0）</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {parts.length > 0 && <p className="mt-2 text-[11px] text-[var(--ink-500)]">词根词缀：OpenEtymology（CC BY-SA 4.0）</p>}
    </div>
  );
}
