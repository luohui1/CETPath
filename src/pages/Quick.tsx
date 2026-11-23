import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, SpeakerHigh } from "@phosphor-icons/react";
import { bumpDay } from "@/lib/db";
import { phonetic, shortTranslation, type DictEntry } from "@/lib/dict";
import { getRoots, type RootInfo } from "@/lib/roots";
import { confusablesOf, type Confusable } from "@/lib/confusables";
import { familiesOf, familyKey, useMemory, type Family } from "@/lib/rootFamilies";
import { passesDone, passNames, todayWords } from "@/lib/passes";
import { useSettings } from "@/lib/settings";
import { useEntries } from "@/lib/useEntries";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, LoadingBlock, PageHeader, ProgressBar } from "@/components/ui";
import { Formula, LevelDot, RootedWord } from "@/components/MemoryTree";

// 每个词只留最核心的意思：第一个义项的前两个词
const brief = (e: DictEntry | null | undefined) =>
  e
    ? shortTranslation(e, 1)
        .replace(/^[a-z]+\.\s*/, "")
        .split(/[，,；;]\s*/)
        .filter(Boolean)
        .slice(0, 2)
        .join("，")
    : "…";

/** 今天的词和它们的词根拆法 */
function useToday() {
  const [words, setWords] = useState<string[] | null>(null);
  const [roots, setRoots] = useState<Map<string, RootInfo | null>>(new Map());
  useEffect(() => {
    todayWords().then(async (ws) => {
      setWords(ws);
      const rs = await Promise.all(ws.map((w) => getRoots(w).catch(() => null)));
      setRoots(new Map(ws.map((w, i) => [w, rs[i]])));
    });
  }, []);
  const entries = useEntries(words ?? []);
  return { words, roots, entries };
}

/**
 * 快速过一遍：今天背过的词一个个闪过去，点一下看意思和拆法，自己判熟不熟；不熟的这一轮最后再来一次。
 * 只是多刺激几次，不动 FSRS 的复习安排。
 */
export function QuickPassPage() {
  const settings = useSettings();
  const { words, roots, entries } = useToday();
  const [queue, setQueue] = useState<string[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const [unsure, setUnsure] = useState<Set<string>>(new Set());
  const [round, setRound] = useState<number | null>(null);
  useEffect(() => {
    if (words && !queue) setQueue(words);
  }, [words, queue]);
  useEffect(() => {
    passesDone().then(setRound);
  }, []);
  const word = queue?.[idx];
  const done = !!queue && idx >= queue.length;
  useEffect(() => {
    if (done && queue?.length) void bumpDay({ passes: 1 });
  }, [done, queue]);
  useEffect(() => {
    if (word && settings.autoSpeak) speak(word);
  }, [word, settings.autoSpeak]);

  const judge = (ok: boolean) => {
    if (!queue || !word) return;
    if (!ok && !unsure.has(word)) {
      setUnsure(new Set(unsure).add(word));
      setQueue([...queue, word]);
    }
    setShown(false);
    setIdx(idx + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!word) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!shown) setShown(true);
        else judge(true);
      }
      if (shown && e.key === "1") judge(false);
      if (shown && e.key === "2") judge(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!queue) return <LoadingBlock text="正在找今天背过的词…" />;
  const names = passNames(settings.dailyPasses);
  const name = round !== null ? names[Math.min(round, names.length - 1)] : "";
  if (!queue.length)
    return (
      <div className="mx-auto mt-10 max-w-md text-center">
        <p className="text-[15px] text-[var(--ink-700)]">今天还没背过词。先做一轮正式复习，之后才能快速过。</p>
        <Link to="/review">
          <Button variant="primary" className="mt-4">
            去背单词
          </Button>
        </Link>
      </div>
    );
  if (done)
    return (
      <div className="card card-raised mx-auto mt-10 max-w-md p-8 text-center">
        <h2 className="t-h2">{name ? `${name}这一轮过完了` : "这一轮过完了"}</h2>
        <p className="mt-2 text-[14px] text-[var(--ink-500)]">
          过了 {words?.length} 个词，{unsure.size} 个不熟，已经多看了一遍。
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link to="/review" className="flex-1">
            <Button className="w-full">回背单词</Button>
          </Link>
          <Link to="/review/digest" className="flex-1">
            <Button variant="primary" className="w-full">
              看单词速览
            </Button>
          </Link>
        </div>
      </div>
    );

  const e = entries.get(word!);
  const r = roots.get(word!);
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl flex-col">
      <div className="flex items-center gap-3">
        <Link to="/review" aria-label="退出">
          <Button size="icon" variant="ghost">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <span className="text-[13px] text-[var(--ink-500)]">快速过 · {name}</span>
        <ProgressBar value={idx / queue.length} className="flex-1" />
        <span className="num text-[14px] text-[var(--ink-500)]">
          {idx}/{queue.length}
        </span>
      </div>
      <button type="button" onClick={() => setShown(true)} className="card card-raised my-auto px-6 pt-10 pb-8 text-center">
        {unsure.has(word!) && idx >= (words?.length ?? 0) && <span className="tag-paper mb-3">再来一次</span>}
        <div className="serif text-[52px] leading-[1.05] font-semibold break-words">{word}</div>
        <div className="mt-2 inline-flex items-center gap-2 text-[var(--ink-500)]">
          {e && phonetic(e) && <span className="font-[family-name:var(--font-mono)] text-[14px]">{phonetic(e)}</span>}
          <SpeakerHigh
            className="size-5"
            onClick={(ev) => {
              ev.stopPropagation();
              speak(word!);
            }}
          />
        </div>
        <div className={cn("mt-6 min-h-[92px] transition", !shown && "opacity-0")}>
          {shown && (
            <div className="animate-pop flex flex-col items-center gap-3">
              <p className="text-[17px] text-[var(--ink)]">{e ? shortTranslation(e) : "…"}</p>
              {r?.m.length ? <Formula parts={r.m} size="sm" /> : null}
            </div>
          )}
        </div>
        {!shown && <p className="text-[13px] text-[var(--ink-500)]">先想一下意思，点一下看答案</p>}
      </button>
      <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-[var(--paper)] pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" disabled={!shown} onClick={() => judge(false)} className="card card-press py-3.5 text-[15px] font-semibold text-[var(--red)] disabled:opacity-40">
          不熟
        </button>
        <button type="button" disabled={!shown} onClick={() => judge(true)} className="card card-press py-3.5 text-[15px] font-semibold disabled:opacity-40">
          熟
        </button>
      </div>
    </div>
  );
}

// 后缀规则：没有同根词可归的词，按词尾的构词规则分组
const SUFFIX_RULES: { re: RegExp; label: string }[] = [
  { re: /(tion|sion)$/, label: "-tion / -sion　动作、结果（名词）" },
  { re: /(ment|ness|ity|ance|ence|ism|ship|hood|age|ure)$/, label: "-ment / -ness / -ity…　状态、性质（名词）" },
  { re: /(er|or|ist|ian|ee|ant)$/, label: "-er / -or / -ist…　人或物（名词）" },
  { re: /(ive|ous|ful|less|able|ible|al|ic|ical|ary|ory|ent|y)$/, label: "-ive / -ous / -able…　形容词" },
  { re: /(ize|ise|ify|ate|en)$/, label: "-ize / -ify / -ate…　使…（动词）" },
  { re: /ly$/, label: "-ly　副词" },
];

interface Digest {
  fams: { f: Family; words: string[] }[];
  pairs: { a: string; b: Confusable }[];
  rules: { label: string; words: string[] }[];
}

/** 晚上的单词速览：今天的词按结构排成一页——同根的成组、易混的对照、其余按后缀规则，每个词只留最核心的意思 */
export function DigestPage() {
  const { words, roots, entries } = useToday();
  const memory = useMemory();
  const [d, setD] = useState<Digest | null>(null);
  useEffect(() => {
    if (!words) return;
    (async () => {
      const today = new Set(words);
      const fs = await Promise.all(words.map((w) => familiesOf(w).catch(() => [] as Family[])));
      // 词根组：今天至少两个词同根的成一组；词多的组先排
      const byFam = new Map<string, { f: Family; words: string[] }>();
      fs.forEach((list) => {
        for (const f of list) {
          const k = familyKey(f);
          if (!byFam.has(k)) byFam.set(k, { f, words: f.w.map((x) => x[0]).filter((x) => today.has(x)) });
        }
      });
      const used = new Set<string>();
      const fams = [...byFam.values()]
        .filter((g) => g.words.length >= 2)
        .sort((a, b) => b.words.length - a.words.length)
        .filter((g) => {
          const fresh = g.words.filter((w) => !used.has(w));
          if (fresh.length < 2) return false;
          g.words = fresh;
          fresh.forEach((w) => used.add(w));
          return true;
        });
      const cs = await Promise.all(words.map((w) => confusablesOf(w).catch(() => [] as Confusable[])));
      const seenPair = new Set<string>();
      const pairs: Digest["pairs"] = [];
      words.forEach((w, i) => {
        const c = cs[i][0];
        if (!c) return;
        const k = [w, c.word].sort().join("|");
        if (seenPair.has(k)) return;
        seenPair.add(k);
        pairs.push({ a: w, b: c });
      });
      const rest = words.filter((w) => !used.has(w));
      const rules: Digest["rules"] = [];
      for (const r of [...SUFFIX_RULES, { re: /./, label: "其他" }]) {
        const ws = rest.filter((w) => !rules.some((g) => g.words.includes(w)) && r.re.test(w));
        if (ws.length) rules.push({ label: r.label, words: ws });
      }
      setD({ fams, pairs, rules });
    })();
  }, [words]);

  if (!words || !d) return <LoadingBlock text="正在整理今天的词…" />;
  const Row = ({ w, root }: { w: string; root?: string }) => {
    const r = roots.get(w);
    return (
      <li className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        <LevelDot m={memory?.get(w)} />
        <button type="button" onClick={() => speak(w)} className="text-left">
          <RootedWord w={w} root={root} className="text-[17px] font-semibold text-[var(--ink)]" />
        </button>
        {r?.m.length ? <span className="text-[13px] text-[var(--ink-500)]">{r.m.map((p) => p[0]).join(" + ")}</span> : null}
        <span className="ml-auto text-[14px] text-[var(--ink-700)]">{brief(entries.get(w))}</span>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <WordsTabs />
      <PageHeader title="单词速览" desc={`今天背的 ${words.length} 个词，按结构排好：同根的放一组，易混的放一起对照，其余按后缀规则分组。睡前过一遍。`} />
      {!words.length && <p className="well py-10 text-center text-[14px] text-[var(--ink-500)]">今天还没背过词</p>}
      {d.fams.length > 0 && (
        <section className="card p-5">
          <h2 className="t-h2 mb-3">同根</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {d.fams.map(({ f, words: ws }) => (
              <div key={familyKey(f)} className="rounded-[12px] bg-[var(--fill-quiet)] p-3.5">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="serif text-[20px] font-semibold text-[var(--blue)]">{f.r}</span>
                  <span className="text-[14px] text-[var(--ink-700)]">{f.g}</span>
                </div>
                <ul className="relative pl-4 before:absolute before:top-2 before:bottom-3 before:left-[4px] before:w-px before:bg-[var(--line-control)]">
                  {ws.map((w) => (
                    <Row key={w} w={w} root={f.r} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      {d.pairs.length > 0 && (
        <section className="card p-5">
          <h2 className="t-h2 mb-3">易混对照</h2>
          <ul className="divide-y divide-[var(--line-soft)]">
            {d.pairs.map(({ a, b }) => (
              <li key={a} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
                <div>
                  <div className="serif text-[17px] font-semibold">{a}</div>
                  <div className="text-[13px] text-[var(--ink-700)]">{brief(entries.get(a))}</div>
                </div>
                <span className="text-[var(--ink-300)]">↔</span>
                <div>
                  <div className="serif text-[17px] font-semibold">{b.word}</div>
                  <div className="text-[13px] text-[var(--ink-700)]">{b.brief}</div>
                </div>
                {b.tip && <p className="serif col-span-3 text-[13px] text-[var(--ink-500)]">{b.tip.tip}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.rules.map((g) => (
        <section key={g.label} className="card p-5">
          <h2 className="mb-1 text-[15px] font-semibold">{g.label}</h2>
          <ul className="divide-y divide-[var(--line-soft)]">
            {g.words.map((w) => (
              <Row key={w} w={w} />
            ))}
          </ul>
        </section>
      ))}
      {words.length > 0 && (
        <div className="flex justify-center pb-6">
          <Link to="/review/quick">
            <Button variant="primary">再快速过一遍</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
