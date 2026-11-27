import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button, Card, EmptyState, LoadingBlock } from "@/components/ui";
import { PaperDialog } from "@/components/overlay";
import { IELTS_QTYPE_ZH, IELTS_SKILLS_ZH, loadIeltsExplain, loadIeltsKey, loadIeltsPaper } from "../data";
import { gradeGroup } from "../grade";
import { QuestionGroupView } from "../exam/QuestionGroupView";
import { deleteIeltsMistake, recordIeltsRetryResult, restoreIeltsMistake, retireIeltsMistake, useIeltsMastery } from "../store";
import type { IeltsAnswerValue, IeltsExamId, IeltsMasteryRow, IeltsPaperGroup } from "../types";
import "../exam/inspera.css";

type Status = "pending" | "retired" | "all";

export function IeltsMistakesView({ exam }: { exam?: IeltsExamId }) {
  const rows = useIeltsMastery();
  const [status, setStatus] = useState<Status>("pending");
  const [skillFilter, setSkillFilter] = useState<"all" | "listening" | "reading">("all");
  const [qtypeFilter, setQtypeFilter] = useState<string>("all");
  const [retrying, setRetrying] = useState<{
    row: IeltsMasteryRow;
    group: IeltsPaperGroup;
    explain: Record<string, string>;
    answers: Record<string, IeltsAnswerValue>;
    checked?: { earned: number; max: number; ok: boolean; perQ: any };
  } | null>(null);

  const all = useMemo(() => (rows ?? []).filter((r) => !exam || r.exam === exam), [rows, exam]);
  const pending = all.filter((r) => !r.retiredAt);
  const qtypes = useMemo(() => [...new Set(all.map((r) => r.qtype))], [all]);

  const shown = all.filter(
    (r) =>
      (status === "all" || (status === "pending" ? !r.retiredAt : Boolean(r.retiredAt))) &&
      (skillFilter === "all" || r.skill === skillFilter) &&
      (qtypeFilter === "all" || r.qtype === qtypeFilter),
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; list: IeltsMasteryRow[]; lastAt: number }>();
    for (const r of shown) {
      let g = map.get(r.paperId);
      if (!g) {
        g = { title: r.paperTitle, list: [], lastAt: 0 };
        map.set(r.paperId, g);
      }
      g.list.push(r);
      g.lastAt = Math.max(g.lastAt, r.updatedAt);
    }
    return [...map.entries()]
      .map(([pid, g]) => ({ pid, ...g, list: g.list.sort((a, b) => a.first - b.first) }))
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [shown]);

  const openRetry = async (row: IeltsMasteryRow) => {
    const [paper, exDoc] = await Promise.all([loadIeltsPaper(row.paperId), loadIeltsExplain(row.paperId)]);
    const partObj = paper[row.skill]?.find((p) => p.part === row.part);
    const grp = partObj?.groups.find((g) => row.first >= g.first && row.first <= g.last);
    if (!grp) return;
    const exPart = exDoc[row.skill]?.find((p) => p.part === row.part);
    setRetrying({
      row,
      group: grp,
      explain: exPart?.explain ?? {},
      answers: {},
    });
  };

  const checkRetry = async () => {
    if (!retrying) return;
    const keyDoc = await loadIeltsKey(retrying.row.paperId);
    const kPart = keyDoc?.[retrying.row.skill]?.find((p) => p.part === retrying.row.part);
    const kGrp = kPart?.groups.find((g) => g.first === retrying.group.first);
    if (!kGrp) return;
    const res = gradeGroup(retrying.group, kGrp, retrying.answers);
    const unit = res.units.find((u) => u.unitKey === retrying.row.unitKey) ?? res.units[0];
    if (!unit) return;
    await recordIeltsRetryResult(retrying.row.id, unit.earned, unit.max, unit.userText);
    setRetrying({
      ...retrying,
      checked: { earned: unit.earned, max: unit.max, ok: unit.ok, perQ: res.perQ },
    });
  };

  if (!rows) return <LoadingBlock text="正在读取雅思错题本…" />;

  if (!all.length) {
    return (
      <Card className="px-6 py-12">
        <EmptyState
          title="还没有雅思错题"
          desc="完成雅思听力或阅读交卷后，答错或未拿满分的题（含多选题组）会自动归档到这里；连续两次重做全对即自动移出。"
          action={
            <Link to="/papers">
              <Button variant="primary">去做一套{exam === "ielts-gt" ? "G类" : "剑雅"}真题</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-8 p-6">
        <div>
          <div className="t-label">待重做题组</div>
          <div className="num mt-1 text-[38px] leading-10">{pending.length}</div>
        </div>
        <div>
          <div className="t-label">已掌握移出</div>
          <div className="num mt-1 text-[26px] leading-10 text-[var(--ink-700)]">{all.length - pending.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "全部科目"],
            ["listening", "听力"],
            ["reading", "阅读"],
          ] as const
        ).map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setSkillFilter(k)} className={cn("pill", skillFilter === k && "pill-on")}>
            {lbl}
          </button>
        ))}

        {qtypes.map((qt) => (
          <button
            key={qt}
            type="button"
            onClick={() => setQtypeFilter(qtypeFilter === qt ? "all" : qt)}
            className={cn("pill", qtypeFilter === qt && "pill-on")}
          >
            {IELTS_QTYPE_ZH[qt] ?? qt}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {(
            [
              ["pending", `待重做 ${pending.length}`],
              ["retired", `已掌握 ${all.length - pending.length}`],
              ["all", "全部"],
            ] as const
          ).map(([st, lbl]) => (
            <button key={st} type="button" onClick={() => setStatus(st)} className={cn("pill", status === st && "pill-on")}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {grouped.map((grp) => (
        <Card key={grp.pid} className="p-5">
          <h3 className="mb-2 text-[16px] font-semibold">{grp.title}</h3>
          <ul className="divide-y divide-[var(--line-soft)]">
            {grp.list.map((r) => {
              const lastWrong = [...r.history].reverse().find((h) => !h.right);
              return (
                <li key={r.id} className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="tag-paper">{IELTS_SKILLS_ZH[r.skill]} P{r.part}</span>
                  <span className="num font-semibold">Q{r.label}</span>
                  <span className="text-[13px] text-[var(--ink-500)]">{IELTS_QTYPE_ZH[r.qtype] ?? r.qtype}</span>
                  <span className="min-w-0 flex-1 text-[14px]">
                    <span className="text-[var(--ink-500)] line-through">{lastWrong?.userText || "（未作答）"}</span>
                    {lastWrong && lastWrong.max > 1 && (
                      <span className="ml-1 text-[12px] text-[#b06d00]">({lastWrong.earned}/{lastWrong.max})</span>
                    )}
                    {" → "}
                    <b className="text-[var(--blue)]">{r.correctText}</b>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" onClick={() => void openRetry(r)}>重做</Button>
                    {r.retiredAt ? (
                      <Button size="sm" variant="ghost" onClick={() => void restoreIeltsMistake(r.id)}>恢复</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void retireIeltsMistake(r.id)}>已掌握</Button>
                    )}
                    <button
                      type="button"
                      title="删除这条错题记录"
                      aria-label="删除这条错题记录"
                      onClick={() => void deleteIeltsMistake(r.id)}
                      className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--ink-400)] transition-colors hover:bg-[var(--red-tint)] hover:text-[var(--red)]"
                    >
                      <Trash className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {/* In-Place Group Retry Dialog */}
      <PaperDialog
        open={Boolean(retrying)}
        onClose={() => setRetrying(null)}
        title={retrying ? `${retrying.row.paperTitle} · 第 ${retrying.row.label} 题重练` : ""}
      >
        {retrying && (
          <div className="space-y-4">
            <div
              className="ielts-cbt theme-bw cbt-sz-0"
              style={{ position: "static", inset: "auto", overflow: "visible", padding: 4, border: "1px solid var(--line)", borderRadius: 6 }}
            >
              <QuestionGroupView
                g={retrying.group}
                ctx={{
                  curQ: retrying.row.first,
                  getAnswer: (n) => retrying.answers[String(n)],
                  setAnswer: (n, v) => {
                    if (retrying.checked) return;
                    setRetrying((prev) => {
                      if (!prev) return prev;
                      const next = { ...prev.answers };
                      if (v === undefined) delete next[String(n)];
                      else next[String(n)] = v;
                      return { ...prev, answers: next };
                    });
                  },
                  focusQ: () => {},
                  pickedMatchOpt: null,
                  setPickedMatchOpt: () => {},
                  onZoomImg: () => {},
                  review: retrying.checked
                    ? {
                        perQ: retrying.checked.perQ,
                        explain: retrying.explain,
                        source: {},
                      }
                    : null,
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              {retrying.checked ? (
                <span className={cn("text-[14px] font-semibold", retrying.checked.ok ? "text-[#1b7530]" : "text-[#b3261e]")}>
                  {retrying.checked.ok
                    ? "✓ 回答完全正确！（连续两次全对自动移出错题本）"
                    : `得分 ${retrying.checked.earned} / ${retrying.checked.max}，请查看上方正确答案与解析`}
                </span>
              ) : (
                <span className="text-[13px] text-[var(--ink-500)]">完成本组题目后点击右侧核对</span>
              )}
              <div className="flex gap-2">
                <Button onClick={() => setRetrying(null)}>关闭</Button>
                {!retrying.checked && (
                  <Button variant="primary" onClick={() => void checkRetry()}>
                    核对答案
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </PaperDialog>
    </div>
  );
}
