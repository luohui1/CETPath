import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft, Sparkle, X } from "@phosphor-icons/react";
import { AgentPanel, type AgentThread } from "./AgentPanel";

/** 做题页右下角的 Agent：收起是一个按钮，点开是悬浮对话窗；默认聊整套卷（看得到作答、对错、用时），从卷面问一句时切到那句 */
export function AgentFloat({ enabled, open, onOpen, thread, onBack, right }: { enabled: boolean; open: boolean; onOpen: (v: boolean) => void; thread: AgentThread; onBack?: () => void; right: number }) {
  // Esc 先收起对话窗（抢在卷面的 Esc 处理之前）
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
  if (!open)
    return (
      <button
        type="button"
        onClick={() => onOpen(true)}
        style={{ right }}
        className="fixed bottom-14 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--blue)] px-5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.35)] transition-transform hover:-translate-y-0.5"
      >
        <Sparkle className="size-5" weight="fill" /> Agent
      </button>
    );
  return (
    <div
      role="dialog"
      aria-label="Agent"
      style={{ right }}
      className="fixed bottom-14 z-40 flex h-[min(620px,calc(100dvh-140px))] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[16px] bg-white shadow-[0_16px_48px_rgba(28,35,48,0.22)] ring-1 ring-[var(--line)]"
    >
      <div className="flex h-11 flex-none items-center gap-2 border-b border-[var(--line-soft)] px-3">
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)]">
            <ArrowLeft className="size-3.5" /> 整套卷
          </button>
        )}
        <span className="flex flex-1 items-center gap-1.5 text-[14px] font-semibold">
          <Sparkle className="size-4 text-[var(--blue)]" weight="fill" /> Agent
        </span>
        <button type="button" onClick={() => onOpen(false)} aria-label="收起 Agent" className="grid size-8 place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--fill-quiet)]">
          <X className="size-4" />
        </button>
      </div>
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
  );
}
