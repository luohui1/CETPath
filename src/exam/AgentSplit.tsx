import { useRef, type PointerEvent as RPointerEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft, Sparkle, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AgentPanel, type AgentThread } from "./AgentPanel";
import type { ToolEnv } from "@/lib/agentTools";

/**
 * 做题页的 Agent 分屏：横屏时卷面在左、Agent 在右（占停靠区那一栏，左边沿可拖宽窄），竖屏时在底部占一半。
 * 默认聊整套卷（看得到作答、对错、用时），从卷面问一句时切到那句。
 */
export function AgentSplit({
  side,
  width,
  inset,
  onWidth,
  enabled,
  thread,
  onBack,
  onClose,
  env,
}: {
  side: boolean;
  width: number;
  inset: number; // 矮横屏工具栏浮在上面时，和停靠区一样往下让
  onWidth: (w: number) => void;
  enabled: boolean;
  thread: AgentThread;
  onBack?: () => void;
  onClose: () => void;
  env?: ToolEnv;
}) {
  const self = useRef<HTMLElement>(null);
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
          className="group absolute inset-y-0 left-0 z-10 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
        >
          <span className="h-10 w-1 rounded-full bg-[var(--line)] transition-colors group-hover:bg-[var(--blue)]" />
        </div>
      )}
      <header className="flex h-12 flex-none items-center gap-2 border-b border-[var(--line-soft)] pr-2 pl-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)]"
          >
            <ArrowLeft className="size-3.5" /> 整套卷
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />{" "}
            Agent
          </span>
        )}
        <span className="flex-1" />
        <Link
          to="/ask"
          className="rounded-[8px] px-2 py-1 text-[13px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]"
        >
          全部对话
        </Link>
        <Link
          to="/settings#memory"
          className="rounded-[8px] px-2 py-1 text-[13px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]"
        >
          学习者档案
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭 Agent"
          className="grid size-8 place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)]"
        >
          <X className="size-4" />
        </button>
      </header>
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
