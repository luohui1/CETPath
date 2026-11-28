import { paperPath } from "@/lib/attempts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowSquareOut, ArrowUp, CaretDown, ChatsCircle, FileText, List, NotePencil, Trash, X } from "@phosphor-icons/react";
import { db, type ChatRow } from "@/lib/db";
import { EXAMS, loadPaperIndex, peekPaperIndex, type ExamId, type PaperIndexItem } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { normalizeTargetExam, resolveTargetExam } from "@/lib/targetExam";
import { sentenceKey } from "@/lib/trans";
import { cn } from "@/lib/utils";
import { AgentPanel, chatTitle, forgetThread, type AgentThread } from "@/exam/AgentPanel";

const SUGGEST_BY_EXAM: Record<string, string[]> = {
  cet4: ["四级翻译常考什么主题词与句式？", "四级仔细阅读干扰项怎么排除？", "四级听力对话总漏听关键信息怎么办？", "帮我制定一周的四级冲刺复习计划"],
  cet6: ["六级翻译怎么拆分长难句？", "六级仔细阅读推理题怎么做？", "六级听力讲座跟不上节奏怎么办？", "帮我制定一周的六级备考复习计划"],
  "ielts-a": ["雅思阅读 TRUE/FALSE/NOT GIVEN 怎么稳拿分？", "雅思大作文审题和论点怎么展开？", "雅思听力地图题和配对题有什么技巧？", "帮我梳理雅思口语 Part 2 话题延伸思路"],
  "ielts-gt": ["雅思 G 类阅读前面段落匹配怎么提速？", "雅思 G 类书信小作文常见语气怎么切换？", "雅思听力填空拼写和单复数如何避坑？", "帮我制定两周的雅思 G 类冲刺计划"],
  kaoyan1: ["考研阅读长难句怎么快速找主干？", "考研新题型七选五有什么衔接线索？", "考研英语大小作文怎么积累功能句？", "考研英译汉怎么准确调整中文语序？"],
};
const FREE = "";

type Group = { key: string; paper?: PaperIndexItem; chats: ChatRow[] };

const asks = (c: ChatRow) => c.messages.filter((m) => m.role === "user").length;
const day = (t: number) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : `${d.getMonth() + 1}月${d.getDate()}日`;
};
const shortTitle = (p: PaperIndexItem) => [EXAMS.find((e) => e.id === p.exam)?.short ?? p.exam, p.month ? `${p.year}.${p.month}` : `${p.year}`, p.set ? `第${p.set}套` : p.label].filter(Boolean).join(" ");
/** 分节练习的会话回到那一节（会话 id 形如 paper:<卷>#<节>:<交卷时间>） */
const paperLink = (id: string, chat?: string) => {
  const sec = chat?.match(/^paper:[^#:]+#([^:]+):/)?.[1];
  return `${paperPath(id, sec && sec !== "retry" ? sec : undefined)}?agent=1${chat ? `&chat=${encodeURIComponent(chat)}` : ""}`;
};

/** AI 助教页：左边历史对话按卷子分组（随便问的单独一组），右边是对话；没开对话时中间一个输入框，下面可以挑一套卷子去卷面上问 */
export function AskPage() {
  const settings = useSettings();
  const targetExam: ExamId = resolveTargetExam(settings);
  const suggest = SUGGEST_BY_EXAM[targetExam] ?? SUGGEST_BY_EXAM.cet6;
  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), []);
  const attempts = useLiveQuery(() => db.attempts.orderBy("updatedAt").reverse().limit(12).toArray(), []);
  const [index, setIndex] = useState(peekPaperIndex);
  useEffect(() => void loadPaperIndex().then(setIndex, () => {}), []);
  const byTitle = useMemo(() => new Map(index?.map((p) => [p.title, p])), [index]);
  const byId = useMemo(() => new Map(index?.map((p) => [p.id, p])), [index]);

  const [thread, setThread] = useState<AgentThread | null>(null);
  const [draft, setDraft] = useState("");
  // 删掉再问同一句时换一个新的对话面板（它记着"这句已经自动问过"）
  const [gen, setGen] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get("q");

  useEffect(() => {
    const text = qParam?.trim().replace(/\s+/g, " ");
    if (!text) return;
    const question = /[\u4e00-\u9fff]/.test(text);
    setThread(question ? { id: `q:${Date.now()}`, ctx: { sentence: "", question: text } } : { id: `${sentenceKey(text)}:`, ctx: { sentence: text } });
    setGen((g) => g + 1);
    setDraft("");
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true });
  }, [qParam, searchParams, setSearchParams]);

  // 每组按最近一次对话排；卷子组标题用试卷目录里的名字，找不到（外刊、删掉的卷）就用存下来的标题
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const c of chats ?? []) {
      const key = c.ctx.paper ?? FREE;
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, paper: byTitle.get(key), chats: [] }));
      g.chats.push(c);
    }
    return [...map.values()];
  }, [chats, byTitle]);

  const recent = useMemo(() => {
    const targetPapers = (index ?? []).filter((p) => normalizeTargetExam(p.exam) === targetExam);
    const seen = (attempts ?? [])
      .map((a) => byId.get(a.paperId))
      .filter((p): p is PaperIndexItem => !!p && normalizeTargetExam(p.exam) === targetExam);
    const unique: PaperIndexItem[] = [];
    for (const p of seen) {
      if (!unique.some((x) => x.id === p.id)) unique.push(p);
    }
    return (unique.length ? unique : targetPapers).slice(0, 4);
  }, [attempts, byId, index, targetExam]);

  const ask = (raw = draft) => {
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text) return;
    // 带中文的当成一般问题（"四级翻译怎么准备"），纯英文的当成要解析的句子
    const question = /[\u4e00-\u9fff]/.test(text);
    setThread(question ? { id: `q:${Date.now()}`, ctx: { sentence: "", question: text } } : { id: `${sentenceKey(text)}:`, ctx: { sentence: text } });
    setGen((g) => g + 1);
    setDraft("");
  };
  const fresh = () => {
    setThread(null);
    setDrawer(false);
    setGen((g) => g + 1);
  };
  const open = (c: ChatRow) => {
    setThread({ id: c.id, ctx: c.ctx });
    setDrawer(false);
  };
  const remove = (c: ChatRow) => {
    forgetThread(c.id);
    void db.chats.delete(c.id);
    if (thread?.id === c.id) fresh();
  };

  const history = groups.length ? (
    <div className="space-y-3">
      {groups.map((g) => {
        const shut = folded[g.key];
        return (
          <section key={g.key || "free"}>
            <div className="group/h flex items-center gap-1 pr-1">
              <button
                type="button"
                onClick={() => setFolded((f) => ({ ...f, [g.key]: !shut }))}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] font-medium text-[var(--ink-500)] hover:bg-[var(--fill-quiet)]"
                aria-expanded={!shut}
              >
                {g.key ? <FileText className="size-[15px] flex-none" /> : <ChatsCircle className="size-[15px] flex-none" />}
                <span className="truncate" title={g.paper?.title ?? g.key}>{g.key ? (g.paper ? shortTitle(g.paper) : g.key) : "随便问"}</span>
                <span className="flex-none tabular-nums text-[var(--ink-400)]">{g.chats.length}</span>
                <CaretDown className={cn("ml-auto size-3 flex-none transition-transform", shut && "-rotate-90")} />
              </button>
              {g.paper && (
                <Link to={paperLink(g.paper.id)} title="打开这套卷，在卷面旁边接着问" className="grid size-7 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--blue)]" aria-label={`打开${g.paper.title}`}>
                  <ArrowSquareOut className="size-[15px]" />
                </Link>
              )}
            </div>
            {!shut && (
              <div className="mt-0.5 space-y-0.5">
                {g.chats.map((c) => (
                  <div key={c.id} className={cn("group flex items-center rounded-[10px] transition-colors hover:bg-[var(--fill-quiet)]", thread?.id === c.id && "bg-[var(--fill-quiet)]")}>
                    <button type="button" onClick={() => open(c)} className="min-w-0 flex-1 py-2 pr-1 pl-3 text-left">
                      <p className="truncate text-[14px] text-[var(--ink)]">{chatTitle(c)}</p>
                      <p className="truncate text-[12px] text-[var(--ink-500)]">
                        {day(c.updatedAt)} · {asks(c)} 问
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="mr-1 grid size-8 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)] focus-visible:opacity-100 pointer-coarse:opacity-100"
                      aria-label="删掉这段对话"
                    >
                      <Trash className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  ) : (
    <p className="px-3 py-2 text-[13px] leading-relaxed text-[var(--ink-500)]">问过的会按卷子分好组，存在这台设备上。</p>
  );

  const sidebar = (close?: ReactNode) => (
    <>
      <div className="flex items-center gap-1 p-2.5">
        <button type="button" onClick={fresh} className="flex flex-1 items-center gap-2 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-[var(--ink)] hover:bg-[var(--fill-quiet)]">
          <NotePencil className="size-[18px]" />
          新对话
        </button>
        {close}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">{history}</div>
    </>
  );

  const total = chats?.length ?? 0;
  const paper = thread?.ctx.paper ? byTitle.get(thread.ctx.paper) : undefined;

  return (
    <div className="card relative flex h-[calc(100dvh-96px)] min-h-[380px] overflow-hidden">
      <aside className="hidden w-[272px] flex-none flex-col border-r border-[var(--line)] bg-[var(--paper-100)] lg:flex">{sidebar()}</aside>

      {drawer && (
        <div className="absolute inset-0 z-20 flex lg:hidden">
          <aside className="flex w-[300px] max-w-[85%] flex-col border-r border-[var(--line)] bg-[var(--paper-100)] shadow-xl">
            {sidebar(
              <button type="button" onClick={() => setDrawer(false)} className="grid size-9 place-items-center rounded-[10px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)]" aria-label="收起历史对话">
                <X className="size-[18px]" />
              </button>,
            )}
          </aside>
          <button type="button" className="flex-1 bg-black/20" onClick={() => setDrawer(false)} aria-label="收起历史对话" />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className={cn("flex h-12 flex-none items-center gap-2 px-3", thread ? "border-b border-[var(--line)]" : "lg:hidden")}>
          <button type="button" onClick={() => setDrawer(true)} className="flex flex-none items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)] lg:hidden" aria-label="历史对话">
            <List className="size-[18px]" />
            {!thread && <span>历史{total ? ` ${total}` : ""}</span>}
          </button>
          {thread && (
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:pl-1">
              <p className="min-w-0 truncate text-[14px] font-medium text-[var(--ink)]">{chatTitle(chats?.find((c) => c.id === thread.id) ?? { ctx: thread.ctx, messages: [] })}</p>
              {thread.ctx.paper &&
                (paper ? (
                  <Link to={paperLink(paper.id, thread.id)} className="flex max-w-[45%] flex-none items-center gap-1 rounded-full bg-[var(--fill-quiet)] px-2.5 py-1 text-[12px] text-[var(--ink-700)] hover:text-[var(--blue)]" title="回到卷面接着问：Agent 能看到原卷、作答和笔记，还能在卷子上标记">
                    <FileText className="size-3.5 flex-none" />
                    <span className="truncate">{shortTitle(paper)}</span>
                    <ArrowSquareOut className="size-3 flex-none" />
                  </Link>
                ) : (
                  <span className="max-w-[45%] flex-none truncate rounded-full bg-[var(--fill-quiet)] px-2.5 py-1 text-[12px] text-[var(--ink-500)]">{thread.ctx.paper}</span>
                ))}
            </div>
          )}
          <button type="button" onClick={fresh} className="ml-auto flex flex-none items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)] lg:hidden">
            <NotePencil className="size-4" />
            新对话
          </button>
        </div>

        {thread ? (
          <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col">
            <AgentPanel key={gen} thread={thread} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
            <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center py-10">
              <h1 className="text-center text-[26px] font-semibold tracking-tight text-[var(--ink)]">今天想弄懂什么？</h1>
              <div className="mt-6 rounded-[22px] border border-[var(--line)] bg-white p-2 shadow-[0_6px_24px_-12px_rgba(0,0,0,0.18)] transition-colors focus-within:border-[var(--ink-300)]">
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      ask();
                    }
                  }}
                  rows={3}
                  placeholder="粘贴一句看不懂的英文，或者直接提问"
                  className="block w-full resize-none bg-transparent px-3 pt-2 text-[16px] leading-[1.6] !outline-none placeholder:text-[var(--ink-500)]"
                  aria-label="要问的内容"
                />
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[12px] text-[var(--ink-500)]">{draft.trim() && !/[\u4e00-\u9fff]/.test(draft) ? "英文句子会按长难句来讲" : "Enter 发送，Shift + Enter 换行"}</span>
                  <button type="button" disabled={!draft.trim()} onClick={() => ask()} className="grid size-9 place-items-center rounded-full bg-[var(--ink)] text-white transition-opacity disabled:opacity-25" aria-label="发送">
                    <ArrowUp className="size-[18px]" weight="bold" />
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {suggest.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-[13px] text-[var(--ink-700)] transition-colors hover:bg-[var(--fill-quiet)]">
                    {s}
                  </button>
                ))}
              </div>
              {recent.length > 0 && (
                <div className="mt-10">
                  <p className="text-center text-[12px] text-[var(--ink-500)]">问某套卷子：在卷面旁边问，Agent 看得到原卷、你的作答和笔记，还能直接在卷子上标记</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {recent.map((p) => {
                      const n = groups.find((g) => g.paper?.id === p.id)?.chats.length ?? 0;
                      return (
                        <Link key={p.id} to={paperLink(p.id)} className="flex items-center gap-2.5 rounded-[14px] border border-[var(--line)] bg-white px-3.5 py-2.5 transition-colors hover:border-[var(--ink-300)]">
                          <FileText className="size-[18px] flex-none text-[var(--blue)]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">{p.title}</span>
                          {n > 0 && <span className="flex-none text-[12px] text-[var(--ink-500)]">{n} 段对话</span>}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
