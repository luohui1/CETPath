import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, CaretRight, Check } from "@phosphor-icons/react";
import { db, type DayRow } from "@/lib/db";
import { answeredCount, paperPath } from "@/lib/attempts";
import { pendingCounts } from "@/lib/learning";
import { usePendingMistakes } from "@/lib/mistakes";
import { isIeltsExam, KIND_NAMES } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { currentStreak } from "@/lib/stats";
import { itemTitle, itemTotal, lastDays, MIN_ANSWERS, pct, spentText, useAttemptItems, useKindStats, usePaperIndex, type AttemptItem, type KindStat } from "@/lib/insights";
import { cn, timeAgo } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { Button } from "@/components/ui";
import { ExamCountdown, examPreset } from "@/components/ExamCountdown";
import { Heatmap } from "@/components/Heatmap";
import { Bubbles, PaperThumb } from "@/components/paper-ui";
import { IELTS_SKILLS_ZH, ieltsPaperLabel, useIeltsIndex } from "@/ielts/data";
import { DeleteRunButton } from "@/ielts/components/DeleteRunButton";
import { useIeltsAttempts, useIeltsPendingMistakes } from "@/ielts/store";
import type { IeltsAttemptRow } from "@/ielts/types";

const WEEKLY_PAPERS = 2; // 每周两套整卷

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 本周一 0 点 */
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** 卡片标题 + 右边一个去处 */
function Head({ title, to, link }: { title: ReactNode; to?: string; link?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="t-h2">{title}</h2>
      {to && (
        <Link to={to} className="inline-flex h-8 items-center gap-1 text-[13px] font-medium text-[var(--blue)] hover:underline">
          {link} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

interface Todo {
  text: ReactNode;
  done: boolean;
  to: string;
}

/** 今天：三行以内，不带按钮；每一行点进去做那一件事（整张卡一个链接时，点"错题"那行却去了听力） */
function TodayCard({ todos, className }: { todos: Todo[]; className?: string }) {
  return (
    <div className={cn("card flex flex-col p-6", className)}>
      <Head title="今天" />
      <ol className="-mx-2 space-y-0.5">
        {todos.map((t, i) => (
          <li key={i}>
            <Link
              to={t.to}
              className={cn("flex min-h-11 items-center gap-3 rounded-[8px] px-2 text-[15px] transition-colors hover:bg-[var(--paper-50)] active:bg-[var(--fill-quiet)]", t.done && "text-[var(--ink-500)]")}
            >
              <span className={cn("grid size-6 flex-none place-items-center rounded-full", t.done ? "bg-[var(--ink)] text-white" : "border border-[var(--line-control)]")}>
                {t.done && <Check className="size-3.5" weight="bold" />}
              </span>
              <span className={cn("min-w-0 flex-1", t.done && "line-through decoration-[var(--ink-300)]")}>{t.text}</span>
              {!t.done && <CaretRight className="size-4 flex-none text-[var(--ink-300)]" weight="bold" />}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 接着做题：最近一个没交卷的整套或专项；没有就推荐下一套没做过的真题。左边三页错开的原卷，一行总进度泡，一行最弱题型提示 */
function ContinueCard({ item, next, weakest, className }: { item?: AttemptItem; next?: { id: string; title: string; meta: string }; weakest?: KindStat; className?: string }) {
  const id = item?.paper.id ?? next?.id;
  const done = item ? answeredCount(item.attempt) : 0;
  const total = item ? itemTotal(item) : 0;
  return (
    <div className={cn("card flex gap-6 p-6", className)}>
      {id && <PaperThumb id={id} width={88} fan className="mt-1 max-[380px]:hidden" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="t-label">{item ? (item.section ? "继续专项训练" : "继续真题训练") : "推荐下一套"}</div>
        <h2 className="mt-1 text-[20px] leading-7 font-semibold">{(item ? itemTitle(item) : next?.title) ?? "所有真题都做过了"}</h2>
        <p className="mt-1 text-[14px] text-[var(--ink-500)]">
          {item ? (
            <>
              已答 <span className="num text-[var(--ink)]">{done}</span> / {total} 题{(item.attempt.spentSec ?? 0) >= 60 && ` · 已用 ${spentText(item.attempt.spentSec)}`}
            </>
          ) : (
            next?.meta
          )}
        </p>
        {item && <Bubbles total={total} done={done} max={20} className="mt-3" />}
        {weakest && (
          <p className="mt-3 text-[14px] text-[var(--ink-700)]">
            最弱：{KIND_NAMES[weakest.kind]} <span className="num">{pct(weakest.correct, weakest.total)}%</span>
            <Link to={`/practice?kind=${weakest.kind}`} className="ml-2 text-[var(--blue)] hover:underline">
              去专项练
            </Link>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
          {(item || next) && (
            <Link to={item ? paperPath(item.paper.id, item.section?.id) : paperPath(next!.id)}>
              <Button variant="primary" size="lg">
                {item ? "继续做题" : "开始做题"} <ArrowRight className="size-4" />
              </Button>
            </Link>
          )}
          <Link to="/papers">
            <Button variant="ghost">全部真题</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 本周：连续打卡并进标题，四个数字横排 */
function WeekCard({ days, className }: { days: DayRow[]; className?: string }) {
  const series = lastDays(days, 7);
  const sum = (k: "questions" | "correct" | "reviews" | "lookups") => series.reduce((n, d) => n + d[k], 0);
  const q = sum("questions");
  const streak = currentStreak(days);
  const metrics: [string, string, string][] = [
    ["做题", `${q}`, ""],
    ["正确率", q >= MIN_ANSWERS ? `${pct(sum("correct"), q)}` : "—", q >= MIN_ANSWERS ? "%" : ""],
    ["复习", `${sum("reviews")}`, ""],
    ["查词", `${sum("lookups")}`, ""],
  ];
  return (
    <div className={cn("card flex flex-col p-6", className)}>
      <Head title={streak ? `本周 · 连续 ${streak} 天` : "本周"} />
      {/* 数字紧跟标题：和旁边"今天"一起拉高时，空白留在下面，不在中间 */}
      <dl className="mt-5 grid grid-cols-4 gap-3">
        {metrics.map(([label, value, unit]) => (
          <div key={label} className="min-w-0">
            <dt className="t-label whitespace-nowrap">{label}</dt>
            <dd className="num mt-1 text-[26px] leading-8">
              {value}
              <span className="text-[14px]">{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 最近练习：最多三行，名称 + 用时，右边得分 */
function RecentCard({ items, className }: { items: AttemptItem[] | null; className?: string }) {
  return (
    <div className={cn("card p-6", className)}>
      <Head title="最近练习" to="/papers" link="全部真题" />
      {!items?.length ? (
        <p className="text-[14px] text-[var(--ink-500)]">还没有做过题。做完一套或一篇专项，这里会记下得分和用时。</p>
      ) : (
        <ul className="-mx-2">
          {items.slice(0, 3).map((it) => {
            const acc = it.attempt.submittedAt && it.attempt.total ? pct(it.attempt.score ?? 0, it.attempt.total) : null;
            return (
              <li key={it.key}>
                <Link to={paperPath(it.paper.id, it.section?.id)} className="flex min-h-[52px] items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[var(--paper-50)]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{itemTitle(it)}</div>
                    <div className="text-[13px] text-[var(--ink-500)]">
                      {spentText(it.attempt.spentSec)} · {timeAgo(it.attempt.updatedAt)}
                    </div>
                  </div>
                  {acc !== null ? (
                    <span className="num text-[20px]">
                      {acc}
                      <span className="text-[13px]">%</span>
                    </span>
                  ) : (
                    <span className="num text-[14px] text-[var(--ink-500)]">
                      {answeredCount(it.attempt)}/{itemTotal(it)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 雅思首页主卡片：正在进行的机考或推荐下一套剑雅整卷模考 */
function IeltsContinueCard({
  active,
  next,
  exam,
  className,
}: {
  active?: IeltsAttemptRow;
  next?: { id: string; title: string; meta: string };
  exam: string;
  className?: string;
}) {
  const curState = active ? active.sections[active.currentSkill] : undefined;
  const answered = curState ? Object.keys(curState.answers).length + Object.keys(curState.essays).length : 0;
  const elapsed = active ? Object.values(active.sections).reduce((s, x) => s + (x?.elapsed ?? 0), 0) : 0;
  const href = active ? `/ielts/exam/${active.id}` : next ? `/ielts/start/${encodeURIComponent(next.id)}?scope=full&mode=mock` : `/papers?exam=${exam}`;

  return (
    <div className={cn("card flex flex-col p-6", className)}>
      <div className="t-label">
        {active ? (active.scope === "full" ? "继续雅思整套机考" : `继续雅思${IELTS_SKILLS_ZH[active.currentSkill]}练习`) : "推荐下一套雅思真题"}
      </div>
      <h2 className="mt-1 text-[20px] leading-7 font-semibold">
        {active ? active.paperTitle : (next?.title ?? "当前题库已全部完成")}
      </h2>
      <p className="mt-1 text-[14px] text-[var(--ink-500)]">
        {active ? (
          <>
            当前科目：<span className="font-medium text-[var(--ink)]">{IELTS_SKILLS_ZH[active.currentSkill]}</span>
            {answered > 0 && (
              <>
                {" "}· 已答 <span className="num text-[var(--ink)]">{answered}</span> 处
              </>
            )}
            {elapsed >= 60 && ` · 已用 ${spentText(elapsed)}`}
          </>
        ) : (
          next?.meta ?? "可前往真题库自选剑雅、机经或单科重练"
        )}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
        {(active || next) && (
          <Link to={href}>
            <Button variant="primary" size="lg">
              {active ? "回到机考考场" : "进入全真机考"} <ArrowRight className="size-4" />
            </Button>
          </Link>
        )}
        {active && <DeleteRunButton run={active} label="放弃本次" className="h-10 px-3 text-[13.5px]" />}
        <Link to={`/papers?exam=${exam}`}>
          <Button variant="ghost">全部真题</Button>
        </Link>
        <Link to="/speaking">
          <Button variant="ghost">口语题库</Button>
        </Link>
      </div>
    </div>
  );
}

/** 雅思最近练习卡片 */
function IeltsRecentCard({ runs, exam, className }: { runs: IeltsAttemptRow[] | undefined; exam: string; className?: string }) {
  return (
    <div className={cn("card p-6", className)}>
      <Head title="最近练习" to={`/papers?exam=${exam}`} link="全部真题" />
      {!runs?.length ? (
        <p className="text-[14px] text-[var(--ink-500)]">还没有雅思机考记录。完成一套模考或单科练习后，这里会显示 Band 与用时。</p>
      ) : (
        <ul className="-mx-2">
          {runs.slice(0, 3).map((r) => {
            const elapsed = Object.values(r.sections).reduce((s, x) => s + (x?.elapsed ?? 0), 0);
            const scopeLabel = r.scope === "full" ? "整套机考" : IELTS_SKILLS_ZH[r.currentSkill];
            const to = r.submittedAt ? `/ielts/review/${r.id}` : `/ielts/exam/${r.id}`;
            return (
              <li key={r.id} className="flex min-h-[52px] items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[var(--paper-50)]">
                <Link to={to} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">
                      {r.paperTitle} · {scopeLabel}
                    </div>
                    <div className="text-[13px] text-[var(--ink-500)]">
                      {spentText(elapsed)} · {timeAgo(r.updatedAt)}
                    </div>
                  </div>
                  {r.submittedAt ? (
                    <span className="num text-[18px] font-semibold">
                      {r.overallBand != null ? `Band ${r.overallBand.toFixed(1)}` : "已交卷"}
                    </span>
                  ) : (
                    <span className="text-[13px] text-[var(--blue)]">进行中</span>
                  )}
                </Link>
                <DeleteRunButton run={r} iconOnly />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 首页只回答一个问题：今天做什么。
 * 接着做题是主角（跨两列），"今天"在它旁边；倒计时是标题下面的一行小条；下面本周、最近练习和学习日历。
 * 列数按内容区的宽度（容器查询），不按屏幕：侧边栏展开收起都不会把卡片挤成细条。
 * 内容区 ≥1040（1366 屏）三列，720–1040（平板横屏 1024–1280）两列、倒计时牌通栏，再窄一列；第一屏不超过五张卡
 */
export function HomePage() {
  const settings = useSettings();
  const days = useCachedLiveQuery("days", () => db.days.toArray());
  const vocabCount = useCachedLiveQuery("vocab-count", () => db.vocab.count());
  const counts = useCachedLiveQuery("pending", () => pendingCounts(), [settings.dailyNew, settings.activeBook]);
  const { index } = usePaperIndex();
  const { index: ieltsIndex } = useIeltsIndex();
  const items = useAttemptItems(index);
  const ieltsAttempts = useIeltsAttempts();
  const kinds = useKindStats(index, items);
  const mistakes = (usePendingMistakes() ?? 0) + (useIeltsPendingMistakes() ?? 0);
  const effectiveExam = settings.lastExam ?? (index && index.length === 0 ? "ielts-a" : null);
  const ieltsMode = isIeltsExam(effectiveExam);

  const current = items?.find((it) => !it.attempt.submittedAt && (!effectiveExam || it.paper.exam === effectiveExam));
  const activeIelts = useMemo(
    () => (ieltsAttempts ?? []).find((a) => !a.submittedAt && (!effectiveExam || a.exam === effectiveExam)),
    [ieltsAttempts, effectiveExam],
  );
  const nextIelts = useMemo(() => {
    if (!ieltsMode) return undefined;
    const doneIds = new Set((ieltsAttempts ?? []).filter((a) => a.scope === "full" && a.submittedAt).map((a) => a.paperId));
    const p = (ieltsIndex?.papers ?? []).find((e) => e.exam === effectiveExam && e.fullMock && !doneIds.has(e.id));
    return (
      p && {
        id: p.id,
        title: ieltsPaperLabel(p),
        meta: `${p.skills.map((s) => IELTS_SKILLS_ZH[s]).join(" + ")} · Inspera 全真机考界面`,
      }
    );
  }, [ieltsMode, ieltsIndex, ieltsAttempts, effectiveExam]);

  const next = useMemo(() => {
    const done = new Set((items ?? []).filter((it) => !it.section).map((it) => it.paper.id));
    const p = [...(index ?? [])].filter((x) => !settings.lastExam || x.exam === settings.lastExam).sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0) || (a.set ?? 0) - (b.set ?? 0)).find((x) => !done.has(x.id));
    return p && { id: p.id, exam: p.exam, title: p.title, meta: [`${p.questionCount} 题`, p.durationMinutes && `${p.durationMinutes} 分钟`, p.hasAudio && "含听力"].filter(Boolean).join(" · ") };
  }, [index, items, settings.lastExam]);

  const firstDay = days?.length ? new Date(`${[...days].sort((a, b) => a.day.localeCompare(b.day))[0].day}T00:00:00`).getTime() : undefined;
  const weakest = (kinds ?? [])
    .filter((k) => k.answered >= MIN_ANSWERS)
    .sort((a, b) => a.correct / a.total - b.correct / b.total)[0];

  // 今天的三件事，只用现有数据：待背的词、弱项一篇、本周整卷
  const today = new Date().setHours(0, 0, 0, 0);
  const words = counts ? counts.dueReviews + counts.newLeft : 0;
  const noSource = !settings.activeBook && !vocabCount;
  const suggest = weakest ?? [...(kinds ?? [])].filter((k) => k.kind !== "writing" && k.kind !== "translation").sort((a, b) => a.practiced - b.practiced || b.sections - a.sections)[0];
  const suggestDone = ieltsMode
    ? !!(ieltsAttempts ?? []).some((a) => a.scope !== "full" && (a.submittedAt ?? 0) >= today)
    : !!suggest && !!items?.some((it) => it.section?.kind === suggest.kind && (it.attempt.submittedAt ?? 0) >= today);
  const weekPapers = ieltsMode
    ? (ieltsAttempts ?? []).filter((a) => a.scope === "full" && (a.submittedAt ?? 0) >= weekStart()).length
    : (items ?? []).filter((it) => !it.section && (it.attempt.submittedAt ?? 0) >= weekStart()).length;
  const papersLeft = Math.max(0, WEEKLY_PAPERS - weekPapers);
  const fullPaper = items?.find((it) => !it.section && !it.attempt.submittedAt);
  const all: Todo[] = [
    noSource
      ? { text: "选一本词书", done: false, to: "/books" }
      : {
          text: words ? (
            <>
              背 <span className="num">{words}</span> 个单词
            </>
          ) : (
            "单词背完了"
          ),
          done: !!counts && words === 0,
          to: "/review",
        },
    ieltsMode
      ? { text: "练一篇雅思单项或口语话题", done: suggestDone, to: `/practice?exam=${effectiveExam}` }
      : { text: suggest ? `练一篇${KIND_NAMES[suggest.kind]}` : "练一篇专项", done: suggestDone, to: suggest ? `/practice?kind=${suggest.kind}` : "/practice" },
    {
      text: papersLeft ? (
        <>
          本周还差 <span className="num">{papersLeft}</span> 套整卷
        </>
      ) : (
        "本周两套整卷做完了"
      ),
      done: papersLeft === 0,
      to: ieltsMode
        ? activeIelts
          ? `/ielts/exam/${activeIelts.id}`
          : nextIelts
            ? `/ielts/start/${encodeURIComponent(nextIelts.id)}?scope=full&mode=mock`
            : `/papers?exam=${effectiveExam}`
        : fullPaper
          ? paperPath(fullPaper.paper.id)
          : next
            ? paperPath(next.id)
            : "/papers",
    },
    ...(mistakes
      ? [
          {
            text: (
              <>
                待重做错题 <span className="num">{mistakes}</span>
              </>
            ),
            done: false,
            to: "/mistakes",
          },
        ]
      : []),
  ];
  // 三行以内：没做完的排前面，做完的顶多补到三行
  const todos = [...all.filter((t) => !t.done), ...all.filter((t) => t.done)].slice(0, 3);

  return (
    <div>
      <div className="mb-7">
        <h1 className="t-h1">{greeting()}</h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-500)]">{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p>
      </div>
      <ExamCountdown startedAt={firstDay} weak={weakest ? KIND_NAMES[weakest.kind] : undefined} defaultName={examPreset(effectiveExam ?? next?.exam)} className="mb-5" />

      <div className="@container">
        <div className="grid grid-flow-row-dense grid-cols-1 gap-5 @min-[720px]:grid-cols-2 @min-[1040px]:grid-cols-3">
          {ieltsMode ? (
            <IeltsContinueCard active={activeIelts} next={nextIelts} exam={effectiveExam!} className="@min-[720px]:col-span-2" />
          ) : (
            <ContinueCard item={current} next={next} weakest={weakest} className="@min-[720px]:col-span-2" />
          )}
          <TodayCard todos={todos} />
          <WeekCard days={days ?? []} />
          <div className="card p-6 @max-[1039px]:order-last">
            <Head title="学习日历" to="/stats" link="统计" />
            <Heatmap days={days ?? []} weeks={18} />
          </div>
          {ieltsMode ? (
            <IeltsRecentCard
              runs={(ieltsAttempts ?? []).filter((a) => a.exam === effectiveExam)}
              exam={effectiveExam!}
            />
          ) : (
            <RecentCard items={items} />
          )}
        </div>
      </div>
    </div>
  );
}
