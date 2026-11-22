import { db } from "./db";

const TABLES = ["vocab", "cards", "logs", "attempts", "days", "settings", "marks", "mastery", "memory", "chats", "methods"] as const;

/** 所有学习数据导出成一个 JSON，换设备或清缓存前用来备份 */
export async function exportBackup() {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  return { app: "yingyu-zhidao", version: 1, exportedAt: new Date().toISOString(), tables };
}

export async function importBackup(json: unknown) {
  const data = json as { app?: string; tables?: Record<string, unknown[]> };
  if (data?.app !== "yingyu-zhidao" || !data.tables) throw new Error("这不是英语之道的备份文件");
  await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = data.tables![t];
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkPut(rows);
    }
  });
}

export async function clearAll() {
  await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}
