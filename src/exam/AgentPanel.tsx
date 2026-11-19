import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUp, Sparkle, Stop } from "@phosphor-icons/react";
import { db } from "@/lib/db";
import { remember, streamChat, useAgentEnabled, type AgentContext, type ChatMsg } from "@/lib/agent";
import { cn } from "@/lib/utils";
import { EmptyState, Spinner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

/** 一次提问的对象：卷面上的一句（可带点的那个词） */
export type AgentThread = { id: string; ctx: AgentContext };

// 换标签、收起面板再打开，同一句的对话还在
const threads = new Map<string, ChatMsg[]>();
/** 删掉一段对话时连内存里的缓存一起清掉，不然同一句再问会把删掉的内容带回来 */
export const forgetThread = (id: string) => void threads.delete(id);

const QUICK = ["再讲简单点", "主干是哪几个词？", "这里为什么这样用？", "出一句类似的考考我"];
// 一般备考问题（不针对某一句）的快捷追问
const QUICK_Q = ["再讲简单点", "举个真题里的例子", "给我出一道练习"];

const firstAsk = (ctx: AgentContext) => ctx.question || (ctx.word ? `「${ctx.word}」在这句里是什么意思、起什么作用？顺便帮我理一下这句的结构。` : "这句我没看懂，帮我解析一下。");

/** inDock：做题页右侧面板里，多一个"去 AI 助教页"的链接 */
export function AgentPanel({ thread, inDock }: { thread: AgentThread | null; inDock?: boolean }) {
  const enabled = useAgentEnabled();
  const memCount = useLiveQuery(() => db.memory.count(), []);
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => (thread ? (threads.get(thread.id) ?? []) : []));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noted, setNoted] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setMsgs(thread ? (threads.get(thread.id) ?? []) : []);
    setError(null);
    setNoted([]);
    // 历史对话（AI 助教页、上次打开）从本机库里取
    if (thread && !threads.has(thread.id))
      void db.chats.get(thread.id).then((row) => {
        if (!live || !row?.messages.length || threads.has(thread.id)) return;
        threads.set(thread.id, row.messages);
        setMsgs(row.messages);
      });
    return () => {
      live = false;
    };
  }, [thread]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    if (!thread || busy || !text.trim()) return;
    const id = thread.id;
    const base = [...(threads.get(id) ?? []), { role: "user" as const, content: text.trim() }];
    const ctx = thread.ctx;
    const put = (list: ChatMsg[], persist = false) => {
      threads.set(id, list);
      setMsgs(list);
      if (persist) void (list.length ? db.chats.put({ id, ctx, messages: list, updatedAt: Date.now() }) : db.chats.delete(id));
    };
    put([...base, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const answer = await streamChat(base, thread.ctx, (all) => put([...base, { role: "assistant", content: all }]), ctl.signal);
      put([...base, { role: "assistant", content: answer }], true);
      // 后台整理长期记忆：只看这一问一答，不拖慢下一次提问
      void remember(base.slice(-1).concat({ role: "assistant", content: answer })).then((added) => added.length && setNoted(added), () => {});
    } catch (e) {
      put(base.slice(0, -1));
      setDraft(text);
      if ((e as Error).name !== "AbortError") setError((e as Error).message || "出错了");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  // 第一次打开这句（本机也没有历史）：自动问一句
  useEffect(() => {
    if (!thread || !enabled || asked.current === thread.id || (threads.get(thread.id)?.length ?? 0) > 0) return;
    asked.current = thread.id;
    const id = thread.id;
    void db.chats.get(id).then((row) => {
      if (row?.messages.length || (threads.get(id)?.length ?? 0) > 0) return;
      void send(firstAsk(thread.ctx));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, enabled]);

  if (enabled === null) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (!enabled)
    return (
      <div className="px-4 py-10">
        <EmptyState icon={<Sparkle className="size-6" />} title="AI 助教还没开通" desc="管理员在后台（/admin）填好模型接口后就能用。" />
      </div>
    );
  if (!thread)
    return (
      <div className="px-4 py-10">
        <EmptyState icon={<Sparkle className="size-6" />} title={inDock ? "点卷面上的词，再点“问 AI”" : "粘贴一句英文，或直接提问"} desc={inDock ? "也可以长按一句，在底部条上点“问 AI”。" : "比如粘贴阅读里看不懂的句子，或者问“六级翻译怎么拆长句”。"} />
      </div>
    );

  const word = thread.ctx.word;
  const quote = word
    ? thread.ctx.sentence.split(new RegExp(`(\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b)`, "i")).map((p, i) => (i % 2 ? <mark key={i} className="rounded-[3px] bg-[var(--blue-tint)] px-0.5 text-[var(--blue)]">{p}</mark> : p))
    : thread.ctx.sentence;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--ink-500)]">
          <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
          <span className="flex-1">AI 助教 · 结合你的记忆讲解</span>
          {inDock && (
            <Link to="/ask" className="hover:text-[var(--ink)]">
              全部对话
            </Link>
          )}
          <Link to="/settings#memory" className="hover:text-[var(--ink)]">
            长期记忆 <span className="num">{memCount ?? 0}</span> 条
          </Link>
        </div>
        {quote && <blockquote className="mt-2 rounded-[10px] bg-[var(--paper-100)] px-3 py-2.5 font-serif text-[15px] leading-[1.6] text-[var(--ink-700)]">{quote}</blockquote>}
      </div>

      <div className="flex-1 space-y-3 px-4 py-3" aria-live="polite">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-[12px] rounded-br-[4px] bg-[var(--blue)] px-3 py-2 text-[14px] leading-[1.6] text-white">
              {m.content}
            </div>
          ) : (
            <div key={i}>
              {m.content ? <Markdown text={m.content} /> : <span className="inline-flex items-center gap-2 text-[var(--ink-500)]"><Spinner /> 在想…</span>}
            </div>
          ),
        )}
        {error && <p className="rounded-[10px] bg-[var(--red-tint,#fdecec)] px-3 py-2 text-[14px] text-[var(--red)]">{error}</p>}
        {noted.length > 0 && !busy && <p className="text-[12px] text-[var(--ink-500)]">已记下：{noted.join("；")}</p>}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 border-t border-[var(--line-soft)] bg-[var(--surface,white)] px-3 pt-2 pb-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(thread.ctx.sentence ? QUICK : QUICK_Q).map((q) => (
            <button key={q} type="button" disabled={busy} onClick={() => void send(q)} className="pill disabled:opacity-40">
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder="接着问，比如：that 指代什么？"
            className="max-h-28 min-h-10 flex-1 resize-none rounded-[10px] bg-[var(--paper-100)] px-3 py-2 text-[14px] leading-6 outline-none focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--blue)_35%,transparent)]"
            aria-label="追问"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className="grid size-10 flex-none place-items-center rounded-full bg-[var(--ink)] text-white" aria-label="停止">
              <Stop className="size-4" weight="fill" />
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} className={cn("grid size-10 flex-none place-items-center rounded-full bg-[var(--blue)] text-white transition-opacity", !draft.trim() && "opacity-40")} aria-label="发送">
              <ArrowUp className="size-4" weight="bold" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
