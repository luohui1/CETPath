import { useMemo, useState, type FormEvent } from "react";
import { sourceHref } from "@/lib/articles";
import { Link, useSearchParams } from "react-router";
import { BookBookmark, Brain, CaretDown, DownloadSimple, MagnifyingGlass, Plus, Printer, SpeakerHigh, Trash } from "@phosphor-icons/react";
import { db, type CardRow, type VocabItem } from "@/lib/db";
import { lookup, phonetic, shortTranslation, translationLines } from "@/lib/dict";
import { addToVocab, isMastered, removeFromVocab, State, STATE_LABELS } from "@/lib/learning";
import { useEntries } from "@/lib/useEntries";
import { lookupOnline } from "@/lib/youdao";
import { speak } from "@/lib/speech";
import { cn, downloadText, fromNow, timeAgo } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, EmptyState, LoadingBlock, PageHeader, Segmented } from "@/components/ui";

import { DefinitionLines } from "@/components/WordPopover";
import { HighlightSentence } from "@/components/HighlightSentence";

type Sort = "recent" | "alpha" | "due";

/** 记忆状态的小标签：纸底墨字；已掌握墨底白字，待复习荧光黄 */
function StatusBadge({ card }: { card?: CardRow }) {
  if (!card) return null;
  if (isMastered(card)) return <span className="tag-paper bg-[var(--ink)] text-white">已掌握</span>;
  if (card.state === State.New) return <span className="tag-paper">未学</span>;
  const due = card.due <= Date.now();
  return <span className={cn("tag-paper", due && "bg-[var(--mark)] text-[var(--ink)]")}>{due ? "待复习" : `${STATE_LABELS[card.state]} · ${fromNow(card.due)}`}</span>;
}

/** 概况里的一格：标签、衬线大数字、一句说明 */
function Tile({ label, value, unit, note }: { label: string; value: string; unit?: string; note: string }) {
  return (
    <div className="card flex flex-col p-5 lg:p-6">
      <div className="t-label">{label}</div>
      <div className="num mt-1.5 text-[32px] leading-9">
        {value}
        {unit && <span className="ml-0.5 font-[family-name:var(--font-sans)] text-[13px] font-normal text-[var(--ink-500)]">{unit}</span>}
      </div>
      <div className="mt-1.5 truncate text-[13px] text-[var(--ink-500)]">{note}</div>
    </div>
  );
}

function csvCell(s: string) {
  return `"${s.replace(/"/g, '""')}"`;
}

export function VocabPage() {
  const [params, setParams] = useSearchParams();
  const items = useCachedLiveQuery("vocab-items", () => db.vocab.orderBy("addedAt").reverse().toArray());
  const cards = useCachedLiveQuery("vocab-cards", () => db.cards.where("origin").equals("vocab").toArray());
  const cardMap = useMemo(() => new Map((cards ?? []).map((c) => [c.word, c])), [cards]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const paperFilter = params.get("paper") ?? "";

  const papers = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items ?? []) for (const s of it.sources) m.set(s.paperId, s.paperTitle);
    return [...m];
  }, [items]);

  const list = useMemo(() => {
    let l: VocabItem[] = items ?? [];
    if (paperFilter) l = l.filter((it) => it.sources.some((s) => s.paperId === paperFilter));
    const q = query.trim().toLowerCase();
    if (q) l = l.filter((it) => it.word.includes(q));
    if (sort === "alpha") l = [...l].sort((a, b) => a.word.localeCompare(b.word));
    if (sort === "due") l = [...l].sort((a, b) => (cardMap.get(a.word)?.due ?? Infinity) - (cardMap.get(b.word)?.due ?? Infinity));
    return l;
  }, [items, paperFilter, query, sort, cardMap]);

  const entries = useEntries(list.map((it) => it.word));
  const dueCount = (cards ?? []).filter((c) => c.due <= Date.now()).length;
  const todayStart = new Date().setHours(0, 0, 0, 0);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const w = adding.trim();
    if (!w) return;
    const r = /\s/.test(w) ? null : await lookup(w);
    if (!r) {
      // 离线词典没有的词和短语也加：在线查到释义就随词存下，查不到先只存词
      const key = w.toLowerCase().replace(/\s+/g, " ");
      const online = await lookupOnline(w);
      await addToVocab(key, undefined, online?.entry);
      setAddMsg(online ? `已加入 ${key}` : `已加入 ${key}（没查到释义）`);
      setAdding("");
      return;
    }
    await addToVocab(r.lemma);
    setAddMsg(r.lemma === w.toLowerCase() ? `已加入 ${r.lemma}` : `已加入原形 ${r.lemma}`);
    setAdding("");
  };

  const exportCsv = () => {
    const rows = [["单词", "音标", "释义", "出处", "加入时间", "状态"]];
    for (const it of list) {
      const e = entries.get(it.word);
      const c = cardMap.get(it.word);
      rows.push([
        it.word,
        e?.p ?? "",
        e ? translationLines(e).join("；") : "",
        it.sources.map((s) => `${s.paperTitle}：${s.sentence}`).join(" | "),
        new Date(it.addedAt).toLocaleString("zh-CN"),
        c ? (isMastered(c) ? "已掌握" : STATE_LABELS[c.state]) : "",
      ]);
    }
    downloadText(`英语之道-生词本-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  };

  if (!items) return <LoadingBlock />;

  return (
    <div>
      <WordsTabs />
      <PageHeader
        title="生词本"
        desc={`共 ${items.length} 个词${dueCount ? ` · ${dueCount} 个待复习` : ""}。在真题里查过并加入的词，都会带上出处原句。`}
        actions={
          <>
            <Link to="/review">
              <Button variant="primary" disabled={!items.length}>
                <Brain className="size-[18px]" /> 背生词
              </Button>
            </Link>
            <Button onClick={exportCsv} disabled={!list.length}>
              <DownloadSimple className="size-[18px]" /> 导出 CSV
            </Button>
            <Button onClick={() => print()} disabled={!list.length} className="hidden sm:inline-flex">
              <Printer className="size-[18px]" /> 打印
            </Button>
          </>
        }
      />

      {/* 概况：总数、本周新增、掌握情况、出处最多的试卷 */}
      {items.length > 0 && (
        <div className="no-print mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          {(() => {
            const week = Date.now() - 7 * 86_400_000;
            const sources = new Map<string, number>();
            for (const it of items) for (const src of it.sources) sources.set(src.paperTitle, (sources.get(src.paperTitle) ?? 0) + 1);
            const top = [...sources.entries()].sort((a, b) => b[1] - a[1])[0];
            const mastered = (cards ?? []).filter(isMastered).length;
            return (
              <>
                <Tile label="生词" value={`${items.length}`} unit="个" note={`本周新增 ${items.filter((it) => it.addedAt >= week).length} 个`} />
                <Tile label="待复习" value={`${dueCount}`} unit="个" note={dueCount ? "去背生词清掉它们" : "都复习过了"} />
                <Tile label="已掌握" value={`${mastered}`} unit="个" note={`占 ${Math.round((mastered / items.length) * 100)}%`} />
                <Tile label="出处最多" value={top ? `${top[1]}` : "—"} unit={top ? "个" : ""} note={top ? top[0] : "查词时会记下出处"} />
              </>
            );
          })()}
        </div>
      )}

      <div className="no-print mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[9px] bg-white px-3 shadow-[var(--elev-1)] focus-within:shadow-[0_0_0_2px_var(--blue)]">
          <MagnifyingGlass className="size-[18px] text-[var(--ink-500)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索生词" className="w-full bg-transparent text-[14px] outline-none" />
        </label>
        <select
          value={paperFilter}
          onChange={(e) => setParams(e.target.value ? { paper: e.target.value } : {}, { replace: true })}
          className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
        >
          <option value="">全部出处</option>
          {papers.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "recent", label: "最近添加" },
            { value: "alpha", label: "字母" },
            { value: "due", label: "复习时间" },
          ]}
        />
      </div>

      <form onSubmit={add} className="no-print mb-6 flex items-center gap-2">
        <input
          value={adding}
          onChange={(e) => {
            setAdding(e.target.value);
            setAddMsg(null);
          }}
          placeholder="手动添加单词，如 resilient"
          className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)] w-full max-w-xs"
        />
        <Button type="submit" disabled={!adding.trim()}>
          <Plus className="size-[18px]" /> 添加
        </Button>
        {addMsg && <span className="text-[14px] text-[var(--ink-500)]">{addMsg}</span>}
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={<BookBookmark className="size-[22px]" />}
          title="生词本还是空的"
          desc="去做一套真题，点击不认识的单词，再点「加入生词本」。"
          action={
            <Link to="/papers">
              <Button variant="primary">去真题训练</Button>
            </Link>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState title="没有符合条件的词" />
      ) : (
        <div className="card divide-y divide-[var(--line-soft)] overflow-hidden">
          {list.map((it) => {
            const e = entries.get(it.word);
            const expanded = open === it.word;
            const fresh = it.addedAt >= todayStart;
            return (
              <div key={it.word} className="relative">
                {/* 今天刚加的：左边一道荧光黄 */}
                {fresh && <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--mark)]" aria-label="今天加入" />}
                <div className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(expanded ? null : it.word)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="serif text-[19px] font-semibold">{e?.w ?? it.word}</span>
                        {e && phonetic(e) && <span className="font-[family-name:var(--font-mono)] text-[13px] text-[var(--ink-500)]">{phonetic(e)}</span>}
                      </div>
                      <div className="truncate text-[13px] text-[var(--ink-700)]">{e ? shortTranslation(e) : e === null ? "（词典里没有释义）" : "…"}</div>
                    </div>
                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                      <StatusBadge card={cardMap.get(it.word)} />
                      <span className="text-[13px] text-[var(--ink-500)]">
                        {it.sources.length ? `${it.sources.length} 处出处 · ` : ""}
                        {timeAgo(it.addedAt)}
                      </span>
                    </div>
                    <CaretDown className={cn("no-print size-4 shrink-0 text-[var(--ink-500)] transition", expanded && "rotate-180")} />
                  </button>
                  <Button size="icon" variant="ghost" className="no-print" onClick={() => speak(it.word)} aria-label="发音">
                    <SpeakerHigh className="size-[18px]" />
                  </Button>
                </div>
                {expanded && (
                  <div className="space-y-4 bg-[var(--paper-50)] px-4 pt-3 pb-4">
                    <div className="sm:hidden">
                      <StatusBadge card={cardMap.get(it.word)} />
                    </div>
                    {e && <DefinitionLines lines={translationLines(e)} />}
                    {it.sources.length > 0 && (
                      <div className="space-y-2">
                        <div className="tag-paper">真题出处</div>
                        {it.sources.map((s, i) => (
                          <div key={i} className="card px-3.5 py-2.5">
                            <HighlightSentence sentence={s.sentence} word={it.word} className="serif text-[15px] leading-relaxed" />
                            <Link to={sourceHref(s.paperId)} className="mt-1 block text-[13px] text-[var(--blue)] hover:underline">
                              {s.paperTitle}
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="no-print flex justify-end">
                      <Button size="sm" variant="danger" onClick={() => removeFromVocab(it.word)}>
                        <Trash className="size-4" /> 移出生词本
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
