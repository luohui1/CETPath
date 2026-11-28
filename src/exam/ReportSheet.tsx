import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowCounterClockwise, Lightbulb, Sparkle } from "@phosphor-icons/react";
import type { AttemptMode, AttemptRow } from "@/lib/db";
import type { Paper, Question, Section } from "@/lib/papers";
import { buildReport, clock } from "@/lib/report";
import { MIN_ANSWERS, pct, useAttemptItems, useKindStats, usePaperIndex } from "@/lib/insights";
import { cn, formatClock } from "@/lib/utils";
import { PaperDialog } from "@/components/overlay";
import { Stamp } from "@/components/paper-ui";
import { Button } from "@/components/ui";

const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} 分钟`;

/**
 * 交卷单（B 轮第 3 节）：交卷后立刻出来的一张纸——顶上一道红线、衬线大数字、一枚章（≥60% 蓝章"通过"，<60% 红章"再练"）。
 * 下面是各部分正确率和用时、比上次、最弱部分、最慢的 5 题、错题（点了收起交卷单，到卷面上看这道题的解析），最后三个去处
 */
export function ReportSheet({
  open,
  onClose,
  paper,
  scope,
  mode,
  attempt,
  retired,
  back,
  onExplain,
  onExplainQ,
  onRetry,
  onAgent,
}: {
  open: boolean;
  onClose: () => void;
  paper: Paper;
  scope?: Section;
  mode: AttemptMode;
  attempt: AttemptRow;
  retired: string[];
  back: { to: string; label: string };
  onExplain: () => void;
  onExplainQ: (q: Question) => void; // 点了某道错题：考场打开这道题和它的解析
  onRetry: (ids: string[]) => void;
  onAgent: () => void; // 收起交卷单，打开 Agent 直接复盘这次作答
}) {
  const report = useMemo(() => buildReport(paper, attempt), [paper, attempt]);
  const { index } = usePaperIndex();
  const items = useAttemptItems(open ? index : null);
  const examIndex = useMemo(() => index?.filter((p) => p.exam === paper.exam) ?? null, [index, paper.exam]);
  const examItems = useMemo(() => items?.filter((it) => it.paper.exam === paper.exam) ?? null, [items, paper.exam]);
  const kinds = useKindStats(open ? examIndex : null, open ? examItems : null);

  // 比上次：同一考试上一次交卷的整套（专项比同一题型）记录
  const prev = useMemo(() => {
    if (!items || mode === "retry" || !attempt.submittedAt) return null;
    const last = items
      .filter((it) => it.key !== attempt.paperId && it.paper.exam === paper.exam && it.attempt.total && (it.attempt.submittedAt ?? Infinity) < attempt.submittedAt!)
      .filter((it) => (scope ? it.section?.kind === scope.kind : !it.section))
      .sort((a, b) => b.attempt.submittedAt! - a.attempt.submittedAt!)[0];
    return last ? pct(last.attempt.score ?? 0, last.attempt.total!) : null;
  }, [items, mode, attempt, paper.exam, scope]);

  const scored = report.sections.filter((s) => s.total);
  // 最弱：正确率最低的部分，和你在这种题型上的平均比
  const weakest = scored.length > 1 ? [...scored].sort((a, b) => a.correct / a.total - b.correct / b.total)[0] : undefined;
  const avg = weakest && kinds?.find((k) => k.kind === weakest.kind);
  const below = weakest && avg && avg.answered >= MIN_ANSWERS ? pct(avg.correct, avg.total) - pct(weakest.correct, weakest.total) : null;
  const showTime = report.sections.some((s) => s.sec);
  const p = report.pct;
  const diff = p !== null && prev !== null ? p - prev : null;
  const wrongIds = report.wrong.map((w) => w.q.id);
  const title = mode === "retry" ? "重做错题" : scope ? `${report.sections[0]?.name ?? ""} · ${paper.title}` : paper.title;

  return (
    <PaperDialog
      open={open}
      onClose={onClose}
      board
      width={600}
      title="交卷单"
      footer={
        <>
          <Link to={back.to} className="btn btn-ghost">
            {back.label}
          </Link>
          {report.total > 0 && (
            <Button onClick={onExplain}>
              <Lightbulb className="size-[18px]" /> 看解析
            </Button>
          )}
          {report.wrong.length > 0 && (
            <Button onClick={() => onRetry(wrongIds)}>
              <ArrowCounterClockwise className="size-[18px]" /> 重做错题（{report.wrong.length}）
            </Button>
          )}
          <Button variant="primary" onClick={onAgent}>
            <Sparkle className="size-[18px]" /> 找 Agent 复盘
          </Button>
        </>
      }
    >
      <div className="mt-1 flex items-baseline justify-between gap-4 text-[14px]">
        <span className="min-w-0 truncate text-[var(--ink-700)]">{title}</span>
        <span className="flex-none text-[var(--ink-500)]">
          用时 <span className="num text-[var(--ink)]">{formatClock(attempt.spentSec ?? 0)}</span>
        </span>
      </div>

      {/* 大数字 + 章 */}
      <div className="mt-4 flex items-center gap-5">
        {p !== null ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="num text-[48px] leading-[52px]">
              {report.score}
              <span className="text-[24px] text-[var(--ink-500)]"> / {report.total}</span>
            </span>
            <span className="num text-[24px] text-[var(--ink-700)]">{p}%</span>
            {diff !== null && (
              <span className="text-[14px] text-[var(--ink-500)]">
                {diff >= 0 ? "▲" : "▼"} 比上次 <span className="num text-[var(--ink)]">{`${diff >= 0 ? "+" : ""}${diff}%`}</span>
              </span>
            )}
          </div>
        ) : (
          <div className="num flex-1 text-[40px] leading-[44px]">
            {report.sections.reduce((n, s) => n + (s.written?.[0] ?? 0), 0)}
            <span className="ml-1 font-[family-name:var(--font-sans)] text-[16px] font-normal text-[var(--ink-500)]">{report.sections.find((s) => s.written)?.written?.[1] ?? "词"}</span>
          </div>
        )}
        {p !== null && (
          <Stamp tone={p >= 60 ? "blue" : "red"} size="lg" double animate id={attempt.paperId} className="flex-none">
            {p >= 60 ? "通过" : "再练"}
          </Stamp>
        )}
      </div>

      {/* 各部分：正确率、用时（旧记录没有用时就不显示这一列）、细条；写作翻译只说写了多少 */}
      {report.sections.length > 1 && (
        <div className="rule mt-5 pt-3">
          {report.sections.map((s) => (
            <div key={s.id} className={cn("grid min-h-10 items-center gap-3 text-[14px]", showTime ? "grid-cols-[minmax(0,1fr)_4em_3.2em_8.5em_minmax(0,5em)]" : "grid-cols-[minmax(0,1fr)_4em_3.2em_minmax(0,6em)]")}>
              <span className="truncate font-medium">{s.name}</span>
              {s.total ? (
                <>
                  <span className="num text-right text-[var(--ink-700)]">
                    {s.correct}/{s.total}
                  </span>
                  <span className="num text-right">{pct(s.correct, s.total)}%</span>
                </>
              ) : (
                <span className="col-span-2 text-right text-[13px] text-[var(--ink-500)]">
                  已写 <span className="num text-[var(--ink)]">{s.written?.[0] ?? 0}</span> {s.written?.[1]}
                </span>
              )}
              {showTime && (
                <span className="text-right text-[13px] whitespace-nowrap text-[var(--ink-500)]">
                  {s.sec ? (
                    <>
                      {minutes(s.sec)}
                      {s.perQuestion && s.total ? <span className="num"> · {clock(s.perQuestion)}/题</span> : null}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              )}
              {s.total ? (
                <span className="meter" aria-hidden>
                  <span style={{ width: `${pct(s.correct, s.total)}%` }} />
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
          {weakest && pct(weakest.correct, weakest.total) < 100 && (
            <p className="mt-2 text-[14px] text-[var(--ink-700)]">
              最弱：{weakest.name}
              {below !== null && below > 0 && <> · 比你的平均低 <span className="num">{below}%</span></>}
            </p>
          )}
        </div>
      )}
      {report.sections.length === 1 && report.sections[0].perQuestion && report.sections[0].total > 0 && (
        <p className="mt-3 text-[14px] text-[var(--ink-500)]">
          平均每题 <span className="num text-[var(--ink)]">{clock(report.sections[0].perQuestion)}</span>
        </p>
      )}
      {report.slowest.length > 0 && (
        <p className="mt-2 text-[14px] text-[var(--ink-700)]">
          最慢：
          {report.slowest.map((x, i) => (
            <span key={x.q.id}>
              {i > 0 && " · "}
              <span className="num">{x.q.label ?? x.q.number}</span> 题 <span className="num">{clock(x.sec)}</span>
            </span>
          ))}
        </p>
      )}

      {/* 错题：题号 你选→答案，点了到卷面上看解析（和点题号看解析是同一个状态） */}
      {report.total > 0 && (
        <div className="rule mt-5 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
            <span>
              错题 <span className="num text-[18px]">{report.wrong.length}</span> 道 · 未答 <span className="num text-[18px]">{report.skipped.length}</span> 道
            </span>
            <span className="text-[13px] text-[var(--ink-500)]">
              {mode === "retry" ? (retired.length ? `已掌握 ${retired.length} 道，移出错题本` : "连续做对两次的题会移出错题本") : report.wrong.length ? "全部已加入错题本" : ""}
            </span>
          </div>
          {report.wrong.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {report.wrong.map(({ q, chosen }) => (
                <button key={q.id} type="button" onClick={() => onExplainQ(q)} aria-label={`第 ${q.number} 题，选了 ${chosen}，答案 ${q.answer}，看解析`} className="pill h-9 gap-1.5 px-3">
                  <span className="num">{q.number}</span>
                  <span className="text-[var(--ink-500)] line-through decoration-1">{chosen}</span>→<span className="text-[var(--blue)]">{q.answer}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </PaperDialog>
  );
}
