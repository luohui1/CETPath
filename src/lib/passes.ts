import { db, dayKey } from "./db";

/** 一天几轮各叫什么 */
export function passNames(n: number) {
  return (
    [["今天"], ["早", "晚"], ["早", "中", "晚"], ["早", "中", "下午", "晚"], ["早", "上午", "中", "下午", "晚"]][n - 1] ??
    Array.from({ length: n }, (_, i) => `第 ${i + 1} 轮`)
  );
}

/** 今天背过的词，按第一次背的先后 */
export async function todayWords() {
  const logs = await db.logs.where("day").equals(dayKey()).sortBy("reviewedAt");
  return [...new Set(logs.map((l) => l.word))];
}

/** 今天已经背了几轮：正式复习算第一轮，再加快速过的遍数 */
export async function passesDone() {
  const d = await db.days.get(dayKey());
  return (d?.reviews ? 1 : 0) + (d?.passes ?? 0);
}
