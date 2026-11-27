import { Link } from "react-router";
import * as G from "@/grasso";
import { IELTS_SKILLS_ZH } from "../data";
import { useIeltsAttempts } from "../store";
import type { IeltsExamId } from "../types";
import { DeleteRunButton } from "./DeleteRunButton";

const shortDate = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * Pure IELTS Mock Band Progression Panel:
 * Strictly counts ONLY unassisted `mode === "mock"` runs (`!r.assisted`) in the Band curve,
 * while listing all runs below so any ongoing or submitted record can be reviewed or deleted.
 */
export function IeltsStatsPanel({ exam }: { exam?: IeltsExamId }) {
  const rawAttempts = useIeltsAttempts();
  if (!rawAttempts) return null;
  const attempts = exam ? rawAttempts.filter((a) => a.exam === exam) : rawAttempts;

  const pureMocks = attempts
    .filter((a) => a.submittedAt && a.mode === "mock" && !a.assisted && a.overallBand != null)
    .sort((a, b) => a.submittedAt! - b.submittedAt!);

  if (!attempts.length) {
    return (
      <p className="well px-4 py-8 text-center text-[14px] text-[var(--ink-500)]">
        完成雅思全真机考交卷后，这里会记录纯净模考的听力、阅读与综合估算 Band 走势（开启过查词辅助的自由练习将单独归档，不污染模考曲线）。
      </p>
    );
  }

  const last = pureMocks[pureMocks.length - 1];

  return (
    <div className="space-y-5">
      {last && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "听力 Band", val: last.sections.listening?.result?.band },
            { label: "阅读 Band", val: last.sections.reading?.result?.band },
            { label: "听读估算均分", val: last.overallBand },
          ].map((x) => (
            <div key={x.label} className="well px-4 py-3">
              <div className="t-label">最近纯净模考 · {x.label}</div>
              <div className="num mt-1 text-[30px] leading-9">{x.val != null ? x.val.toFixed(1) : "—"}</div>
            </div>
          ))}
        </div>
      )}

      {pureMocks.length > 1 && (
        <G.LineChart
          data={pureMocks.slice(-12).map((r) => ({
            label: shortDate(r.submittedAt!),
            综合: r.overallBand ?? 0,
            ...(r.sections.listening?.result?.band != null ? { 听力: r.sections.listening.result.band } : {}),
            ...(r.sections.reading?.result?.band != null ? { 阅读: r.sections.reading.result.band } : {}),
          }))}
          series={[
            { key: "综合", label: "估算均分" },
            { key: "听力", label: "听力" },
            { key: "阅读", label: "阅读" },
          ]}
          height={200}
          ariaLabel="历次纯净雅思模考 Band 走势"
          xLabel="交卷日期"
        />
      )}

      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[13px] text-[var(--ink-500)]">
            <th className="pb-2 font-normal">日期</th>
            <th className="pb-2 font-normal">试卷与范围</th>
            <th className="pb-2 font-normal">状态 / 模式</th>
            <th className="pb-2 text-right font-normal">听力</th>
            <th className="pb-2 text-right font-normal">阅读</th>
            <th className="pb-2 text-right font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {attempts.slice(0, 15).map((r) => {
            const scopeLabel = r.scope === "full" ? "整套" : IELTS_SKILLS_ZH[r.currentSkill];
            return (
              <tr key={r.id} className="border-t border-[var(--line-soft)]">
                <td className="num py-2 pr-3 whitespace-nowrap text-[var(--ink-500)]">
                  {shortDate(r.submittedAt ?? r.updatedAt)}
                </td>
                <td className="py-2 pr-3">
                  {r.paperTitle} <span className="text-[12px] text-[var(--ink-500)]">· {scopeLabel}</span>
                </td>
                <td className="py-2 pr-3 text-[12.5px] text-[var(--ink-500)]">
                  {!r.submittedAt ? (
                    <span className="text-[#b87400]">进行中</span>
                  ) : r.mode === "mock" && !r.assisted ? (
                    "纯净模考"
                  ) : (
                    "单项练习"
                  )}
                </td>
                <td className="num py-2 text-right">{r.sections.listening?.result?.band?.toFixed(1) ?? "—"}</td>
                <td className="num py-2 text-right">{r.sections.reading?.result?.band?.toFixed(1) ?? "—"}</td>
                <td className="py-2 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    <Link
                      to={r.submittedAt ? `/ielts/review/${r.id}` : `/ielts/exam/${r.id}`}
                      className="text-[13px] font-medium text-[var(--blue)] hover:underline"
                    >
                      {r.submittedAt ? "查看" : "继续"}
                    </Link>
                    <DeleteRunButton run={r} iconOnly />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
