import { useEffect, useRef, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { cn, formatClock } from "@/lib/utils";

const WARNINGS = [
  { at: 600, text: "还剩 10 分钟" },
  { at: 300, text: "还剩 5 分钟，注意时间" },
  { at: 0, text: "考试时间到。可以继续作答，用时会记下超时" },
];

/**
 * 考场计时（参照 Bluebook）：整套按考试时长倒计时，可以隐藏，剩 5 分钟时强制显示；
 * 超时不收卷，继续计时并标红。专项训练没有时长，正计时。
 * elapsed 由做题页每 15 秒存一次，这里每秒往前走，下次存档时对齐。
 */
export function ExamTimer({ elapsed, running, limit }: { elapsed: number; running: boolean; limit: number | null }) {
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const base = useRef({ elapsed, at: Date.now() });
  const [, setTick] = useState(0);

  useEffect(() => {
    base.current = { elapsed, at: Date.now() };
  }, [elapsed]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // 页面在后台时不累计，最多往前走 20 秒，等存档对齐
  const live = running ? base.current.elapsed + Math.min(20, Math.floor((Date.now() - base.current.at) / 1000)) : elapsed;
  const remaining = limit === null ? null : limit - live;

  // 跨过 10 分钟、5 分钟、0 时提醒一次
  const last = useRef(remaining);
  useEffect(() => {
    const prev = last.current;
    last.current = remaining;
    if (!running || remaining === null || prev === null) return;
    const hit = WARNINGS.find((w) => prev > w.at && remaining <= w.at);
    if (hit) setMessage(hit.text);
  }, [remaining, running]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 8000);
    return () => clearTimeout(t);
  }, [message]);

  const urgent = remaining !== null && remaining <= 300;
  const show = !hidden || urgent || !running;
  const label = !running ? `用时 ${formatClock(elapsed)}` : remaining === null ? `已用 ${formatClock(live)}` : remaining >= 0 ? `剩余 ${formatClock(remaining)}` : `超时 ${formatClock(-remaining)}`;
  const tone = !running
    ? "text-muted"
    : remaining === null || remaining > 600
      ? "text-text"
      : remaining > 300
        ? "bg-[var(--star-tint)] text-[var(--star-ink)]"
        : "bg-[var(--danger-tint)] text-danger";

  return (
    <div className="relative">
      <div className={cn("num flex h-8 items-center gap-1.5 rounded-full pr-1 pl-3 text-[14px] font-semibold transition-colors", tone)}>
        <span className="min-w-[6.5em] font-[family-name:var(--font-sans)] text-[13px] font-medium" aria-live="off">
          {show ? label : "时间已隐藏"}
        </span>
        {running && !urgent && (
          <button type="button" onClick={() => setHidden(!hidden)} className="gr-iconbtn size-6" aria-label={hidden ? "显示时间" : "隐藏时间"} title={hidden ? "显示时间" : "隐藏时间（剩 5 分钟时会自动显示）"}>
            {hidden ? <Eye className="size-4" /> : <EyeSlash className="size-4" />}
          </button>
        )}
      </div>
      {message && (
        <div role="status" className="card card-float animate-pop absolute top-full right-0 z-40 mt-2 rounded-[12px] px-3 py-2 text-[12px] whitespace-nowrap text-text">
          {message}
        </div>
      )}
    </div>
  );
}
