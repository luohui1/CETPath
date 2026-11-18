import { dayKey, type DayRow } from "./db";

export function isActive(d?: DayRow) {
  return !!d && (d.reviews > 0 || d.questions > 0);
}

/** 连续打卡天数：今天还没学就从昨天往前数 */
export function currentStreak(days: DayRow[]): number {
  const map = new Map(days.map((d) => [d.day, d]));
  const cursor = new Date();
  if (!isActive(map.get(dayKey(cursor)))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (isActive(map.get(dayKey(cursor)))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export function longestStreak(days: DayRow[]): number {
  const active = days.filter(isActive).map((d) => d.day).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of active) {
    const d = new Date(`${k}T00:00:00`);
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function activityScore(d?: DayRow) {
  return d ? d.reviews + d.questions * 2 + d.lookups : 0;
}
