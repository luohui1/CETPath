// 页面用的基础组件：都基于团队设计系统 Grasso（src/grasso），保持原来的调用方式
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Tray } from "@phosphor-icons/react";
import * as G from "@/grasso";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "green" | "gold";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
  soft: "btn btn-secondary",
  green: "btn btn-primary",
  gold: "btn btn-secondary",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/** 平面按钮（.btn）：主要动作蓝底，其余白底描边；size="icon" 是圆形图标按钮 */
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  if (size === "icon") {
    return (
      <button type={type} className={cn("gr-iconbtn", variant === "soft" && "gr-iconbtn-on", className)} disabled={disabled} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <button type={type} className={cn(VARIANTS[variant], size === "sm" && "btn-sm", size === "lg" && "btn-lg", className)} disabled={disabled || loading} {...rest}>
      {loading && <G.Spinner />}
      {children}
    </button>
  );
}

/** 纸张卡片（.card）：近白的纸、上沿内高光、多层柔和阴影；内边距由调用方决定 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...rest} />;
}

const TONES = { neutral: "neutral", primary: "brand", accent: "star", success: "success", danger: "danger" } as const;

export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof TONES; className?: string; children?: ReactNode }) {
  return (
    <G.Badge tone={TONES[tone]} className={className}>
      {children}
    </G.Badge>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="t-h1">{title}</h1>
        {desc && <p className="mt-1.5 max-w-[640px] text-[14px] leading-[22px] text-[var(--ink-500)]">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 空状态：图标、一句说明、一个下一步（.gr-empty） */
export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="gr-empty">
      <span className="gr-empty-icon text-muted">{icon ?? <Tray className="size-[22px]" />}</span>
      <p className="gr-empty-title">{title}</p>
      {desc && <p className="gr-empty-desc">{desc}</p>}
      {action && <div className="gr-empty-action">{action}</div>}
    </div>
  );
}

/** 分段控件（Grasso Tabs）：值可以是数字，内部转成字符串 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <G.Tabs
      className={className}
      label={label ?? ""}
      value={String(value)}
      onChange={(v: string) => onChange(options.find((o) => String(o.value) === v)!.value)}
      items={options.map((o) => ({ value: String(o.value), label: o.label }))}
    />
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  // 设置行左边已经有标题，开关的文字只给读屏
  return <G.Switch checked={checked} onChange={onChange} label={<span className="sr-only">{label}</span>} />;
}

export function Spinner({ className }: { className?: string }) {
  return <G.Spinner className={className} />;
}

export function LoadingBlock({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted">
      <G.Spinner /> {text}
    </div>
  );
}

/** 细进度条，value 取 0–1；color 是填充色 */
export function ProgressBar({ value, className, label, color }: { value: number; className?: string; label?: string; color?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn("meter", className)} role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={color ? ({ "--meter": color } as CSSProperties) : undefined}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="t-label flex items-center gap-2">
        {icon}
        {label}
      </div>
      <div className="num mt-2.5 text-[32px] leading-9">{value}</div>
      {hint && <div className="mt-1.5 text-[13px] leading-5 text-[var(--ink-500)]">{hint}</div>}
    </Card>
  );
}
