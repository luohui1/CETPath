import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash } from "@phosphor-icons/react";
import { db } from "@/lib/db";
import { sentenceKey } from "@/lib/trans";
import { cn } from "@/lib/utils";
import { AgentPanel, type AgentThread } from "@/exam/AgentPanel";
import { Button, PageHeader } from "@/components/ui";

/** AI 助教页：粘贴任意句子来问；左边是本机保存的历史对话（做题时"问 AI"的也在这里） */
export function AskPage() {
  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), []);
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [draft, setDraft] = useState("");

  const ask = () => {
    const sentence = draft.trim().replace(/\s+/g, " ");
    if (!sentence) return;
    setThread({ id: `${sentenceKey(sentence)}:`, ctx: { sentence } });
    setDraft("");
  };

  return (
    <div>
      <PageHeader title="AI 助教" desc="粘贴看不懂的英文句子，AI 结合你的长期记忆讲解，可以接着追问。做题时点“问 AI”的对话也保存在这里。" />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="card p-4">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
              }}
              rows={5}
              placeholder="粘贴一句英文，比如：What he said at the meeting, which surprised everyone, was that…"
              className="w-full resize-none rounded-[10px] bg-[var(--paper-100)] px-3 py-2.5 font-serif text-[15px] leading-[1.6] outline-none focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--blue)_35%,transparent)]"
              aria-label="要问的句子"
            />
            <Button variant="primary" className="mt-3 w-full" disabled={!draft.trim()} onClick={ask}>
              解析这句
            </Button>
          </div>
          <div className="card p-2">
            <div className="px-2.5 pt-2 pb-1.5 text-[13px] font-semibold text-[var(--ink-500)]">历史对话</div>
            {!chats?.length && <p className="px-2.5 pb-3 text-[13px] text-[var(--ink-500)]">还没有。问过的句子会存在这台设备上。</p>}
            {chats?.map((c) => (
              <div key={c.id} className={cn("group flex items-start gap-1 rounded-[10px] transition-colors hover:bg-[var(--fill-quiet)]", thread?.id === c.id && "bg-[var(--blue-tint)] hover:bg-[var(--blue-tint)]")}>
                <button type="button" onClick={() => setThread({ id: c.id, ctx: c.ctx })} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <p className="line-clamp-2 font-serif text-[14px] leading-[1.5] text-[var(--ink)]">{c.ctx.sentence}</p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--ink-500)]">
                    {[c.ctx.paper, c.ctx.word && `「${c.ctx.word}」`, `${Math.ceil(c.messages.length / 2)} 问`].filter(Boolean).join(" · ")}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void db.chats.delete(c.id);
                    if (thread?.id === c.id) setThread(null);
                  }}
                  className="mt-1.5 mr-1 grid size-8 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)] focus:opacity-100"
                  aria-label="删掉这段对话"
                >
                  <Trash className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="card flex h-[calc(100dvh-180px)] min-h-[480px] flex-col overflow-hidden">
          <AgentPanel thread={thread} />
        </div>
      </div>
    </div>
  );
}
