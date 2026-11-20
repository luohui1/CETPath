import type { Transaction } from "dexie";
import { db } from "./db";

/*
 * 跨设备同步：登录后，本机每张表改过的行记进"待上传"，定时和服务器交换（POST /api/sync）。
 * 按条同步、后改的为准；从服务器拉下来写进本机时打上标记，不会又被当成本机改动传回去。
 */
const TABLES = ["vocab", "cards", "logs", "attempts", "days", "settings", "marks", "mastery", "memory", "chats"] as const;
type Tbl = (typeof TABLES)[number];
type Row = Record<string, unknown>;
const OUT = "yz-sync-out";
const SEQ = "yz-sync-seq";
const KV_PREFIXES = ["yz-article-marks:", "yz-articles-read"];

/** 同步用的键：自增 id 的表（logs、memory）换成跨设备不变的键 */
function keyOf(tbl: Tbl, row: Row): string | null {
  if (tbl === "logs") return `${row.word}|${row.reviewedAt}`;
  if (tbl === "memory") return row.kind === "profile" ? "profile" : null;
  const pk = db.table(tbl).schema.primKey.keyPath as string;
  const v = row[pk];
  return v === undefined || v === null ? null : String(v);
}

const readOut = (): Record<string, number> => JSON.parse(localStorage.getItem(OUT) || "{}");
function markDirty(id: string) {
  try {
    const out = readOut();
    out[id] = Date.now();
    localStorage.setItem(OUT, JSON.stringify(out));
  } catch {
    // localStorage 满了也不能拦住学习数据的保存，这条只是暂时不同步
  }
  schedule(2000);
}

const isSync = (tx?: Transaction) => !!(tx as unknown as { __sync?: boolean } | undefined)?.__sync;
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  for (const tbl of TABLES) {
    const t = db.table(tbl);
    t.hook("creating", (_pk, obj, tx) => {
      if (!isSync(tx)) {
        const k = keyOf(tbl, obj as Row);
        if (k) markDirty(`${tbl}\u0001${k}`);
      }
    });
    t.hook("updating", (mods, _pk, obj, tx) => {
      if (!isSync(tx)) {
        const k = keyOf(tbl, { ...(obj as Row), ...(mods as Row) });
        if (k) markDirty(`${tbl}\u0001${k}`);
      }
    });
    t.hook("deleting", (_pk, obj, tx) => {
      if (!isSync(tx)) {
        const k = keyOf(tbl, obj as Row);
        if (k) markDirty(`${tbl}\u0001${k}`);
      }
    });
  }
}

async function currentRow(tbl: Tbl | "kv", k: string): Promise<unknown> {
  if (tbl === "kv") return localStorage.getItem(k);
  if (tbl === "logs") {
    const [word, at] = [k.slice(0, k.lastIndexOf("|")), Number(k.slice(k.lastIndexOf("|") + 1))];
    const r = await db.logs.where("word").equals(word).filter((x) => x.reviewedAt === at).first();
    if (!r) return null;
    const { id: _id, ...rest } = r as unknown as Row;
    return rest;
  }
  if (tbl === "memory") return (await db.memory.where("kind").equals("profile").first()) ?? null;
  return (await db.table(tbl).get(k)) ?? (/^\d+$/.test(k) ? await db.table(tbl).get(Number(k)) : undefined) ?? null;
}

async function applyRow(tbl: string, k: string, row: unknown) {
  if (tbl === "kv") {
    if (row === null) localStorage.removeItem(k);
    else localStorage.setItem(k, String(row));
    const seen: Record<string, string> = JSON.parse(localStorage.getItem(KV_SEEN) || "{}");
    if (row === null) delete seen[k];
    else seen[k] = String(row);
    localStorage.setItem(KV_SEEN, JSON.stringify(seen));
    return;
  }
  if (!(TABLES as readonly string[]).includes(tbl)) return;
  const t = db.table(tbl);
  await db.transaction("rw", t, async (tx) => {
    (tx as unknown as { __sync: boolean }).__sync = true;
    if (tbl === "logs") {
      const [word, at] = [k.slice(0, k.lastIndexOf("|")), Number(k.slice(k.lastIndexOf("|") + 1))];
      const old = await db.logs.where("word").equals(word).filter((x) => x.reviewedAt === at).first();
      if (row === null) {
        if (old) await db.logs.delete(old.id!);
      } else if (!old) await db.logs.add(row as never);
      return;
    }
    if (tbl === "memory") {
      const old = await db.memory.where("kind").equals("profile").first();
      if (row === null) {
        if (old) await db.memory.delete(old.id!);
      } else {
        const { id: _id, ...rest } = row as Row;
        await db.memory.put({ ...rest, ...(old ? { id: old.id } : {}) } as never);
      }
      return;
    }
    if (row === null) {
      await t.delete(k);
      await t.delete(Number(k)).catch(() => {});
    } else await t.put(row);
  });
}

/** 外刊标注、已读这些存在 localStorage 的，变了也要传 */
function kvSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (KV_PREFIXES.some((p) => k.startsWith(p))) out[k] = localStorage.getItem(k)!;
  }
  return out;
}
const KV_SEEN = "yz-sync-kv";

export type SyncState = { status: "off" | "idle" | "syncing" | "error"; at?: number; error?: string };
let state: SyncState = { status: "off" };
const setState = (s: SyncState) => {
  state = s;
  dispatchEvent(new Event("yz-sync"));
};
export const syncState = () => state;

let timer = 0;
let running = false;
let enabled = false;
function schedule(ms: number) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), ms);
}

export async function syncNow() {
  if (!enabled || running) return;
  running = true;
  setState({ ...state, status: "syncing" });
  try {
    // localStorage 里的东西：和上次传过的比，变了的记进待上传
    const seen: Record<string, string> = JSON.parse(localStorage.getItem(KV_SEEN) || "{}");
    const kv = kvSnapshot();
    const out = readOut();
    for (const k of new Set([...Object.keys(seen), ...Object.keys(kv)])) if (seen[k] !== kv[k]) out[`kv\u0001${k}`] = Date.now();
    localStorage.setItem(OUT, JSON.stringify(out));
    localStorage.setItem(KV_SEEN, JSON.stringify(kv));
    let more = true;
    let first = true;
    while (more) {
      const ids = first ? Object.keys(out).slice(0, 1500) : [];
      const push = await Promise.all(
        ids.map(async (id) => {
          const [tbl, k] = id.split("\u0001");
          return { tbl, k, row: await currentRow(tbl as Tbl, k), t: out[id] };
        }),
      );
      const r = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since: Number(localStorage.getItem(SEQ) || 0), push }) });
      if (r.status === 401) {
        stopSync();
        return;
      }
      const x = (await r.json()) as { pull: { tbl: string; k: string; row: unknown; t: number }[]; seq: number; more: boolean; error?: string };
      if (!r.ok) throw new Error(x.error || "同步失败");
      // 传上去的从待上传里删掉（传的过程中又改了的留着）
      const now = readOut();
      for (const id of ids) if (now[id] === out[id]) delete now[id];
      localStorage.setItem(OUT, JSON.stringify(now));
      const pend = readOut();
      // 本机还有没传上去、而且更新的改动：留着本机的，下次传上去
      for (const it of x.pull) if (!(pend[`${it.tbl}\u0001${it.k}`] > it.t)) await applyRow(it.tbl, it.k, it.row);
      localStorage.setItem(SEQ, String(x.seq));
      more = x.more;
      first = false;
    }
    setState({ status: "idle", at: Date.now() });
    if (Object.keys(readOut()).length) schedule(1000);
  } catch (e) {
    setState({ status: "error", at: state.at, error: e instanceof Error ? e.message : "同步失败" });
  } finally {
    running = false;
  }
}

/** 登录后调用：第一次会把本机已有的数据全部记进待上传（合并进账号） */
export async function startSync(user: string) {
  hook();
  if (localStorage.getItem("yz-sync-user") !== user) {
    localStorage.setItem("yz-sync-user", user);
    localStorage.removeItem(SEQ);
    localStorage.removeItem(KV_SEEN);
    const out = readOut();
    for (const tbl of TABLES)
      for (const row of await db.table(tbl).toArray()) {
        const k = keyOf(tbl, row as Row);
        if (k) out[`${tbl}\u0001${k}`] = 1; // t=1：服务器上有更新的版本时以服务器为准
      }
    localStorage.setItem(OUT, JSON.stringify(out));
  }
  enabled = true;
  void syncNow();
  if (!pollTimer) {
    pollTimer = window.setInterval(() => void syncNow(), 30_000);
    addEventListener("online", () => void syncNow());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void syncNow());
  }
}
let pollTimer = 0;

export function stopSync() {
  enabled = false;
  clearTimeout(timer);
  setState({ status: "off" });
}

// 没登录、离线时的改动也记下来，登录或联网后一起传
hook();
