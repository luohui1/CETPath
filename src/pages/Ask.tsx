import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUp, NotePencil, Trash } from "@phosphor-icons/react";
import { db } from "@/lib/db";
import { sentenceKey } from "@/lib/trans";
import { cn } from "@/lib/utils";
import { AgentPanel, forgetThread, type AgentThread } from "@/exam/AgentPanel";

const SUGGEST = ["六级翻译怎么拆长句？", "仔细阅读的推理题怎么做？", "听力总是跟不上怎么办？", "帮我制定一周的四级复习计划"];

/** AI 助教页：像 ChatGPT 一样，左边是历史对话，右边是对话；没开对话时中间一个输入框 */
export function AskPage() {
  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), []);
  const [thread, setThread] = useState<AgentThread | null>(null);
  const [draft, setDraft] = useState("");
  // 删掉再问同一句时换一个新的对话面板（它记着"这句已经自动问过"）
  const [gen, setGen] = useState(0);

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
    setGen((g) => g + 1);
  };

  const history = (
    <div className="space-y-0.5">
      {chats?.map((c) => (
        <div key={c.id} className={cn("group flex items-center rounded-[10px] transition-colors hover:bg-[var(--fill-quiet)]", thread?.id === c.id && "bg-[var(--fill-quiet)]")}>
          <button type="button" onClick={() => setThread({ id: c.id, ctx: c.ctx })} className="min-w-0 flex-1 px-3 py-2 text-left">
            <p className="truncate text-[14px] text-[var(--ink)]">{c.ctx.sentence || c.ctx.question || `复盘 · ${c.ctx.paper ?? ""}`}</p>
            <p className="truncate text-[12px] text-[var(--ink-500)]">{[c.ctx.paper, `${Math.ceil(c.messages.length / 2)} 问`].filter(Boolean).join(" · ")}</p>
          </button>
          <button
            type="button"
            onClick={() => {
              forgetThread(c.id);
              void db.chats.delete(c.id);
              if (thread?.id === c.id) fresh();
            }}
            className="mr-1 grid size-8 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] opacity-0 group-hover:opacity-100 hover:text-[var(--red)] focus-visible:opacity-100 pointer-coarse:opacity-100"
            aria-label="删掉这段对话"
          >
            <Trash className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="card flex h-[calc(100dvh-112px)] min-h-[520px] overflow-hidden">
      <aside className="hidden w-[260px] flex-none flex-col border-r border-[var(--line)] bg-[var(--paper-100)] lg:flex">
        <div className="p-2.5">
          <button type="button" onClick={fresh} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-[var(--ink)] hover:bg-[var(--fill-quiet)]">
            <NotePencil className="size-[18px]" />
            新对话
          </button>
        </div>
        <div className="px-4 pb-1 text-[12px] font-medium text-[var(--ink-500)]">历史对话</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          {chats?.length ? history : <p className="px-3 py-2 text-[13px] text-[var(--ink-500)]">问过的会存在这台设备上。</p>}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {thread ? (
          <>
            <div className="flex h-12 flex-none items-center justify-between border-b border-[var(--line)] px-4">
              <p className="min-w-0 truncate text-[14px] font-medium text-[var(--ink)]">{thread.ctx.sentence || thread.ctx.question || "复盘"}</p>
              <button type="button" onClick={fresh} className="flex flex-none items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)] lg:hidden">
                <NotePencil className="size-4" />
                新对话
              </button>
            </div>
            <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col">
              <AgentPanel key={gen} thread={thread} />
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5">
            <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center py-10">
              <h1 className="text-center text-[26px] font-semibold tracking-tight text-[var(--ink)]">今天想弄懂什么？</h1>
              <div className="mt-6 rounded-[22px] border border-[var(--line)] bg-white p-2 shadow-[0_6px_24px_-12px_rgba(0,0,0,0.18)] focus-within:border-[var(--ink-300)]">
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
                  className="block w-full resize-none bg-transparent px-3 pt-2 outline-none focus-visible:outline-none text-[16px] leading-[1.6] outline-none placeholder:text-[var(--ink-500)]"
                  aria-label="要问的内容"
                />
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[12px] text-[var(--ink-500)]">{draft.trim() && !/[\u4e00-\u9fff]/.test(draft) ? "英文句子会按长难句来讲" : "Enter 发送，Shift + Enter 换行"}</span>
                  <button
                    type="button"
                    disabled={!draft.trim()}
                    onClick={() => ask()}
                    className="grid size-9 place-items-center rounded-full bg-[var(--ink)] text-white transition-opacity disabled:opacity-25"
                    aria-label="发送"
                  >
                    <ArrowUp className="size-[18px]" weight="bold" />
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGEST.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-[13px] text-[var(--ink-700)] transition-colors hover:bg-[var(--fill-quiet)]">
                    {s}
                  </button>
                ))}
              </div>
              {!!chats?.length && (
                <div className="mt-10 lg:hidden">
                  <div className="px-3 pb-1 text-[12px] font-medium text-[var(--ink-500)]">历史对话</div>
                  {history}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
