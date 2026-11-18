import { db, type AttemptMode, type AttemptRow, type MasteryRow } from "./db";
import { attemptMode, parseAttemptKey } from "./attempts";
import { primeLiveQuery, useCachedLiveQuery } from "./live";
import { loadPaper, type Paper, type Question, type SectionKind } from "./papers";
import { getSettings, setSetting } from "./settings";

/*
 * 错题本规则（docs/设计任务-B轮-练习闭环.md 第 2 节）：
 * - 交卷（exam、free 或 practice）时，每道选择题：答错 → 没有行就建一行，有行就追加一次；答对且已有行 → 追加一次
 * - 重做（retry）只追加，不新建
 * - history 末尾连续两次答对 → 移出（retiredAt）；又答错就回到待重做
 * - 没答的题不进错题本
 */

export const masteryId = (paperId: string, questionId: string) => `${paperId}#${questionId}`;

/** 末尾连续两次答对就算掌握了 */
const mastered = (h: MasteryRow["history"]) => h.length >= 2 && h[h.length - 1].right && h[h.length - 2].right;

export interface ScoredQuestion {
  q: Question;
  kind: SectionKind;
}

/** 一次作答涉及的选择题和它们的题型 */
export function scoredQuestions(paper: Paper): ScoredQuestion[] {
  return paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.filter((q) => q.options?.length && q.answer).map((q) => ({ q, kind: s.kind }))));
}

/** 把一次交卷记进错题本；返回这次移出（掌握了）的题 id */
export async function recordMastery(paperId: string, questions: ScoredQuestion[], answers: Record<string, string>, mode: AttemptMode, at = Date.now()): Promise<string[]> {
  const retired: string[] = [];
  await db.transaction("rw", db.mastery, async () => {
    const ids = questions.map(({ q }) => masteryId(paperId, q.id));
    const rows = await db.mastery.bulkGet(ids);
    const out: MasteryRow[] = [];
    questions.forEach(({ q, kind }, i) => {
      const chosen = answers[q.id];
      if (!chosen) return;
      const right = chosen === q.answer;
      let row = rows[i];
      if (!row) {
        if (right || mode === "retry") return;
        row = { id: ids[i], paperId, questionId: q.id, kind, firstWrongAt: at, history: [] };
      }
      row.history.push({ at, right, mode, chosen });
      if (!right) delete row.retiredAt;
      else if (!row.retiredAt && mastered(row.history)) {
        row.retiredAt = at;
        retired.push(q.id);
      }
      out.push(row);
    });
    if (out.length) await db.mastery.bulkPut(out);
  });
  return retired;
}

/** 手动标"已掌握" */
export const retireMistake = (id: string) => db.mastery.update(id, { retiredAt: Date.now() });

/** 手动恢复到待重做 */
export async function restoreMistake(id: string) {
  await db.transaction("rw", db.mastery, async () => {
    const row = await db.mastery.get(id);
    if (!row) return;
    delete row.retiredAt;
    await db.mastery.put(row);
  });
}

/** 一次作答记录在原卷上涉及哪些选择题：整套是全部，专项是那一部分，重做是那几道 */
function questionsOf(paper: Paper, a: AttemptRow): ScoredQuestion[] {
  const { sectionId } = parseAttemptKey(a.paperId);
  const all = scoredQuestions(sectionId && sectionId !== "retry" ? { ...paper, sections: paper.sections.filter((s) => s.id === sectionId) } : paper);
  if (sectionId !== "retry") return all;
  const ids = new Set(a.retryIds ?? []);
  return all.filter(({ q }) => ids.has(q.id));
}

let backfilling: Promise<void> | null = null;

/**
 * 旧数据迁移：把升级前已经交卷的记录按交卷时间先后跑一遍上面的规则，只跑一次（设置里记标记）。
 * 升级后交的卷在交卷时就记过了（masteryAt），这里跳过，不会记两遍
 */
export function backfillMastery(): Promise<void> {
  backfilling ??= (async () => {
    if ((await getSettings()).masteryBackfilled) return;
    const attempts = (await db.attempts.toArray()).filter((a) => a.submittedAt && a.masteryAt !== a.submittedAt).sort((a, b) => a.submittedAt! - b.submittedAt!);
    for (const a of attempts) {
      const { paperId } = parseAttemptKey(a.paperId);
      const paper = await loadPaper(paperId).catch(() => null);
      if (!paper) continue;
      await recordMastery(paperId, questionsOf(paper, a), a.answers, attemptMode(a), a.submittedAt);
      await db.attempts.update(a.paperId, { masteryAt: a.submittedAt });
    }
    await setSetting("masteryBackfilled", true);
  })().catch((e) => {
    backfilling = null;
    console.error("补录错题本失败", e);
  });
  return backfilling;
}

const masteryRows = () => db.mastery.toArray();
const pendingCount = () => db.mastery.filter((r) => !r.retiredAt).count();

/** 错题本的全部行（错题本页用） */
export const useMistakes = () => useCachedLiveQuery("mastery", masteryRows);

/** 待重做的题数（导航徽标、首页"今天"） */
export const usePendingMistakes = () => useCachedLiveQuery("mastery-pending", pendingCount);

/** 应用启动时先读好待重做数，导航徽标不会晚一拍跳出来 */
export const primeMistakes = () => primeLiveQuery("mastery-pending", pendingCount);

/** 某套卷里这些题已经重做过几次（不含 before 之后的），给"重做错题 · 第 N 次"用 */
export async function retryRounds(paperId: string, ids: string[], before: number) {
  const rows = await db.mastery.bulkGet(ids.map((id) => masteryId(paperId, id)));
  return Math.max(0, ...rows.map((r) => r?.history.filter((h) => h.mode === "retry" && h.at < before).length ?? 0));
}
