import type { BrandIconProps } from "./BrandIcon";
import { cn } from "@/lib/utils";

/** 错题本：一枚红色描边的"错"字方章，略歪，像批改时盖上去的（不走墨色描边 + 套色，整枚都是红笔色） */
export function IconWrongStamp({ size = 20, className, style, title }: BrandIconProps) {
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
      <g transform="rotate(-6 12 12)">
        <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3" fill="var(--icon-red)" fillOpacity="0.35" stroke="var(--red)" strokeWidth={1.75} />
        <text x="12" y="16.6" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--red)" fontFamily="var(--font-sans)">
          错
        </text>
      </g>
    </svg>
  );
}
