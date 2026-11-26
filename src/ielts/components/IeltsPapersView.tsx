import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import { cn, timeAgo } from "@/lib/utils";
import { Button, Card, EmptyState, LoadingBlock } from "@/components/ui";
import { PaperDialog } from "@/components/overlay";
import { StickyTab } from "@/components/paper-ui";
import { IELTS_SKILLS_ZH, ieltsPaperLabel, useIeltsIndex } from "../data";
import { deletePaperIeltsAttempts, useIeltsAttempts } from "../store";
import { DeleteRunButton } from "./DeleteRunButton";
import type { IeltsAttemptRow, IeltsExamId, IeltsIndexEntry, IeltsRunMode, IeltsSkill } from "../types";

type StatusFilter = "all" | "new" | "doing" | "done";

function runAnsweredCount(r: IeltsAttemptRow): number {
  let n = 0;
  for (const st of Object.values(r.sections)) {
    if (!st) continue;
    n += Object.keys(st.answers).length;
    n += Object.values(st.essays).filter((v) => v.trim().length > 0).length;
  }
  return n;
}

export function IeltsPapersView({ exam }: { exam: IeltsExamId }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { index, error } = useIeltsIndex();
  const attempts = useIeltsAttempts();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [launcher, setLauncher] = useState<{ entry: IeltsIndexEntry; skill: IeltsSkill } | null>(null);
  const [historyEntry, setHistoryEntry] = useState<IeltsIndexEntry | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const sourceParam = params.get("source") || "all";
  const allForExam = useMemo(
    () => (index?.papers ?? []).filter((p) => p.exam === exam),
    [index, exam],
  );

  // Map latest full-mock, per-skill state, and all runs per paper
  const byPaper = useMemo(() => {
    const map = new Map<
      string,
      {
        runs: IeltsAttemptRow[];
        activeFullRun?: IeltsAttemptRow;
        doneFullBand?: number | null;
        lastDoneRunId?: string;
        skillState: Partial<
          Record<IeltsSkill, { activeRun?: IeltsAttemptRow; doneRun?: IeltsAttemptRow; band?: number | null }>
        >;
      }
    >();
    for (const a of attempts ?? []) {
      let rec = map.get(a.paperId);
      if (!rec) {
        rec = { runs: [], skillState: {} };
        map.set(a.paperId, rec);
      }
      rec.runs.push(a);
      if (a.scope === "full") {
        if (!a.submittedAt && !rec.activeFullRun) rec.activeFullRun = a;
        else if (a.submittedAt && !rec.lastDoneRunId) {
          rec.lastDoneRunId = a.id;
          rec.doneFullBand = a.overallBand;
        }
      }
      for (const s of a.skills) {
        const cur = (rec.skillState[s] ??= {});
        const sec = a.sections[s];
        if (!a.submittedAt && (a.scope === s || a.currentSkill === s) && !cur.activeRun) {
          cur.activeRun = a;
        }
        if (a.submittedAt && sec?.status === "submitted" && !cur.doneRun) {
          cur.doneRun = a;
          cur.band = sec.result?.band;
        }
      }
    }
    return map;
  }, [attempts]);

  const statusOf = (pid: string): Exclude<StatusFilter, "all"> => {
    const r = byPaper.get(pid);
    if (!r || r.runs.length === 0) return "new";
    if (r.activeFullRun || Object.values(r.skillState).some((x) => x?.activeRun)) return "doing";
    if (r.lastDoneRunId || Object.values(r.skillState).some((x) => x?.doneRun)) return "done";
    return "new";
  };

  const sourceFiltered = allForExam.filter((p) => sourceParam === "all" || p.family === sourceParam);
  const shown = sourceFiltered.filter((p) => status === "all" || statusOf(p.id) === status);

  const groups = useMemo(() => {
    const camMap = new Map<string, { label: string; tag: string; list: IeltsIndexEntry[] }>();
    for (const p of shown) {
      const key =
        p.family === "cam" || p.family === "gt"
          ? `book-${p.book}`
          : p.family === "jj"
            ? `jj-${p.group || "机经Pro"}`
            : "rb";
      const tag =
        p.family === "cam" || p.family === "gt"
          ? `C${p.book}`
          : p.family === "jj"
            ? "机经"
            : "密卷";
      const label =
        p.family === "cam"
          ? `剑桥雅思真题 ${p.book}（A类）`
          : p.family === "gt"
            ? `剑桥雅思真题 ${p.book}（G类）`
            : p.family === "jj"
              ? p.group || "机经 Pro 套题"
              : "雅思红皮密卷";
      if (!camMap.has(key)) camMap.set(key, { label, tag, list: [] });
      camMap.get(key)!.list.push(p);
    }
    return [...camMap.entries()];
  }, [shown]);

  if (error) return <EmptyState title="雅思题库目录加载失败" desc={error} />;
  if (!index) return <LoadingBlock text="正在读取雅思题库目录…" />;

  const historyRuns = historyEntry ? (byPaper.get(historyEntry.id)?.runs ?? []) : [];
  const launcherSkillRuns = launcher
    ? (byPaper.get(launcher.entry.id)?.runs ?? []).filter((r) => r.scope === launcher.skill)
    : [];

  return (
    <div>
      {/* Source sub-filters for Academic */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {exam === "ielts-a" ? (
          <div className="flex flex-wrap gap-2">
            {[
              ["all", `全部 (${allForExam.length})`],
              ["cam", `剑雅真题 (${allForExam.filter((p) => p.family === "cam").length})`],
              ["jj", `机经 Pro (${allForExam.filter((p) => p.family === "jj").length})`],
              ["rb", `红皮密卷 (${allForExam.filter((p) => p.family === "rb").length})`],
            ].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setParams(val === "all" ? { exam } : { exam, source: val }, { replace: true })}
                className={cn("pill", sourceParam === val && "pill-on")}
              >
                {lbl}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-[var(--ink-500)]">剑桥雅思 G 类培训真题共 {allForExam.length} 套（共用对应 A 类听力）</div>
        )}

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "全部"],
              ["new", "没做过"],
              ["doing", "进行中"],
              ["done", "已完成"],
            ] as const
          ).map(([v, lbl]) => {
            const cnt = v === "all" ? sourceFiltered.length : sourceFiltered.filter((p) => statusOf(p.id) === v).length;
            return (
              <button key={v} type="button" onClick={() => setStatus(v)} className={cn("pill", status === v && "pill-on")}>
                {lbl} <span className="num">{cnt}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Gentle narrow-screen hint */}
      <p className="mb-5 text-[13px] text-[var(--ink-500)] md:hidden">
        提示：手机竖屏已适配原文/题目顶栏切换；若进行「整套模考」建议在电脑或平板横屏下体验完整 1:1 双栏机考。
      </p>

      {groups.length === 0 ? (
        <p className="py-12 text-center text-[14px] text-[var(--ink-500)]">没有符合筛选条件的试卷</p>
      ) : (
        <div className="space-y-6">
          {groups.map(([gKey, grp]) => (
            <section key={gKey} className="grid grid-cols-[44px_minmax(0,1fr)]">
              <StickyTab vertical className="sticky top-6 mt-3 self-start">
                <span className="num text-[14px] font-semibold">{grp.tag}</span>
              </StickyTab>
              <div className="rounded-[14px] rounded-tl-[4px] bg-[var(--paper-200)]/60 p-4 shadow-[inset_0_1px_2px_rgba(28,35,48,0.06)]">
                <h3 className="mb-3 px-1 text-[15px] font-semibold text-[var(--ink-700)]">{grp.label}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {grp.list.map((entry) => {
                    const rec = byPaper.get(entry.id);
                    const runCount = rec?.runs.length ?? 0;
                    return (
                      <Card key={entry.id} className="flex flex-col justify-between gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[16px] font-semibold">{ieltsPaperLabel(entry)}</div>
                            <div className="mt-0.5 text-[12.5px] text-[var(--ink-500)]">
                              {entry.skills.map((s) => `${IELTS_SKILLS_ZH[s]}${entry.q[s] ? ` ${entry.q[s]}` : ""}`).join(" · ")}
                              {!entry.fullMock && "（听读组合）"}
                            </div>
                            {entry.hit && (
                              <div className="mt-1 text-[12px] text-[var(--blue)]">
                                最近命中 {entry.hit.date} · {entry.hit.label} {entry.hit.place ? `（${entry.hit.place}）` : ""}
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            {rec?.doneFullBand != null && (
                              <Link
                                to={`/ielts/review/${rec.lastDoneRunId}`}
                                className="tag-paper bg-[var(--blue-tint)] font-semibold text-[var(--blue)] hover:underline"
                              >
                                Band ≈ {rec.doneFullBand.toFixed(1)}
                              </Link>
                            )}
                            {runCount > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmClearAll(false);
                                  setHistoryEntry(entry);
                                }}
                                title="查看或删除这套试卷的做题记录"
                                className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--paper-100)] px-2.5 text-[12px] font-medium text-[var(--ink-700)] transition-colors hover:bg-white hover:text-[var(--ink)]"
                              >
                                <ClockCounterClockwise className="size-3.5" />
                                记录 <span className="num">{runCount}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Link
                            to={
                              rec?.activeFullRun
                                ? `/ielts/exam/${rec.activeFullRun.id}`
                                : `/ielts/start/${encodeURIComponent(entry.id)}?scope=full&mode=mock`
                            }
                          >
                            <Button size="sm" variant="primary">
                              {rec?.activeFullRun ? "继续模考" : entry.fullMock ? "整套模考" : "连考听读"}
                            </Button>
                          </Link>

                          {rec?.activeFullRun && (
                            <DeleteRunButton run={rec.activeFullRun} label="放弃" className="h-8 px-2.5" />
                          )}

                          {(["listening", "reading", "writing"] as IeltsSkill[]).map((sk) => {
                            const available = entry.skills.includes(sk);
                            const skSt = rec?.skillState[sk];
                            return (
                              <button
                                key={sk}
                                type="button"
                                disabled={!available}
                                onClick={() => setLauncher({ entry, skill: sk })}
                                className={cn(
                                  "h-8 rounded-[8px] px-2.5 text-[13px] font-medium transition-colors disabled:opacity-35",
                                  skSt?.activeRun
                                    ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                                    : skSt?.doneRun
                                      ? "bg-[var(--paper-100)] text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--blue-line)]"
                                      : "bg-[var(--paper-100)] text-[var(--ink-700)] hover:bg-white",
                                )}
                              >
                                {IELTS_SKILLS_ZH[sk]}
                                {skSt?.band != null ? ` ${skSt.band.toFixed(1)}` : ""}
                              </button>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Single-Skill Mode Launcher Modal */}
      <PaperDialog
        open={Boolean(launcher)}
        onClose={() => setLauncher(null)}
        title={launcher ? `${ieltsPaperLabel(launcher.entry)} · ${IELTS_SKILLS_ZH[launcher.skill]}` : ""}
      >
        {launcher && (
          <div className="space-y-4">
            {launcherSkillRuns.length > 0 && (
              <div className="rounded-[10px] bg-[var(--paper-100)] p-3">
                <div className="mb-2 text-[12.5px] font-semibold text-[var(--ink-700)]">已有单科记录：</div>
                <ul className="space-y-1.5">
                  {launcherSkillRuns.slice(0, 5).map((r) => {
                    const sec = r.sections[launcher.skill];
                    const b = sec?.result?.band;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 rounded-[8px] bg-white px-3 py-2 text-[13px] shadow-2xs">
                        <div className="min-w-0">
                          <span className="font-medium">
                            {r.mode === "mock" ? "限时机考" : "自由练习"}
                          </span>
                          <span className="ml-2 text-[var(--ink-500)]">
                            {r.submittedAt
                              ? `${b != null ? `Band ${b.toFixed(1)}` : "已交卷"} · ${timeAgo(r.submittedAt)}`
                              : `进行中（已答 ${runAnsweredCount(r)} 处）· ${timeAgo(r.updatedAt)}`}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Link
                            to={r.submittedAt ? `/ielts/review/${r.id}?skill=${launcher.skill}` : `/ielts/exam/${r.id}`}
                            onClick={() => setLauncher(null)}
                            className="rounded-[6px] bg-[var(--blue-tint)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--blue)] hover:underline"
                          >
                            {r.submittedAt ? "查看复盘" : "继续作答"}
                          </Link>
                          <DeleteRunButton run={r} iconOnly />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="text-[14px] text-[var(--ink-700)]">
              {launcherSkillRuns.some((r) => !r.submittedAt) ? "或新开一轮单科练习：" : "选择本次单科作答模式："}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["mock", "全真机考模式", "限时自动交卷、听力连续播放一遍且带 2 分钟检查、全程锁死辅助功能"],
                  ["practice", "自由练习模式", "不限时、听力支持暂停倍速与拖动，适合日常精听精读拆练"],
                ] as [IeltsRunMode, string, string][]
              ).map(([m, title, desc]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    const target = `/ielts/start/${encodeURIComponent(launcher.entry.id)}?scope=${launcher.skill}&mode=${m}&new=1`;
                    setLauncher(null);
                    navigate(target);
                  }}
                  className="card card-press flex flex-col items-start p-4 text-left hover:shadow-[0_0_0_2px_var(--blue)]"
                >
                  <div className="text-[15px] font-semibold">{title}</div>
                  <div className="mt-1 text-[12.5px] leading-5 text-[var(--ink-500)]">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </PaperDialog>

      {/* Per-Paper Attempt Records Manager Modal */}
      <PaperDialog
        open={Boolean(historyEntry)}
        onClose={() => setHistoryEntry(null)}
        title={historyEntry ? `${ieltsPaperLabel(historyEntry)} · 做题记录` : ""}
        description="可继续未完成的考试、查看历次复盘，或删除任意一条记录（删除后自动同步）。"
      >
        {historyEntry && (
          <div className="mt-3 space-y-3">
            {historyRuns.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-[var(--ink-500)]">这套试卷暂无做题记录。</p>
            ) : (
              <>
                <ul className="max-h-[55dvh] divide-y divide-[var(--line-soft)] overflow-y-auto rounded-[10px] border border-[var(--line-soft)] bg-white">
                  {historyRuns.map((r) => {
                    const scopeTitle = r.scope === "full" ? "整套机考" : `${IELTS_SKILLS_ZH[r.currentSkill]}单项`;
                    const modeTitle = r.mode === "mock" ? "全真模式" : "自由练习";
                    const ansCnt = runAnsweredCount(r);
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[14px] font-semibold">
                            <span>{scopeTitle}</span>
                            <span className="tag-paper text-[11.5px] font-normal">{modeTitle}</span>
                            {r.submittedAt ? (
                              <span className="num text-[13px] text-[var(--blue)]">
                                {r.overallBand != null ? `Band ≈ ${r.overallBand.toFixed(1)}` : "已交卷"}
                              </span>
                            ) : (
                              <span className="text-[12.5px] text-[#b87400]">进行中 · 已答 {ansCnt} 处</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[12px] text-[var(--ink-500)]">
                            {new Date(r.submittedAt ?? r.updatedAt).toLocaleString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" · "}
                            {timeAgo(r.submittedAt ?? r.updatedAt)}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Link
                            to={r.submittedAt ? `/ielts/review/${r.id}` : `/ielts/exam/${r.id}`}
                            onClick={() => setHistoryEntry(null)}
                          >
                            <Button size="sm" variant={r.submittedAt ? "secondary" : "primary"}>
                              {r.submittedAt ? "复盘" : "继续"}
                            </Button>
                          </Link>
                          <DeleteRunButton run={r} />
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {historyRuns.length > 1 && (
                  <div className="flex items-center justify-end pt-1">
                    {!confirmClearAll ? (
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ink-500)] hover:text-[var(--red)]"
                      >
                        <Trash className="size-3.5" /> 清空本套全部 {historyRuns.length} 条记录
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void deletePaperIeltsAttempts(historyEntry.id).then(() => {
                            setConfirmClearAll(false);
                            setHistoryEntry(null);
                          });
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[var(--red)] px-3 text-[12.5px] font-semibold text-white"
                      >
                        <Trash className="size-3.5" /> 确认清空全部 {historyRuns.length} 条记录
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </PaperDialog>
    </div>
  );
}
