import { useState } from "react";
import { cn } from "@/lib/utils";
import type { QuizQ } from "@/lib/agentTools";

/** Agent 出的练习题卡：点一个选项立刻判对错、出解析 */
export function AgentQuiz({
  quiz,
}: {
  quiz: { title?: string; questions: QuizQ[] };
}) {
  const [picks, setPicks] = useState<Record<number, string>>({});
  const total = quiz.questions.length;
  const done = Object.keys(picks).length;
  const right = quiz.questions.filter((q, i) => picks[i] === q.answer).length;
  return (
    <div className="mt-2 overflow-hidden rounded-[12px] ring-1 ring-[var(--line)]">
      <div className="flex items-center gap-2 bg-[var(--paper-100)] px-3 py-2 text-[13px] font-medium">
        <span className="flex-1">{quiz.title || "同类练习"}</span>
        <span className="num text-[var(--ink-500)]">
          {done === total ? `答对 ${right}/${total}` : `${done}/${total}`}
        </span>
      </div>
      <ol className="divide-y divide-[var(--line-soft)]">
        {quiz.questions.map((q, i) => {
          const p = picks[i];
          return (
            <li key={i} className="space-y-2 px-3 py-3">
              <p className="font-serif text-[15px] leading-[1.6] whitespace-pre-line">
                <span className="num mr-1 text-[var(--ink-500)]">{i + 1}.</span>
                {q.stem}
              </p>
              <div className="grid gap-1.5">
                {q.options.map((o, j) => {
                  const L = "ABCD"[j];
                  return (
                    <button
                      key={j}
                      type="button"
                      disabled={!!p}
                      onClick={() => setPicks({ ...picks, [i]: L })}
                      className={cn(
                        "flex items-start gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[14px] leading-[1.5] ring-1 transition-colors",
                        !p
                          ? "ring-[var(--line)] hover:bg-[var(--blue-tint)]"
                          : L === q.answer
                            ? "bg-[var(--blue-tint)] text-[var(--blue)] ring-[var(--blue-line)]"
                            : p === L
                              ? "bg-[var(--red-tint,#fdecec)] text-[var(--red)] ring-transparent"
                              : "opacity-55 ring-[var(--line-soft)]",
                      )}
                    >
                      <span className="num font-semibold">{L}</span>
                      <span className="font-serif">
                        {o.replace(/^[A-D][).．、]\s*/, "")}
                      </span>
                    </button>
                  );
                })}
              </div>
              {p && (
                <p className="rounded-[8px] bg-[var(--paper-100)] px-2.5 py-2 text-[13px] leading-[1.6] text-[var(--ink-700)]">
                  <b
                    className={
                      p === q.answer
                        ? "text-[var(--blue)]"
                        : "text-[var(--red)]"
                    }
                  >
                    {p === q.answer ? "答对了" : `答案是 ${q.answer}`}
                  </b>{" "}
                  · {q.explain}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
