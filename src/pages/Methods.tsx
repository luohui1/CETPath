import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CaretDown, Lightbulb, PencilSimple, Plus, Sparkle, SpeakerHigh, Trash, TreeStructure } from "@phosphor-icons/react";
import { db, type MethodRow } from "@/lib/db";
import { useAgentEnabled } from "@/lib/agent";
import { GENERAL, SYNTAX_KIND, addMethod, analyzeSentenceSyntax, isSentenceMethod, methodPaperHref, removeMethod, updateMethod } from "@/lib/methods";
import { speak } from "@/lib/speech";
import { looksLikeEnglishSentence } from "@/lib/syntax";
import { sentenceKey } from "@/lib/trans";
import { useCachedLiveQuery } from "@/lib/live";
import { cn, timeAgo } from "@/lib/utils";
import { Button, EmptyState, LoadingBlock, PageHeader, Segmented, Spinner } from "@/components/ui";
import { MISTAKE_PAGES, WordsTabs } from "@/components/WordsTabs";
import { Markdown } from "@/components/Markdown";
import { SyntaxBreakdown, SyntaxSentence } from "@/exam/SyntaxCard";

const KIND_HINTS = ["细节", "推理", "主旨", "态度", "词义", "听力", "选词填空", "段落匹配", "翻译", "写作", SYNTAX_KIND];
const FROM: Record<MethodRow["from"], string> = {
  explain: "解析",
  agent: "Agent",
  mine: "自己收的",
  syntax: "卷面长难句",
};

type ComposeMode = "method" | "sentence";

function rowCategory(r: MethodRow): string {
  return r.kind || (isSentenceMethod(r) ? SYNTAX_KIND : GENERAL);
}

function MethodItem({ m }: { m: MethodRow }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.text);
  const [kind, setKind] = useState(m.kind ?? "");
  const href = methodPaperHref(m);
  const save = async () => {
    if (!text.trim()) return;
    await updateMethod(m.id, { text: text.trim(), kind: kind.trim() || undefined });
    setEdit(false);
  };
  return (
    <li className="border-t border-[var(--line-soft)] py-3 first:border-0">
      {edit ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(8, Math.max(2, text.split("\n").length + 1))}
            className="w-full rounded-[9px] bg-white px-3 py-2 text-[14px] leading-[1.6] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              list="method-kinds"
              placeholder="题型（可不填）"
              className="h-9 w-36 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
            />
            <Button variant="primary" onClick={() => void save()} disabled={!text.trim()}>
              保存
            </Button>
            <Button
              onClick={() => {
                setText(m.text);
                setKind(m.kind ?? "");
                setEdit(false);
              }}
            >
              取消
            </Button>
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
                  {href ? (
                    <Link to={href} className="hover:text-[var(--blue)] hover:underline">
                      {m.source.paperTitle}
                      {m.source.number ? ` 第 ${m.source.number} 题` : ""}
                    </Link>
                  ) : (
                    <span>
                      {m.source.paperTitle}
                      {m.source.number ? ` 第 ${m.source.number} 题` : ""}
                    </span>
                  )}
                </>
              )}
              {" · "}
              {timeAgo(m.updatedAt)}
            </p>
          </div>
          <span className="flex flex-none items-center">
            <button
              type="button"
              onClick={() => {
                setText(m.text);
                setKind(m.kind ?? "");
                setEdit(true);
              }}
              aria-label="编辑"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]"
            >
              <PencilSimple className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void removeMethod(m.id)}
              aria-label="删除"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--red-tint,#fdecec)] hover:text-[var(--red)]"
            >
              <Trash className="size-4" />
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function SentenceMethodItem({ m, aiOn }: { m: MethodRow; aiOn: boolean | null }) {
  const sentence = m.sentence || m.text;
  const translation = m.translation || m.syntax?.zh || "";
  const initialNote = m.text && sentenceKey(m.text) !== sentenceKey(sentence) ? m.text : "";
  const [edit, setEdit] = useState(false);
  const [editSent, setEditSent] = useState(sentence);
  const [editTrans, setEditTrans] = useState(translation);
  const [editNote, setEditNote] = useState(initialNote);
  const [editKind, setEditKind] = useState(m.kind ?? SYNTAX_KIND);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [itemErr, setItemErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const href = methodPaperHref(m);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openEdit = () => {
    setEditSent(sentence);
    setEditTrans(translation);
    setEditNote(initialNote);
    setEditKind(m.kind ?? SYNTAX_KIND);
    setEdit(true);
  };

  const saveEdit = async () => {
    const nextSent = editSent.trim().replace(/\s+/g, " ");
    if (!nextSent) return;
    const sentChanged = sentenceKey(nextSent) !== sentenceKey(sentence);
    const nextTrans = editTrans.trim();
    const nextSyntax = sentChanged ? undefined : m.syntax ? { ...m.syntax, zh: nextTrans } : undefined;
    await updateMethod(m.id, {
      sentence: nextSent,
      translation: nextTrans || undefined,
      text: editNote.trim() || nextSent,
      kind: editKind.trim() || SYNTAX_KIND,
      syntax: nextSyntax,
    });
    setEdit(false);
  };

  const runAiBreakdown = async () => {
    if (aiBusy) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setAiBusy(true);
    setItemErr(null);
    try {
      const res = await analyzeSentenceSyntax(sentence, ctl.signal);
      const nextTrans = translation || res.translation;
      const pointsNote = res.syntax?.points?.length ? res.syntax.points.join("；") : "";
      await updateMethod(m.id, {
        ...(res.syntax ? { syntax: res.syntax } : {}),
        ...(nextTrans ? { translation: nextTrans } : {}),
        ...(!initialNote && pointsNote ? { text: pointsNote } : {}),
      });
      if (res.syntax) setDetailsOpen(true);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setItemErr(e instanceof Error ? e.message : "AI 拆解失败");
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setAiBusy(false);
    }
  };

  return (
    <li className="border-t border-[var(--line-soft)] py-3.5 first:border-0">
      {edit ? (
        <div className="space-y-2">
          <textarea
            value={editSent}
            onChange={(e) => setEditSent(e.target.value)}
            rows={Math.min(6, Math.max(2, Math.ceil(editSent.length / 72)))}
            placeholder="英文长难句原句"
            className="serif w-full rounded-[9px] bg-white px-3 py-2 text-[15px] leading-[1.65] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
          <textarea
            value={editTrans}
            onChange={(e) => setEditTrans(e.target.value)}
            rows={2}
            placeholder="中文译文（选填）"
            className="w-full rounded-[9px] bg-white px-3 py-2 text-[14px] leading-[1.6] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
          <input
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="拆解要点 / 语法难点（选填）"
            className="h-9 w-full rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={editKind}
              onChange={(e) => setEditKind(e.target.value)}
              list="method-kinds"
              placeholder="分类"
              className="h-9 w-36 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
            />
            <Button variant="primary" onClick={() => void saveEdit()} disabled={!editSent.trim()}>
              保存
            </Button>
            <Button onClick={() => setEdit(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {m.syntax ? (
              <SyntaxSentence key={`${m.id}:${m.updatedAt}`} e={m.syntax} />
            ) : (
              <p className="serif text-[16px] leading-[1.85] text-[var(--ink)]">{sentence}</p>
            )}

            {translation && (
              <p className="mt-2 rounded-[8px] bg-[#f6f9ff] px-3 py-2 text-[14px] leading-[1.7] text-[var(--ink-700)]">{translation}</p>
            )}

            {initialNote && (
              <p className="mt-2 flex items-start gap-2 text-[13px] leading-[1.65] text-[var(--ink-700)]">
                <span className="mt-[2px] flex-none rounded-[5px] bg-[var(--paper-200)] px-1.5 text-[11px] leading-[18px] font-medium text-[var(--ink-700)]">
                  要点
                </span>
                <span className="min-w-0 whitespace-pre-wrap">{initialNote}</span>
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {m.syntax ? (
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen}
                  className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium text-[var(--ink-700)] transition-colors hover:bg-[var(--paper-50)] hover:text-[var(--ink)]"
                >
                  <CaretDown className={cn("size-3.5 transition-transform duration-150", detailsOpen && "rotate-180")} />
                  {detailsOpen ? "收起结构拆解" : "展开结构拆解（主干 · 修饰成分 · 怎么拆）"}
                </button>
              ) : (
                aiOn && (
                  <button
                    type="button"
                    disabled={aiBusy}
                    onClick={() => void runAiBreakdown()}
                    className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--blue-tint)] px-3 text-[12px] font-medium text-[var(--blue)] transition-colors hover:bg-[color-mix(in_oklab,var(--blue)_18%,transparent)] disabled:opacity-60"
                  >
                    {aiBusy ? <Spinner className="size-3.5" /> : <Sparkle className="size-3.5" weight="fill" />}
                    {aiBusy ? "AI 拆解中…" : "AI 拆解结构"}
                  </button>
                )
              )}
              {itemErr && <span className="text-[12px] text-[var(--red)]">{itemErr}</span>}
            </div>

            {detailsOpen && m.syntax && (
              <div className="mt-2.5 divide-y divide-[var(--line-soft)] overflow-hidden rounded-[12px] border border-[var(--line-soft)] bg-white">
                <SyntaxBreakdown e={m.syntax} showTrans={false} />
              </div>
            )}

            <p className="mt-2 text-[12px] text-[var(--ink-500)]">
              {FROM[m.from]}
              {m.source && (
                <>
                  {" · "}
                  {href ? (
                    <Link to={href} className="hover:text-[var(--blue)] hover:underline">
                      {m.source.paperTitle}
                      {m.source.number ? ` 第 ${m.source.number} 题` : ""}
                    </Link>
                  ) : (
                    <span>
                      {m.source.paperTitle}
                      {m.source.number ? ` 第 ${m.source.number} 题` : ""}
                    </span>
                  )}
                </>
              )}
              {" · "}
              {timeAgo(m.updatedAt)}
            </p>
          </div>

          <span className="flex flex-none flex-wrap items-center">
            <button
              type="button"
              onClick={() => speak(sentence)}
              aria-label="朗读句子"
              title="朗读"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--paper-50)] hover:text-[var(--blue)]"
            >
              <SpeakerHigh className="size-4" />
            </button>
            <Link
              to={`/ask?q=${encodeURIComponent(sentence)}`}
              aria-label="在 AI 助教中深入提问"
              title="问 AI 助教"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue)]"
            >
              <Sparkle className="size-4" weight="fill" />
            </Link>
            <button
              type="button"
              onClick={openEdit}
              aria-label="编辑"
              title="编辑"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]"
            >
              <PencilSimple className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void removeMethod(m.id)}
              aria-label="删除"
              title="删除"
              className="inline-flex size-9 items-center justify-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--red-tint,#fdecec)] hover:text-[var(--red)]"
            >
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
  const aiOn = useAgentEnabled();
  const [composeMode, setComposeMode] = useState<ComposeMode>("method");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState("");

  const [sentDraft, setSentDraft] = useState("");
  const [transDraft, setTransDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const { syntaxCount, otherKinds } = useMemo(() => {
    const c = new Map<string, number>();
    let syn = 0;
    for (const r of rows ?? []) {
      const cat = rowCategory(r);
      if (cat === SYNTAX_KIND) syn++;
      else c.set(cat, (c.get(cat) ?? 0) + 1);
    }
    return { syntaxCount: syn, otherKinds: [...c].sort((a, b) => b[1] - a[1]) };
  }, [rows]);

  const shown =
    filter === SYNTAX_KIND || otherKinds.some(([k]) => k === filter)
      ? filter
      : "";

  const groups = useMemo(() => {
    const g = new Map<string, MethodRow[]>();
    for (const r of rows ?? []) {
      const k = rowCategory(r);
      if (shown && k !== shown) continue;
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return [...g];
  }, [rows, shown]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (composeMode === "sentence") {
      if (!sentDraft.trim() || aiBusy) return;
      await addMethod({
        sentence: sentDraft,
        translation: transDraft.trim() || undefined,
        text: noteDraft.trim() || undefined,
        kind: SYNTAX_KIND,
        from: "mine",
      });
      setSentDraft("");
      setTransDraft("");
      setNoteDraft("");
      setAiErr(null);
      return;
    }
    if (!draft.trim()) return;
    await addMethod({ text: draft, kind: draftKind || undefined, from: "mine" });
    setDraft("");
  };

  const saveWithAi = async () => {
    if (!sentDraft.trim() || aiBusy) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setAiBusy(true);
    setAiErr(null);
    try {
      const res = await analyzeSentenceSyntax(sentDraft, ctl.signal);
      await addMethod({
        sentence: sentDraft,
        translation: transDraft.trim() || res.translation,
        text: noteDraft.trim() || undefined,
        syntax: res.syntax ?? undefined,
        kind: SYNTAX_KIND,
        from: "agent",
      });
      setSentDraft("");
      setTransDraft("");
      setNoteDraft("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setAiErr(e instanceof Error ? e.message : "AI 拆解失败，可先直接收进思路库");
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setAiBusy(false);
    }
  };

  const switchToSentence = () => {
    setSentDraft(draft.trim());
    setDraft("");
    setComposeMode("sentence");
    setAiErr(null);
  };

  if (!rows) return <LoadingBlock />;

  const looksLikeSentence = composeMode === "method" && looksLikeEnglishSentence(draft, 8);

  return (
    <div>
      <WordsTabs pages={MISTAKE_PAGES} label="错题" />
      <PageHeader
        title="思路库"
        desc="做题攒下的解题方法与长难句：解析里的信号、卷面与 AI 拆解的长难句，或者自己总结的思路与句子。考前翻一遍。"
      />
      <datalist id="method-kinds">
        {KIND_HINTS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      <form onSubmit={add} className="card mb-6 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="添加类型"
            value={composeMode}
            onChange={(v) => {
              setComposeMode(v);
              setAiErr(null);
            }}
            options={[
              {
                value: "method",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Lightbulb className="size-4" />
                    解题方法
                  </span>
                ),
              },
              {
                value: "sentence",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <TreeStructure className="size-4" />
                    长难句
                  </span>
                ),
              },
            ]}
          />
          <span className="text-[12px] text-[var(--ink-500)]">
            {composeMode === "sentence"
              ? "自动按长难句归类，支持色块主干拆解与跟读"
              : "按题型归类，方便考前快速复盘"}
          </span>
        </div>

        {composeMode === "method" ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="写一条方法，比如：定位句里出现 however，答案往后看；举例前面的那句才是观点"
              className="w-full resize-y rounded-[9px] bg-white px-3 py-2 text-[14px] leading-[1.6] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
            />
            {looksLikeSentence && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] bg-[var(--blue-tint)] px-3 py-2 text-[13px] text-[var(--ink-700)]">
                <span>检测到这是一句英文长句，建议按长难句放入（可生成主干/从句色块拆解）</span>
                <button
                  type="button"
                  onClick={switchToSentence}
                  className="font-semibold text-[var(--blue)] hover:underline"
                >
                  切换为「长难句」放入 →
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value)}
                list="method-kinds"
                placeholder="题型（可不填）"
                className="h-10 w-40 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
              />
              <Button type="submit" variant="primary" disabled={!draft.trim()}>
                <Plus className="size-[18px]" /> 收进思路库
              </Button>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={sentDraft}
              onChange={(e) => {
                setSentDraft(e.target.value);
                if (aiErr) setAiErr(null);
              }}
              rows={3}
              placeholder="粘贴或输入一句英文长难句（如阅读、翻译或外刊里卡住的句子）…"
              className="serif w-full resize-y rounded-[9px] bg-white px-3 py-2 text-[15px] leading-[1.65] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={transDraft}
                onChange={(e) => setTransDraft(e.target.value)}
                placeholder="中文译文（选填，点右侧 AI 拆解可自动生成）"
                className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
              />
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="拆解要点 / 语法难点（选填，如：定语从句修饰先行词）"
                className="h-10 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
              />
            </div>
            {aiErr && (
              <p className="rounded-[9px] bg-[var(--red-tint,#fdecec)] px-3 py-2 text-[13px] text-[var(--red)]">{aiErr}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={!sentDraft.trim() || aiBusy}>
                <Plus className="size-[18px]" /> 收进思路库
              </Button>
              {aiOn && (
                <Button
                  type="button"
                  loading={aiBusy}
                  disabled={!sentDraft.trim() || aiBusy}
                  onClick={() => void saveWithAi()}
                >
                  {!aiBusy && <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />}
                  {aiBusy ? "正在拆解主干与从句…" : "AI 拆解并收入"}
                </Button>
              )}
            </div>
          </>
        )}
      </form>

      {!rows.length ? (
        <EmptyState
          icon={<Lightbulb className="size-[22px]" />}
          title="还没有收进思路或长难句"
          desc="你可以在上方直接记录方法或粘贴长难句；做题时在解析「信号」、长按长难句、查词「译整句」和 AI 助教里也能一键收进思路库。"
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setFilter("")} className={cn("pill", !shown && "pill-on")}>
              全部 {rows.length}
            </button>
            <button
              type="button"
              onClick={() => {
                if (shown === SYNTAX_KIND) setFilter("");
                else {
                  setFilter(SYNTAX_KIND);
                  setComposeMode("sentence");
                }
              }}
              className={cn("pill", shown === SYNTAX_KIND && "pill-on")}
            >
              {SYNTAX_KIND} {syntaxCount}
            </button>
            {otherKinds.map(([k, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(shown === k ? "" : k)}
                className={cn("pill", shown === k && "pill-on")}
              >
                {k} {n}
              </button>
            ))}
          </div>

          {!groups.length ? (
            <EmptyState
              icon={<TreeStructure className="size-[22px]" />}
              title="还没有收进长难句"
              desc="直接在上方切换到「长难句」粘贴句子（支持 AI 自动标出主干与从句），或在做题长按句子、查词「译整句」、AI 结构图旁点「收进思路库」。"
            />
          ) : (
            <div className="space-y-5">
              {groups.map(([k, list]) => (
                <section key={k} className="card px-5 py-3">
                  <h2 className="t-label pt-1 pb-1">{k}</h2>
                  <ul>
                    {list.map((m) =>
                      isSentenceMethod(m) ? (
                        <SentenceMethodItem key={m.id} m={m} aiOn={aiOn} />
                      ) : (
                        <MethodItem key={m.id} m={m} />
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
