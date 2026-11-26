/*
 * 多账号本地隔离与旧站路由兼容：
 * - 未登录（访客）使用默认库 "yingyu-zhidao"；
 * - 登录用户使用独立库 "yingyu-zhidao:u<uid>"，同步游标与待传队列也按 u<uid> 隔离；
 * - 登录、退出或跨标签页切换账号时整页刷新，避免不同账号共用内存缓存或互相串数据。
 */

export interface ActiveAccount {
  uid: number;
  name: string;
}

export const ACCOUNT_KEY = "yz-active-account";
export const GUEST_DB_NAME = "yingyu-zhidao";

export function readActiveAccount(): ActiveAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveAccount>;
    if (typeof parsed?.uid === "number" && Number.isInteger(parsed.uid) && parsed.uid > 0 && typeof parsed?.name === "string" && parsed.name.trim()) {
      return { uid: parsed.uid, name: parsed.name.trim() };
    }
  } catch {
    // 隐私模式或损坏的值按访客处理
  }
  return null;
}

export function writeActiveAccount(acc: ActiveAccount | null): void {
  try {
    if (!acc) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ uid: acc.uid, name: acc.name }));
  } catch {
    // 忽略存储异常
  }
}

/** 当前页面生命周期锁定的账号身份；变化时通过整页刷新切库 */
export const ACTIVE_ACCOUNT: ActiveAccount | null = typeof window !== "undefined" ? readActiveAccount() : null;
export const ACCOUNT_SCOPE: string = ACTIVE_ACCOUNT ? `u${ACTIVE_ACCOUNT.uid}` : "guest";
export const DB_NAME: string = ACTIVE_ACCOUNT ? `${GUEST_DB_NAME}:u${ACTIVE_ACCOUNT.uid}` : GUEST_DB_NAME;

/** 给账号相关的 localStorage 键加上当前账号作用域 */
export function scopedKey(base: string, scope: string = ACCOUNT_SCOPE): string {
  return `${base}:${scope}`;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === ACCOUNT_KEY) location.reload();
  });
}

/**
 * 兼容旧版独立雅思站点的 Hash 路由书签与已安装 PWA 入口：
 * 例如 /#/speaking/topic/xxx -> /speaking/topic/xxx，/#/library/gt -> /papers?exam=ielts-gt
 */
export function redirectLegacyHash(): void {
  if (typeof window === "undefined") return;
  const h = location.hash;
  if (!h.startsWith("#/")) return;
  const path = h.slice(1); // "/speaking..."
  let next: string | null = null;
  if (path === "/" || path === "") next = "/";
  else if (path === "/speaking" || path.startsWith("/speaking/")) next = path;
  else if (path === "/library" || path === "/library/cam") next = "/papers?exam=ielts-a";
  else if (path === "/library/gt") next = "/papers?exam=ielts-gt";
  else if (path === "/library/jj") next = "/papers?exam=ielts-a&source=jj";
  else if (path === "/library/rb") next = "/papers?exam=ielts-a&source=rb";
  else if (path === "/library/wj") next = "/practice?exam=ielts-a&kind=writing";
  else if (path === "/wrong") next = "/mistakes";
  else if (path === "/progress") next = "/stats";
  else if (path === "/settings") next = "/settings";
  if (next) {
    try {
      history.replaceState(null, "", next);
    } catch {
      // 忽略沙箱环境的 history 限制
    }
  }
}
