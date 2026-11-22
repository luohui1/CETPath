import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Lightbulb, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { db, type MethodRow } from "@/lib/db";
import { GENERAL, addMethod, removeMethod, updateMethod } from "@/lib/methods";
import { paperPath } from "@/lib/attempts";
import { useCachedLiveQuery } from "@/lib/live";
import { cn, timeAgo } from "@/lib/utils";
import { Button, EmptyState, LoadingBlock, PageHeader } from "@/components/ui";
import { MISTAKE_PAGES, WordsTabs } from "@/components/WordsTabs";
import { Markdown } from "@/components/Markdown";

const KIND_HINTS = ["细节", "推理", "主旨", "态度", "词义", "听力", "选词填空", "段落匹配", "翻译", "写作"];
const FROM: Record<MethodRow["from"], string> = { explain: "解析信号", agent: "Agent", mine: "自己写的" };

function MethodItem({ m }: { m: MethodRow }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.text);
  const [kind, setKind] = useState(m.kind ?? "");
  const save = async () => {
    if (!text.trim()) return;
    await updateMethod(m.id, { text: text.trim(), kind: kind.trim() || undefined });
    setEdit(false);
  };
  return (
    <li className="border-t border-[var(--line-soft)] py-3 first:border-0">
      {edit ? (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(8, Math.max(2, text.split("\n").length + 1))} className="w-full rounded-[9px] bg-white px-3 py-2 text-[14px] leading-[1.6] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]" />
          <div className="flex flex-wrap items-center gap-2">
            <input value={kind} onChange={(e) => setKind(e.target.value)} list="method-kinds" placeholder="题型（可不填）" className="h-9 w-36 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]" />
            <Button variant="primary" onClick={() => void save()} disabled={!text.trim()}>保存</Button>
            <Button onClick={() => { setText(m.text); setKind(m.kind ?? ""); setEdit(false); }}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-[14px] leading-[1.7] text-[var(--ink)]">
            {m.from === "agent" ? <Markdown text={m.text} /> : <p className="whitespace-pre-wrap">{m.text}</p>}
            <p className="mt-1 text-[12px] text-[var(--ink-500)]">
              {FROM[m.from]}
              {m.source && (
                <>
                  {" · "}
                  <Link to={m.source.questionId ? `${paperPath(m.source.paperId)}?focus=${m.source.questionId}` : paperPath(m.source.paperId)} className="hover:text-[var(--blue)] hover:underline">
                    {m.source.paperTitle}
                    {m.source.number ? ` 第 ${m.source.number} 题` : ""}
                  </Link>
                </>
              )}
              {" · "}
              {timeAgo(m.updatedAt)}
            </p>
          </div>
          <span className="flex flex-none items-center">
            <button type="button" onClick={() => setEdit(true)} aria-label="编辑" className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]">
              <PencilSimple className="size-4" />
            </button>
            <button type="button" onClick={() => void removeMethod(m.id)} aria-label="删除" className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--red-tint,#fdecec)] hover:text-[var(--red)]">
              <Trash className="size-4" />
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

export function MethodsPage() {
  const rows = useCachedLiveQuery("methods", () => db.methods.orderBy("updatedAt").reverse().toArray());
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState("");
  const kinds = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows ?? []) c.set(r.kind || GENERAL, (c.get(r.kind || GENERAL) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const groups = useMemo(() => {
    const g = new Map<string, MethodRow[]>();
    for (const r of rows ?? []) {
      const k = r.kind || GENERAL;
      if (filter && k !== filter) continue;
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return [...g];
  }, [rows, filter]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await addMethod({ text: draft, kind: draftKind || undefined, from: "mine" });
    setDraft("");
  };
  if (!rows) return <LoadingBlock />;
  return (
    <div>
      <WordsTabs pages={MISTAKE_PAGES} label="错题" />
      <PageHeader title="解题思路" desc="做题时攒下的方法：解析里的信号、Agent 讲的思路，或者自己总结的。按题型归在一起，考前翻一遍。" />
      <datalist id="method-kinds">
        {KIND_HINTS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <form onSubmit={add} className="card mb-6 space-y-2 p-4">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="写一条方法，比如：定位句里出现 however，答案往后看；举例前面的那句才是观点" className="w-full resize-y rounded-[9px] bg-white px-3 py-2 text-[14px] leading-[1.6] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]" />
        <div className="flex flex-wrap items-center gap-2">
          <input value={draftKind} onChange={(e) => setDraftKind(e.target.value)} list="method-kinds" placeholder="题型（可不填）" className="h-10 w-40 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]" />
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            <Plus className="size-[18px]" /> 收进思路库
          </Button>
        </div>
      </form>
      {!rows.length ? (
        <EmptyState icon={<Lightbulb className="size-[22px]" />} title="还没有收进思路" desc="解析里的「信号」旁边、Agent 回答下面都有「收进思路库」；在 Agent 回答里选中一段也能收。" />
      ) : (
        <>
          {kinds.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setFilter("")} className={cn("pill", !filter && "pill-on")}>全部 {rows.length}</button>
              {kinds.map(([k, n]) => (
                <button key={k} type="button" onClick={() => setFilter(filter === k ? "" : k)} className={cn("pill", filter === k && "pill-on")}>
                  {k} {n}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-5">
            {groups.map(([k, list]) => (
              <section key={k} className="card px-5 py-3">
                <h2 className="t-label pt-1 pb-1">{k}</h2>
                <ul>
                  {list.map((m) => (
                    <MethodItem key={m.id} m={m} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
