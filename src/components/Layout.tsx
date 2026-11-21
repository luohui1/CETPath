import { AuthGate } from "./AuthGate";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigation } from "react-router";
import { SidebarSimple } from "@phosphor-icons/react";
import { pendingCounts } from "@/lib/learning";
import { backfillMastery, usePendingMistakes } from "@/lib/mistakes";
import { useSettings } from "@/lib/settings";
import { cn, daysUntil } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { PixelIcon, type PixelName } from "./PixelIcon";
import { WORD_PAGES } from "./WordsTabs";
import { ARTICLES_ON } from "@/lib/articles";

const KEY = "yy-sidebar-collapsed";

/** 侧边栏收起/展开：记在本机；没记过时，平板等窄屏默认收起 */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) return v === "1";
    } catch {
      // 隐私模式等读不到本地存储，按屏幕宽度来
    }
    return innerWidth < 1280;
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch {
      // 存不了就只在这次打开里有效
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

interface NavItem {
  to: string;
  label: string;
  short?: string; // 收起时图标下面的小字
  icon: PixelName;
  end?: boolean;
  badge?: number;
  red?: boolean; // 徽标用红笔色（错题本的待重做数）
  match?: readonly string[]; // 这几页也算当前项（单词：背单词、词书、生词本）
}

/** 主导航项：双色文具图标 + 文字；当前页是一张抬起的白纸，左边一道品牌蓝 */
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

/** 次要导航：小字、小一号的文具图标 */
function Quiet({ to, label, icon, collapsed }: { to: string; label: string; icon: PixelName; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        cn(
          "flex min-h-10 items-center rounded-[10px] text-[13px] transition-colors",
          // 收起时图标下面也写字（和主导航一样），不然只剩三个猜不出意思的小图标
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

/** 侧边栏底部的小倒计时牌：墨色数字（红色只留给首页的倒计时牌，每屏最多一处红） */
function Countdown({ collapsed }: { collapsed: boolean }) {
  const settings = useSettings();
  const days = settings.examDate ? daysUntil(settings.examDate) : null;
  const set = days !== null && days >= 0;
  if (!set) return null; // 设考试只在首页那一条
  return (
    <NavLink
      to={set ? "/" : "/settings"}
      className={cn("card card-press flex items-center", collapsed ? "flex-col gap-0.5 px-1 py-2" : "gap-3 px-3 py-2")}
      title={set ? `距${settings.examName || "考试"} ${days} 天` : "设置考试日期"}
    >
      {set ? (
        <div className={cn("min-w-0", collapsed && "text-center")}>
          {!collapsed && <div className="truncate text-[11px] text-[var(--ink-subtle)]">距{settings.examName || "考试"}</div>}
          <div className={cn("num leading-7 text-[var(--ink)]", collapsed ? "text-[20px]" : "text-[26px]")}>
            {days}
            <span className="ml-0.5 font-[family-name:var(--font-sans)] text-[11px] font-normal text-[var(--ink-subtle)]">天</span>
          </div>
        </div>
      ) : (
        <span className={cn("flex items-center whitespace-nowrap text-[var(--blue)]", collapsed ? "flex-col gap-1 text-[11px] leading-none" : "gap-2 text-[12px]")}>
          <PixelIcon name="hourglass" size={18} />
          {collapsed ? "考试日" : "设置考试"}
        </span>
      )}
    </NavLink>
  );
}

/** 应用外壳：左侧窄导航（可以收成图标栏），右侧内容 */
/** 切页时下一页还在加载：顶上一条细进度条，让人知道点到了 */
function NavProgress() {
  const loading = useNavigation().state === "loading";
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-[var(--blue)] transition-[transform,opacity] duration-[1200ms] ease-out", loading ? "scale-x-90 opacity-100" : "scale-x-0 opacity-0 duration-200")} />
  );
}

export function Layout() {
  const settings = useSettings();
  const counts = useCachedLiveQuery("pending", () => pendingCounts(), [settings.dailyNew, settings.activeBook]);
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useCollapsed();
  const mistakes = usePendingMistakes();
  // 升级前交过卷的错题补进错题本（只跑一次）；稍等一会儿，不和首屏抢
  useEffect(() => {
    const t = setTimeout(() => void backfillMastery(), 1500);
    return () => clearTimeout(t);
  }, []);

  const items: NavItem[] = [
    { to: "/", label: "首页", icon: "house", end: true },
    { to: "/papers", label: "真题训练", short: "真题", icon: "paper" },
    { to: "/practice", label: "专项训练", short: "专项", icon: "target" },
    ...(ARTICLES_ON ? [{ to: "/articles", label: "外刊阅读", short: "外刊", icon: "book" } as NavItem] : []),
    { to: "/mistakes", label: "错题本", short: "错题", icon: "mistakes", badge: mistakes ?? 0, red: true },
    { to: "/review", label: "单词", short: "单词", icon: "bolt", badge: counts ? counts.dueReviews + counts.newLeft : 0, match: WORD_PAGES.map((p) => p.to) },
    { to: "/ask", label: "AI 助教", short: "AI", icon: "star" },
  ];
  const width = collapsed ? 72 : 200;

  return (
    <div className="min-h-dvh transition-[padding] duration-200 ease-out" style={{ paddingLeft: width }}>
      <aside
        className="no-print fixed top-[var(--memdb-h)] bottom-0 left-0 z-30 flex flex-col overflow-x-hidden overflow-y-auto bg-[var(--paper-50)] px-2.5 py-5 shadow-[inset_-1px_0_0_rgba(28,35,48,0.07),4px_0_16px_-12px_rgba(28,35,48,0.25)] transition-[width] duration-200 ease-out"
        style={{ width }}
      >
        <NavLink to="/" className={cn("mb-7 flex items-center gap-2.5", collapsed ? "justify-center" : "px-2")} title="英语之道">
          {/* 一枚小方章做标志 */}
          <span className="stamp stamp-flat grid size-8 flex-none place-items-center rounded-[7px] p-0 text-[15px] leading-none tracking-normal">道</span>
          {!collapsed && <span className="text-[17px] leading-none font-semibold tracking-[0.04em] whitespace-nowrap">英语之道</span>}
        </NavLink>

        <nav className="flex flex-col gap-1" aria-label="主导航">
          {items.map((it) => (
            <Item key={it.to} {...it} collapsed={collapsed} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-6">
          {/* 首页已经有倒计时牌，同一件事不说两遍 */}
          {pathname !== "/" && <Countdown collapsed={collapsed} />}
          <nav className="flex flex-col gap-0.5" aria-label="更多">
            <Quiet to="/stats" label="学习统计" icon="graph" collapsed={collapsed} />
            <Quiet to="/settings" label="设置" icon="ruler" collapsed={collapsed} />
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
    </div>
  );
}
