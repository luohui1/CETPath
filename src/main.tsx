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
import type { ComponentType } from "react";
import { Layout } from "./components/Layout";
import { loadMe } from "./lib/auth";
import { HomePage } from "./pages/Home";
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
      { path: "/review", ...page(() => import("./pages/Review").then((m) => m.ReviewPage)) },
      { path: "/vocab", ...page(() => import("./pages/Vocab").then((m) => m.VocabPage)) },
      { path: "/books", ...page(() => import("./pages/Books").then((m) => m.BooksPage)) },
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

// 先把常用数据读好再画第一帧（最多等 600ms），首页不会先空着再一块块跳出来
const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* 通用界面图标统一用 Phosphor 的双色（duotone） */}
      <IconContext.Provider value={{ weight: "duotone" }}>
        {memoryDb && <MemoryDbNotice />}
        <RouterProvider router={router} />
      </IconContext.Provider>
    </StrictMode>,
  );
Promise.race([primeAppData(), new Promise((r) => setTimeout(r, 600))]).then(render, render);
