import { bumpDay, db } from "@/lib/db";
import { useCachedLiveQuery } from "@/lib/live";
import { getSettings } from "@/lib/settings";
import { ieltsPaperLabel, loadIeltsIndex, loadIeltsKey, loadIeltsPaper, warmIeltsKey } from "./data";
import { band, gradeSection, roundIeltsBand, wordCount } from "./grade";
import type {
  IeltsAttemptRow,
  IeltsMasteryRow,
  IeltsPaper,
  IeltsRunMode,
  IeltsRunScope,
  IeltsSkill,
  IeltsSkillState,
  IeltsSpeakingRow,
} from "./types";

export const SKILL_LIMITS: Record<IeltsSkill, number | null> = {
  listening: null, // audio-paced, followed by 120s check period
  reading: 3600,
  writing: 3600,
};

export const LISTENING_CHECK_SEC = 120;
export const MOCK_ORDER: IeltsSkill[] = ["listening", "reading", "writing"];

export function makeRunId(prefix = "ia"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function initSkillState(paper: IeltsPaper, skill: IeltsSkill, mode: IeltsRunMode): IeltsSkillState {
  let limit = mode === "mock" ? SKILL_LIMITS[skill] : null;
  if (mode === "mock" && paper.id.startsWith("wj:") && skill === "writing" && paper.writing?.length === 1) {
    limit = paper.writing[0].part === 1 ? 1200 : 2400;
  }
  const firstQ =
    skill === "writing"
      ? paper.writing?.[0]?.part ?? 1
      : paper[skill]?.[0]?.groups?.[0]?.first ?? 1;
  return {
    status: mode === "mock" ? "intro" : "active",
    answers: {},
    essays: {},
    flags: {},
    highlights: {},
    elapsed: 0,
    limit,
    deadlineAt: null,
    listenDone: false,
    audioPart: 0,
    audioSec: 0,
    viewPart: 0,
    curQ: firstQ,
  };
}

/**
 * Find an active (unfinished) run matching the same paper, scope, and mode so "继续做题" resumes cleanly,
 * or start a fresh run with frozen assistSnapshot.
 */
export async function startOrResumeIeltsRun(opts: {
  paperId: string;
  scope: IeltsRunScope;
  mode: IeltsRunMode;
  forceNew?: boolean;
}): Promise<IeltsAttemptRow> {
  const { paperId, scope, mode, forceNew } = opts;
  if (!forceNew) {
    const all = await db.ieltsAttempts.where("paperId").equals(paperId).toArray();
    const active = all
      .filter((a) => !a.submittedAt && a.scope === scope && a.mode === mode)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (active) {
      warmIeltsKey(paperId);
      return active;
    }
  }

  const [paper, settings, idx] = await Promise.all([
    loadIeltsPaper(paperId),
    getSettings(),
    loadIeltsIndex().catch(() => null),
  ]);
  const entry = idx?.papers.find((e) => e.id === paperId);
  const paperTitle = entry ? ieltsPaperLabel(entry) : paper.title;

  const available = MOCK_ORDER.filter((s) => (paper[s]?.length ?? 0) > 0);
  const skills: IeltsSkill[] = scope === "full" ? available : available.includes(scope) ? [scope] : [available[0]];
  if (!skills.length) throw new Error("这套试卷没有可用的科目");

  // Freeze anti-pollution snapshot at run start: mock is ALWAYS 100% unassisted
  const assistSnapshot =
    mode === "mock"
      ? { practiceLookup: false, practiceVocabMarks: false }
      : {
          practiceLookup: !!settings.ieltsPracticeLookup,
          practiceVocabMarks: !!settings.ieltsPracticeVocabMarks,
        };
  const assisted = mode !== "mock" && (assistSnapshot.practiceLookup || assistSnapshot.practiceVocabMarks);

  const sections: Partial<Record<IeltsSkill, IeltsSkillState>> = {};
  for (const s of skills) sections[s] = initSkillState(paper, s, mode);

  const now = Date.now();
  const row: IeltsAttemptRow = {
    id: makeRunId(),
    paperId,
    paperTitle,
    family: paper.family,
    exam: paper.exam,
    scope,
    mode,
    assisted,
    assistSnapshot,
    skills,
    currentSkill: skills[0],
    sections,
    candidateName: settings.ieltsCandidateName?.trim() || undefined,
    startedAt: now,
    updatedAt: now,
  };
  await db.ieltsAttempts.put(row);
  warmIeltsKey(paperId);
  return row;
}

/** Strict anti-pollution gate: review/explanations unlock ONLY when the entire run is submitted */
export function isRunReviewUnlocked(run: IeltsAttemptRow | null | undefined): boolean {
  return Boolean(run?.submittedAt);
}

export async function patchSkillState(
  runId: string,
  skill: IeltsSkill,
  mutator: (st: IeltsSkillState, run: IeltsAttemptRow) => void,
  fallbackRun?: IeltsAttemptRow,
): Promise<void> {
  await db.transaction("rw", db.ieltsAttempts, async () => {
    const existing = await db.ieltsAttempts.get(runId);
    const run = existing ?? (fallbackRun ? structuredClone(fallbackRun) : undefined);
    if (!run || run.submittedAt) return;
    const st = run.sections[skill];
    if (!st || st.status === "submitted") return;
    mutator(st, run);
    run.updatedAt = Date.now();
    await db.ieltsAttempts.put(run);
  });
}

const masteredHistory = (h: IeltsMasteryRow["history"]) =>
  h.length >= 2 && h[h.length - 1].right && h[h.length - 2].right;

/**
 * Submit one skill inside a run:
 * - Seals the skill's answers;
 * - Grades against `IeltsKey` (for listening/reading) and records mistakes + `bumpDay`;
 * - Atomically advances `currentSkill` to the next unsubmitted skill in `skills`, OR finalizes `run.submittedAt` & `overallBand`.
 */
export async function submitIeltsSkill(
  runId: string,
  skill: IeltsSkill,
  reason: "manual" | "timeup" = "manual",
): Promise<IeltsAttemptRow | null> {
  const existing = await db.ieltsAttempts.get(runId);
  if (!existing) return null;
  const curSection = existing.sections[skill];
  if (!curSection || curSection.status === "submitted") return existing;

  const [paper, keyDoc] = await Promise.all([
    loadIeltsPaper(existing.paperId),
    skill === "writing" ? Promise.resolve(null) : loadIeltsKey(existing.paperId),
  ]);

  const at = Date.now();
  let rawScore = 0;
  let totalScore = 0;
  let skillBand: number | null = null;
  const masteryUpdates: {
    part: number;
    unitKey: string;
    label: string;
    first: number;
    count: number;
    qtype: IeltsMasteryRow["qtype"];
    earned: number;
    max: number;
    ok: boolean;
    answered: boolean;
    userText: string;
    correctText: string;
  }[] = [];

  if (skill === "listening" || skill === "reading") {
    const pParts = paper[skill] ?? [];
    const kParts = keyDoc?.[skill] ?? [];
    for (const pp of pParts) {
      const kp = kParts.find((x) => x.part === pp.part);
      if (!kp) continue;
      const gRes = gradeSection(pp.groups, kp.groups, curSection.answers);
      rawScore += gRes.raw;
      totalScore += gRes.total;
      for (const u of gRes.units) {
        masteryUpdates.push({ part: pp.part, ...u });
      }
    }
    skillBand = band(skill, rawScore, totalScore, existing.exam === "ielts-gt");
  }

  let updatedRun: IeltsAttemptRow | null = null;
  await db.transaction("rw", [db.ieltsAttempts, db.ieltsMastery], async () => {
    const run = await db.ieltsAttempts.get(runId);
    if (!run) return;
    const st = run.sections[skill];
    if (!st || st.status === "submitted") {
      updatedRun = run;
      return;
    }

    st.status = "submitted";
    st.submittedAt = at;
    st.deadlineAt = null;
    if (skill === "writing") {
      const words: Record<string, number> = {};
      for (const [k, v] of Object.entries(st.essays)) words[k] = wordCount(v);
      st.result = { words, reason, elapsed: st.elapsed };
    } else {
      st.result = { raw: rawScore, total: totalScore, band: skillBand, reason, elapsed: st.elapsed };
    }

    // Advance to next skill or finalize entire run
    const nextSkill = run.skills.find((s) => run.sections[s]?.status !== "submitted");
    if (nextSkill) {
      run.currentSkill = nextSkill;
    } else {
      run.submittedAt = at;
      const bands = run.skills
        .map((s) => run.sections[s]?.result?.band)
        .filter((b): b is number => typeof b === "number");
      run.overallBand = bands.length
        ? bands.length > 1
          ? roundIeltsBand(bands.reduce((a, b) => a + b, 0) / bands.length)
          : bands[0]
        : null;
    }
    run.updatedAt = at;
    await db.ieltsAttempts.put(run);
    updatedRun = run;

    // Update ieltsMastery (wrong & previously tracked units)
    if ((skill === "listening" || skill === "reading") && masteryUpdates.length) {
      const ids = masteryUpdates.map((u) => `${run.paperId}:${skill}:${u.unitKey}`);
      const oldRows = await db.ieltsMastery.bulkGet(ids);
      const toPut: IeltsMasteryRow[] = [];
      masteryUpdates.forEach((u, idx) => {
        // Record wrong units (including unanswered in submitted exam so IELTS blank gaps aren't lost, or answered wrong)
        let row = oldRows[idx];
        if (!row) {
          if (u.ok) return;
          row = {
            id: ids[idx],
            paperId: run.paperId,
            paperTitle: run.paperTitle,
            exam: run.exam,
            skill,
            part: u.part,
            unitKey: u.unitKey,
            label: u.label,
            first: u.first,
            count: u.count,
            qtype: u.qtype,
            correctText: u.correctText,
            firstWrongAt: at,
            updatedAt: at,
            history: [],
          };
        }
        row.correctText = u.correctText;
        row.updatedAt = at;
        row.history.push({
          at,
          earned: u.earned,
          max: u.max,
          right: u.ok,
          userText: u.userText,
          mode: run.mode,
        });
        if (!u.ok) delete row.retiredAt;
        else if (!row.retiredAt && masteredHistory(row.history)) row.retiredAt = at;
        toPut.push(row);
      });
      if (toPut.length) await db.ieltsMastery.bulkPut(toPut);
    }
  });

  if (totalScore > 0) {
    await bumpDay({ questions: totalScore, correct: rawScore }, at);
  }
  return updatedRun;
}

export async function recordIeltsRetryResult(
  rowId: string,
  earned: number,
  max: number,
  userTextStr: string,
): Promise<boolean> {
  const ok = earned === max;
  const at = Date.now();
  await db.transaction("rw", db.ieltsMastery, async () => {
    const row = await db.ieltsMastery.get(rowId);
    if (!row) return;
    row.history.push({ at, earned, max, right: ok, userText: userTextStr, mode: "practice" });
    row.updatedAt = at;
    if (!ok) delete row.retiredAt;
    else if (!row.retiredAt && masteredHistory(row.history)) row.retiredAt = at;
    await db.ieltsMastery.put(row);
  });
  await bumpDay({ questions: max, correct: earned }, at);
  return ok;
}

export const retireIeltsMistake = (id: string) =>
  db.ieltsMastery.update(id, { retiredAt: Date.now(), updatedAt: Date.now() });

export const deleteIeltsMistake = (id: string) => db.ieltsMastery.delete(id);

export function isIeltsRunEmpty(run: IeltsAttemptRow): boolean {
  if (run.submittedAt) return false;
  for (const st of Object.values(run.sections)) {
    if (!st) continue;
    if (st.status === "submitted") return false;
    if (Object.keys(st.answers).length > 0) return false;
    if (Object.values(st.essays).some((v) => v.trim().length > 0)) return false;
  }
  return true;
}

export async function deleteIeltsAttempt(runId: string): Promise<void> {
  await db.ieltsAttempts.delete(runId);
}

export async function deletePaperIeltsAttempts(paperId: string): Promise<void> {
  const ids = await db.ieltsAttempts.where("paperId").equals(paperId).primaryKeys();
  if (ids.length) await db.ieltsAttempts.bulkDelete(ids);
}

export async function restoreIeltsMistake(id: string) {
  await db.transaction("rw", db.ieltsMastery, async () => {
    const row = await db.ieltsMastery.get(id);
    if (!row) return;
    delete row.retiredAt;
    row.updatedAt = Date.now();
    await db.ieltsMastery.put(row);
  });
}

// ---------- Speaking Progress & Local Recordings ----------
export async function patchSpeakingProgress(qid: string, mutator: (cur: IeltsSpeakingRow) => void): Promise<void> {
  await db.transaction("rw", db.ieltsSpeaking, async () => {
    const cur: IeltsSpeakingRow = (await db.ieltsSpeaking.get(qid)) ?? { id: qid, updatedAt: Date.now() };
    mutator(cur);
    cur.updatedAt = Date.now();
    if (!cur.done && !cur.fav && !cur.count) {
      await db.ieltsSpeaking.delete(qid);
    } else {
      await db.ieltsSpeaking.put(cur);
    }
  });
}

// ---------- Live Queries ----------
const allIeltsAttempts = () => db.ieltsAttempts.orderBy("updatedAt").reverse().toArray();
const allIeltsMastery = () => db.ieltsMastery.toArray();
const pendingIeltsMasteryCount = () => db.ieltsMastery.filter((r) => !r.retiredAt).count();
const allIeltsSpeaking = () => db.ieltsSpeaking.toArray();

export const useIeltsAttempts = () => useCachedLiveQuery("ielts-attempts", allIeltsAttempts);
export const useIeltsMastery = () => useCachedLiveQuery("ielts-mastery", allIeltsMastery);
export const useIeltsPendingMistakes = () => useCachedLiveQuery("ielts-mastery-pending", pendingIeltsMasteryCount);
export const useIeltsSpeakingRows = () => useCachedLiveQuery("ielts-speaking", allIeltsSpeaking);
