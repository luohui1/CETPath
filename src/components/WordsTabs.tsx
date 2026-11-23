import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

/** 单词：背单词、词书、生词本三页共用的顶部切换（侧边栏只有一个"单词"入口） */
export const WORD_PAGES = [
  { to: "/review", label: "背单词" },
  { to: "/vocab", label: "生词本" },
  { to: "/roots", label: "记忆树" },
  { to: "/books", label: "词书" },
] as const;

/** 错题本、解题思路库共用的顶部切换 */
export const MISTAKE_PAGES = [
  { to: "/mistakes", label: "错题本" },
  { to: "/methods", label: "解题思路" },
] as const;

export function WordsTabs({ pages = WORD_PAGES, label = "单词" }: { pages?: readonly { to: string; label: string }[]; label?: string }) {
  return (
    <nav className="mb-5 inline-flex rounded-[11px] bg-[var(--fill-quiet)] p-1" aria-label={label}>
      {pages.map((p) => (
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
