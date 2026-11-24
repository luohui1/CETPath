import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ARTICLES_ON } from "./lib/articles";
import { registerSW } from "virtual:pwa-register";
import { IconContext } from "@phosphor-icons/react";
// 数字和英文展示用的衬线体，只要拉丁字符
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-500.css";
import "@fontsource/source-serif-4/latin-600.css";
import "@fontsource/source-serif-4/latin-700.css";
import "./index.css";
import { primeAppData } from "./lib/insights";
import { db, memoryDb } from "./lib/db";
import { leaveHttp, takeHandoff } from "./lib/https";
import type { ComponentType } from "react";
import { Layout } from "./components/Layout";
import { loadMe } from "./lib/auth";
import { HomePage } from "./pages/Home";
import { IS_PREVIEW, installPreview } from "./lib/preview";
import { NotFoundPage } from "./pages/NotFound";

/*
 * 页面按需加载：首页只带首页的代码；做题页（连同 pdf.js、听力条、画笔）、统计图表、背词等各自一包，
 * 进那一页才下载。慢网（国内到新加坡 14–50KB/s）下第一次打开站点少下一大半脚本。
 * 装好 Service Worker 以后所有包都在预缓存里，切页不用等网络。
 */
const loaders: (() => Promise<unknown>)[] = [];
const page = (load: () => Promise<ComponentType>) => {
  loaders.push(load);
  return { lazy: async () => ({ Component: await load() }) };
};
const reader = () => import("./pages/PaperReader").then((m) => m.PaperReaderPage);

if (IS_PREVIEW) installPreview();
void loadMe(); // 从哪个页面打开都先查登录、开始同步

const router = createBrowserRouter([
  { path: "/welcome", ...page(() => import("./pages/Welcome").then((m) => m.WelcomePage)) },
  // 做题页是沉浸式考场，不显示应用侧边栏；/paper/:id/retry?q=… 是重做错题
  ARTICLES_ON
    ? { path: "/articles/:id", ...page(() => import("./pages/Article").then((m) => m.ArticlePage)) }
    : { path: "/articles/*", element: <Navigate to="/" replace /> },
  { path: "/paper/:id/:section?", ...page(reader), hydrateFallbackElement: <div className="min-h-dvh bg-[var(--paper-100)]" /> },
  {
    element: <Layout />,
    hydrateFallbackElement: <div className="min-h-dvh bg-[var(--paper-100)]" />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/papers", ...page(() => import("./pages/Papers").then((m) => m.PapersPage)) },
      ARTICLES_ON
        ? { path: "/articles", ...page(() => import("./pages/Articles").then((m) => m.ArticlesPage)) }
        : { path: "/articles", element: <Navigate to="/" replace /> },
      { path: "/practice", ...page(() => import("./pages/Practice").then((m) => m.PracticePage)) },
      { path: "/mistakes", ...page(() => import("./pages/Mistakes").then((m) => m.MistakesPage)) },
      { path: "/methods", ...page(() => import("./pages/Methods").then((m) => m.MethodsPage)) },
      { path: "/review", ...page(() => import("./pages/Review").then((m) => m.ReviewPage)) },
      { path: "/review/quick", ...page(() => import("./pages/Quick").then((m) => m.QuickPassPage)) },
      { path: "/review/digest", ...page(() => import("./pages/Quick").then((m) => m.DigestPage)) },
      { path: "/vocab", ...page(() => import("./pages/Vocab").then((m) => m.VocabPage)) },
      { path: "/books", ...page(() => import("./pages/Books").then((m) => m.BooksPage)) },
      { path: "/roots", ...page(() => import("./pages/Roots").then((m) => m.RootsPage)) },
      { path: "/stats", ...page(() => import("./pages/Stats").then((m) => m.StatsPage)) },
      { path: "/ask", ...page(() => import("./pages/Ask").then((m) => m.AskPage)) },
      { path: "/settings", ...page(() => import("./pages/Settings").then((m) => m.SettingsPage)) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

// 首页画出来、浏览器空下来以后，先把做题页那一包取好：点"开始做题"时不用再等
const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 2000));
// 再把其余各页的包也取好：切页时不用等下载（慢网下以前每切一页都要卡一下）
idle(() => {
  void reader().catch(() => {});
  loaders.forEach((l, i) => setTimeout(() => void l().catch(() => {}), 300 * (i + 1)));
});

registerSW({ immediate: true });

/* 本地数据库看门狗：5 秒打不开（某些手机自带、内嵌浏览器里 IndexedDB 不回调），本次会话改用内存库，刷新一次。
   只自动切一次；内存库模式下发现真的数据库又能用了（比如换了设置），自动切回来，也只切一次 */
const flag = (key: string, value?: string | null) => {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    return value;
  } catch {
    return undefined; // 会话存储也不能用：没法切，照旧等着
  }
};
if (!memoryDb) {
  const opened = db.open().then(
    () => true,
    () => false,
  );
  void Promise.race([opened, new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]).then((ok) => {
    if (ok || flag("yz-memory-db-tried")) return;
    if (flag("yz-memory-db-tried", "1") !== "1" || flag("yz-memory-db", "1") !== "1") return;
    location.reload();
  });
} else {
  document.documentElement.classList.add("yz-memdb");
  if (!flag("yz-memory-db-back")) {
    const t0 = performance.now();
    try {
      const req = indexedDB.open("yz-probe");
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase("yz-probe");
        // 刚打开页面时才切（用户还没开始做题）
        if (performance.now() - t0 > 3000) return;
        flag("yz-memory-db-back", "1");
        flag("yz-memory-db", null);
        flag("yz-memory-db-tried", null);
        location.reload();
      };
    } catch {
      // 真的数据库还是不能用
    }
  }
}

/** 内存库时顶部一行提示（不是错误，不用红） */
function MemoryDbNotice() {
  return (
    <div role="status" className="no-print fixed inset-x-0 top-0 z-[100] flex h-8 items-center justify-center overflow-hidden bg-[var(--star-tint)] px-4 text-center text-[13px] whitespace-nowrap text-[var(--ink-700)] shadow-[inset_0_-1px_0_var(--line)]">
      {/* 窄屏放不下一整句，只说要紧的 */}
      <span className="hidden sm:inline">这个浏览器的本地数据库没响应，这次的记录不会保存；用 Chrome 或 Safari 打开可以保存。</span>
      <span className="sm:hidden">本地数据库没响应，这次的记录不会保存</span>
    </div>
  );
}

/** 预览版：顶部一行说明这是预览版、少了什么，并挂显眼的 GitHub 仓库入口 */
function PreviewNotice() {
  return (
    <div role="status" className="no-print fixed inset-x-0 top-0 z-[100] flex h-8 items-center justify-center gap-2.5 overflow-hidden bg-[var(--star-tint)] px-3 text-center text-[13px] whitespace-nowrap text-[var(--ink-700)] shadow-[inset_0_-1px_0_var(--line)]">
      <span className="rounded-full bg-[var(--blue)] px-2 py-px text-[11px] leading-4 font-semibold text-white">预览版</span>
      <span className="hidden md:inline">含 21 套四六级与考研真题（2 套带听力），AI 助教可在</span>
      <a href="/settings#agent" className="font-medium text-[var(--blue)] underline-offset-2 hover:underline">
        设置里接自己的模型
      </a>
      <a
        href="https://github.com/luohui1/CETPath"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-[#1f2328] px-2.5 py-0.5 text-[12px] leading-4 font-semibold text-white shadow-xs transition hover:bg-black"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        <span>GitHub 开源 · CETPath</span>
      </a>
    </div>
  );
}

// 先把常用数据读好再画第一帧（最多等 600ms），首页不会先空着再一块块跳出来
const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* 通用界面图标统一用 Phosphor 的双色（duotone） */}
      <IconContext.Provider value={{ weight: "duotone" }}>
        {IS_PREVIEW ? <PreviewNotice /> : memoryDb && <MemoryDbNotice />}
        <RouterProvider router={router} />
      </IconContext.Provider>
    </StrictMode>,
  );
const start = () => Promise.race([primeAppData(), new Promise((r) => setTimeout(r, 600))]).then(render, render);
// 站点换成 https：http 页先把本地数据搬过去再跳走；内存库时读不到真数据，不搬也不跳
if (memoryDb) void start();
else
  void leaveHttp().then((away) => {
    if (!away)
      void takeHandoff().then((back) => {
        if (!back) void start();
      }, start);
  });
