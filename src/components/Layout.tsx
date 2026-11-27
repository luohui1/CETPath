import { AuthGate } from "./AuthGate";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigation } from "react-router";
import { ArrowsLeftRight, GithubLogo, SidebarSimple } from "@phosphor-icons/react";
import { pendingCounts } from "@/lib/learning";
import { backfillMastery, useMistakes } from "@/lib/mistakes";
import { isIeltsExam } from "@/lib/papers";
import { usePaperIndex } from "@/lib/insights";
import { useSettings } from "@/lib/settings";
import { getTargetMeta, normalizeTargetExam, resolveTargetExam, type TargetExamMeta } from "@/lib/targetExam";
import { cn, daysUntil } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { useIeltsPendingMistakes } from "@/ielts/store";
import { PixelIcon, type PixelName } from "./PixelIcon";
import { LogoMark } from "./Logo";
import { TargetExamModal } from "./TargetExamModal";
import { MISTAKE_PAGES, WORD_PAGES } from "./WordsTabs";
import { ARTICLES_ON } from "@/lib/articles";

const KEY = "yy-sidebar-collapsed";

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) return v === "1";
    } catch {
      // 隐私模式读不到本地存储，按屏幕宽度来
    }
    return innerWidth < 1280;
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch {
      // 忽略
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: PixelName;
  end?: boolean;
  badge?: number;
  red?: boolean;
  match?: readonly string[];
}

function Item({ to, label, short, icon, end, badge, red, match, collapsed }: NavItem & { collapsed: boolean }) {
  const { pathname } = useLocation();
  const also = !!match?.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive: hit }) => {
        const isActive = hit || also;
        return cn(
          "relative flex items-center rounded-[10px] font-medium transition-[background-color,color,box-shadow] duration-150",
          collapsed ? "flex-col justify-center gap-1 py-2" : "h-10 gap-3 px-3",
          isActive
            ? "bg-white text-[var(--ink)] shadow-[var(--elev-1)] before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--blue)]"
            : "text-[var(--ink-700)] hover:bg-white/70 hover:text-[var(--ink)]",
        );
      }}
    >
      <PixelIcon name={icon} size={collapsed ? 22 : 20} />
      <span className={cn("leading-none whitespace-nowrap", collapsed ? "text-[11px]" : "text-[14px]")}>{collapsed ? (short ?? label) : label}</span>
      {!!badge && (
        <span className={cn("num min-w-[18px] rounded-full px-1.5 text-center text-[11px] leading-[18px] font-semibold text-white", red ? "bg-[var(--red)]" : "bg-[var(--ink)]", collapsed ? "absolute top-1 right-1.5" : "ml-auto")}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </NavLink>
  );
}

function Quiet({ to, label, icon, collapsed }: { to: string; label: string; icon: PixelName; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        cn(
          "flex min-h-10 items-center rounded-[10px] text-[13px] transition-colors",
          collapsed ? "flex-col justify-center gap-1 py-1.5" : "gap-3 px-3 py-2",
          isActive ? "bg-white text-[var(--ink)] shadow-[var(--elev-1)]" : "text-[var(--ink-500)] hover:bg-white/70 hover:text-[var(--ink)]",
        )
      }
    >
      <PixelIcon name={icon} size={18} />
      {collapsed ? <span className="text-[11px] leading-none whitespace-nowrap">{label.replace("学习", "")}</span> : label}
    </NavLink>
  );
}

/** 侧边栏底部常驻：当前备考目标徽章（点击切换备考目标与考试日期） */
function TargetBadge({
  collapsed,
  target,
  examDate,
  onClick,
}: {
  collapsed: boolean;
  target: TargetExamMeta;
  examDate: string | null;
  onClick: () => void;
}) {
  const days = examDate ? daysUntil(examDate) : null;
  const hasDays = days !== null && days >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card card-press w-full text-left transition",
        collapsed ? "flex flex-col items-center gap-0.5 px-1 py-2 text-center" : "px-3 py-2.5",
      )}
      title={`当前备考目标：${target.name}${hasDays ? ` · 距考 ${days} 天` : ""}（点击切换）`}
    >
      {collapsed ? (
        <>
          <span className="text-[11px] leading-tight font-semibold text-[var(--blue)]">{target.short}</span>
          {hasDays ? (
            <span className="num text-[14px] leading-tight text-[var(--ink)]">{days}天</span>
          ) : (
            <span className="text-[10px] leading-tight text-[var(--ink-500)]">切换</span>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-[var(--ink-500)]">
            <span>备考目标</span>
            <span className="inline-flex items-center gap-0.5 font-medium text-[var(--blue)]">
              <ArrowsLeftRight className="size-3" />
              切换
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1.5">
            <span className="truncate text-[14px] font-semibold text-[var(--ink)]">{target.short}</span>
            {hasDays && (
              <span className="num flex-none text-[13px] font-semibold text-[var(--ink-700)]">
                {days} 天
              </span>
            )}
          </div>
        </>
      )}
    </button>
  );
}

function NavProgress() {
  const loading = useNavigation().state === "loading";
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-[var(--blue)] transition-[transform,opacity] duration-[1200ms] ease-out", loading ? "scale-x-90 opacity-100" : "scale-x-0 opacity-0 duration-200")} />
  );
}

export function Layout() {
  const settings = useSettings();
  const targetExam = resolveTargetExam(settings);
  const targetMeta = getTargetMeta(targetExam);
  const ieltsMode = isIeltsExam(targetExam);

  const counts = useCachedLiveQuery("pending", () => pendingCounts(), [settings.dailyNew, settings.activeBook]);
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useCollapsed();
  const [targetModalOpen, setTargetModalOpen] = useState(false);

  const { index } = usePaperIndex();
  const mistakes = useMistakes();
  const ieltsMistakes = useIeltsPendingMistakes(ieltsMode ? targetExam : undefined);

  const cetMistakeCount = useMemo(() => {
    if (ieltsMode || !mistakes || !index) return 0;
    const examByPaper = new Map(index.map((p) => [p.id, normalizeTargetExam(p.exam)]));
    return mistakes.filter((r) => !r.retiredAt && examByPaper.get(r.paperId) === targetExam).length;
  }, [ieltsMode, mistakes, index, targetExam]);

  const totalMistakes = ieltsMode ? (ieltsMistakes ?? 0) : cetMistakeCount;

  useEffect(() => {
    const t = setTimeout(() => void backfillMastery(), 1500);
    return () => clearTimeout(t);
  }, []);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: "做题",
      items: [
        { to: "/", label: "首页", icon: "house", end: true },
        { to: "/papers", label: "真题训练", short: "真题", icon: "paper" },
        { to: "/practice", label: "专项训练", short: "专项", icon: "target" },
        ...(targetMeta.hasListening
          ? [{ to: "/listening", label: "听力精练", short: "精听", icon: "headphones", match: ["/listening", "/studio"] } as NavItem]
          : []),
        { to: "/speaking", label: "口语训练", short: "口语", icon: "mic", match: ["/speaking"] },
        ...(ARTICLES_ON ? [{ to: "/articles", label: "外刊阅读", short: "外刊", icon: "book" } as NavItem] : []),
      ],
    },
    {
      title: "复盘",
      items: [
        { to: "/ask", label: "AI 助教", short: "AI", icon: "star" },
        { to: "/mistakes", label: "错题本", short: "错题", icon: "mistakes", badge: totalMistakes, red: true, match: MISTAKE_PAGES.map((p) => p.to) },
      ],
    },
    {
      title: "背词",
      items: [{ to: "/review", label: "单词", short: "单词", icon: "bolt", badge: counts ? counts.dueReviews + counts.newLeft : 0, match: WORD_PAGES.map((p) => p.to) }],
    },
  ];
  const width = collapsed ? 72 : 200;

  return (
    <div className="min-h-dvh transition-[padding] duration-200 ease-out" style={{ paddingLeft: width }}>
      <aside
        className="no-print fixed top-[var(--memdb-h)] bottom-0 left-0 z-30 flex flex-col overflow-x-hidden overflow-y-auto bg-[var(--paper-50)] px-2.5 py-5 shadow-[inset_-1px_0_0_rgba(28,35,48,0.07),4px_0_16px_-12px_rgba(28,35,48,0.25)] transition-[width] duration-200 ease-out"
        style={{ width }}
      >
        <NavLink to="/" className={cn("mb-7 flex items-center gap-2.5", collapsed ? "justify-center" : "px-2")} title="英语之道">
          <LogoMark className="flex-none" />
          {!collapsed && <span className="text-[17px] leading-none font-semibold tracking-[0.04em] whitespace-nowrap">英语之道</span>}
        </NavLink>

        <nav className="flex flex-col" aria-label="主导航">
          {groups.map((g, i) => (
            <div key={g.title} className={cn("flex flex-col gap-1", i > 0 && (collapsed ? "mt-2 border-t border-[var(--line-soft)] pt-2" : "mt-4"))}>
              {!collapsed && <div className="px-3 pb-1 text-[11px] font-medium tracking-[0.12em] text-[var(--ink-subtle)]">{g.title}</div>}
              {g.items.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-5">
          <TargetBadge
            collapsed={collapsed}
            target={targetMeta}
            examDate={settings.examDate}
            onClick={() => setTargetModalOpen(true)}
          />
          <nav className={cn("flex flex-col", collapsed ? "gap-1.5" : "gap-0.5")} aria-label="更多">
            <Quiet to="/stats" label="学习统计" icon="graph" collapsed={collapsed} />
            <Quiet to="/settings" label="设置" icon="ruler" collapsed={collapsed} />
            <a
              href="https://github.com/luohui1/CETPath"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub 开源仓库 CETPath"
              className={cn("flex min-h-10 items-center rounded-[10px] text-[13px] text-[var(--ink-500)] transition-colors hover:bg-white/70 hover:text-[var(--ink)]", collapsed ? "flex-col justify-center gap-1 py-1.5" : "gap-3 px-3 py-2")}
            >
              <GithubLogo className="size-[18px]" weight="fill" />
              {collapsed ? <span className="text-[11px] leading-none">GitHub</span> : "GitHub 开源"}
            </a>
          </nav>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={cn("flex min-h-10 items-center gap-3 rounded-[10px] border-t border-[var(--line-soft)] py-2.5 text-[13px] text-[var(--ink-500)] transition-colors hover:text-[var(--ink)]", collapsed ? "justify-center" : "px-3")}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <SidebarSimple className={cn("size-[18px]", collapsed && "-scale-x-100")} />
            {!collapsed && "收起"}
          </button>
        </div>
      </aside>

      <NavProgress />
      <main key={pathname} className="page-in mx-auto w-full max-w-[1120px] px-5 pt-8 pb-16 md:px-10 md:pt-10">
        <AuthGate />
        <Outlet />
      </main>

      <TargetExamModal open={targetModalOpen} onClose={() => setTargetModalOpen(false)} />
    </div>
  );
}
