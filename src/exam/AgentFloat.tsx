import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft, CaretRight, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AgentPanel, type AgentThread } from "./AgentPanel";

/**
 * 做题页的 Agent：贴在屏幕最右边、竖直居中。收起时是一个竖着的小标签，点开从右边滑出对话栏，左边沿的 › 再收起。
 * 默认聊整套卷（看得到作答、对错、用时），从卷面问一句时切到那句。
 */
export function AgentFloat({ enabled, open, onOpen, thread, onBack }: { enabled: boolean; open: boolean; onOpen: (v: boolean) => void; thread: AgentThread; onBack?: () => void }) {
  // Esc 先收起（抢在卷面的 Esc 处理之前）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpen]);
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(true)}
        aria-label="打开 Agent"
        aria-expanded={open}
        className={cn(
          "fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-[12px] bg-[var(--blue)] px-2 py-3.5 text-white shadow-[0_6px_20px_rgba(37,99,235,0.35)] transition-[transform,opacity] duration-200 ease-out hover:pr-3",
          open && "pointer-events-none translate-x-full opacity-0",
        )}
      >
        <Sparkle className="size-4" weight="fill" />
        <span className="text-[13px] font-semibold tracking-[0.12em] [writing-mode:vertical-rl]">Agent</span>
      </button>
      <aside
        aria-label="Agent"
        inert={!open}
        className={cn(
          "fixed top-1/2 right-0 z-40 flex h-[min(760px,calc(100dvh-96px))] w-[420px] max-w-[calc(100vw-24px)] -translate-y-1/2 flex-col rounded-l-[16px] bg-white shadow-[0_16px_48px_rgba(28,35,48,0.22)] ring-1 ring-[var(--line)] transition-transform duration-200 ease-out",
          !open && "translate-x-[calc(100%+12px)]",
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(false)}
          aria-label="收起 Agent"
          className="absolute top-1/2 -left-6 grid h-14 w-6 -translate-y-1/2 place-items-center rounded-l-[10px] bg-white text-[var(--ink-500)] shadow-[-4px_0_12px_rgba(28,35,48,0.10)] ring-1 ring-[var(--line)] hover:text-[var(--blue)]"
        >
          <CaretRight className="size-4" weight="bold" />
        </button>
        <div className="flex h-11 flex-none items-center gap-2 border-b border-[var(--line-soft)] px-3">
          {onBack && (
            <button type="button" onClick={onBack} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)]">
              <ArrowLeft className="size-3.5" /> 整套卷
            </button>
          )}
          <span className="flex flex-1 items-center gap-1.5 text-[14px] font-semibold">
            <Sparkle className="size-4 text-[var(--blue)]" weight="fill" /> Agent
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-bl-[16px]">
          {enabled ? (
            <AgentPanel key={thread.id} thread={thread} inDock noAutoAsk={thread.id.startsWith("paper:")} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-[15px] font-semibold">还没设置模型</p>
              <p className="text-[13px] leading-[21px] text-[var(--ink-500)]">在设置页“Agent 模型”里填接口地址、模型名和 API Key，保存后回到这里就能用。</p>
              <Link to="/settings#agent" className="inline-flex h-9 items-center rounded-[9px] bg-[var(--blue)] px-4 text-[14px] font-medium text-white">
                去设置
              </Link>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
