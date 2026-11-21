import { db } from "./db";

const TABLES = ["vocab", "cards", "logs", "attempts", "days", "settings", "marks", "mastery", "memory", "chats"] as const;
const MOVED = "yz-moved-https";

type Handoff = { app: string; tables: Record<string, unknown[]>; ls: Record<string, string> };

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

/** 站点从 http 换到 https 后，浏览器把两边当成两个站：本地数据要搬一次。
 *  在 http 页上：把本地数据交给服务器暂存，带着取件码跳到 https；返回 true 表示正在跳走。搬不了就留在 http，不丢数据 */
export async function leaveHttp(): Promise<boolean> {
  if (!import.meta.env.PROD || location.protocol !== "http:" || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return false;
  const target = new URL(location.href);
  target.protocol = "https:";
  try {
    if (localStorage.getItem(MOVED)) {
      location.replace(target.href);
      return true;
    }
    const tables: Record<string, unknown[]> = {};
    await timeout(
      (async () => {
        for (const t of TABLES) tables[t] = await db.table(t).toArray();
      })(),
      5000,
    );
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      ls[k] = localStorage.getItem(k) ?? "";
    }
    if (Object.values(tables).some((rows) => rows.length) || Object.keys(ls).length) {
      const r = await timeout(fetch("/api/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "yingyu-zhidao", tables, ls } satisfies Handoff) }), 15000);
      if (!r.ok) return false;
      target.searchParams.set("handoff", (await r.json()).token);
    }
    localStorage.setItem(MOVED, "1");
    location.replace(target.href);
    return true;
  } catch {
    return false;
  }
}

/** 在 https 页上：地址里带着取件码，就把 http 那边的数据并进来 */
export async function takeHandoff() {
  const url = new URL(location.href);
  const tok = url.searchParams.get("handoff");
  if (!tok) return;
  url.searchParams.delete("handoff");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  try {
    const r = await timeout(fetch(`/api/handoff/${encodeURIComponent(tok)}`), 15000);
    if (!r.ok) return;
    const data = (await r.json()) as Handoff;
    if (data?.app !== "yingyu-zhidao" || !data.tables) return;
    for (const [k, v] of Object.entries(data.ls || {})) if (k !== MOVED) localStorage.setItem(k, v);
    await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) {
        const rows = data.tables[t];
        if (Array.isArray(rows) && rows.length) await db.table(t).bulkPut(rows);
      }
    });
  } catch {
    // 搬不过来就算了：http 那边的数据还在
  }
}
