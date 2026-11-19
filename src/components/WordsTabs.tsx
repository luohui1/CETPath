import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

/** 单词：背单词、词书、生词本三页共用的顶部切换（侧边栏只有一个"单词"入口） */
export const WORD_PAGES = [
  { to: "/review", label: "背单词" },
  { to: "/books", label: "词书" },
  { to: "/vocab", label: "生词本" },
] as const;

export function WordsTabs() {
  return (
    <nav className="mb-5 inline-flex rounded-[11px] bg-[var(--fill-quiet)] p-1" aria-label="单词">
      {WORD_PAGES.map((p) => (
        <NavLink
          key={p.to}
          to={p.to}
          className={({ isActive }) =>
            cn(
              "h-9 rounded-[8px] px-4 text-[14px] leading-9 font-medium transition-colors",
              isActive ? "bg-white text-[var(--ink)] shadow-[var(--elev-1)]" : "text-[var(--ink-500)] hover:text-[var(--ink)]",
            )
          }
        >
          {p.label}
        </NavLink>
      ))}
    </nav>
  );
}
