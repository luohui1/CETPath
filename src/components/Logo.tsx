import { cn } from "@/lib/utils";

/** 标志：一条从左下走向右上的"道"，落在圆角方块里 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M8 22.5c4.5 0 6-9 10.5-9 2.6 0 3.4 2.6 5.5 2.6" stroke="var(--primary-fg)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="10" r="2.2" fill="var(--primary-fg)" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">英语之道</span>
    </div>
  );
}
