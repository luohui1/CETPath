import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Shuffle, Target } from "@phosphor-icons/react";
import type { AttemptRow } from "@/lib/db";
import { answeredCount, attemptKey, paperPath } from "@/lib/attempts";
import { EXAMS, kindName, type ExamId, type PaperIndexItem, type SectionIndexItem, type SectionKind } from "@/lib/papers";
import { KINDS, MIN_ANSWERS, pct, spentText, useAttemptItems, useKindStats, usePaperIndex } from "@/lib/insights";
import { setSetting, useSettings } from "@/lib/settings";
import { cn, timeAgo } from "@/lib/utils";
import { Button, EmptyState, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { KIND_PIXELS, PixelIcon } from "@/components/PixelIcon";
import { Bubbles, PaperThumb } from "@/components/paper-ui";

const SUBJECTIVE = new Set<SectionKind>(["translation", "writing"]);
type Status = "all" | "new" | "doing" | "done";

const FILTERS: { value: Status; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "new", label: "没练过" },
  { value: "doing", label: "进行中" },
  { value: "done", label: "已完成" },
];

interface Row {
  paper: PaperIndexItem;
  section: SectionIndexItem;
  attempt?: AttemptRow;
}

const statusOf = (a?: AttemptRow): Exclude<Status, "all"> => (!a ? "new" : a.submittedAt ? "done" : "doing");
const sittingName = (p: PaperIndexItem) => (p.month ? `${p.year}年${p.month}月${p.set ? ` 第${p.set}套` : ""}` : `${p.year}`);

/** 一行的状态：没练、做到哪（答题卡小泡）、交卷后的得分 */
function Status({ row }: { row: Row }) {
  const { section, attempt } = row;
  if (!attempt) return <span className="text-[13px] text-[var(--ink-500)]">还没练</span>;
  const practice = attempt.mode === "practice";
  if (attempt.submittedAt) {
    if (!attempt.total) return <span className="text-[13px] text-[var(--ink-500)]">已交卷 · {timeAgo(attempt.submittedAt)}</span>;
    const p = pct(attempt.score ?? 0, attempt.total);
    return (
      <span className="flex items-baseline gap-2 text-[13px] text-[var(--ink-500)]">
        <b className="num text-[18px] text-[var(--ink)]">{p}%</b>
        <span className="hidden lg:inline">{spentText(attempt.spentSec)}</span>
      </span>
    );
  }
  const n = answeredCount(attempt);
  return (
    <span className="flex items-center gap-2">
      <Bubbles total={section.questionCount} done={n} max={10} />
      <span className="num text-[13px] text-[var(--ink-500)]">
        {n}/{section.questionCount}
      </span>
      {practice && <span className="text-[13px] text-[var(--ink-500)]">练习</span>}
    </span>
  );
}

/** 专项训练只回答"练哪种"：像一个文具盒——每种题型一格，看练得怎么样；选中一格，下面逐篇列出。每篇只截取原卷里的那一部分，和整套模考分开计分 */
export function PracticePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { index, error } = usePaperIndex();
  const items = useAttemptItems(index);
  const [status, setStatus] = useState<Status>("all");
  const settings = useSettings();
  // 新开一篇用哪种模式：考试（交卷才判）/ 练习（选完即判）；已经开始的按记录
  const startPath = (r: Row) => paperPath(r.paper.id, r.section.id) + (r.attempt ? "" : `?mode=${settings.practiceMode}`);

  const exam = (params.get("exam") as ExamId) || (settings.lastExam as ExamId | null) || (index?.[0]?.exam ?? "kaoyan1");
  // 从别处带着考试进来（如做题页的"返回真题训练"）也记下
  const askedExam = params.get("exam");
  useEffect(() => {
    if (askedExam && askedExam !== settings.lastExam) void setSetting("lastExam", askedExam);
  }, [askedExam, settings.lastExam]);
  const papers = useMemo(() => (index ?? []).filter((p) => p.exam === exam), [index, exam]);
  const examItems = useMemo(() => (items ?? []).filter((it) => it.paper.exam === exam), [items, exam]);
  const stats = useKindStats(index ? papers : null, items ? examItems : null);
  const attemptMap = useMemo(() => new Map(examItems.filter((it) => it.section).map((it) => [it.key, it.attempt])), [examItems]);

  const rowsOf = (k: SectionKind): Row[] =>
    papers
      // 第 3 套接过来的听力和同场那一套是同一份，不重复列
      .flatMap((paper) => paper.sections.filter((s) => s.kind === k && !s.from).map((section) => ({ paper, section, attempt: attemptMap.get(attemptKey(paper.id, section.id)) })))
      .sort((a, b) => b.paper.year - a.paper.year || (b.paper.month ?? 0) - (a.paper.month ?? 0) || (a.paper.set ?? 0) - (b.paper.set ?? 0));
  const kinds = KINDS.filter((k) => papers.some((p) => p.sections.some((s) => s.kind === k)));
  const asked = params.get("kind") as SectionKind | null;
  const kind = asked && kinds.includes(asked) ? asked : kinds[0];
  const rows = kind ? rowsOf(kind) : [];
  const shown = rows.filter((r) => status === "all" || statusOf(r.attempt) === status);
  const count = (s: Status) => (s === "all" ? rows.length : rows.filter((r) => statusOf(r.attempt) === s).length);

  const chooseKind = (k: SectionKind) => {
    setStatus("all");
    setParams({ exam, kind: k }, { replace: true });
  };
  /** 来一篇：优先没练过的（随机挑），都练过就挑正确率最低的 */
  const pick = (k: SectionKind) => {
    const all = rowsOf(k);
    const fresh = all.filter((r) => !r.attempt);
    const rate = (r: Row) => (r.attempt?.score ?? 0) / Math.max(1, r.attempt?.total ?? 1);
    const r = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : [...all].sort((a, b) => rate(a) - rate(b))[0];
    if (r) navigate(startPath(r));
  };

  return (
    <div>
      <PageHeader title="专项训练" desc="按题型练：每次只做原卷里的一个部分，和整套模考分开计分。练习模式选完一题马上看对错和解析。" />

      <Segmented
        label="考试"
        className="mb-6"
        value={exam}
        onChange={(v) => {
          setStatus("all");
          setParams({ exam: v }, { replace: true });
          void setSetting("lastExam", v);
        }}
        options={EXAMS.map((e) => {
          const n = (index ?? []).filter((p) => p.exam === e.id).length;
          return { value: e.id, label: n ? `${e.short} ${n}` : e.short };
        })}
      />

      {error && <EmptyState title="试卷目录加载失败" desc={error} />}
      {!index && !error && <LoadingBlock />}
      {index && !kinds.length && <EmptyState icon={<Target className="size-[22px]" />} title={`还没有收录${EXAMS.find((e) => e.id === exam)?.name}`} desc="收录真题后，这里会按题型列出每套卷子的各个部分。" />}

      {/* 文具盒：每种题型一格——图标、名称、已练几篇、正确率（答够 5 题才显示）。选中的一格抬起来，左边一道品牌蓝 */}
      {kinds.length > 0 && (
        <div className="mb-9 grid grid-cols-2 gap-5 lg:grid-cols-3">
          {kinds.map((k) => {
            const st = stats?.find((s) => s.kind === k);
            const all = rowsOf(k);
            const practiced = all.filter((r) => r.attempt?.submittedAt).length;
            const acc = st && st.answered >= MIN_ANSWERS ? pct(st.correct, st.total) : null;
            const active = k === kind;
            return (
              <div
                key={k}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => chooseKind(k)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && chooseKind(k)}
                className={cn("card card-press relative flex items-center gap-4 overflow-hidden p-6", active && "card-raised before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--blue)]")}
              >
                <PixelIcon name={KIND_PIXELS[k]} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] leading-6 font-semibold">{kindName(k, exam)}</div>
                  <div className="mt-0.5 text-[13px] text-[var(--ink-500)]">
                    已练 <span className="num text-[var(--ink-700)]">{practiced}</span>/{all.length}
                  </div>
                </div>
                {!SUBJECTIVE.has(k) && acc !== null && (
                  <div className="num flex-none text-[28px] leading-8" title={`正确率：答对 ${st!.correct} / ${st!.total} 题（含整套模考）`}>
                    {acc}
                    <span className="text-[15px]">%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {kind && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="t-h2">{kindName(kind, exam)}</h2>
              <Button size="sm" onClick={() => pick(kind)}>
                <Shuffle className="size-4" /> 来一篇
              </Button>
              <Segmented
                label="新开一篇的模式"
                value={settings.practiceMode}
                onChange={(v) => setSetting("practiceMode", v)}
                options={[
                  { value: "exam", label: "考试模式" },
                  { value: "practice", label: "练习模式" },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="按状态筛选">
              {FILTERS.map(({ value, label }) => (
                <button key={value} type="button" role="radio" aria-checked={status === value} onClick={() => setStatus(value)} className={cn("pill", status === value && "pill-on")}>
                  {label} <span className="num">{count(value)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card divide-y divide-[var(--line-soft)] p-1.5">
            {!shown.length && <p className="py-10 text-center text-[14px] text-[var(--ink-500)]">没有符合条件的篇目</p>}
            {shown.map((row) => {
              const { paper, section, attempt } = row;
              const action = !attempt ? "开始" : attempt.submittedAt ? "查看" : "继续";
              return (
                <Link
                  key={`${paper.id}-${section.id}`}
                  to={startPath(row)}
                  className="group flex min-h-[56px] items-center gap-4 rounded-[8px] px-3 py-2 transition-colors duration-[var(--dur-fast)] hover:bg-[var(--paper-50)]"
                >
                  <PaperThumb id={paper.id} width={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{sittingName(paper)}</div>
                    <div className="mt-0.5 truncate text-[13px] text-[var(--ink-500)]">{[section.part, section.subtitle, `${section.questionCount} 题`, kind === "listening" && paper.hasAudio && "含录音"].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex flex-none justify-end">
                    <Status row={row} />
                  </div>
                  <span className="inline-flex w-14 flex-none items-center justify-end gap-1 text-[13px] font-medium text-[var(--blue)]">
                    {action} <ArrowRight className="size-3.5 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
