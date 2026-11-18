// 自己画的小图表：比通用图表库更贴合页面，数据量小、不需要坐标轴
import { useId, type ReactNode } from "react";
import { TrendDown, TrendUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** 平滑曲线：Catmull-Rom 转贝塞尔 */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return d;
}

/** 迷你走势：平滑曲线 + 渐隐的面积，最后一点加圆点 */
export function Sparkline({ data, color = "var(--blue)", height = 36, className }: { data: number[]; color?: string; height?: number; className?: string }) {
  const id = useId();
  const w = 120;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i): [number, number] => [(i / Math.max(1, data.length - 1)) * w, height - 3 - (v / max) * (height - 8)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("block h-9 w-full overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {line && <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
      {last && <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** 指标块：图标、数值、和上周比、两周走势 */
export function Metric({
  icon,
  label,
  value,
  unit,
  delta,
  trend,
  color = "var(--blue)",
  note,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { text: string; up: boolean; good?: boolean };
  trend?: number[];
  color?: string;
  note?: ReactNode;
}) {
  const good = delta ? (delta.good ?? delta.up) : true;
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className="flex size-7 items-center justify-center rounded-[9px]" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="font-[family-name:var(--font-display)] text-[30px] leading-[34px] font-semibold tracking-[-0.02em] tabular-nums">
          {value}
          {unit && <span className="ml-0.5 text-[14px] font-normal text-subtle">{unit}</span>}
        </div>
        {trend && <Sparkline data={trend} color={color} className="w-24 flex-none" />}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[12px] text-subtle">
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-success" : "text-danger")}>
            {delta.up ? <TrendUp className="size-3.5" /> : <TrendDown className="size-3.5" />}
            {delta.text}
          </span>
        )}
        {delta && note && <span>·</span>}
        {note}
      </div>
    </div>
  );
}

/** 横向条：一行一项，条长按 max，右边是数值 */
export function HBars({ rows, max = 100, suffix = "%" }: { rows: { label: string; value: number; hint?: string; tone?: "good" | "bad" | "plain" }[]; max?: number; suffix?: string }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[64px_1fr_56px] items-center gap-3 text-[13px]">
          <span className="truncate text-muted">{r.label}</span>
          <span className="relative h-2.5 overflow-hidden rounded-full bg-[var(--fill-track)]" title={r.hint}>
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", r.tone === "bad" ? "bg-[var(--danger)]" : r.tone === "good" ? "bg-[var(--success)]" : "bg-primary")}
              style={{ width: `${Math.min(100, (r.value / Math.max(1, max)) * 100)}%` }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">
            {r.value}
            <span className="font-normal text-subtle">{suffix}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** 一周的柱子：每天两段叠起来（如做题、背词），柱顶圆角，今天加深 */
export function WeekBars({ days, series }: { days: { label: string; values: number[]; today?: boolean }[]; series: { label: string; color: string }[] }) {
  const max = Math.max(1, ...days.map((d) => d.values.reduce((a, b) => a + b, 0)));
  return (
    <div>
      <div className="flex h-36 items-end gap-2.5">
        {days.map((d) => {
          const total = d.values.reduce((a, b) => a + b, 0);
          return (
            <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}：${series.map((s, i) => `${s.label} ${d.values[i]}`).join("，")}`}>
              <span className="text-[11px] text-subtle tabular-nums">{total || ""}</span>
              <div className="flex w-full max-w-[34px] flex-col-reverse overflow-hidden rounded-[8px]" style={{ height: `${Math.max(3, (total / max) * 100)}%`, opacity: total ? 1 : 0.35 }}>
                {total ? (
                  d.values.map((v, i) => <span key={i} style={{ height: `${(v / total) * 100}%`, background: series[i].color }} />)
                ) : (
                  <span className="h-full bg-[var(--fill-track)]" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2.5">
        {days.map((d) => (
          <span key={d.label} className={cn("flex-1 text-center text-[11px]", d.today ? "font-semibold text-text" : "text-subtle")}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-4 text-[12px] text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// 记忆状态的颜色：只用墨色的深浅和品牌蓝
const MEMORY_TONES: Record<string, string> = { 已掌握: "var(--ink)", 复习中: "var(--ink-500)", 学习中: "var(--blue)", 未学: "var(--paper-300)" };

/** 单词记忆状态：一条按比例分段的纸条 + 图例（代替环形图） */
export function MemoryStrip({ memory, total }: { memory: { label: string; value: number }[]; total: number }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--paper-200)]" role="img" aria-label={memory.map((m) => `${m.label} ${m.value}`).join("，")}>
        {memory.map((m) => (
          <span key={m.label} style={{ width: `${(m.value / Math.max(1, total)) * 100}%`, background: MEMORY_TONES[m.label] }} className="border-r-2 border-white last:border-r-0" />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {memory.map((m) => (
          <div key={m.label} className="flex items-baseline gap-2">
            <span className="size-2.5 flex-none translate-y-[-1px] rounded-[3px]" style={{ background: MEMORY_TONES[m.label] }} />
            <dt className="text-[13px] text-[var(--ink-700)]">{m.label}</dt>
            <dd className="num ml-auto text-[18px]">{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 一周的柱：墨色，第一根（今天）品牌蓝；柱顶写数 */
export function DayColumns({ data, unit = "" }: { data: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-40 items-end gap-3">
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}：${d.value}${unit}`}>
          <span className="num text-[13px] text-[var(--ink-700)]">{d.value || ""}</span>
          <span className={cn("w-full max-w-[30px] rounded-t-[5px] rounded-b-[2px]", d.value ? (i === 0 ? "bg-[var(--blue)]" : "bg-[var(--ink)]") : "bg-[var(--paper-200)]")} style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} />
          <span className={cn("text-[12px]", i === 0 ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-500)]")}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 圆环：正确率、进度 */
export function Ring({ value, size = 44, stroke = 4, color = "var(--blue)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}
