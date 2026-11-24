import { cn } from "@/lib/utils";

/** 标志：翻开的书页中间一条小路通向太阳，路的尽头是笔尖 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
  <defs>
    <linearGradient id="yz-logo-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#1D4ED8"/>
      <stop offset="1" stopColor="#3B82F6"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#yz-logo-bg)"/>
  <g stroke="#F59E0B" strokeWidth="2.4" strokeLinecap="round">
    <path d="M32 9.5v3.6M21.5 13.2l2 2.9M42.5 13.2l-2 2.9M15.8 19.8l3.2 1.6M48.2 19.8l-3.2 1.6"/>
  </g>
  <path d="M23.2 25.5a8.8 8.8 0 0 1 17.6 0z" fill="#F59E0B"/>
  <path d="M10 46.5 14.8 27c6.6-.6 12.4 1.5 16.2 5.2L25.6 44c-4.6-1.6-10-1.4-15.6 2.5z" fill="#fff"/>
  <path d="M54 46.5 49.2 27c-6.6-.6-12.4 1.5-16.2 5.2L38.4 44c4.6-1.6 10-1.4 15.6 2.5z" fill="#fff"/>
  <path d="M10 51c5.4-3.6 10.6-4 15-2.3M54 51c-5.4-3.6-10.6-4-15-2.3" stroke="#BFDBFE" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
  <path d="M32 25.6c-3.4 1.4-4.6 3.3-2.4 5.6 2.4 2.6 3.2 4.6-.4 8.2L25.8 44 32 56.5 38.2 44l-2.6-3.6c-2.6-3.6-1.6-6 .6-8.6 2-2.4 0-4.8-4.2-6.2z" fill="#fff"/>
  <circle cx="32" cy="46.2" r="1.9" fill="#1D4ED8"/>
  <path d="M32 48v7" stroke="#1D4ED8" strokeWidth="1.3" strokeLinecap="round"/>
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
