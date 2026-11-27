import { useMemo, useState } from "react";
import { Link } from "react-router";
import { FileText } from "@phosphor-icons/react";
import type { AttemptRow } from "@/lib/db";
import { answeredCount, paperPath } from "@/lib/attempts";
import { EXAMS, isIeltsExam, KIND_NAMES, type PaperIndexItem } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { getTargetMeta, normalizeTargetExam, resolveTargetExam } from "@/lib/targetExam";
import { pct, useAttemptItems, usePaperIndex } from "@/lib/insights";
import { cn, daysUntil } from "@/lib/utils";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui";
import { Bubbles, PaperThumb, StickyTab, jumpToYear, useCurrentYear } from "@/components/paper-ui";
import { IeltsPapersView } from "@/ielts/components/IeltsPapersView";

type Status = "all" | "new" | "doing" | "done";

const statusOf = (a?: AttemptRow): Exclude<Status, "all"> => (!a ? "new" : a.submittedAt ? "done" : "doing");

const FILTERS: { value: Status; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "new", label: "没做过" },
  { value: "doing", label: "进行中" },
  { value: "done", label: "已完成" },
];

/** 一套卷子：原卷第一页（白边、纸的阴影）+ 标题、一行元信息、一个状态。各部分题量放在悬停提示里 */
function PaperCard({ paper, attempt }: { paper: PaperIndexItem; attempt?: AttemptRow }) {
  const status = statusOf(attempt);
  const acc = attempt?.total ? pct(attempt.score ?? 0, attempt.total) : null;
  const answered = attempt ? answeredCount(attempt) : 0;
  // "2024年12月四级真题(第1套)" 拆成场次一行、"四级真题(第1套)"一行：平板两列时卡片文字区很窄，一行放不下
  const split = paper.title.match(/^(\d{4}年\d{1,2}月)(.+)$/);
  return (
    <Link to={paperPath(paper.id)} className="card card-press flex items-center gap-3 p-3.5" title={paper.sections.map((s) => `${KIND_NAMES[s.kind]} ${s.questionCount}`).join(" · ")}>
      <PaperThumb id={paper.id} width={76} frame />
      <div className="min-w-0 flex-1">
        {split ? (
          <h3 className="text-[16px] leading-6 font-semibold">
            {split[1]}
            <span className="block truncate text-[14px] leading-5 font-medium text-[var(--ink-700)]">{split[2]}</span>
          </h3>
        ) : (
          <h3 className="line-clamp-2 text-[16px] leading-6 font-semibold">{paper.title}</h3>
        )}
        <p className="mt-0.5 truncate text-[13px] text-[var(--ink-500)]">
          {/* 四六级每套都有听力，"含听力"不用每张卡都写（平板两列时会把这一行挤出省略号） */}
          {[`${paper.questionCount} 题`, paper.durationMinutes && `${paper.durationMinutes} 分钟`].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2.5 text-[14px]">
          {status === "done" ? (
            <span className="text-[var(--ink-700)]">
              已完成 <span className="num text-[var(--ink)]">{acc === null ? "" : `${acc}%`}</span>
            </span>
          ) : status === "doing" ? (
            <span className="flex items-center gap-2 text-[var(--ink-700)]">
              <Bubbles total={paper.questionCount} done={answered} max={8} />
              <span className="num">
                {answered}/{paper.questionCount}
              </span>
            </span>
          ) : (
            <span className="text-[var(--ink-500)]">没做过</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** 真题训练只回答"做哪套"：像一个试卷架——每年一个档案夹，左边伸出年份便签，里面按场次放卷子 */
export function PapersPage() {
  const settings = useSettings();
  const { index, error } = usePaperIndex();
  const items = useAttemptItems(index);
  const [status, setStatus] = useState<Status>("all");

  const attemptMap = useMemo(() => new Map((items ?? []).filter((it) => !it.section).map((it) => [it.paper.id, it.attempt])), [items]);
  const exam = resolveTargetExam(settings);
  const targetMeta = getTargetMeta(exam);
  const ieltsMode = isIeltsExam(exam);
  const all = (index ?? []).filter((p) => normalizeTargetExam(p.exam) === exam);
  const papers = all.filter((p) => status === "all" || statusOf(attemptMap.get(p.id)) === status);
  const count = (s: Status) => (s === "all" ? all.length : all.filter((p) => statusOf(attemptMap.get(p.id)) === s).length);

  // 年份 → 上半年 / 下半年 → 套
  const years = useMemo(() => {
    const byYear = new Map<number, Map<number, PaperIndexItem[]>>();
    for (const p of papers) {
      if (!byYear.has(p.year)) byYear.set(p.year, new Map());
      const m = byYear.get(p.year)!;
      const half = p.month ? (p.month <= 9 ? 1 : 2) : 0;
      if (!m.has(half)) m.set(half, []);
      m.get(half)!.push(p);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, halves]) => ({
        year,
        sittings: [...halves.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([half, ps]) => ({
            half,
            papers: ps.sort((a, b) => (b.month ?? 0) - (a.month ?? 0) || (a.set ?? 0) - (b.set ?? 0)),
          })),
      }));
  }, [papers]);
  const showIndex = years.length > 6;
  const curYear = useCurrentYear(years.map((y) => y.year));
  const countdown = settings.examDate ? daysUntil(settings.examDate) : null;
  const examName = EXAMS.find((e) => e.id === exam)?.name ?? targetMeta.name;

  return (
    <div>
      <PageHeader
        title="真题训练"
        desc={
          <>
            当前目标：<b className="text-[var(--ink)]">{targetMeta.name}</b> · 整套做题、交卷看分；只练一种题型去
            <Link to="/practice" className="text-[var(--blue)] hover:underline">
              专项训练
            </Link>
            。{countdown !== null && countdown >= 0 && ` 距开考还有 ${countdown} 天。`}
          </>
        }
        actions={
          !ieltsMode && all.length > 0 ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="按状态筛选">
              {FILTERS.map(({ value, label }) => (
                <button key={value} type="button" role="radio" aria-checked={status === value} onClick={() => setStatus(value)} className={cn("pill", status === value && "pill-on")}>
                  {label} <span className="num">{count(value)}</span>
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {ieltsMode ? (
        <IeltsPapersView exam={exam} />
      ) : (
        <>
          {error && <EmptyState title="试卷目录加载失败" desc={error} />}
          {!index && !error && <LoadingBlock />}
          {index && all.length === 0 && <EmptyState icon={<FileText className="size-[22px]" />} title={`还没有收录${examName}`} desc="真题导入方法见 docs/试卷数据格式.md。" />}
          {all.length > 0 && papers.length === 0 && <p className="py-12 text-center text-[14px] text-[var(--ink-500)]">没有符合条件的试卷</p>}

          <div className={cn(showIndex && "grid grid-cols-[minmax(0,1fr)_48px] gap-4")}>
            <div className="space-y-6">
              {years.map(({ year, sittings }) => (
                <section key={year} id={`y${year}`} className="grid scroll-mt-6 grid-cols-[36px_minmax(0,1fr)]">
                  {/* 档案夹左边伸出的年份便签，滚动时贴在顶上 */}
                  <StickyTab vertical className="sticky top-6 mt-3 self-start">
                    <span className="num text-[16px] tracking-[0.04em]">{year}</span>
                  </StickyTab>
                  <div className="space-y-5 rounded-[14px] rounded-tl-[4px] bg-[var(--paper-200)]/60 p-4 shadow-[inset_0_1px_2px_rgba(28,35,48,0.06)]">
                    {sittings.map(({ half, papers: ps }) => (
                      <div key={half}>
                        {half > 0 && <h3 className="mb-2.5 px-1 text-[14px] font-semibold text-[var(--ink-700)]">{half === 1 ? "上半年" : "下半年"}</h3>}
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {ps.map((p) => (
                            <PaperCard key={p.id} paper={p} attempt={attemptMap.get(p.id)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* 年份索引：右边一列小字，像书页边的索引；滚动时高亮当前年份 */}
            {showIndex && (
              <nav aria-label="跳到年份" className="sticky top-8 flex flex-col items-stretch gap-0.5 self-start">
                {years.map(({ year }) => (
                  <a
                    key={year}
                    href={`#y${year}`}
                    onClick={(e) => jumpToYear(e, year)}
                    aria-current={curYear === year ? "true" : undefined}
                    className={cn(
                      "num relative flex h-10 items-center justify-center rounded-[8px] text-[13px] transition-colors",
                      curYear === year
                        ? "bg-white text-[var(--ink)] shadow-[var(--elev-1)] before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--blue)]"
                        : "text-[var(--ink-500)] hover:text-[var(--ink)]",
                    )}
                  >
                    {year}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </>
      )}
    </div>
  );
}
