import { db, type AttemptMode, type AttemptRow } from "./db";

/** 作答记录的键：整套卷就是试卷 id，专项训练是 "试卷 id#部分 id"，两者分开计分 */
export const attemptKey = (paperId: string, sectionId?: string) => (sectionId ? `${paperId}#${sectionId}` : paperId);

export function parseAttemptKey(key: string): { paperId: string; sectionId?: string } {
  const [paperId, sectionId] = key.split("#");
  return { paperId, sectionId };
}

/** 重做错题的作答记录：每套卷一条，每次重做覆盖 */
export const retryKey = (paperId: string) => `${paperId}#retry`;

/** 做题页地址 */
export const paperPath = (paperId: string, sectionId?: string) => (sectionId ? `/paper/${paperId}/${sectionId}` : `/paper/${paperId}`);

/** 重做错题：在原卷上只做这几道 */
export const retryPath = (paperId: string, ids: string[]) => `/paper/${paperId}/retry?q=${ids.join(",")}`;

/** 做题方式：旧记录没有就当整套模考（exam） */
export const attemptMode = (a?: AttemptRow): AttemptMode => a?.mode ?? "exam";

/** 已经作答的题数（选择题选了、主观题写了） */
export const answeredCount = (a: AttemptRow) => Object.keys(a.answers).length + Object.values(a.texts).filter((t) => t.trim()).length;

export function emptyAttempt(paperId: string, init?: Partial<AttemptRow>): AttemptRow {
  const now = Date.now();
  return { paperId, answers: {}, texts: {}, startedAt: now, updatedAt: now, lookups: 0, spentSec: 0, ...init };
}

/** 读出作答记录（没有就新建，init 只用在新建时），改完写回 */
export async function updateAttempt(paperId: string, patch: (a: AttemptRow) => void, init?: Partial<AttemptRow>) {
  await db.transaction("rw", db.attempts, async () => {
    const a = (await db.attempts.get(paperId)) ?? emptyAttempt(paperId, init);
    patch(a);
    a.updatedAt = Date.now();
    await db.attempts.put(a);
  });
}
