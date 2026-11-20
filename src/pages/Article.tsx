import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { goBack } from "@/lib/nav";
import { Link, useParams, useNavigate } from "react-router";
import { ArrowLeft, Eraser, Highlighter, PencilSimple, NotePencil, Sparkle, TextUnderline, Translate } from "@phosphor-icons/react";
import { WordText, WordTextProvider, type WordClick } from "@/components/WordText";
import { WordCard } from "@/exam/WordCard";
import { AgentSplit } from "@/exam/AgentSplit";
import type { AgentThread } from "@/exam/AgentPanel";
import { agentHeaders, useAgentEnabled } from "@/lib/agent";
import { sentenceKey } from "@/lib/trans";
import { ArticleInk } from "./ArticleInk";
import { ARTICLES_BASE, articleText, loadArticle, SOURCE_NAMES, type Article } from "@/lib/articles";
import { EmptyState, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const READ_KEY = "yz-articles-read";
type Mark = { id: number; p: number; a: number; b: number; kind: "hl" | "ul"; note?: string };
type Sel = { p: number; a: number; b: number; text: string; x: number; y: number };
const marksKey = (id: string) => `yz-article-marks:${id}`;
const MARK_CLS = { hl: "am-hl", ul: "am-ul" } as const;

/** 选中的字（同一段里）→ 段号和字符范围 */
function readSelection(): Sel | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
  const para = el(r.commonAncestorContainer)?.closest<HTMLElement>("[data-p]");
  if (!para) return null;
  const ws = [...para.querySelectorAll<HTMLElement>(".w")].filter((w) => r.intersectsNode(w));
  if (!ws.length) return null;
  const a = Number(ws[0].dataset.o);
  const last = ws[ws.length - 1];
  const b = Number(last.dataset.o) + (last.textContent?.length ?? 0);
  const box = r.getBoundingClientRect();
  return { p: Number(para.dataset.p), a, b, text: sel.toString().trim(), x: box.left + box.width / 2, y: box.top };
}

/** 外刊阅读页：正文点词查词、选短语、加生词本；VOA 能边听边读；右边 Agent 分屏讲这篇 */
export function ArticlePage() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const [a, setA] = useState<Article | null>(null);
  const [err, setErr] = useState(false);
  const [hit, setHit] = useState<WordClick | null>(null);
  const [agent, setAgent] = useState(false);
  const [width, setWidth] = useState(() => Number(localStorage.getItem("yz-agent-w")) || 420);
  const aiOn = useAgentEnabled();
  const [tr, setTr] = useState<string[][][] | null>(null);
  const [showTr, setShowTr] = useState(false);
  const [trBusy, setTrBusy] = useState<string | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const [ask, setAsk] = useState<AgentThread | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pen, setPen] = useState(false);
  useEffect(() => {
    setTr(null);
    setShowTr(false);
    setMarks(JSON.parse(localStorage.getItem(marksKey(id)) || "[]"));
    fetch(`/api/agent/trans?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => x && setTr(x), () => {});
  }, [id]);
  const saveMarks = (m: Mark[]) => {
    setMarks(m);
    localStorage.setItem(marksKey(id), JSON.stringify(m));
  };
  const trMap = useMemo(() => new Map((tr ?? []).flat().map(([en, zh]) => [sentenceKey(en), zh])), [tr]);
  const trans = useCallback((s: string) => ({ text: trMap.get(sentenceKey(s)) ?? null, ready: true }), [trMap]);
  const translate = async () => {
    if (tr) return setShowTr(!showTr);
    if (!a || trBusy === "…") return;
    if (!aiOn) return setTrBusy("翻译要先激活 Agent（右上角 Agent 里输激活码）");
    setTrBusy("…");
    try {
      const r = await fetch("/api/agent/trans", { method: "POST", headers: agentHeaders(true), body: JSON.stringify({ id: a.id, paras: a.paras.map((p) => p.t) }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || "翻译失败");
      setTr(x);
      setShowTr(true);
      setTrBusy(null);
    } catch (e) {
      setTrBusy(e instanceof Error ? e.message : "翻译失败，再试一次");
    }
  };
  const notingRef = useRef(false);
  notingRef.current = noting !== null;
  useEffect(() => {
    // 写批注时输入框拿走了焦点，选区会没：这时不收工具条
    const up = () => window.setTimeout(() => !notingRef.current && setSel(readSelection()), 0);
    document.addEventListener("selectionchange", up);
    return () => document.removeEventListener("selectionchange", up);
  }, []);
  const addMark = (kind: Mark["kind"], note?: string) => {
    if (!sel) return;
    saveMarks([...marks.filter((m) => !(m.p === sel.p && m.a === sel.a && m.b === sel.b && m.kind === kind)), { id: Date.now(), p: sel.p, a: sel.a, b: sel.b, kind, note }]);
    getSelection()?.removeAllRanges();
    setSel(null);
  };
  const overlapped = sel ? marks.filter((m) => m.p === sel.p && m.a < sel.b && m.b > sel.a) : [];
  const onWord = useCallback((h: WordClick) => {
    if (getSelection()?.isCollapsed === false) return;
    setHit(h);
  }, []);
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
          paper: a.title,
          sentence: "",
          article: `${SOURCE_NAMES[a.source]}，约${a.level}难度，${a.words} 词，${a.published.slice(0, 10)}，作者：${a.author}`,
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
    <WordTextProvider onWord={onWord} marks>
      <div className="flex h-dvh bg-[var(--paper-100)]">
        <main ref={mainRef} data-ink-scroll onScroll={() => setSel(null)} className="min-w-0 flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--line-soft)] bg-white/90 px-3 backdrop-blur">
            <Link to="/articles" onClick={(e) => goBack(navigate, "/articles", e)} className="gr-tool" aria-label="回外刊列表">
              <ArrowLeft className="size-[18px]" />
            </Link>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.title}</p>
            <button type="button" disabled={showTr && !!tr} onClick={() => setPen(!pen)} className={cn("gr-tool", pen && "is-on")} aria-label="手写" title={showTr && tr ? "收起译文后才能手写" : "在文章上手写"}>
              <PencilSimple className="size-[18px]" />
              <span className="gr-tool-text">手写</span>
            </button>
            <button type="button" onClick={() => void translate()} className={cn("gr-tool", showTr && "is-on")} aria-label="译文" title={tr ? "显示 / 隐藏逐段译文" : "生成全文译文"}>
              <Translate className="size-[18px]" />
              <span className="gr-tool-text">{trBusy === "…" ? "翻译中…" : "译文"}</span>
            </button>
            <button type="button" onClick={() => setAgent(!agent)} className={cn("gr-tool", agent && "is-on")} aria-label="Agent">
              <Sparkle className="size-[18px]" />
              <span className="gr-tool-text">Agent</span>
            </button>
          </header>
          <article className={cn("@container mx-auto px-5 pt-8 pb-24 transition-[max-width] duration-500 [transition-timing-function:cubic-bezier(.3,1.1,.45,1)]", showTr && tr ? "max-w-[720px] lg:max-w-[1180px]" : "max-w-[720px]")}>
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
            <div ref={boxRef} className="relative mt-6 space-y-4 font-serif text-[18px] leading-[1.75] text-[var(--ink)]">
              <ArticleInk id={id} box={boxRef} on={pen} hidden={showTr && !!tr} onClose={() => setPen(false)} />
              {trBusy && trBusy !== "…" && <p className="font-sans text-[13px] text-[var(--red,#c43)]">{trBusy}</p>}
              {a.paras.map((p, i) => {
                const ranges = marks.filter((m) => m.p === i).map((m) => ({ a: m.a, b: m.b, cls: MARK_CLS[m.kind] }));
                const notes = marks.filter((m) => m.p === i && m.note);
                const rows = tr?.[i] ?? [];
                const body = p.k === "h" ? (
                  <h2 className="pt-2 text-[20px] font-semibold">
                    <WordText text={p.t} ranges={ranges} />
                  </h2>
                ) : p.k === "q" ? (
                  <blockquote className="border-l-[3px] border-[var(--line)] pl-4 text-[var(--ink-700)]">
                    <WordText text={p.t} ranges={ranges} />
                  </blockquote>
                ) : p.k === "fine" ? (
                  <p className="font-sans text-[12px] leading-[1.6] text-[var(--ink-500)] italic">{p.t}</p>
                ) : (
                  <WordText as="p" text={p.t} ranges={ranges} />
                );
                const side = rows.length > 0 && showTr;
                return (
                  <div key={i} data-p={i} className={cn(side && "@min-[1100px]:grid @min-[1100px]:grid-cols-[680px_minmax(0,1fr)] @min-[1100px]:gap-x-12")}>
                    {body}
                    {(side || notes.length > 0) && (
                      <div className="font-sans">
                        {side && <p className="animate-pop mt-1.5 text-[15px] leading-[1.8] text-[var(--ink-500)] @min-[1100px]:mt-1">{rows.map((x) => x[1]).join("")}</p>}
                        {notes.map((m) => (
                          <p key={m.id} className="group animate-pop mt-2 border-l-2 border-[#e0b43c] pl-3 text-[14px] leading-[1.65] text-[var(--ink-700)]">
                            <span className="text-[var(--ink-500)] italic">{p.t.slice(m.a, m.b)}</span>
                            <span className="mx-1.5 text-[var(--ink-300,#bbb)]">·</span>
                            {m.note}
                            <button type="button" className="ml-1.5 text-[var(--ink-500)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={() => saveMarks(marks.filter((x) => x.id !== m.id))} aria-label="删除批注">
                              ×
                            </button>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
            sentence={ask}
            onClearSentence={() => setAsk(null)}
            onClose={() => setAgent(false)}
          />
        )}
      </div>
      {sel &&
        !hit &&
        createPortal(
          <div
            className="animate-pop fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-[12px] bg-[var(--ink)]/95 p-1 text-white shadow-[0_10px_30px_rgba(20,30,50,0.25)] backdrop-blur"
            style={{ left: sel.x, top: sel.y - 8 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {noting !== null ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (noting.trim()) addMark("ul", noting.trim());
                  setNoting(null);
                }}
              >
                <input autoFocus value={noting} onChange={(e) => setNoting(e.target.value)} placeholder="写批注，回车保存" className="h-7 w-48 rounded-[6px] bg-white/15 px-2 text-[13px] text-white outline-none placeholder:text-white/60" onMouseDown={(e) => e.stopPropagation()} />
              </form>
            ) : (
              <>
                {(
                  [
                  ["高亮", Highlighter, () => addMark("hl")],
                  ["划线", TextUnderline, () => addMark("ul")],
                  ["批注", NotePencil, () => setNoting("")],
                  ...(overlapped.length ? [["清除", Eraser, () => (saveMarks(marks.filter((m) => !overlapped.includes(m))), setSel(null))] as [string, typeof Highlighter, () => void]] : []),
                  ...(aiOn && sel && sel.text.split(/\s+/).length >= 8 && thread
                    ? [["长难句解析", Sparkle, () => (setAsk({ id: `asel:${a!.id}:L${sel.p}-${sel.a}-${sel.b}`, ctx: { ...thread.ctx, sentence: sel.text, question: "用结构图拆解这句长难句：主干是什么，从句和修饰各起什么作用，再给一句通顺的译文。" } }), setAgent(true), setSel(null))] as [string, typeof Highlighter, () => void]]
                    : []),
                  ...(aiOn ? [["问 Agent", Sparkle, () => (thread && setAsk({ id: `asel:${thread.id.slice(8)}:${sel?.p}-${sel?.a}-${sel?.b}`, ctx: { ...thread.ctx, sentence: sel?.text ?? "" } }), setAgent(true), setSel(null))] as [string, typeof Highlighter, () => void]] : []),
                  ] as [string, typeof Highlighter, () => void][]
                ).map(([label, Icon, fn]) => (
                  <button key={label} type="button" onClick={fn} className="flex h-8 items-center gap-1 rounded-[7px] px-2 text-[13px] hover:bg-white/15">
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
      {hit &&
        createPortal(
          <WordCard
            hit={hit}
            ctx={ctx}
            anchor={anchor}
            bounds={bounds}
            source={{ paperId: `article:${a.id}`, paperTitle: a.title }}
            trans={trans}
            onLookedUp={() => {}}
            onClose={() => setHit(null)}
          />,
          document.body,
        )}
    </WordTextProvider>
  );
}
