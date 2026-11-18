import { dayKey, type DayRow } from "@/lib/db";
import { activityScore } from "@/lib/stats";
import { cn } from "@/lib/utils";

// 灰-墨两级：学了就涂黑（不用蓝色渐变）
const LEVELS = ["bg-[var(--paper-200)]", "bg-[var(--ink)]"];

const level = (score: number) => (score > 0 ? 1 : 0);

/** 打卡热力图：一列一周，从左到右是过去 weeks 周 */
export function Heatmap({ days, weeks = 20 }: { days: DayRow[]; weeks?: number }) {
  const map = new Map(days.map((d) => [d.day, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 从本周日往回推，周一为每列第一格
  const end = new Date(today);
  end.setDate(end.getDate() + ((7 - ((end.getDay() + 6) % 7) - 1) % 7));
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7 + 1);

  const cols: { key: string; date: Date }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      col.push({ key: dayKey(d), date: d });
    }
    cols.push(col);
  }

  return (
    <div>
      <div className="scrollbar-none flex gap-[3px] overflow-x-auto">
        {cols.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map(({ key, date }) => {
              const d = map.get(key);
              const future = date > today;
              return (
                <div
                  key={key}
                  title={future ? key : `${key}：复习 ${d?.reviews ?? 0} 次，做题 ${d?.questions ?? 0} 道，查词 ${d?.lookups ?? 0} 次`}
                  className={cn("size-3 rounded-[2px]", future ? "bg-transparent shadow-[inset_0_0_0_1px_var(--paper-200)]" : LEVELS[level(activityScore(d))])}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
