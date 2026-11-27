import { useEffect, useState } from "react";
import { CalendarBlank, PencilSimple } from "@phosphor-icons/react";
import type { ExamId } from "@/lib/papers";
import { setSetting, useSettings } from "@/lib/settings";
import { getTargetMeta } from "@/lib/targetExam";
import { cn, daysUntil } from "@/lib/utils";
import { Button } from "./ui";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function stageOf(days: number, weak?: string) {
  if (days <= 0) return { name: "考试日", tip: "放轻松，按平时的节奏答题。听力开始前先把题目扫一遍。" };
  if (days <= 15) return { name: "冲刺", tip: "保持手感：每天一篇阅读、一篇作文或翻译，错题过一遍，不再开新题型。" };
  if (days <= 60) return { name: "真题", tip: "每周两套整卷限时模考，交卷后逐题看解析，错题和生词当天清掉。" };
  if (days <= 120) return { name: "强化", tip: `专项训练攻克弱项${weak ? `（目前最弱的是${weak}）` : ""}，每周一套整卷检查进度。` };
  return { name: "基础", tip: "每天背词打底，每周一套真题熟悉题型和节奏，在原卷上做笔记。" };
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 首页考试倒计时与当前备考目标条 */
export function ExamCountdown({
  startedAt,
  weak,
  targetExam,
  onEditTarget,
  className,
}: {
  startedAt?: number;
  weak?: string;
  targetExam: ExamId;
  onEditTarget?: () => void;
  className?: string;
}) {
  const settings = useSettings();
  const meta = getTargetMeta(targetExam);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(settings.examDate ?? "");
  const now = useNow(60_000);

  useEffect(() => {
    setDate(settings.examDate ?? "");
  }, [settings.examDate]);

  const target = settings.examDate ? new Date(`${settings.examDate}T08:30:00`).getTime() : null;

  if (!target || editing) {
    const save = async () => {
      if (!date) return;
      await setSetting("examName", meta.name);
      await setSetting("examDate", date);
      setEditing(false);
    };
    return (
      <div className={cn("card flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3.5", className)}>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-[var(--ink-500)]">当前目标</span>
          <span className="font-semibold text-[var(--ink)]">{meta.name}</span>
          {!target && <span className="text-[var(--ink-500)]">· 设个考试日期开启倒计时</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-white px-3 text-[13.5px]">
            <CalendarBlank className="size-4 text-[var(--ink-500)]" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent outline-none"
              aria-label="考试日期"
            />
          </label>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!date}>
            {target ? "保存日期" : "开始倒计时"}
          </Button>
          {onEditTarget && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                onEditTarget();
              }}
              className="h-9 px-2 text-[13px] font-medium text-[var(--blue)] hover:underline"
            >
              切换目标
            </button>
          )}
          {target && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-9 px-2 text-[13px] text-[var(--ink-500)] hover:text-[var(--ink)]"
            >
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  const left = Math.max(0, target - now);
  const days = Math.max(0, daysUntil(settings.examDate!));
  const d = new Date(target);
  const stage = stageOf(Math.ceil(left / 86_400_000), weak);

  return (
    <div
      className={cn("card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3", className)}
      title={startedAt ? `已备考 ${Math.max(1, Math.ceil((now - startedAt) / 86_400_000))} 天` : undefined}
    >
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-[14px] text-[var(--ink-700)]">
          距 {meta.name}（{d.getMonth() + 1} 月 {d.getDate()} 日 周{WEEKDAYS[d.getDay()]}）还有
        </span>
        <span className="num text-[34px] leading-none text-[var(--red)]">{days}</span>
        <span className="text-[15px] font-semibold">天</span>
      </div>
      <span className="tag-paper">{stage.name}阶段</span>
      <p className="min-w-[240px] flex-1 text-[14px] leading-6 text-[var(--ink-700)]">{stage.tip}</p>
      <div className="flex items-center gap-1">
        {onEditTarget && (
          <button
            type="button"
            onClick={onEditTarget}
            className="h-8 rounded-[8px] px-2.5 text-[12.5px] font-medium text-[var(--blue)] hover:bg-[var(--blue-tint)]/60"
          >
            切换目标
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="grid size-9 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] transition-colors hover:bg-[var(--paper-100)] hover:text-[var(--ink)]"
          aria-label="修改考试日期"
          title="修改考试日期"
        >
          <PencilSimple className="size-[18px]" />
        </button>
      </div>
    </div>
  );
}
