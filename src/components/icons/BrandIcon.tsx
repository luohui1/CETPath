// 品牌图标的底子：24 网格，墨色描边（1.75、圆头圆角）+ 一块套色填充。
// 填充层画在描边下面、整体平移 (1, 1)，像印刷套色没对齐，一眼就不是通用图标库的模样。
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 套色：品牌蓝 / 红笔 / 荧光黄 / 墨（30%）/ 不要填充 */
export type IconAccent = "blue" | "red" | "mark" | "ink" | "none";

export interface BrandIconProps {
  size?: number;
  accent?: IconAccent;
  className?: string;
  style?: CSSProperties;
  /** 有意义的图标给读屏的名字；装饰性的不给 */
  title?: string;
}

// --icon-accent 留给外面统一改套色（如选中态）
const FILLS: Record<Exclude<IconAccent, "none">, string> = {
  blue: "var(--icon-accent, var(--icon-blue))",
  red: "var(--icon-accent, var(--icon-red))",
  mark: "var(--icon-accent, var(--icon-mark))",
  ink: "var(--icon-accent, var(--icon-ink))",
};

export function BrandIcon({
  size = 20,
  accent,
  defaultAccent,
  className,
  style,
  title,
  fill,
  line,
}: BrandIconProps & { defaultAccent: IconAccent; fill: ReactNode; line: ReactNode }) {
  const a = accent ?? defaultAccent;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("inline-block flex-none", className)}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {a !== "none" && (
        <g transform="translate(1 1)" style={{ fill: FILLS[a] }} stroke="none">
          {fill}
        </g>
      )}
      <g fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        {line}
      </g>
    </svg>
  );
}
