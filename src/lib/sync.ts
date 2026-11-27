import type { Transaction } from "dexie";
import { ACTIVE_ACCOUNT, scopedKey, type ActiveAccount } from "./account";
import { db, openGuestDb } from "./db";

/*
 * 跨设备同步：登录后，本账号独立 Dexie 库里改过的行记进本账号作用域的"待上传"，定时和服务器交换（POST /api/sync）。
 * 不同账号拥有各自独立的 IndexedDB 与同步队列，切换账号不会互相污染。
 */
export const SYNC_TABLES = [
  "vocab",
  "cards",
  "logs",
  "attempts",
  "days",
  "settings",
  "marks",
  "mastery",
  "memory",
  "chats",
  "methods",
  "aiSyntax",
  "ieltsAttempts",
  "ieltsMastery",
  "ieltsSpeaking",
] as const;
type Tbl = (typeof SYNC_TABLES)[number];
type Row = Record<string, unknown>;

const OUT = scopedKey("yz-sync-out");
const SEQ = scopedKey("yz-sync-seq");
const KV_SEEN = scopedKey("yz-sync-kv");
const GUEST_DISMISSED = scopedKey("yz-guest-dismissed");
const KV_PREFIXES = ["yz-article-marks:", "yz-articles-read", "yz-studio-"];

/** 同步用的键：自增 id 的表（logs、memory）换成跨设备不变的键 */
function keyOf(tbl: Tbl, row: Row): string | null {
  if (tbl === "logs") return `${row.word}|${row.reviewedAt}`;
  if (tbl === "memory") return row.kind === "profile" ? "profile" : null;
  const pk = db.table(tbl).schema.primKey.keyPath as string;
  const v = row[pk];
  return v === undefined || v === null ? null : String(v);
}

const readOut = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(OUT) || "{}");
  } catch {
    return {};
  }
};

function markDirty(id: string, at = Date.now()) {
  try {
    const out = readOut();
    out[id] = at;
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
  for (const tbl of SYNC_TABLES) {
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
  if (tbl === "kv") return localStorage.getItem(scopedKey(k));
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
    const sk = scopedKey(k);
    if (row === null) localStorage.removeItem(sk);
    else localStorage.setItem(sk, String(row));
    const seen: Record<string, string> = JSON.parse(localStorage.getItem(KV_SEEN) || "{}");
    if (row === null) delete seen[k];
    else seen[k] = String(row);
    localStorage.setItem(KV_SEEN, JSON.stringify(seen));
    if (k.startsWith("yz-studio-")) dispatchEvent(new Event("yz-studio-change"));
    return;
  }
  if (!(SYNC_TABLES as readonly string[]).includes(tbl)) return;
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

/** 存在 localStorage 的外刊标注、已读记录（按当前账号作用域隔离） */
function kvSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const suffix = `:${ACTIVE_ACCOUNT ? `u${ACTIVE_ACCOUNT.uid}` : "guest"}`;
  for (let i = 0; i < localStorage.length; i++) {
    const rawKey = localStorage.key(i)!;
    if (!rawKey.endsWith(suffix)) continue;
    const base = rawKey.slice(0, -suffix.length);
    if (KV_PREFIXES.some((p) => base.startsWith(p))) out[base] = localStorage.getItem(rawKey)!;
  }
  return out;
}

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
let inFlight: AbortController | null = null;

function schedule(ms: number) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), ms);
}

export async function syncNow() {
  if (!enabled || running || !ACTIVE_ACCOUNT) return;
  running = true;
  const ctrl = new AbortController();
  inFlight = ctrl;
  setState({ ...state, status: "syncing" });
  try {
    const seen: Record<string, string> = JSON.parse(localStorage.getItem(KV_SEEN) || "{}");
    const kv = kvSnapshot();
    const out = readOut();
    for (const k of new Set([...Object.keys(seen), ...Object.keys(kv)])) if (seen[k] !== kv[k]) out[`kv\u0001${k}`] = Date.now();
    localStorage.setItem(OUT, JSON.stringify(out));
    localStorage.setItem(KV_SEEN, JSON.stringify(kv));
    let more = true;
    let first = true;
    while (more) {
      if (ctrl.signal.aborted) return;
      const ids = first ? Object.keys(out).slice(0, 1500) : [];
      const push = await Promise.all(
        ids.map(async (id) => {
          const [tbl, k] = id.split("\u0001");
          return { tbl, k, row: await currentRow(tbl as Tbl, k), t: out[id] };
        }),
      );
      const r = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: ACTIVE_ACCOUNT.uid, since: Number(localStorage.getItem(SEQ) || 0), push }),
        signal: ctrl.signal,
      });
      if (r.status === 401 || r.status === 409) {
        stopSync();
        return;
      }
      const x = (await r.json()) as { pull: { tbl: string; k: string; row: unknown; t: number }[]; seq: number; more: boolean; error?: string };
      if (!r.ok) throw new Error(x.error || "同步失败");
      if (ctrl.signal.aborted) return;
      const now = readOut();
      for (const id of ids) if (now[id] === out[id]) delete now[id];
      localStorage.setItem(OUT, JSON.stringify(now));
      const pend = readOut();
      for (const it of x.pull) if (!(pend[`${it.tbl}\u0001${it.k}`] > it.t)) await applyRow(it.tbl, it.k, it.row);
      localStorage.setItem(SEQ, String(x.seq));
      more = x.more;
      first = false;
    }
    setState({ status: "idle", at: Date.now() });
    if (Object.keys(readOut()).length) schedule(1000);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    setState({ status: "error", at: state.at, error: e instanceof Error ? e.message : "同步失败" });
  } finally {
    if (inFlight === ctrl) inFlight = null;
    running = false;
  }
}

let pollTimer = 0;

/** 登录后启动当前账号独立库的云端同步 */
export async function startSync(acc: ActiveAccount) {
  if (!ACTIVE_ACCOUNT || ACTIVE_ACCOUNT.uid !== acc.uid) return;
  hook();
  enabled = true;
  void syncNow();
  if (!pollTimer) {
    pollTimer = window.setInterval(() => void syncNow(), 30_000);
    addEventListener("online", () => void syncNow());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void syncNow());
  }
}

export function stopSync() {
  enabled = false;
  clearTimeout(timer);
  inFlight?.abort();
  inFlight = null;
  setState({ status: "off" });
}

/** 检查本机未登录访客库里是否有尚未认领的学习记录 */
export async function countUnclaimedGuestRecords(): Promise<number> {
  if (!ACTIVE_ACCOUNT) return 0;
  try {
    if (localStorage.getItem(GUEST_DISMISSED)) return 0;
  } catch {
    return 0;
  }
  const guest = openGuestDb();
  if (!guest) return 0;
  try {
    await guest.open();
    const coreTables: Tbl[] = ["vocab", "attempts", "marks", "mastery", "chats", "methods", "ieltsAttempts", "ieltsMastery", "ieltsSpeaking"];
    let count = 0;
    for (const tbl of coreTables) {
      if (guest.tables.some((t) => t.name === tbl)) {
        count += await guest.table(tbl).count();
      }
    }
    return count;
  } catch {
    return 0;
  } finally {
    guest.close();
  }
}

/** 用户主动确认后，将本机访客库中的记录合并进当前登录账号（t=1，不覆盖云端更新数据） */
export async function claimGuestRecords(): Promise<number> {
  if (!ACTIVE_ACCOUNT) return 0;
  const guest = openGuestDb();
  if (!guest) return 0;
  let imported = 0;
  try {
    await guest.open();
    const out = readOut();
    for (const tbl of SYNC_TABLES) {
      if (!guest.tables.some((t) => t.name === tbl)) continue;
      const rows = (await guest.table(tbl).toArray()) as Row[];
      if (!rows.length) continue;
      const target = db.table(tbl);
      await db.transaction("rw", target, async (tx) => {
        (tx as unknown as { __sync: boolean }).__sync = true;
        for (const row of rows) {
          const k = keyOf(tbl, row);
          if (!k) continue;
          const existing = await currentRow(tbl, k);
          if (existing !== null) continue;
          if (tbl === "logs" || tbl === "memory") {
            const { id: _id, ...rest } = row;
            await target.add(rest as never);
          } else {
            await target.put(row as never);
          }
          out[`${tbl}\u0001${k}`] = 1;
          imported++;
        }
      });
    }
    localStorage.setItem(OUT, JSON.stringify(out));
    localStorage.setItem(GUEST_DISMISSED, "claimed");
    void syncNow();
    return imported;
  } finally {
    guest.close();
  }
}

export function dismissGuestRecords(): void {
  try {
    localStorage.setItem(GUEST_DISMISSED, "dismissed");
  } catch {
    // ignore
  }
}

hook();
