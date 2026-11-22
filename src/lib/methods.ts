import { db, type MethodRow } from "./db";

export const GENERAL = "通用";

/** 收进解题思路库；同一段话收过就只更新出处和时间 */
export async function addMethod(m: Pick<MethodRow, "text" | "from"> & Partial<Pick<MethodRow, "kind" | "source">>) {
  const text = m.text.trim().slice(0, 1200);
  if (!text) return null;
  const now = Date.now();
  const old = await db.methods.filter((r) => r.text === text).first();
  if (old) {
    await db.methods.update(old.id, { updatedAt: now, ...(m.kind ? { kind: m.kind } : {}), ...(m.source ? { source: m.source } : {}) });
    return old.id;
  }
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db.methods.put({ id, text, kind: m.kind?.trim() || undefined, from: m.from, source: m.source, createdAt: now, updatedAt: now });
  return id;
}

export const updateMethod = (id: string, patch: Partial<Pick<MethodRow, "text" | "kind">>) => db.methods.update(id, { ...patch, updatedAt: Date.now() });
export const removeMethod = (id: string) => db.methods.delete(id);
export const hasMethod = async (text: string) => !!(await db.methods.filter((r) => r.text === text.trim()).first());
