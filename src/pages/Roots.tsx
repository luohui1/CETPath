import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { MagnifyingGlass, Plus, SpeakerHigh } from "@phosphor-icons/react";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { addToVocab } from "@/lib/learning";
import { getRoots, type RootInfo } from "@/lib/roots";
import { familyKey, loadFamilies, LV_COLOR, mine, NO_MEM, useMemory, type Family, type FamilyWord, type Mem } from "@/lib/rootFamilies";
import { LEVELS } from "@/lib/learning";
import { Formula, LevelDot, MemoryTree, RootedWord } from "@/components/MemoryTree";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";

type View = "universe" | "tree";
const VIEWS: { value: View; label: string }[] = [
  { value: "tree", label: "记忆树" },
  { value: "universe", label: "总览" },
];

/** 词根记忆：单词宇宙（自己的词按词根聚成星团）+ 记忆树（一个词根 → 前缀分支 → 词） */
export function RootsPage() {
  const [params, setParams] = useSearchParams();
  const [families, setFamilies] = useState<Family[] | null>(null);
  const memo = useMemory();
  const view: View = params.get("v") === "universe" ? "universe" : "tree";
  const key = params.get("r");
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState("");

  useEffect(() => {
    loadFamilies().then(setFamilies, () => setFamilies([]));
  }, []);

  const go = (next: { v?: View; r?: string; w?: string }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    if (!next.w) p.delete("w");
    setParams(p, { replace: true });
  };

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const w = q.trim().toLowerCase();
    if (!w || !families) return;
    const hits = families.filter((f) => f.w.some((x) => x[0] === w));
    const f = hits.sort((a, b) => b.w.length - a.w.length)[0] ?? families.find((f) => f.r === w);
    if (!f) return setMiss(w); // 没有词根的词：只画短语、易混两根枝
    setMiss("");
    go({ v: "tree", r: familyKey(f), w: f.w.some((x) => x[0] === w) ? w : undefined });
  };

  if (!families || !memo) return <LoadingBlock />;
  const fam = (key && families.find((f) => familyKey(f) === key)) || null;

  return (
    <div className="space-y-5">
      <WordsTabs />
      <PageHeader
        title="记忆树"
        desc="一个词根是树根，加不同的前缀长出不同的枝，同根的词一串记。圆点越深，FSRS 估计你记得越久。"
        actions={<Segmented label="看法" value={view} options={VIEWS} onChange={(v) => go({ v, r: key ?? undefined })} />}
      />
      <form onSubmit={search} className="flex max-w-md items-center gap-2">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-[11px] bg-white px-3 shadow-[inset_0_0_0_1px_var(--line-control)]">
          <MagnifyingGlass className="size-4 text-[var(--ink-500)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入单词或词根，比如 predict、spect" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </label>
        <Button type="submit">找词根</Button>
      </form>
      {miss && (
        <div className="card p-5">
          <div className="flex items-center gap-2">
            <h2 className="serif text-[26px] font-semibold">{miss}</h2>
            <button type="button" onClick={() => speak(miss)} aria-label="发音" className="rounded-full p-2 text-[var(--ink-500)] hover:bg-[var(--paper-100)]">
              <SpeakerHigh className="size-5" />
            </button>
          </div>
          <p className="mb-3 text-[13px] text-[var(--ink-500)]">这个词拆不出词根，靠短语和易混词记。</p>
          <MemoryTree word={miss} memory={memo} />
        </div>
      )}
      <Legend />
      {view === "universe" ? (
        <Universe families={families} memo={memo} selected={fam} onPick={(f) => go({ v: "tree", r: familyKey(f) })} />
      ) : (
        <TreeView families={families} memo={memo} fam={fam} word={params.get("w")} onWord={(w) => go({ v: "tree", r: key ?? undefined, w })} onFamily={(f) => go({ v: "tree", r: familyKey(f) })} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--ink-500)]">
      <span className="inline-flex items-center gap-1.5">
        <LevelDot m={{ lv: 0, vocab: true }} /> 生词本里还没背
      </span>
      {LEVELS.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <LevelDot m={{ lv: i, vocab: false }} /> {i === 0 ? "没碰过" : l.label}
        </span>
      ))}
    </div>
  );
}

const owned = (f: Family, memo: Map<string, Mem>) => f.w.filter((x) => mine(memo.get(x[0]))).length;

/* ---------------- 单词宇宙 ---------------- */

interface Star {
  f: Family;
  n: number;
  x: number;
  y: number;
  r: number;
}

/** 大的放中间，后面的沿螺旋线找第一个不重叠的位置 */
function pack(list: { f: Family; n: number }[]): Star[] {
  const out: Star[] = [];
  for (const it of list) {
    const r = 26 + 8 * Math.sqrt(Math.min(it.f.w.length, 30));
    let x = 0;
    let y = 0;
    for (let t = 0; out.length; t++) {
      const a = t * 0.31;
      const d = t * 1.25;
      x = Math.cos(a) * d;
      y = Math.sin(a) * d * 0.78;
      if (out.every((s) => Math.hypot(s.x - x, s.y - y) > s.r + r + 8)) break;
    }
    out.push({ ...it, x, y, r });
  }
  return out;
}

function Universe({ families, memo, selected, onPick }: { families: Family[]; memo: Map<string, Mem>; selected: Family | null; onPick: (f: Family) => void }) {
  const owns = useMemo(
    () =>
      families
        .map((f) => ({ f, n: owned(f, memo) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || b.f.w.length - a.f.w.length),
    [families, memo],
  );
  const demo = owns.length === 0;
  const list = demo ? families.slice(0, 36).map((f) => ({ f, n: 0 })) : owns.slice(0, 60);
  const stars = useMemo(() => pack(list), [list]);
  const pad = 12;
  const x0 = Math.min(...stars.map((s) => s.x - s.r)) - pad;
  const x1 = Math.max(...stars.map((s) => s.x + s.r)) + pad;
  const y0 = Math.min(...stars.map((s) => s.y - s.r)) - pad;
  const y1 = Math.max(...stars.map((s) => s.y + s.r)) + pad;
  const words = owns.reduce((n, x) => n + x.n, 0);

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline gap-x-3 px-5 pt-4">
        <h2 className="t-h2">{demo ? "词书里最大的 36 个词根" : `你的 ${words} 个词，连成了 ${owns.length} 个词根星团`}</h2>
        <span className="text-[13px] text-[var(--ink-500)]">{demo ? "生词本还没有词。加了生词以后，这里只显示你自己的词。" : "星团越大，这个词根下的词越多。点一个星团看它的记忆树。"}</span>
      </div>
      <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} className="block h-auto max-h-[72vh] w-full" role="img" aria-label="单词宇宙">
        {stars.map((s) => {
          const k = Math.min(s.f.w.length, 40);
          const sel = selected && familyKey(selected) === familyKey(s.f);
          return (
            <g key={familyKey(s.f)} transform={`translate(${s.x},${s.y})`} onClick={() => onPick(s.f)} className="cursor-pointer [&:hover>circle:first-child]:stroke-[var(--blue)]">
              <circle r={s.r} fill={sel ? "var(--blue-tint)" : "white"} stroke={sel ? "var(--blue)" : "var(--line)"} strokeWidth={1.2} />
              {s.f.w.slice(0, k).map((w, i) => {
                const m = memo.get(w[0]) ?? NO_MEM;
                const a = i * 2.39996;
                const d = (s.r - 9) * Math.sqrt((i + 0.5) / k);
                const own = mine(m);
                return own && m.lv === 0 ? (
                  <circle key={w[0]} cx={Math.cos(a) * d} cy={Math.sin(a) * d} r={3.2} fill="white" stroke="var(--blue)" strokeWidth={1.6} />
                ) : (
                  <circle key={w[0]} cx={Math.cos(a) * d} cy={Math.sin(a) * d} r={own ? 4 : 2.4} fill={LV_COLOR[m.lv]} opacity={own ? 1 : 0.7} />
                );
              })}
              <text y={-2} textAnchor="middle" className="serif" style={{ fontSize: 15, fontWeight: 600, fill: "var(--ink)", paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>
                {s.f.r}
              </text>
              <text y={14} textAnchor="middle" style={{ fontSize: 11, fill: "var(--ink-700)", paintOrder: "stroke", stroke: "white", strokeWidth: 3.5 }}>
                {s.f.g}
                {!demo && ` · ${s.n}/${s.f.w.length}`}
              </text>
            </g>
          );
        })}
      </svg>
      {!demo && owns.length > 60 && <p className="px-5 pb-4 text-[13px] text-[var(--ink-500)]">另外还有 {owns.length - 60} 个小星团没画出来，可以在上面搜。</p>}
    </div>
  );
}

/* ---------------- 记忆树 ---------------- */

const ROW = 46;

function TreeView({
  families,
  memo,
  fam,
  word,
  onWord,
  onFamily,
}: {
  families: Family[];
  memo: Map<string, Mem>;
  fam: Family | null;
  word: string | null;
  onWord: (w: string) => void;
  onFamily: (f: Family) => void;
}) {
  const f = fam ?? families.find((x) => owned(x, memo) > 0) ?? families.find((x) => x.r === "dict") ?? families[0];
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [f]);

  // 词根 → 前缀分支 → 词；分支按自己背过的词多少排，再按词频
  const groups = useMemo(() => {
    const g = new Map<string, { pre: [string, string][]; words: FamilyWord[] }>();
    for (const w of f.w) {
      const k = w[2].map((p) => p[0]).join("+");
      if (!g.has(k)) g.set(k, { pre: w[2], words: [] });
      g.get(k)!.words.push(w);
    }
    const score = (ws: FamilyWord[]) => [ws.filter((w) => mine(memo.get(w[0]))).length, ws.some((w) => w[4]) ? 1 : 0, -Math.min(...ws.map((w) => w[4] || 1e6))];
    return [...g.values()]
      .map((x) => ({ ...x, words: x.words.sort((a, b) => (a[3] ? 1 : 0) - (b[3] ? 1 : 0) || (a[4] || 1e6) - (b[4] || 1e6)) }))
      .sort((a, b) => {
        const [sa, sb] = [score(a.words), score(b.words)];
        return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2];
      });
  }, [f, memo]);

  // 默认只画词书里的和自己背过的，最多 14 个
  const keep = (w: FamilyWord) => all || w[4] > 0 || mine(memo.get(w[0]));
  let budget = all ? Infinity : 14;
  const shown = groups
    .map((g) => {
      const ws = g.words.filter(keep).slice(0, Math.max(0, budget));
      budget -= ws.length;
      return { ...g, words: ws };
    })
    .filter((g) => g.words.length);
  const hidden = f.w.length - shown.reduce((n, g) => n + g.words.length, 0);

  // 位置：叶子一行一个，分支在自己叶子的中间，词根在所有分支的中间
  let row = 0;
  const layout = shown.map((g) => {
    const ys = g.words.map(() => (row++ + 0.5) * ROW);
    return { ...g, ys, y: (ys[0] + ys[ys.length - 1]) / 2 };
  });
  const height = Math.max(row * ROW, 160);
  const rootY = layout.length ? (layout[0].y + layout[layout.length - 1].y) / 2 : height / 2;
  const X = { root: 0, rootW: 150, br: 200, brW: 132, leaf: 372 };
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
  const sel = word ? f.w.find((w) => w[0] === word) : undefined;

  const siblings = families.filter((x) => x !== f && x.r === f.r);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="t-h2">
            <span className="serif text-[22px] text-[var(--blue)]">{f.r}</span>（{f.g}）的记忆树
          </h2>
          <span className="text-[13px] text-[var(--ink-500)]">
            {f.w.length} 个词 · 你背过 {owned(f, memo)} 个
          </span>
          {siblings.map((s) => (
            <button key={familyKey(s)} type="button" onClick={() => onFamily(s)} className="text-[13px] text-[var(--blue)] hover:underline">
              {s.r} 还有"{s.g}"的意思
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div className="relative min-w-[640px]" style={{ height }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {layout.map((g, i) => (
                <g key={i} fill="none" stroke="var(--line-control)" strokeWidth={1.5}>
                  <path d={curve(X.root + X.rootW, rootY, X.br, g.y)} />
                  {g.ys.map((y, j) => (
                    <path key={j} d={curve(X.br + X.brW, g.y, X.leaf, y)} stroke={mine(memo.get(g.words[j][0])) ? "var(--blue-line)" : "var(--line-control)"} />
                  ))}
                </g>
              ))}
            </svg>
            <div className="absolute flex w-[150px] -translate-y-1/2 flex-col items-center rounded-[14px] bg-[var(--blue)] px-3 py-3 text-white shadow-[var(--elev-1)]" style={{ left: X.root, top: rootY }}>
              <span className="serif text-[26px] leading-tight font-semibold">{f.r}</span>
              <span className="text-[14px]">{f.g}</span>
            </div>
            {layout.map((g, i) => (
              <div key={i} className="absolute flex w-[132px] -translate-y-1/2 items-baseline justify-center gap-1 rounded-full bg-[var(--fill-quiet)] px-2 py-1.5 text-center" style={{ left: X.br, top: g.y }}>
                {g.pre.length ? (
                  <>
                    <b className="serif text-[15px] font-semibold">{g.pre.map((p) => p[0]).join("+")}-</b>
                    <span className="truncate text-[12px] text-[var(--ink-700)]">{g.pre.map((p) => p[1].split(/[；;，,/]/)[0]).join("+")}</span>
                  </>
                ) : (
                  <span className="text-[12px] text-[var(--ink-500)]">不加前缀</span>
                )}
              </div>
            ))}
            {layout.map((g) =>
              g.words.map((w, j) => {
                const m = memo.get(w[0]) ?? NO_MEM;
                return (
                  <button
                    key={w[0]}
                    type="button"
                    onClick={() => onWord(w[0])}
                    className={cn(
                      "absolute flex h-[38px] max-w-[calc(100%-372px)] -translate-y-1/2 items-center gap-2 rounded-[10px] bg-white px-3 shadow-[inset_0_0_0_1px_var(--line)] transition hover:shadow-[inset_0_0_0_1.5px_var(--blue)]",
                      word === w[0] && "shadow-[inset_0_0_0_2px_var(--blue)]",
                    )}
                    style={{ left: X.leaf, top: g.ys[j] }}
                  >
                    <LevelDot m={m} />
                    <RootedWord w={w[0]} root={f.r} className="text-[16px] text-[var(--ink)]" />
                    <span className="truncate text-[13px] text-[var(--ink-500)]">{w[1]}</span>
                  </button>
                );
              }),
            )}
          </div>
        </div>
        {(hidden > 0 || all) && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-[14px] text-[var(--blue)] hover:underline">
            {all ? "只看词书里的和背过的" : `还有 ${hidden} 个不在词书里的词`}
          </button>
        )}
      </div>
      <WordPanel fam={f} w={sel ?? null} memory={memo} onWord={onWord} />
    </div>
  );
}

/** 右边：点到的词怎么由词根拼出来，再往外长出短语、易混词 */
function WordPanel({ fam, w, memory, onWord }: { fam: Family; w: FamilyWord | null; memory: Map<string, Mem>; onWord: (w: string) => void }) {
  const [info, setInfo] = useState<RootInfo | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    setInfo(null);
    setAdded(false);
    if (w) getRoots(w[0]).then(setInfo, () => {});
  }, [w]);
  if (!w)
    return (
      <div className="card self-start p-5 text-[14px] leading-[1.7] text-[var(--ink-700)]">
        <h3 className="mb-2 text-[17px] font-semibold text-[var(--ink)]">怎么记</h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            先记住树根 <b className="serif text-[var(--blue)]">{fam.r}</b> = {fam.g}。
          </li>
          <li>顺着枝看：每加一个前缀，意思往一个方向偏。</li>
          <li>点一个词，看它怎么拼出来，再看它的短语和易混词。</li>
        </ol>
      </div>
    );
  const m = memory.get(w[0]) ?? NO_MEM;
  const parts: [string, string, string?][] = info?.m.length ? info.m : [...w[2], [fam.r, fam.g], ...(w[3] ? [[w[3], "后缀"] as [string, string]] : [])];
  return (
    <div className="card self-start p-5 xl:sticky xl:top-4">
      <div className="flex items-center gap-2">
        <h3 className="serif text-[28px] font-semibold">{w[0]}</h3>
        <button type="button" onClick={() => speak(w[0])} aria-label="发音" className="rounded-full p-2 text-[var(--ink-500)] hover:bg-[var(--paper-100)]">
          <SpeakerHigh className="size-5" />
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-[var(--ink-500)]">
          <LevelDot m={m} />
          {m.lv === 0 && m.vocab ? "生词本里，还没背" : m.lv === 0 ? "还没背" : `${LEVELS[m.lv].label} · ${LEVELS[m.lv].hint}`}
        </span>
      </div>
      <p className="mt-1 text-[15px] text-[var(--ink)]">{w[1]}</p>
      <div className="mt-4">
        <Formula parts={parts} root={fam.r} result={w[1].split("，")[0]} />
      </div>
      {info?.e && <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-700)]">{info.e}</p>}
      <div className="mt-4 border-t border-[var(--line-soft)] pt-4">
        <MemoryTree word={w[0]} memory={memory} hideFormula compact onWord={onWord} />
      </div>
      {!mine(m) && (
        <Button
          className="mt-4"
          disabled={added}
          onClick={async () => {
            await addToVocab(w[0]);
            setAdded(true);
          }}
        >
          <Plus className="size-4" /> {added ? "已加入生词本" : "加入生词本"}
        </Button>
      )}
    </div>
  );
}
