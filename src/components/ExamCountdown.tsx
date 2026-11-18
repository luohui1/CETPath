import { useEffect, useState } from "react";
import { CalendarBlank, PencilSimple } from "@phosphor-icons/react";
import { setSetting, useSettings } from "@/lib/settings";
import { cn, daysUntil } from "@/lib/utils";
import { Button } from "./ui";
import { Stamp } from "./paper-ui";

const EXAM_PRESETS = ["考研英语（一）", "考研英语（二）", "大学英语四级", "大学英语六级"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 离考试越近，建议越具体 */
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

/** 首页的考试倒计时牌：像教室墙上"距考试还有 N 天"的撕页牌——厚厚一叠白纸、红线、大红数字、一枚阶段章，下面一行这个阶段该做什么 */
export function ExamCountdown({ startedAt, weak, className }: { startedAt?: number; weak?: string; className?: string }) {
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(settings.examName || EXAM_PRESETS[0]);
  const [date, setDate] = useState(settings.examDate ?? "");
  const now = useNow(60_000);

  useEffect(() => {
    setName(settings.examName || EXAM_PRESETS[0]);
    setDate(settings.examDate ?? "");
  }, [settings.examName, settings.examDate]);

  const target = settings.examDate ? new Date(`${settings.examDate}T08:30:00`).getTime() : null;

  if (!target || editing) {
    const save = async () => {
      if (!date) return;
      await setSetting("examName", name.trim() || "考试");
      await setSetting("examDate", date);
      setEditing(false);
    };
    return (
      <div className={cn("card card-thick board p-6 pt-8 lg:p-7 lg:pt-9", className)}>
        <div className="t-label">考试倒计时</div>
        <h2 className="mt-1.5 text-[28px] leading-9 font-semibold">{target ? "修改考试" : "你在准备哪场考试？"}</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {EXAM_PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setName(p)} className={cn("pill", name === p && "pill-on")} aria-pressed={name === p}>
              {p}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="flex h-10 items-center gap-2 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)]">
            <CalendarBlank className="size-[18px] text-[var(--ink-500)]" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent outline-none" aria-label="考试日期" />
          </label>
          <Button variant="primary" onClick={save} disabled={!date}>
            开始倒计时
          </Button>
          {target && (
            <button type="button" onClick={() => setEditing(false)} className="h-10 px-2 text-[14px] text-[var(--ink-500)] hover:text-[var(--ink)]">
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  const left = Math.max(0, target - now);
  // 按日历天数算，和侧边栏的小牌子一致
  const days = Math.max(0, daysUntil(settings.examDate!));
  const d = new Date(target);
  const stage = stageOf(Math.ceil(left / 86_400_000), weak);

  // 一张牌只说一件事：还有几天。日期并进标题，阶段建议一行
  return (
    <div className={cn("card card-thick board flex flex-col p-6 pt-8 lg:p-7 lg:pt-9", className)} title={startedAt ? `已备考 ${Math.max(1, Math.ceil((now - startedAt) / 86_400_000))} 天` : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-[var(--ink-700)]">
            距 {settings.examName || "考试"}（{d.getMonth() + 1} 月 {d.getDate()} 日 周{WEEKDAYS[d.getDay()]}）还有
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="num text-[96px] leading-[0.82] tracking-[-0.04em] text-[var(--red)] xl:text-[112px]">{days}</span>
            <span className="mb-1 text-[22px] font-semibold">天</span>
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-3 pt-1">
          <Stamp size="lg" double id={`stage-${stage.name}`}>
            {stage.name}阶段
          </Stamp>
          <button type="button" onClick={() => setEditing(true)} className="grid size-10 place-items-center rounded-[8px] text-[var(--ink-500)] transition-colors hover:bg-[var(--paper-100)] hover:text-[var(--ink)]" aria-label="修改考试" title="修改考试">
            <PencilSimple className="size-[18px]" />
          </button>
        </div>
      </div>
      <p className="mt-auto max-w-[600px] pt-6 text-[15px] leading-6 text-[var(--ink-700)]">{stage.tip}</p>
    </div>
  );
}
