import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowCounterClockwise, BookBookmark, BookmarkSimple, ChatText, Lightbulb, NotePencil, NoteBlank, Receipt, SpeakerHigh, Trash, X } from "@phosphor-icons/react";
import * as G from "@/grasso";
import { db, type AttemptMode, type AttemptRow } from "@/lib/db";
import { updateAttempt } from "@/lib/attempts";
import { phonetic, translationLines } from "@/lib/dict";
import { SenseLine } from "@/components/WordPopover";
import { removeFromVocab } from "@/lib/learning";
import { kindName, type Paper, type Question, type Section } from "@/lib/papers";
import { colorValue, isMarker, markBounds, NOTE_COLOR, type MarkHistory, type MarkRow } from "@/lib/marks";
import { speak } from "@/lib/speech";
import { useEntries } from "@/lib/useEntries";
import { clock, countText } from "@/lib/report";
import { cn, formatDuration } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";
import { Tip } from "@/components/overlay";
import { Explanation, ExplanationCard } from "./Explanation";
import type { Answers } from "./PaperPages";

type Filter = "all" | "wrong" | "skipped" | "flagged";

/**
 * 答题卡：一张简单的纸。顶上已答 N/M（交卷后是得分）和筛选；下面按部分分组的题号网格，
 * 格子只写题号（有用时的下面一行小字），状态靠底色：未答白、已答浅蓝；交卷后对浅蓝、错浅红、没答灰；标记是右上角一个小点。
 * 练习模式做一题判一题，对错实时显示。点格子跳到卷面上的题。平板（浮动面板）每行 6 格，格子 44px 好点
 */
function AnswerSheet({
  paper,
  attempt,
  mode,
  answers,
  flags,
  submitted,
  justSubmitted,
  times,
  limits,
  cols,
  onJump,
  onSubmit,
  onRedo,
  onExplain,
  onReport,
}: {
  paper: Paper;
  attempt?: AttemptRow;
  mode: AttemptMode;
  answers: Answers;
  flags: Set<string>;
  submitted: boolean;
  justSubmitted?: boolean;
  times: Record<string, number> | null;
  limits: Record<string, number>;
  cols: 6 | "fill"; // 侧栏：每行 6 个大格子；底部抽屉（整屏宽）：能放几个放几个
  onJump: (q: Question) => void;
  onSubmit: () => void;
  onRedo: () => void;
  onExplain: () => void;
  onReport: () => void;
}) {
  const practice = mode === "practice";
  const choice = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).filter((q) => q.options?.length);
  const answered = choice.filter((q) => answers[q.id]).length;
  const isWrong = (q: Question) => !!answers[q.id] && answers[q.id] !== q.answer;
  // 判过的：交卷了，或者练习模式里做过的
  const judged = (q: Question) => submitted || (practice && !!answers[q.id]);

  // 可以只看没答的、标记了的；交卷后还能只看错题
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => setFilter("all"), [submitted]);
  const keep = (q: Question) =>
    !!q.options?.length && (filter === "all" || (filter === "wrong" ? isWrong(q) : filter === "flagged" ? flags.has(q.id) : !answers[q.id]));
  const filters: { value: Filter; label: string; n?: number }[] = [
    { value: "all", label: "全部" },
    { value: "skipped", label: "未答", n: choice.length - answered },
    { value: "flagged", label: "标记", n: choice.filter((q) => flags.has(q.id)).length },
    ...(submitted || practice ? [{ value: "wrong" as const, label: "错题", n: choice.filter(isWrong).length }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {choice.length > 0 && (
        <div className="border-b border-[var(--line)] px-4 pt-4 pb-3">
          {/* 刚交卷：分数像盖章一样按下去 */}
          <div className="flex items-center gap-2">
            <div className={cn("flex items-baseline gap-2", submitted && justSubmitted && "stamp-in [--stamp-rot:0deg]")}>
              <span className="text-[14px] text-[var(--ink-700)]">{submitted ? "得分" : practice ? "答对" : "已答"}</span>
              <span className="num text-[28px] leading-8">
                {submitted ? (attempt?.score ?? 0) : practice ? choice.filter((q) => answers[q.id] === q.answer).length : answered}
                <span className="text-[15px] text-[var(--ink-500)]"> / {submitted ? (attempt?.total ?? choice.length) : practice ? answered : choice.length}</span>
              </span>
            </div>
            {submitted && (
              <button type="button" onClick={onReport} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--blue)] hover:bg-[var(--blue-tint)]">
                <Receipt className="size-4" /> 交卷单
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="筛选题目">
            {filters.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)} className={cn("pill h-8 px-3 text-[13px]", filter === f.value && "pill-on")}>
                {f.label}
                {f.n !== undefined && <span className="num">{f.n}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-4">
        {!choice.length && <p className="text-[14px] leading-6 text-[var(--ink-700)]">这套只有写作和翻译，在「作答」里写。</p>}
        {filter !== "all" && !choice.some(keep) && <p className="py-8 text-center text-[14px] text-[var(--ink-500)]">{filter === "wrong" ? "没有答错的题" : filter === "flagged" ? "没有标记的题" : "每道题都答了"}</p>}
        {paper.sections.map((s) => {
          const all = s.groups.flatMap((g) => g.questions).filter((q) => q.options?.length);
          const qs = all.filter(keep);
          if (!qs.length) return null;
          // 小标题用中文题型名和题号范围（"听力 1–25"），同一种题型有两个部分时再带上原卷的小节名
          const twin = paper.sections.filter((x) => x.kind === s.kind).length > 1;
          return (
            <section key={s.id}>
              <h3 className="mb-2 flex items-baseline gap-2 truncate text-[14px] font-semibold text-[var(--ink)]">
                {kindName(s.kind, paper.exam)}
                {twin && s.subtitle && <span className="font-normal text-[var(--ink-500)]">{s.subtitle}</span>}
                <span className="num font-normal text-[var(--ink-500)]">
                  {all[0].number}–{all[all.length - 1].number}
                </span>
              </h3>
              <div className={cn("grid gap-2", cols === 6 ? "grid-cols-6" : "grid-cols-[repeat(auto-fill,minmax(56px,1fr))]")}>
                {qs.map((q) => {
                  const a = answers[q.id];
                  const tone = !judged(q)
                    ? a
                      ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                      : "bg-white text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)]"
                    : !a
                      ? "bg-[var(--paper-200)] text-[var(--ink-500)]"
                      : a === q.answer
                        ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                        : "bg-[var(--red-tint)] text-[var(--red)]";
                  const sec = times?.[q.id];
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => onJump(q)}
                      aria-label={`第 ${q.number} 题${a ? `，选了 ${a}` : "，没答"}${flags.has(q.id) ? "，已标记" : ""}${sec ? `，用时 ${clock(sec)}` : ""}`}
                      className={cn("num relative flex h-11 w-full flex-col items-center justify-center rounded-[6px] text-[14px] leading-4 transition-colors duration-[120ms]", tone)}
                    >
                      {q.number}
                      {/* 用时小字：和卷面上一样 11px，超过建议时长是红的；判过之后格子底色已经说了对错，用时不再标红 */}
                      {sec && sec >= 1 ? (
                        <span className={cn("mt-px text-[11px] leading-3 font-medium", !judged(q) && sec > (limits[q.id] ?? Infinity) ? "text-[var(--red)]" : "text-[var(--ink-500)]")}>{clock(sec)}</span>
                      ) : null}
                      {flags.has(q.id) && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--mark-ink)]" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex gap-2 border-t border-[var(--line)] p-3">
        {submitted ? (
          <>
            {choice.length > 0 && (
              <Button size="sm" variant="primary" className="flex-1" onClick={onExplain}>
                <Lightbulb className="size-4" /> 看解析
              </Button>
            )}
            <Tip label="复习本卷生词">
              <Link to={`/vocab?paper=${paper.id}`}>
                <Button size="sm">
                  <BookBookmark className="size-4" /> 生词
                </Button>
              </Link>
            </Tip>
            <Button size="sm" onClick={onRedo}>
              <ArrowCounterClockwise className="size-4" /> 重做
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" className="w-full" onClick={onSubmit}>
            {practice ? "结束练习" : "交卷"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** 解析里的一道选择题，一题一张纸：头一行是题号（对错着色）、答案、你选了什么、卷面；下面是结论、原文、展开 */
function ExplainCard({ q, chosen, onJump }: { q: Question; chosen?: string; onJump: () => void }) {
  const right = chosen === q.answer;
  return (
    <div className="card px-4 pt-3 pb-2">
      <ExplanationCard
        q={q}
        mine={chosen ?? null}
        title={
          <span
            className={cn(
              "num flex h-7 min-w-8 items-center justify-center rounded-full px-2 text-[14px] font-semibold",
              right ? "bg-[var(--ink)] text-white" : chosen ? "bg-[var(--red-tint)] text-[var(--red)]" : "bg-[var(--paper-200)] text-[var(--ink-700)]",
            )}
          >
            {q.number}
          </span>
        }
        action={
          <button type="button" onClick={onJump} className="h-8 rounded-full px-2.5 text-[13px] font-medium text-[var(--blue)] hover:bg-[var(--blue-tint)]">
            卷面
          </button>
        }
      />
    </div>
  );
}

/** 解析：交卷后逐题看对错和解析，默认只看错题和没答的；每篇文章后面可以展开全文翻译 */
function ExplainPanel({ paper, answers, elapsed, onJump }: { paper: Paper; answers: Answers; elapsed: number; onJump: (q: Question) => void }) {
  const choice = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).filter((q) => q.options?.length);
  const missed = choice.filter((q) => answers[q.id] !== q.answer);
  const [filter, setFilter] = useState<"missed" | "all">(missed.length ? "missed" : "all");
  const keep = (q: Question) => !!q.options?.length && (filter === "all" || answers[q.id] !== q.answer);
  const aiCount = choice.filter((q) => q.explanationBy === "ai").length;
  const wrong = choice.filter((q) => answers[q.id] && answers[q.id] !== q.answer).length;
  const skipped = choice.filter((q) => !answers[q.id]).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--line)] px-4 pt-3.5 pb-3">
        <div className="flex items-baseline gap-4 text-[13px] text-[var(--ink-500)]">
          <span>
            错题 <span className={cn("num text-[20px]", wrong ? "text-[var(--red)]" : "text-[var(--ink)]")}>{wrong}</span>
          </span>
          <span>
            未答 <span className="num text-[20px] text-[var(--ink)]">{skipped}</span>
          </span>
          <span className="ml-auto">
            用时 <span className="num text-[15px] text-[var(--ink)]">{formatDuration(elapsed)}</span>
          </span>
        </div>
        <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="解析范围">
          {(
            [
              ["missed", "错题和未答", missed.length],
              ["all", "全部", choice.length],
            ] as const
          ).map(([v, label, n]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)} className={cn("pill h-8 px-3 text-[12px]", filter === v && "pill-on")}>
              {label} <span className="num">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pt-3 pb-4">
        {filter === "missed" && !missed.length && <p className="py-8 text-center text-[13px] text-[var(--ink-500)]">全部答对了，切到「全部」可以看每道题的解析。</p>}
        {paper.sections.map((s) => {
          const groups = s.groups.map((g) => ({ g, qs: g.questions.filter(keep) })).filter((x) => x.qs.length);
          if (!groups.length) return null;
          return (
            <section key={s.id} className="space-y-2.5">
              <h3 className="flex items-baseline gap-2 px-1 text-[14px] font-semibold text-[var(--ink)]">
                {kindName(s.kind, paper.exam)}
                {paper.sections.filter((x) => x.kind === s.kind).length > 1 && s.subtitle && <span className="font-normal text-[var(--ink-500)]">{s.subtitle}</span>}
              </h3>
              {groups.map(({ g, qs }) => (
                <div key={g.id} className="space-y-2">
                  {g.title && <div className="px-1 text-[13px] text-[var(--ink-500)]">{g.title}</div>}
                  {qs.map((q) => (
                    <ExplainCard key={q.id} q={q} chosen={answers[q.id]} onJump={() => onJump(q)} />
                  ))}
                  {g.translation && (
                    <details className="well px-3 py-2">
                      <summary className="flex min-h-8 cursor-pointer items-center text-[13px] font-semibold text-[var(--ink-700)] select-none">全文翻译</summary>
                      <p className="mt-2 text-[13px] leading-[1.75] whitespace-pre-line text-text">{g.translation}</p>
                    </details>
                  )}
                </div>
              ))}
            </section>
          );
        })}
        <p className="text-[13px] leading-5 text-[var(--ink-500)]">
          解析整理自各套真题的官方解析{aiCount ? `；其中 ${aiCount} 题官方解析缺失或残缺，由 AI 补写，标了「AI 解析」，仅供参考` : ""}。写作和翻译的参考范文在「作答」里。
        </p>
      </div>
    </div>
  );
}

function PaperVocab({ paper }: { paper: Paper }) {
  const items = useLiveQuery(() => db.vocab.filter((v) => v.sources.some((s) => s.paperId === paper.id)).toArray(), [paper.id]);
  const list = useMemo(() => [...(items ?? [])].sort((a, b) => b.addedAt - a.addedAt), [items]);
  const entries = useEntries(list.map((v) => v.word));
  if (!list.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center">
        <EmptyState icon={<BookmarkSimple className="size-[22px]" />} title="还没有生词" desc="在卷面上点单词，加入生词本的词会出现在这里，并记下它在这套卷子里的原句。" />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {list.map((v) => {
        const e = entries.get(v.word);
        return (
          <div key={v.word} className="group flex items-start gap-1 rounded-[10px] px-2.5 py-2 hover:bg-[var(--fill-quiet)]">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="serif text-[16px] font-semibold">{e?.w ?? v.word}</span>
                {e && phonetic(e) && <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-500)]">{phonetic(e)}</span>}
              </div>
              {e && <SenseLine lines={translationLines(e)} className="mt-0.5" />}
            </div>
            <button type="button" onClick={() => speak(v.word)} className="gr-iconbtn size-8 opacity-0 group-hover:opacity-100 touch-show" aria-label="发音">
              <SpeakerHigh className="size-4" />
            </button>
            <button type="button" onClick={() => removeFromVocab(v.word)} className="gr-iconbtn size-8 opacity-0 group-hover:opacity-100 touch-show hover:text-danger" aria-label="移出生词本">
              <Trash className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 建议字数：优先从题目要求里读（"about 100 words""160-200 words"），读不到按题型 */
function target(q: Question) {
  const range = q.stem?.match(/(\d+)\s*[-–~]\s*(\d+)\s*words/i);
  if (range) return `${range[1]}–${range[2]} 词`;
  const about = q.stem?.match(/about\s+(\d+)\s*words/i);
  if (about) return `约 ${about[1]} 词`;
  return q.label === "作文" ? "120–180 词" : "";
}

function AnswerBox({
  q,
  name,
  kind,
  value,
  submitted,
  attemptKey,
  focus,
  onJump,
  onFocus,
}: {
  q: Question;
  kind: Section["kind"];
  value: string;
  name: string; // 题目那一行的名字："写作""翻译"，或一部分里有几道时的题号
  submitted: boolean;
  attemptKey: string; // 作答记录的键（专项训练是"试卷#部分"）
  focus: number;
  onJump: () => void;
  onFocus: () => void;
}) {
  const [text, setText] = useState(value);
  const [more, setMore] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  // 从卷面点进来：滚到这道题并聚焦
  useEffect(() => {
    if (!focus) return;
    box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (!submitted) input.current?.focus({ preventScroll: true });
  }, [focus, submitted]);

  const save = (v: string) => updateAttempt(attemptKey, (a) => (a.texts[q.id] = v));
  const writing = kind === "writing";
  const goal = target(q);
  const count = countText(text);

  return (
    <div ref={box} className="scroll-mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Tip label="在卷面上看这道题">
          <button type="button" onClick={onJump} className="flex h-8 items-center gap-1 rounded-full pr-2.5 pl-0.5 text-[15px] font-semibold text-[var(--ink)] transition hover:text-[var(--blue)]">
            {name}
          </button>
        </Tip>
        {goal && <span className="text-[13px] text-[var(--ink-500)]">建议 {goal}</span>}
        <span className="num ml-auto text-[13px] text-[var(--ink-500)]">
          <span className="text-text">{count[0]}</span> {count[1]}
        </span>
      </div>
      {q.stem && (
        <button type="button" onClick={() => setMore(!more)} className={cn("mb-2 block w-full text-left font-serif text-[13px] leading-5 whitespace-pre-line text-muted", !more && "line-clamp-3")} title={more ? "收起" : "展开全文"}>
          {q.stem}
        </button>
      )}
      <textarea
        ref={input}
        value={text}
        disabled={submitted}
        placeholder={writing ? "开始写作…" : "写下你的译文…"}
        onFocus={onFocus}
        onChange={(e) => {
          setText(e.target.value);
          clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => save(v), 500);
        }}
        onBlur={() => {
          clearTimeout(timer.current);
          if (text !== value) void save(text);
        }}
        // 随内容长高
        className={cn("gr-input gr-textarea h-auto w-full resize-none font-serif text-[14px] leading-6 [field-sizing:content]", writing ? "min-h-48" : "min-h-20")}
      />
      {submitted && (q.reference || q.explanation || q.explain) && (
        <div className="well mt-2 space-y-2 px-3.5 py-3">
          {q.reference && (
            <div>
              <div className="tag-paper mb-1.5">{writing ? "参考范文" : "参考译文"}</div>
              <p className="font-serif text-[13.5px] leading-6 whitespace-pre-line">{q.reference}</p>
            </div>
          )}
          {q.explain ? (
            <ExplanationCard q={q} className="border-t border-[var(--line-soft)] pt-2" />
          ) : (
            q.explanation && <Explanation text={q.explanation} by={q.explanationBy} className="border-t border-[var(--line-soft)] pt-2" />
          )}
        </div>
      )}
    </div>
  );
}

/** 作答：所有翻译、写作题放在一起，按卷面顺序 */
function WritePanel({
  paper,
  attemptKey,
  texts,
  submitted,
  focus,
  onJump,
  onFocus,
}: {
  paper: Paper;
  attemptKey: string;
  texts: Answers;
  submitted: boolean;
  focus: { id: string; n: number } | null;
  onJump: (q: Question) => void;
  onFocus: (q: Question) => void;
}) {
  const sections = paper.sections.map((s) => ({ s, qs: s.groups.flatMap((g) => g.questions).filter((q) => !q.options?.length) })).filter((x) => x.qs.length);
  const done = sections.reduce((n, x) => n + x.qs.filter((q) => texts[q.id]?.trim()).length, 0);
  const total = sections.reduce((n, x) => n + x.qs.length, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 pb-1">
        <G.Progress value={done} max={total} label="已写" format={(v, max) => `${v} / ${max}`} />
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pt-3 pb-4">
        {sections.map(({ s, qs }) => (
          <section key={s.id}>
            {/* 这一部分只有一道题（四六级的写作、翻译）：题目那一行就写"写作""翻译"，不再另起一个标题 */}
            {qs.length > 1 && <h3 className="mb-2.5 px-0.5 text-[14px] font-semibold text-[var(--ink)]">{kindName(s.kind, paper.exam)}</h3>}
            <div className="space-y-5">
              {qs.map((q) => (
                <AnswerBox
                  key={q.id}
                  q={q}
                  name={qs.length > 1 ? (q.label ?? String(q.number)) : kindName(s.kind, paper.exam)}
                  kind={s.kind}
                  value={texts[q.id] ?? ""}
                  submitted={submitted}
                  attemptKey={attemptKey}
                  focus={focus?.id === q.id ? focus.n : 0}
                  onJump={() => onJump(q)}
                  onFocus={() => onFocus(q)}
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-[13px] text-[var(--ink-500)]">{submitted ? "已交卷，可以对照参考答案。" : "自动保存。交卷后显示参考答案。"}</p>
      </div>
    </div>
  );
}

/** 笔记面板里的一条：高亮、下划线（可加批注）或便签。点了跳到卷面 */
function NoteItem({ m, history, onJump }: { m: MarkRow; history: MarkHistory; onJump: () => void }) {
  const [editing, setEditing] = useState(false);
  const commentable = m.kind !== "note";
  return (
    <div className="group flex items-start gap-1 rounded-[10px] px-2 py-2 hover:bg-[var(--fill-quiet)]">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onJump} className="block w-full text-left">
          {m.kind === "note" ? (
            <span className="flex items-start gap-2 text-[14px] leading-6">
              <span className="mt-1 flex size-4 flex-none items-center justify-center rounded-[4px] text-white" style={{ background: NOTE_COLOR }}>
                <NoteBlank className="size-2.5" weight="bold" />
              </span>
              <span className="line-clamp-4 whitespace-pre-line">{m.note}</span>
            </span>
          ) : (
            <span className="line-clamp-3 font-serif text-[15px] leading-6">
              <span
                style={
                  m.kind === "highlight"
                    ? { background: `${colorValue(m.color)}b3`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
                    : { textDecoration: `underline ${colorValue(m.color)} 1.5px`, textUnderlineOffset: 3 }
                }
              >
                {m.text}
              </span>
            </span>
          )}
        </button>
        {commentable && editing ? (
          <textarea
            autoFocus
            defaultValue={m.note ?? ""}
            rows={2}
            placeholder="写批注…"
            onBlur={(e) => {
              setEditing(false);
              const v = e.target.value.trim();
              if (v !== (m.note ?? "")) void history.update(m, { note: v || undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) e.currentTarget.blur();
            }}
            className="gr-input gr-textarea mt-1.5 h-auto w-full resize-none text-[13px] leading-5 [field-sizing:content]"
          />
        ) : (
          commentable &&
          m.note && (
            <button type="button" onClick={() => setEditing(true)} className="mt-1.5 block w-full rounded-[8px] bg-[var(--star-tint)] px-2.5 py-1.5 text-left text-[13px] leading-5 whitespace-pre-line text-text" title="改批注">
              {m.note}
            </button>
          )
        )}
      </div>
      {commentable && !m.note && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="gr-iconbtn size-6 flex-none opacity-0 group-hover:opacity-100 touch-show hover:text-primary focus-visible:opacity-100 pointer-coarse:-my-2" aria-label="加批注" title="加批注">
          <ChatText className="size-3.5" />
        </button>
      )}
      <RemoveButton onClick={() => history.remove([m])} />
    </div>
  );
}

function RemoveButton({ onClick, label = "删除" }: { onClick: () => void; label?: string }) {
  return (
    // 触屏上按钮放大到 40px：往上提 8px，和第一行字的中线对齐
    <button type="button" onClick={onClick} className="gr-iconbtn size-6 flex-none opacity-0 group-hover:opacity-100 touch-show hover:text-danger focus-visible:opacity-100 pointer-coarse:-my-2" aria-label={label} title={label}>
      <Trash className="size-3.5" />
    </button>
  );
}

/** 笔记：本卷的高亮、下划线、便签和手写，按页和位置排好，点了跳到卷面 */
function NotesPanel({ marks, history, onJumpMark, onClear }: { marks: MarkRow[]; history: MarkHistory; onJumpMark: (m: MarkRow) => void; onClear: () => void }) {
  const pages = useMemo(() => {
    const map = new Map<number, MarkRow[]>();
    for (const m of [...marks].sort((a, b) => a.page - b.page || markBounds(a)[1] - markBounds(b)[1])) {
      if (!map.has(m.page)) map.set(m.page, []);
      map.get(m.page)!.push(m);
    }
    return [...map.entries()];
  }, [marks]);

  if (!marks.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center">
        <EmptyState icon={<NotePencil className="size-[22px]" />} title="还没有笔记" desc="用工具栏里的笔、高亮、下划线和便签在卷面上做笔记，都会汇总在这里。" />
      </div>
    );
  }

  const count = (k: MarkRow["kind"]) => marks.filter((m) => m.kind === k).length;
  const summary = (
    [
      ["高亮", count("highlight")],
      ["下划线", count("underline")],
      ["便签", count("note")],
      ["手写", count("pen")],
    ] as const
  ).filter(([, n]) => n);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3.5 pt-3 pb-1 text-[14px] text-[var(--ink-700)]">{summary.map(([k, n]) => `${k} ${n}`).join(" · ")}</p>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1.5 pt-2 pb-3">
        {pages.map(([page, ms]) => {
          // 手写和荧光笔色带（没有原文）都算在"手写"这一行里
          const pens = ms.filter((m) => m.kind === "pen" || isMarker(m));
          return (
            <section key={page}>
              <h3 className="mb-1 px-2 text-[13px] font-semibold text-[var(--ink-500)]">第 {page} 页</h3>
              {ms
                .filter((m) => m.kind !== "pen" && !isMarker(m))
                .map((m) => (
                  <NoteItem key={m.id} m={m} history={history} onJump={() => onJumpMark(m)} />
                ))}
              {pens.length > 0 && (
                <div className="group flex items-center gap-1 rounded-[10px] px-2 py-1.5 hover:bg-[var(--fill-quiet)]">
                  <button type="button" onClick={() => onJumpMark(pens[0])} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[14px] text-[var(--ink-700)]">
                    <span className="flex -space-x-1">
                      {[...new Set(pens.map((m) => m.color))].map((c) => (
                        <span key={c} className="size-2.5 rounded-full ring-2 ring-white" style={{ background: colorValue(c) }} />
                      ))}
                    </span>
                    手写 {pens.length} 笔
                  </button>
                  <RemoveButton onClick={() => history.remove(pens)} label="清除本页手写" />
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--fill-quiet)] px-3 py-1.5 text-[13px] text-[var(--ink-500)]">
        {/* 键盘提示只给有键盘的（平板上看不到） */}
        <span className="pointer-coarse:invisible">
          <G.Kbd>Ctrl</G.Kbd> <G.Kbd>Z</G.Kbd> 撤销
        </span>
        <button type="button" onClick={onClear} className="h-9 rounded-full px-2.5 hover:bg-[var(--red-tint)] hover:text-danger">
          清空本卷笔记
        </button>
      </div>
    </div>
  );
}

/** 停靠区的标签；temp 是竖屏底部抽屉开着时临时出现的"查词""解析 N""译句"（底部条的内容放进抽屉） */
export type DockTab = "sheet" | "listen" | "explain" | "write" | "notes" | "vocab";
export type DockView = DockTab | "temp";

export const DOCK_WIDTH = 360; // 横屏右侧停靠栏的宽
/** 竖屏底部抽屉的三个停留高度：占"卷面 + 抽屉"这一块的比例 */
export const DRAWER_SNAPS = [0.4, 0.7, 0.92];
const DRAWER_MIN = 160; // 抽屉最矮
const PAPER_MIN = 128; // 抽屉拉到最高也给卷面留这么多（工具栏一行和一点卷面），含上面的 8px 间距

/**
 * 停靠区：所有"面板"放在这一个地方，同一时间只开一个标签——答题卡、原文（有录音的卷）、解析（交卷后）、作答（点开过作文翻译才有）、
 * 笔记、生词。和卷面并排、不盖在卷面上：
 *  - side（横屏，或宽 ≥ 1100）：右侧一栏，宽 360，把卷面挤窄；
 *  - drawer（竖屏、宽 < 1100）：听力条上面的底部抽屉，顶上一个把手，停在 40% / 70% / 92%，拖到底收起。
 * 原文标签的内容由听力条画（它管着录音），这里只给一个放内容的格子（listenSlot）。
 */
export function Dock({
  layout,
  view,
  onView,
  onClose,
  temp,
  showWrite,
  listenSlot,
  snap,
  onSnap,
  inset = 0,
  paper,
  attempt,
  answers,
  texts,
  submitted,
  elapsed,
  vocabCount,
  justSubmitted,
  flags,
  marks,
  history,
  focusWrite,
  onJump,
  onJumpMark,
  onClearMarks,
  onSubmit,
  onRedo,
  onReport,
  onWriteFocus,
  mode,
  attemptKey,
  times,
  limits,
}: {
  layout: "side" | "drawer";
  view: DockView;
  onView: (t: DockView) => void;
  onClose: () => void;
  /** 竖屏抽屉里临时的标签：标签上的字和内容 */
  temp?: { label: string; body: ReactNode } | null;
  showWrite: boolean; // 点开过作文、翻译：多一个"作答"
  listenSlot: (el: HTMLDivElement | null) => void;
  snap: number; // 抽屉停在哪一档
  onSnap: (f: number | null) => void; // 拖完停到哪一档；null 是拖到底收起
  inset?: number; // 侧栏顶上让出的高度（矮屏横屏时工具栏浮在上面）
  paper: Paper;
  attempt?: AttemptRow;
  answers: Answers;
  texts: Answers;
  submitted: boolean;
  elapsed: number;
  vocabCount: number;
  justSubmitted?: boolean;
  flags: Set<string>;
  marks: MarkRow[];
  history: MarkHistory;
  focusWrite: { id: string; n: number } | null;
  onJump: (q: Question) => void;
  onJumpMark: (m: MarkRow) => void;
  onClearMarks: () => void;
  onSubmit: () => void;
  onRedo: () => void;
  onReport: () => void;
  onWriteFocus: (q: Question) => void;
  mode: AttemptMode;
  attemptKey: string;
  times: Record<string, number> | null;
  limits: Record<string, number>;
}) {
  const hasWrites = paper.sections.some((s) => s.groups.some((g) => g.questions.some((q) => !q.options?.length)));
  // 解析交卷后才有（只有写作翻译的卷没有）；重做后回到答题卡
  const hasChoice = paper.sections.some((s) => s.groups.some((g) => g.questions.some((q) => q.options?.length)));
  const canExplain = submitted && hasChoice;
  const shown: DockView =
    view === "temp"
      ? temp
        ? "temp"
        : "sheet"
      : (view === "explain" && !canExplain) || (view === "listen" && !paper.audio) || (view === "write" && !hasWrites)
        ? "sheet"
        : view;
  const tabs = [
    { value: "sheet", label: "答题卡" },
    ...(paper.audio ? [{ value: "listen", label: "原文" }] : []),
    ...(canExplain ? [{ value: "explain", label: "解析" }] : []),
    ...(hasWrites && (showWrite || !hasChoice || shown === "write") ? [{ value: "write", label: "作答" }] : []),
    { value: "notes", label: marks.length ? `笔记 ${marks.length}` : "笔记" },
    { value: "vocab", label: vocabCount ? `生词 ${vocabCount}` : "生词" },
    ...(temp ? [{ value: "temp", label: temp.label }] : []),
  ];

  // 抽屉的把手：拖的时候直接改高度（不经过 React，卷面跟着挤，不重画），松手按位置和快慢停到一档或收起
  const self = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; room: number; ly: number; lt: number; v: number; moved: boolean } | null>(null);
  const pct = (f: number) => `${f * 100}%`;
  const settle = (next: number | null) => {
    const el = self.current;
    if (el) {
      el.style.transition = "";
      el.style.height = pct(next ?? snap);
    }
    onSnap(next);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = self.current;
    const room = el?.parentElement?.clientHeight;
    if (!el || !room) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    drag.current = { y: e.clientY, h: el.offsetHeight, room, ly: e.clientY, lt: performance.now(), v: 0, moved: false };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = self.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 4) d.moved = true;
    const now = performance.now();
    if (now > d.lt) d.v = (e.clientY - d.ly) / (now - d.lt); // 正数是往下
    d.ly = e.clientY;
    d.lt = now;
    el.style.height = `${Math.max(0, Math.min(d.room - PAPER_MIN, d.h - dy))}px`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = self.current;
    if (!d || !el) return;
    if (!d.moved) return settle(snap);
    const f = el.offsetHeight / d.room;
    // 松手前停了一下（0.1 秒没动）就不算甩，按停的位置算
    if (performance.now() - d.lt > 100) d.v = 0;
    // 甩一下：往下甩到下一档（最低一档再往下就收起），往上甩到上一档
    if (d.v > 0.6) return settle([...DRAWER_SNAPS].reverse().find((s) => s < f - 0.02) ?? null);
    if (d.v < -0.6) return settle(DRAWER_SNAPS.find((s) => s > f + 0.02) ?? DRAWER_SNAPS[DRAWER_SNAPS.length - 1]);
    if (f < DRAWER_SNAPS[0] * 0.6) return settle(null);
    settle(DRAWER_SNAPS.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a)));
  };
  // 把手也能用键盘：↑ ↓ 换档
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = DRAWER_SNAPS.indexOf(snap);
    if (e.key === "ArrowUp" && i < DRAWER_SNAPS.length - 1) settle(DRAWER_SNAPS[i + 1]);
    else if (e.key === "ArrowDown") settle(i > 0 ? DRAWER_SNAPS[i - 1] : null);
    else return;
    e.preventDefault();
  };

  const drawer = layout === "drawer";
  return (
    <aside
      ref={self}
      data-dock={layout}
      aria-label="面板"
      className={cn("gr-wb-panel no-print shrink-0", drawer ? "transition-[height] duration-200 ease-out" : "transition-[margin] duration-200 ease-out")}
      style={drawer ? { height: pct(snap), minHeight: DRAWER_MIN, maxHeight: `calc(100% - ${PAPER_MIN}px)` } : { width: DOCK_WIDTH, marginTop: inset }}
    >
      {drawer && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖动调整面板高度"
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onHandleKey}
          className="flex h-5 flex-none cursor-row-resize touch-none items-center justify-center"
        >
          <span className="h-1 w-9 rounded-full bg-[var(--line-control)]" />
        </div>
      )}
      <div className="gr-wb-panel-head h-11 gap-1 pr-1.5 pl-1.5">
        {/* 标签多（六七个）放不下时左右滑 */}
        <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto">
          <G.Tabs label="面板" value={shown} onChange={(v: string) => onView(v as DockView)} items={tabs} className="w-max" />
        </div>
        <button type="button" onClick={onClose} className="gr-iconbtn size-8 flex-none" aria-label="收起面板">
          <X className="size-4" />
        </button>
      </div>
      {shown === "temp" && temp?.body}
      {shown === "listen" && <div ref={listenSlot} className="flex min-h-0 flex-1 flex-col" />}
      {shown === "sheet" && (
        <AnswerSheet
          paper={paper}
          attempt={attempt}
          mode={mode}
          answers={answers}
          flags={flags}
          submitted={submitted}
          justSubmitted={justSubmitted}
          times={times}
          limits={limits}
          cols={drawer ? "fill" : 6}
          onJump={onJump}
          onSubmit={onSubmit}
          onRedo={onRedo}
          onExplain={() => onView("explain")}
          onReport={onReport}
        />
      )}
      {shown === "explain" && <ExplainPanel paper={paper} answers={answers} elapsed={elapsed} onJump={onJump} />}
      {shown === "write" && <WritePanel paper={paper} attemptKey={attemptKey} texts={texts} submitted={submitted} focus={focusWrite} onJump={onJump} onFocus={onWriteFocus} />}
      {shown === "notes" && <NotesPanel marks={marks} history={history} onJumpMark={onJumpMark} onClear={onClearMarks} />}
      {shown === "vocab" && <PaperVocab paper={paper} />}
    </aside>
  );
}
