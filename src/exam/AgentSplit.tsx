import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CaretDown,
  ChatsCircle,
  IdentificationCard,
  NotePencil,
  Trash,
  X,
} from "@phosphor-icons/react";
import { db, type ChatRow } from "@/lib/db";
import { cn } from "@/lib/utils";
import { AgentPanel, forgetThread, type AgentThread } from "./AgentPanel";
import type { ToolEnv } from "@/lib/agentTools";

const when = (t: number) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
    : `${d.getMonth() + 1}/${d.getDate()}`;
};
const titleOf = (c: ChatRow) => {
  const first = c.messages.find((m) => m.role === "user")?.content ?? "";
  return (c.ctx.sentence ? `“${c.ctx.sentence}”` : first || "新对话")
    .replace(/\s+/g, " ")
    .slice(0, 40);
};

/**
 * 做题页的 Agent 分屏：横屏时卷面在左、Agent 在右（占停靠区那一栏，左边沿可拖宽窄），竖屏时在底部占一半。
 * 一套卷可以有多个会话：顶栏标题点开是这套卷的会话列表，右边“新对话”。整卷会话看得到作答、对错、用时；
 * 从卷面问一句时（sentence）切到那句的会话。
 */
export function AgentSplit({
  side,
  width,
  inset,
  onWidth,
  enabled,
  paperThread,
  sentence,
  onClearSentence,
  onClose,
  env,
}: {
  side: boolean;
  width: number;
  inset: number; // 矮横屏工具栏浮在上面时，和停靠区一样往下让
  onWidth: (w: number) => void;
  enabled: boolean;
  paperThread: AgentThread;
  sentence: AgentThread | null;
  onClearSentence: () => void;
  onClose: () => void;
  env?: ToolEnv;
}) {
  const self = useRef<HTMLElement>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const title = paperThread.ctx.paper;
  const chats = useLiveQuery(
    async () =>
      (await db.chats.where("updatedAt").above(0).reverse().toArray()).filter(
        (c) => c.ctx.paper === title,
      ),
    [title],
  );
  // 从卷面问一句：切到那句的会话
  useEffect(() => {
    if (sentence) setSid(null);
  }, [sentence]);
  const prefix = paperThread.id;
  const picked = sid ? chats?.find((c) => c.id === sid) : undefined;
  // 当前会话：卷面上刚问的那句 > 列表里选的 > 这套卷最近的整卷会话 > 新的整卷会话
  const thread: AgentThread = sentence
    ? sentence
    : sid
      ? sid.startsWith("paper:") // 整卷会话总用最新的作答数据（交卷后前缀会变，旧会话也要看到对错和用时）
        ? { id: sid, ctx: paperThread.ctx }
        : { id: sid, ctx: picked?.ctx ?? paperThread.ctx }
      : {
          id: chats?.find((c) => c.id.startsWith(prefix))?.id ?? prefix,
          ctx: paperThread.ctx,
        };
  const current = chats?.find((c) => c.id === thread.id);
  const heading = sentence
    ? `“${sentence.ctx.sentence.slice(0, 40)}”`
    : current
      ? titleOf(current)
      : "新对话";

  const fresh = () => {
    onClearSentence();
    setSid(`${prefix}#${Date.now()}`);
    setListOpen(false);
  };
  const pick = (id: string) => {
    onClearSentence();
    setSid(id);
    setListOpen(false);
  };

  // 拖的时候直接改宽度，松手才让卷面重排
  const onGrip = (e: RPointerEvent<HTMLDivElement>) => {
    const el = self.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const right = el.getBoundingClientRect().right;
    let w = el.offsetWidth;
    const move = (ev: PointerEvent) => {
      w = Math.round(
        Math.min(
          Math.min(860, innerWidth * 0.6),
          Math.max(320, right - ev.clientX),
        ),
      );
      el.style.width = `${w}px`;
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      onWidth(w);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const icon =
    "grid size-8 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]";
  return (
    <aside
      ref={self}
      aria-label="Agent"
      className={cn(
        "gr-wb-panel no-print relative flex shrink-0 flex-col overflow-hidden",
        !side && "h-[55%]",
      )}
      style={side ? { width, marginTop: inset } : undefined}
    >
      {side && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整宽度"
          onPointerDown={onGrip}
          className="group absolute inset-y-0 left-0 z-20 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
        >
          <span className="h-10 w-1 rounded-full bg-[var(--line)] transition-colors group-hover:bg-[var(--blue)]" />
        </div>
      )}
      <header className="relative z-10 flex h-11 flex-none items-center gap-1 border-b border-[var(--line-soft)] pr-1.5 pl-3">
        <button
          type="button"
          onClick={() => setListOpen(!listOpen)}
          aria-expanded={listOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-left hover:bg-[var(--fill-quiet)]"
        >
          <span className="truncate text-[14px] font-semibold">{heading}</span>
          <CaretDown
            className={cn(
              "size-3.5 flex-none text-[var(--ink-500)] transition-transform",
              listOpen && "rotate-180",
            )}
            weight="bold"
          />
        </button>
        <button
          type="button"
          onClick={fresh}
          title="新对话"
          aria-label="新对话"
          className={icon}
        >
          <NotePencil className="size-[18px]" />
        </button>
        <Link
          to="/settings#memory"
          title="学习者档案"
          aria-label="学习者档案"
          className={icon}
        >
          <IdentificationCard className="size-[18px]" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          title="关闭"
          aria-label="关闭 Agent"
          className={icon}
        >
          <X className="size-[18px]" />
        </button>
        {listOpen && (
          <div className="absolute inset-x-2 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-[12px] bg-white p-1 shadow-[0_12px_32px_rgba(28,35,48,0.16)] ring-1 ring-[var(--line)]">
            <button
              type="button"
              onClick={fresh}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-[13px] font-medium text-[var(--blue)] hover:bg-[var(--blue-tint)]"
            >
              <NotePencil className="size-4" /> 新对话
            </button>
            {chats?.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 hover:bg-[var(--fill-quiet)]",
                  c.id === thread.id && "bg-[var(--fill-quiet)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => pick(c.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px]">
                    {titleOf(c)}
                  </span>
                  <span className="text-[11px] text-[var(--ink-500)]">
                    {c.ctx.sentence ? "句子" : "整套卷"} · {when(c.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void db.chats.delete(c.id);
                    forgetThread(c.id);
                    if (c.id === thread.id) fresh();
                  }}
                  aria-label="删掉这个对话"
                  className="grid size-7 flex-none place-items-center rounded-[6px] text-[var(--ink-500)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)]"
                >
                  <Trash className="size-3.5" />
                </button>
              </div>
            ))}
            <Link
              to="/ask"
              className="flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-[12px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)]"
            >
              <ChatsCircle className="size-4" /> 全部对话
            </Link>
          </div>
        )}
      </header>
      {listOpen && (
        <div
          className="absolute inset-0 z-[5]"
          onClick={() => setListOpen(false)}
        />
      )}
      {enabled ? (
        <AgentPanel
          env={env}
          key={thread.id}
          thread={thread}
          inDock
          noAutoAsk={thread.id.startsWith("paper:")}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-[15px] font-semibold">还没设置模型</p>
          <p className="text-[13px] leading-[21px] text-[var(--ink-500)]">
            在设置页“Agent 模型”里填接口地址、模型名和 API
            Key，保存后回到这里就能用。
          </p>
          <Link
            to="/settings#agent"
            className="inline-flex h-9 items-center rounded-[9px] bg-[var(--blue)] px-4 text-[14px] font-medium text-white"
          >
            去设置
          </Link>
        </div>
      )}
    </aside>
  );
}
