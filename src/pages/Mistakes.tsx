import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowCounterClockwise, CaretDown } from "@phosphor-icons/react";
import type { MasteryRow } from "@/lib/db";
import { paperPath, retryPath } from "@/lib/attempts";
import { kindName, KIND_NAMES, isIeltsExam, loadPaper, peekPaper, peekPaperIndex, type Paper, type Question, type SectionKind } from "@/lib/papers";
import { backfillMastery, restoreMistake, retireMistake, useMistakes } from "@/lib/mistakes";
import { KINDS, usePaperIndex } from "@/lib/insights";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Button, EmptyState, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { PaperDialog } from "@/components/overlay";
import { PaperThumb } from "@/components/paper-ui";
import { MISTAKE_PAGES, WordsTabs } from "@/components/WordsTabs";
import { ExplainContext, ExplanationCard } from "@/exam/Explanation";
import { IeltsMistakesView } from "@/ielts/components/IeltsMistakesView";
import { useIeltsPendingMistakes } from "@/ielts/store";

type Status = "pending" | "retired" | "all";
const BATCH = 30; // 一次最多重做 30 题
const ROWS = 5; // 一组先列 5 道，其余展开再看

/** 本周一 0 点 */
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** 错题涉及的试卷（加载过的直接拿，没加载的后台读） */
function usePapers(ids: string[]) {
  const [, loaded] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter((id) => !peekPaper(id));
    if (missing.length) void Promise.all(missing.map((id) => loadPaper(id).catch(() => null))).then(() => !cancelled && loaded((n) => n + 1));
    return () => {
      cancelled = true;
    };
    // key 概括了 ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (id: string) => peekPaper(id);
}

function findQuestion(paper: Paper | undefined, id: string): Question | undefined {
  return paper?.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).find((q) => q.id === id);
}

/** 错题本的一行：题号、我的答案 → 正确答案、题干开头；看解析（展开）、卷面、已掌握 */
function MistakeRow({ row, q, paper }: { row: MasteryRow; q?: Question; paper?: Paper }) {
  const [open, setOpen] = useState(false);
  const last = [...row.history].reverse().find((h) => !h.right && h.chosen);
  const ctx = useMemo(() => paper && { paperId: paper.id, paperTitle: paper.title }, [paper]);
  return (
    <li className="border-t border-[var(--line-soft)] first:border-0">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-1 py-2">
        <span className="num w-8 flex-none text-[16px]">{q?.number ?? row.questionId.replace(/^q/, "")}</span>
        <span className="flex-none text-[14px]">
          {last?.chosen && <span className="mr-1 text-[var(--ink-500)] line-through decoration-1">{last.chosen}</span>}→ <b className="text-[var(--blue)]">{q?.answer ?? "?"}</b>
        </span>
        <span className="min-w-0 flex-1 basis-40 truncate text-[14px] text-[var(--ink-500)]">{q?.stem ? q.stem.replace(/\s+/g, " ").slice(0, 40) : ""}</span>
        <span className="flex flex-none items-center">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex h-10 items-center gap-1 rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--ink-700)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]">
            看解析 <CaretDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          <Link to={`${paperPath(row.paperId)}?focus=${row.questionId}`} className="inline-flex h-10 items-center rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--ink-500)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]">
            卷面
          </Link>
          {row.retiredAt ? (
            <button type="button" onClick={() => void restoreMistake(row.id)} className="inline-flex h-10 items-center rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--ink-500)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue)]">
              恢复
            </button>
          ) : (
            <button type="button" onClick={() => void retireMistake(row.id)} className="inline-flex h-10 items-center rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--ink-500)] hover:bg-[var(--blue-tint)] hover:text-[var(--blue)]">
              已掌握
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="well mb-3 px-4 py-3">
          {q ? (
            <ExplainContext.Provider value={ctx ?? null}>
              {/* 答案和上次选的已经在这一行上 */}
              <ExplanationCard q={q} answer={false} />
            </ExplainContext.Provider>
          ) : (
            <p className="text-[13px] text-[var(--ink-500)]">正在读这套卷子…</p>
          )}
        </div>
      )}
    </li>
  );
}

/** 空状态：一句说明 + 去做题 */
function EmptySheet() {
  return (
    <div className="card px-6 py-12">
      <EmptyState
        title="还没有错题"
        desc="交卷后做错的题会自动收进来，重做对两次就移出。"
        action={
          <Link to="/papers">
            <Button variant="primary">去做一套真题</Button>
          </Link>
        }
      />
    </div>
  );
}

/**
 * 错题本：交过卷的错题都在这里，做对两次自动移出。顶上一张概况（待重做是主角），下面按试卷一张纸一组。
 * 只回答一个问题："先重做哪些"
 */
export function MistakesPage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const rows = useMistakes();
  const ieltsPending = useIeltsPendingMistakes();
  const { index } = usePaperIndex();
  const [deck, setDeck] = useState<"ielts" | "cet">(() =>
    isIeltsExam(settings.lastExam) || peekPaperIndex()?.length === 0 ? "ielts" : "cet",
  );
  const [kind, setKind] = useState<SectionKind | "all">("all");
  const [paperFilter, setPaperFilter] = useState("all");
  const [status, setStatus] = useState<Status>("pending");
  const [batches, setBatches] = useState(false);
  const [more, setMore] = useState<Set<string>>(new Set()); // 展开了全部错题的卷子
  // 第一次打开：把升级前交过卷的记录补进来（只跑一次）
  useEffect(() => void backfillMastery(), []);

  const titles = useMemo(() => new Map((index ?? []).map((p) => [p.id, p.title])), [index]);
  const all = useMemo(() => rows ?? [], [rows]);
  const pending = all.filter((r) => !r.retiredAt);
  const paperIds = useMemo(() => [...new Set(all.map((r) => r.paperId))], [all]);
  const paperOf = usePapers(paperIds);

  const shown = all.filter((r) => (status === "all" || (status === "pending" ? !r.retiredAt : !!r.retiredAt)) && (kind === "all" || r.kind === kind) && (paperFilter === "all" || r.paperId === paperFilter));
  // 按试卷分组：最近出错的卷子在前；组内按题号
  const groups = useMemo(() => {
    const map = new Map<string, MasteryRow[]>();
    for (const r of shown) {
      if (!map.has(r.paperId)) map.set(r.paperId, []);
      map.get(r.paperId)!.push(r);
    }
    const num = (r: MasteryRow) => Number(r.questionId.replace(/\D/g, "")) || 0;
    return [...map.entries()].map(([paperId, list]) => ({ paperId, list: list.sort((a, b) => num(a) - num(b)), last: Math.max(...list.map((r) => r.firstWrongAt)) })).sort((a, b) => b.last - a.last);
  }, [shown]);

  const week = weekStart();
  const byKind = KINDS.map((k) => ({ k, n: pending.filter((r) => r.kind === k).length })).filter((x) => x.n);
  const maxKind = Math.max(1, ...byKind.map((x) => x.n));
  const kindsPresent = KINDS.filter((k) => all.some((r) => r.kind === k));
  // 重做全部：按试卷分批，每批最多 30 题
  const plan = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of pending) {
      if (!map.has(r.paperId)) map.set(r.paperId, []);
      map.get(r.paperId)!.push(r.questionId);
    }
    return [...map.entries()].flatMap(([paperId, ids]) => Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ({ paperId, ids: ids.slice(i * BATCH, (i + 1) * BATCH), part: ids.length > BATCH ? i + 1 : 0 })));
  }, [pending]);
  const retryAll = () => (plan.length === 1 ? navigate(retryPath(plan[0].paperId, plan[0].ids)) : setBatches(true));

  if (!rows) return <LoadingBlock />;

  return (
    <div>
      <WordsTabs pages={MISTAKE_PAGES} label="错题" />
      <PageHeader
        title="错题本"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="错题分类"
              value={deck}
              onChange={(v) => setDeck(v)}
              options={[
                { value: "ielts", label: `雅思错题${ieltsPending ? ` ${ieltsPending}` : ""}` },
                { value: "cet", label: `四六级 / 考研${pending.length ? ` ${pending.length}` : ""}` },
              ]}
            />
            {deck === "cet" && pending.length > 0 && (
              <Button variant="primary" onClick={retryAll}>
                <ArrowCounterClockwise className="size-[18px]" /> 重做全部待重做（{pending.length}）
              </Button>
            )}
          </div>
        }
      />

      {deck === "ielts" ? (
        <IeltsMistakesView />
      ) : !all.length ? (
        <EmptySheet />
      ) : (
        <>
          {/* 概况：一张纸。待重做是主角；右边每种题型待重做几道 */}
          <div className="card mb-5 flex flex-wrap items-center gap-x-10 gap-y-5 p-6">
            <dl className="flex gap-8">
              <div>
                <dt className="t-label">待重做</dt>
                <dd className="num mt-1 text-[40px] leading-[44px]">{pending.length}</dd>
              </div>
              <div>
                <dt className="t-label">本周新增</dt>
                <dd className="num mt-1 text-[26px] leading-[44px] text-[var(--ink-700)]">{all.filter((r) => r.firstWrongAt >= week).length}</dd>
              </div>
              <div>
                <dt className="t-label">已掌握</dt>
                <dd className="num mt-1 text-[26px] leading-[44px] text-[var(--ink-700)]">{all.length - pending.length}</dd>
              </div>
            </dl>
            {byKind.length > 0 && (
              <ul className="ml-auto w-full max-w-[360px] min-w-[220px] space-y-1.5">
                {byKind.map(({ k, n }) => (
                  <li key={k} className="grid grid-cols-[5.5em_minmax(0,1fr)_2em] items-center gap-3 text-[13px]">
                    <span className="text-[var(--ink-700)]">{KIND_NAMES[k]}</span>
                    <span className="meter" aria-hidden>
                      <span style={{ width: `${(n / maxKind) * 100}%` }} />
                    </span>
                    <span className="num text-right">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 筛选：题型、试卷、状态 */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="按题型筛选">
              {(["all", ...kindsPresent] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("pill", kind === k && "pill-on")}>
                  {k === "all" ? "全部题型" : KIND_NAMES[k]}
                </button>
              ))}
            </div>
            <select
              value={paperFilter}
              onChange={(e) => setPaperFilter(e.target.value)}
              aria-label="按试卷筛选"
              className="h-10 max-w-60 rounded-[9px] bg-white px-3 text-[13px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
            >
              <option value="all">全部试卷</option>
              {paperIds.map((id) => (
                <option key={id} value={id}>
                  {titles.get(id) ?? id}
                </option>
              ))}
            </select>
            <div className="ml-auto flex gap-2" role="radiogroup" aria-label="按状态筛选">
              {(
                [
                  ["pending", "待重做"],
                  ["retired", "已掌握"],
                  ["all", "全部"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={status === v} onClick={() => setStatus(v)} className={cn("pill", status === v && "pill-on")}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!groups.length && <p className="py-12 text-center text-[14px] text-[var(--ink-500)]">{status === "pending" && !pending.length ? "错题都掌握了" : "没有符合条件的错题"}</p>}

          {/* 一张卷子一张纸：左边缩略图，组内每题一行 */}
          <div className="space-y-5">
            {groups.map(({ paperId, list }) => {
              const paper = paperOf(paperId);
              const todo = list.filter((r) => !r.retiredAt);
              const exam = index?.find((p) => p.id === paperId)?.exam;
              const kinds = [...new Set(list.map((r) => r.kind))].map((k) => kindName(k, exam)).join(" · ");
              return (
                <section key={paperId} className="card flex gap-5 p-5">
                  <PaperThumb id={paperId} width={56} frame className="mt-1 max-md:hidden" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-[16px] leading-6 font-semibold">{titles.get(paperId) ?? paper?.title ?? paperId}</h2>
                        <p className="text-[13px] text-[var(--ink-500)]">{kinds}</p>
                      </div>
                      {todo.length > 0 && (
                        <Link to={retryPath(paperId, todo.slice(0, BATCH).map((r) => r.questionId))} className="btn btn-secondary btn-sm">
                          重做这套的错题（{Math.min(BATCH, todo.length)}）
                        </Link>
                      )}
                    </div>
                    <ul className="mt-2">
                      {(more.has(paperId) ? list : list.slice(0, ROWS)).map((r) => (
                        <MistakeRow key={r.id} row={r} paper={paper} q={findQuestion(paper, r.questionId)} />
                      ))}
                    </ul>
                    {list.length > ROWS && !more.has(paperId) && (
                      <button type="button" onClick={() => setMore(new Set(more).add(paperId))} className="mt-1 inline-flex h-10 items-center gap-1 text-[13px] font-medium text-[var(--ink-700)] hover:text-[var(--ink)]">
                        还有 <span className="num">{list.length - ROWS}</span> 道 <CaretDown className="size-3.5" />
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* 一次最多 30 题，在原卷上做：按试卷分批 */}
      <PaperDialog open={batches} onClose={() => setBatches(false)} title="分批重做" description={`待重做 ${pending.length} 道，在原卷上做，一次一套卷、最多 ${BATCH} 道。`} width={480}>
        <ul className="mt-4 max-h-[60dvh] space-y-1 overflow-y-auto">
          {plan.map((b) => (
            <li key={`${b.paperId}-${b.part}`}>
              <Link to={retryPath(b.paperId, b.ids)} className="flex min-h-12 items-center gap-3 rounded-[10px] px-3 hover:bg-[var(--paper-50)]">
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {titles.get(b.paperId) ?? b.paperId}
                  {b.part > 0 && <span className="text-[var(--ink-500)]"> · 第 {b.part} 批</span>}
                </span>
                <span className="num text-[15px]">{b.ids.length}</span>
                <span className="text-[13px] text-[var(--blue)]">重做</span>
              </Link>
            </li>
          ))}
        </ul>
      </PaperDialog>
    </div>
  );
}
