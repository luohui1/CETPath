import { useEffect, useState } from "react";
import { CalendarBlank, PencilSimple } from "@phosphor-icons/react";
import { setSetting, useSettings } from "@/lib/settings";
import { cn, daysUntil } from "@/lib/utils";
import { Button } from "./ui";

const EXAM_PRESETS = ["雅思（A类）", "雅思（G类）", "大学英语四级", "大学英语六级", "考研英语（一）", "考研英语（二）"];
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

/** 真题页、专项页上次选的考试 → 倒计时的默认考试名 */
const PRESET_OF: Record<string, string> = {
  "ielts-a": EXAM_PRESETS[0],
  "ielts-gt": EXAM_PRESETS[1],
  cet4: EXAM_PRESETS[2],
  cet6: EXAM_PRESETS[3],
  kaoyan1: EXAM_PRESETS[4],
  kaoyan2: EXAM_PRESETS[5],
};
const EXAM_OF: Record<string, string> = Object.fromEntries(Object.entries(PRESET_OF).map(([k, v]) => [v, k]));
export const examPreset = (exam?: string | null) => (exam && PRESET_OF[exam]) || undefined;

/** 首页的考试倒计时：一行小条。没设日期时就地设（考试名默认是上次选的考试），设好后是"距某考试还有 N 天"+ 阶段 + 一句建议 */
export function ExamCountdown({ startedAt, weak, defaultName, className }: { startedAt?: number; weak?: string; defaultName?: string; className?: string }) {
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const fallback = defaultName || EXAM_PRESETS[0];
  const [name, setName] = useState(settings.examName || fallback);
  const [date, setDate] = useState(settings.examDate ?? "");
  const now = useNow(60_000);

  useEffect(() => {
    setName(settings.examName || fallback);
    setDate(settings.examDate ?? "");
    // 只跟着存下的考试走：点考试按钮会改 lastExam（fallback 跟着变），不能把刚点的选择和没保存的日期冲掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className={cn("card flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5", className)}>
        <span className="text-[14px] font-medium">{target ? "修改考试" : "设个考试日期，开始倒计时"}</span>
        <div className="flex flex-wrap gap-1.5">
          {EXAM_PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => {
                setName(p);
                // 首页下面的"继续做题"、推荐卷子跟着换成这门考试
                void setSetting("lastExam", EXAM_OF[p]);
              }} className={cn("pill", name === p && "pill-on")} aria-pressed={name === p}>
              {p}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-0 items-center gap-2 rounded-[9px] bg-white px-3 text-[14px] shadow-[var(--elev-1)]">
            <CalendarBlank className="size-[18px] text-[var(--ink-500)]" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent outline-none" aria-label="考试日期" />
          </label>
          <Button variant="primary" size="sm" onClick={save} disabled={!date}>
            开始倒计时
          </Button>
          {target && (
            <button type="button" onClick={() => setEditing(false)} className="h-9 px-2 text-[14px] text-[var(--ink-500)] hover:text-[var(--ink)]">
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

  return (
    <div className={cn("card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3", className)} title={startedAt ? `已备考 ${Math.max(1, Math.ceil((now - startedAt) / 86_400_000))} 天` : undefined}>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-[14px] text-[var(--ink-700)]">
          距 {settings.examName || "考试"}（{d.getMonth() + 1} 月 {d.getDate()} 日 周{WEEKDAYS[d.getDay()]}）还有
        </span>
        <span className="num text-[34px] leading-none text-[var(--red)]">{days}</span>
        <span className="text-[15px] font-semibold">天</span>
      </div>
      <span className="tag-paper">{stage.name}阶段</span>
      <p className="min-w-[240px] flex-1 text-[14px] leading-6 text-[var(--ink-700)]">{stage.tip}</p>
      <button type="button" onClick={() => setEditing(true)} className="grid size-9 flex-none place-items-center rounded-[8px] text-[var(--ink-500)] transition-colors hover:bg-[var(--paper-100)] hover:text-[var(--ink)]" aria-label="修改考试" title="修改考试">
        <PencilSimple className="size-[18px]" />
      </button>
    </div>
  );
}
