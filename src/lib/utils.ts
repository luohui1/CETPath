import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 class，后传入的会覆盖组件自带的同类样式（如 hidden 覆盖 inline-flex） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAY = 86_400_000;

/** 把未来的时间点说成"10 分钟后""3 天后" */
export function fromNow(ts: number, now = Date.now()): string {
  const diff = ts - now;
  if (diff <= 0) return "现在";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${Math.max(min, 1)} 分钟后`;
  const hr = Math.round(diff / 3_600_000);
  if (hr < 24) return `${hr} 小时后`;
  const d = Math.round(diff / DAY);
  if (d < 30) return `${d} 天后`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} 个月后`;
  return `${(d / 365).toFixed(1)} 年后`;
}

/** 把过去的时间点说成"刚刚""2 小时前" */
export function timeAgo(ts: number, now = Date.now()): string {
  const diff = now - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 考试倒计时：超过一小时显示成 2:59:12，否则 59:12 */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
