import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router";
import { ArrowLeft, Sparkle } from "@phosphor-icons/react";
import { WordText, WordTextProvider, type WordClick } from "@/components/WordText";
import { WordCard } from "@/exam/WordCard";
import { AgentSplit } from "@/exam/AgentSplit";
import type { AgentThread } from "@/exam/AgentPanel";
import { useAgentEnabled } from "@/lib/agent";
import { ARTICLES_BASE, articleText, loadArticle, SOURCE_NAMES, type Article } from "@/lib/articles";
import { EmptyState, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const NO_TRANS = () => ({ text: null, ready: true });
const READ_KEY = "yz-articles-read";

/** 外刊阅读页：正文点词查词、选短语、加生词本；VOA 能边听边读；右边 Agent 分屏讲这篇 */
export function ArticlePage() {
  const { id = "" } = useParams();
  const [a, setA] = useState<Article | null>(null);
  const [err, setErr] = useState(false);
  const [hit, setHit] = useState<WordClick | null>(null);
  const [agent, setAgent] = useState(false);
  const [width, setWidth] = useState(() => Number(localStorage.getItem("yz-agent-w")) || 420);
  const aiOn = useAgentEnabled();
  useEffect(() => {
    setA(null);
    setErr(false);
    loadArticle(id).then(
      (x) => {
        setA(x);
        const read = new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
        read.add(x.id);
        localStorage.setItem(READ_KEY, JSON.stringify([...read].slice(-500)));
      },
      () => setErr(true),
    );
  }, [id]);
  const thread = useMemo<AgentThread | null>(
    () =>
      a && {
        id: `article:${a.id}`,
        ctx: {
          paper: `外刊：${a.title}`,
          sentence: "",
          review: `这是一篇外刊（${SOURCE_NAMES[a.source]}，约${a.level}难度，${a.words} 词），不是考试卷，没有作答记录。按四六级阅读的角度讲：长难句、同义替换、话题词汇；出题就按四六级阅读题型出。`,
          paperText: `${a.title}\n${articleText(a)}`,
        },
      },
    [a],
  );
  const ctx = useMemo(() => {
    if (!hit) return null;
    const tokens = hit.sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
    const at = tokens.findIndex((t) => t.toLowerCase() === hit.word.toLowerCase());
    return { tokens, at: Math.max(0, at) };
  }, [hit]);
  const anchor = useCallback(() => {
    if (!hit) return null;
    const word = hit.el?.isConnected ? hit.el.getBoundingClientRect() : hit.rect;
    return { word, avoid: word };
  }, [hit]);
  const bounds = useCallback(() => new DOMRect(0, 0, innerWidth, innerHeight), []);

  if (err) return <EmptyState title="这篇文章找不到了" desc={<Link to="/articles" className="text-[var(--blue)]">回外刊列表</Link>} />;
  if (!a || !thread)
    return (
      <div className="grid h-dvh place-items-center">
        <Spinner />
      </div>
    );
  return (
    <WordTextProvider onWord={setHit} marks>
      <div className="flex h-dvh bg-[var(--paper-100)]">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--line-soft)] bg-white/90 px-3 backdrop-blur">
            <Link to="/articles" className="gr-tool" aria-label="回外刊列表">
              <ArrowLeft className="size-[18px]" />
            </Link>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.title}</p>
            <button type="button" onClick={() => setAgent(!agent)} className={cn("gr-tool", agent && "is-on")} aria-label="Agent">
              <Sparkle className="size-[18px]" />
              <span className="gr-tool-text">Agent</span>
            </button>
          </header>
          <article className="mx-auto max-w-[720px] px-5 pt-8 pb-24">
            <p className="text-[12px] font-medium text-[var(--blue)]">
              {SOURCE_NAMES[a.source]} · {a.level}难度 · {a.words} 词 · 约 {a.minutes} 分钟
            </p>
            <h1 className="mt-2 font-serif text-[28px] leading-[1.25] font-semibold text-[var(--ink)]">{a.title}</h1>
            {/* 署名和授权放在文首（The Conversation 的转载条件） */}
            <p className="mt-3 text-[13px] leading-[1.6] text-[var(--ink-500)]">
              {a.author} · {a.published.slice(0, 10)} ·{" "}
              <a href={a.url} target="_blank" rel="noreferrer" className="text-[var(--blue)] underline-offset-2 hover:underline">
                原文
              </a>{" "}
              · {a.license}
            </p>
            {a.audio && <audio controls preload="none" src={ARTICLES_BASE + a.audio} className="mt-4 w-full" />}
            <div className="mt-6 space-y-4 font-serif text-[18px] leading-[1.75] text-[var(--ink)]">
              {a.paras.map((p, i) =>
                p.k === "h" ? (
                  <h2 key={i} className="pt-2 text-[20px] font-semibold">
                    <WordText text={p.t} />
                  </h2>
                ) : p.k === "q" ? (
                  <blockquote key={i} className="border-l-[3px] border-[var(--line)] pl-4 text-[var(--ink-700)]">
                    <WordText text={p.t} />
                  </blockquote>
                ) : p.k === "fine" ? (
                  <p key={i} className="font-sans text-[12px] leading-[1.6] text-[var(--ink-500)] italic">
                    {p.t}
                  </p>
                ) : (
                  <WordText key={i} as="p" text={p.t} />
                ),
              )}
            </div>
            {!!a.glossary?.length && (
              <section className="mt-10 rounded-[14px] bg-white p-4 ring-1 ring-[var(--line)]">
                <h2 className="text-[14px] font-semibold">本文词汇（Words in This Story）</h2>
                <ul className="mt-2 space-y-1.5 text-[14px] leading-[1.6]">
                  {a.glossary.map((g) => (
                    <li key={g.w}>
                      <b className="font-serif">{g.w}</b> <span className="text-[var(--ink-700)]">– <WordText text={g.d} /></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {a.pixel && <img src={a.pixel} alt="" width={1} height={1} className="absolute size-px opacity-0" />}
          </article>
        </main>
        {agent && (
          <AgentSplit
            side
            width={width}
            inset={0}
            onWidth={(w) => {
              setWidth(w);
              localStorage.setItem("yz-agent-w", String(w));
            }}
            enabled={!!aiOn}
            paperThread={thread}
            sentence={null}
            onClearSentence={() => {}}
            onClose={() => setAgent(false)}
          />
        )}
      </div>
      {hit &&
        createPortal(
          <WordCard
            hit={hit}
            ctx={ctx}
            anchor={anchor}
            bounds={bounds}
            source={{ paperId: `article:${a.id}`, paperTitle: a.title }}
            trans={NO_TRANS}
            onLookedUp={() => {}}
            onClose={() => setHit(null)}
          />,
          document.body,
        )}
    </WordTextProvider>
  );
}
