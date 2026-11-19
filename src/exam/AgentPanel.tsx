import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowUp, Sparkle, Stop, Wrench } from "@phosphor-icons/react";
import { quizOf, runTool, type ToolEnv } from "@/lib/agentTools";
import { AgentQuiz } from "./AgentQuiz";
import { db } from "@/lib/db";
import {
  pickedModel,
  remember,
  setPickedModel,
  streamChat,
  useAgentEnabled,
  useAgentModels,
  type AgentContext,
  type ChatMsg,
} from "@/lib/agent";
import { cn } from "@/lib/utils";
import { EmptyState, Spinner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

/** 一次提问的对象：卷面上的一句（可带点的那个词） */
export type AgentThread = { id: string; ctx: AgentContext };

// 换标签、收起面板再打开，同一句的对话还在
const threads = new Map<string, ChatMsg[]>();
/** 删掉一段对话时连内存里的缓存一起清掉，不然同一句再问会把删掉的内容带回来 */
export const forgetThread = (id: string) => void threads.delete(id);

const QUICK = [
  "再讲简单点",
  "主干是哪几个词？",
  "这里为什么这样用？",
  "出一句类似的考考我",
];
// 一般备考问题（不针对某一句）的快捷追问
const QUICK_Q = ["再讲简单点", "举个真题里的例子", "给我出一道练习"];
// 复盘一套卷子的快捷追问
const QUICK_R = [
  "帮我复盘这套卷",
  "逐题讲讲我的错题",
  "哪类题最拖时间？",
  "给我一周的练习计划",
];
// 还没交卷时
const QUICK_P = [
  "我现在做得怎么样？",
  "这部分时间怎么分配？",
  "这类题有什么技巧？",
];

const firstAsk = (ctx: AgentContext) =>
  (ctx.review &&
    "帮我复盘这套卷子：错在哪、为什么错、哪类题花的时间多，接下来怎么练。") ||
  ctx.question ||
  (ctx.word
    ? `「${ctx.word}」在这句里是什么意思、起什么作用？顺便帮我理一下这句的结构。`
    : "这句我没看懂，帮我解析一下。");

/** inDock：做题页右侧面板里，多一个"去 AI 助教页"的链接 */
export function AgentPanel({
  thread,
  inDock,
  noAutoAsk,
  env,
}: {
  thread: AgentThread | null;
  inDock?: boolean;
  noAutoAsk?: boolean;
  env?: ToolEnv;
}) {
  const enabled = useAgentEnabled();
  const [msgs, setMsgs] = useState<ChatMsg[]>(() =>
    thread ? (threads.get(thread.id) ?? []) : [],
  );
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
    const base = [
      ...(threads.get(id) ?? []),
      { role: "user" as const, content: text.trim() },
    ];
    const ctx = thread.ctx;
    const put = (list: ChatMsg[], persist = false) => {
      threads.set(id, list);
      setMsgs(list);
      if (persist)
        void (list.length
          ? db.chats.put({ id, ctx, messages: list, updatedAt: Date.now() })
          : db.chats.delete(id));
    };
    put([...base, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      let list: ChatMsg[] = base;
      let answer = "";
      // 模型要用工具：在本机执行，把结果接回去再问，最多 4 轮
      for (let step = 0; step < 4; step++) {
        const cur = list;
        const r = await streamChat(
          cur,
          thread.ctx,
          (all) => put([...cur, { role: "assistant", content: all }]),
          ctl.signal,
          true,
        );
        if (r.text) answer = r.text;
        list = [
          ...cur,
          {
            role: "assistant",
            content: r.text,
            ...(r.calls.length ? { calls: r.calls } : {}),
          },
        ];
        if (!r.calls.length) break;
        for (const c of r.calls) {
          const res = await runTool(c.name, c.args, env ?? {});
          list = [
            ...list,
            {
              role: "tool",
              callId: c.id,
              label: res.label,
              content: res.result,
            },
          ];
        }
        put([...list, { role: "assistant", content: "" }]);
      }
      put(list, true);
      // 后台整理长期记忆：只看这一问一答，不拖慢下一次提问
      void remember(
        base.slice(-1).concat({ role: "assistant", content: answer }),
      ).then(
        (changed) => changed && setNoted(["已更新学习者档案"]),
        () => {},
      );
    } catch (e) {
      put(base.slice(0, -1));
      setDraft(text);
      if ((e as Error).name !== "AbortError")
        setError((e as Error).message || "出错了");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  // 第一次打开这句（本机也没有历史）：自动问一句
  useEffect(() => {
    if (
      !thread ||
      !enabled ||
      noAutoAsk ||
      asked.current === thread.id ||
      (threads.get(thread.id)?.length ?? 0) > 0
    )
      return;
    asked.current = thread.id;
    const id = thread.id;
    void db.chats.get(id).then((row) => {
      if (row?.messages.length || (threads.get(id)?.length ?? 0) > 0) return;
      void send(firstAsk(thread.ctx));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, enabled]);

  if (enabled === null)
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  if (!enabled)
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<Sparkle className="size-6" />}
          title="AI 助教还没开通"
          desc="管理员在后台（/admin）填好模型接口后就能用。"
        />
      </div>
    );
  if (!thread)
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<Sparkle className="size-6" />}
          title={
            inDock ? "点卷面上的词，再点“问 AI”" : "粘贴一句英文，或直接提问"
          }
          desc={
            inDock
              ? "也可以长按一句，在底部条上点“问 AI”。"
              : "比如粘贴阅读里看不懂的句子，或者问“六级翻译怎么拆长句”。"
          }
        />
      </div>
    );

  const word = thread.ctx.word;
  const quote = word
    ? thread.ctx.sentence
        .split(
          new RegExp(
            `(\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b)`,
            "i",
          ),
        )
        .map((p, i) =>
          i % 2 ? (
            <mark
              key={i}
              className="rounded-[3px] bg-[var(--blue-tint)] px-0.5 text-[var(--blue)]"
            >
              {p}
            </mark>
          ) : (
            p
          ),
        )
    : thread.ctx.sentence;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="px-4 pt-3">
        <div
          className={cn(
            "flex items-center gap-2 text-[13px] text-[var(--ink-500)]",
            inDock && "hidden",
          )}
        >
          {!inDock && (
            <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
          )}
          <span className="flex-1">
            {inDock ? "" : "AI 助教 · "}结合你的长期记忆讲解
          </span>
          {inDock && (
            <Link to="/ask" className="hover:text-[var(--ink)]">
              全部对话
            </Link>
          )}
          <Link to="/settings#memory" className="hover:text-[var(--ink)]">
            学习者档案
          </Link>
        </div>
        {thread.ctx.review && (
          <p className="flex items-center gap-1.5 text-[12px] text-[var(--ink-500)]">
            <span
              className={cn(
                "size-1.5 rounded-full",
                thread.ctx.reviewReady === false
                  ? "bg-[var(--ink-300,#c4c8d0)]"
                  : "bg-[var(--blue)]",
              )}
            />
            {thread.ctx.reviewReady === false
              ? "看得到整套卷和你的作答进度；交卷后还能看到对错和用时"
              : "看得到整套卷、你每题选了什么、对错和用时"}
          </p>
        )}
        {quote && (
          <blockquote className="mt-1 border-l-[3px] border-[var(--blue-line,#bcd3f5)] py-0.5 pl-3 font-serif text-[15px] leading-[1.6] text-[var(--ink-700)]">
            {quote}
          </blockquote>
        )}
      </div>

      <div className="flex-1 space-y-3 px-4 py-3" aria-live="polite">
        {inDock && msgs.length === 0 && !busy && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center">
            <Sparkle className="size-7 text-[var(--blue)]" weight="duotone" />
            <p className="text-[15px] font-semibold">问这套卷的任何问题</p>
            <p className="text-[13px] leading-[20px] text-[var(--ink-500)]">哪题怎么做、哪句看不懂、怎么分配时间都行；也能让它把词加进生词本、出几道同类题。</p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-[var(--blue-tint)] px-3 py-2 text-[14px] leading-[1.6] whitespace-pre-wrap text-[var(--ink)]"
            >
              {m.content}
            </div>
          ) : m.role === "tool" ? (
            <div
              key={i}
              className="flex items-center gap-1.5 text-[12px] text-[var(--ink-500)]"
            >
              <Wrench className="size-3.5" /> {m.label ?? "用了一个工具"}
            </div>
          ) : (
            <div key={i}>
              {m.content ? (
                <Markdown text={m.content} />
              ) : (
                !m.calls?.length && (
                  <span className="inline-flex items-center gap-2 text-[var(--ink-500)]">
                    <Spinner /> 在想…
                  </span>
                )
              )}
              {m.calls?.map((c) => {
                const quiz = c.name === "show_quiz" ? quizOf(c) : null;
                return quiz ? <AgentQuiz key={c.id} quiz={quiz} /> : null;
              })}
            </div>
          ),
        )}
        {error && (
          <p className="rounded-[10px] bg-[var(--red-tint,#fdecec)] px-3 py-2 text-[14px] text-[var(--red)]">
            {error}
          </p>
        )}
        {noted.length > 0 && !busy && (
          <p className="text-[12px] text-[var(--ink-500)]">
            {noted.join("；")}
          </p>
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 bg-[var(--surface,white)] px-3 pt-2 pb-3">
        {/* 快捷问题只在还没聊的时候出现，聊起来就让位给对话 */}
        <div
          className={cn(
            "mb-2 flex flex-wrap gap-1.5",
            msgs.length > 0 && "hidden",
          )}
        >
          {(thread.ctx.review
            ? thread.ctx.reviewReady === false
              ? QUICK_P
              : QUICK_R
            : thread.ctx.sentence
              ? QUICK
              : QUICK_Q
          ).map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void send(q)}
              className="pill disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="rounded-[12px] border border-[var(--line)] bg-white px-2.5 pt-2 pb-1.5 transition-colors focus-within:border-[color-mix(in_oklab,var(--blue)_55%,transparent)]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder="问点什么，Enter 发送"
            className="block max-h-32 min-h-6 w-full resize-none bg-transparent px-0.5 text-[14px] leading-6 outline-none focus-visible:outline-none"
            style={{ outline: "none" }}
            aria-label="追问"
          />
          <div className="flex items-center gap-2">
            <ModelPicker />
            <span className="flex-1" />
            {busy ? (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="grid size-7 flex-none place-items-center rounded-full bg-[var(--ink-700)] text-white"
                aria-label="停止"
              >
                <Stop className="size-3" weight="fill" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className={cn(
                  "grid size-7 flex-none place-items-center rounded-full bg-[var(--blue)] text-white transition-opacity",
                  !draft.trim() && "opacity-40",
                )}
                aria-label="发送"
              >
                <ArrowUp className="size-4" weight="bold" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** 输入框下面的模型下拉：后台设了几个可选模型就能切，选的记在本机 */
function ModelPicker() {
  const m = useAgentModels();
  const [v, setV] = useState(() => pickedModel() ?? "");
  if (!m?.default) return null;
  if (m.models.length < 2)
    return (
      <span className="max-w-[200px] truncate pl-1.5 text-[12px] text-[var(--ink-500)]">
        {m.default}
      </span>
    );
  const cur = m.models.includes(v) ? v : m.default;
  return (
    <select
      aria-label="模型"
      value={cur}
      onChange={(e) => {
        setV(e.target.value);
        setPickedModel(e.target.value);
      }}
      className="h-7 max-w-[200px] cursor-pointer truncate rounded-[7px] bg-transparent pr-1 pl-1.5 text-[12px] font-medium text-[var(--ink-500)] outline-none hover:bg-[var(--fill-quiet)] hover:text-[var(--ink-700)] focus:shadow-[0_0_0_2px_var(--blue)]"
    >
      {m.models.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
}
