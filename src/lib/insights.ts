import { useEffect, useMemo, useState } from "react";
import { db, dayKey, type AttemptRow, type DayRow } from "./db";
import { answeredCount, parseAttemptKey } from "./attempts";
import { primeLiveQuery, useCachedLiveQuery } from "./live";
import { KIND_NAMES, loadPaper, loadPaperIndex, peekPaper, peekPaperIndex, type Paper, type PaperIndexItem, type SectionIndexItem, type SectionKind } from "./papers";
import { settingsRows } from "./settings";
import { primeMistakes } from "./mistakes";

/** 一条作答记录对应的套卷或专项 */
export interface AttemptItem {
  key: string;
  paper: PaperIndexItem;
  section?: SectionIndexItem;
  attempt: AttemptRow;
}

export interface KindStat {
  kind: SectionKind;
  sections: number; // 题库里这种题型有几个部分
  practiced: number; // 交过卷的部分（整套或专项都算）
  correct: number;
  total: number;
  answered: number; // 其中真的作答了的题（不足 5 题不显示正确率）
}

/** 答题不足 5 题看不出水平，不显示正确率 */
export const MIN_ANSWERS = 5;

export const KINDS = Object.keys(KIND_NAMES) as SectionKind[];

export const itemTitle = (it: { paper: PaperIndexItem; section?: SectionIndexItem }) => (it.section ? `${KIND_NAMES[it.section.kind]} · ${it.paper.title}` : it.paper.title);
export const itemTotal = (it: { paper: PaperIndexItem; section?: SectionIndexItem }) => it.section?.questionCount ?? it.paper.questionCount;
export const itemProgress = (it: AttemptItem) => answeredCount(it.attempt) / Math.max(1, itemTotal(it));

const attemptRows = () => db.attempts.orderBy("updatedAt").reverse().toArray();

/** 应用启动时先把设置、作答记录和试卷目录读好，第一次进页面就是完整的，不会一块块跳出来 */
export function primeAppData() {
  return Promise.all([primeLiveQuery("settings", settingsRows), primeLiveQuery("attempts", attemptRows), loadPaperIndex(), primeMistakes()]);
}

/** 试卷目录（只加载一次；加载过就直接给，切页不用等） */
export function usePaperIndex() {
  const [index, setIndex] = useState<PaperIndexItem[] | null>(peekPaperIndex);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!index) loadPaperIndex().then(setIndex, (e: Error) => setError(e.message));
  }, [index]);
  return { index, error };
}

/** 读一套试卷；加载过的直接返回 */
export function usePaper(id: string | undefined): Paper | undefined {
  const [, loaded] = useState(0);
  const paper = id ? peekPaper(id) : undefined;
  useEffect(() => {
    if (id && !peekPaper(id)) loadPaper(id).then(() => loaded((n) => n + 1), () => {});
  }, [id]);
  return paper;
}

/** 作答记录对上试卷（专项训练的记录还要对上部分），按最近更新排序 */
export function useAttemptItems(index: PaperIndexItem[] | null) {
  const attempts = useCachedLiveQuery("attempts", attemptRows);
  return useMemo(() => {
    if (!index || !attempts) return null;
    const papers = new Map(index.map((p) => [p.id, p]));
    return attempts.flatMap((attempt): AttemptItem[] => {
      const { paperId, sectionId } = parseAttemptKey(attempt.paperId);
      const paper = papers.get(paperId);
      const section = sectionId ? paper?.sections.find((s) => s.id === sectionId) : undefined;
      return paper && (!sectionId || section) ? [{ key: attempt.paperId, paper, section, attempt }] : [];
    });
  }, [index, attempts]);
}

const kindCache = new Map<string, KindStat[]>();

/**
 * 各题型的正确率：交过卷的整套和专项都算，按题目所在部分的题型归类。
 * 要读每套交过卷的试卷才知道哪题属于哪个题型，试卷和算好的结果都有缓存。
 */
export function useKindStats(index: PaperIndexItem[] | null, items: AttemptItem[] | null) {
  const [stats, setStats] = useState<KindStat[] | null>(null);
  const done = useMemo(() => (items ?? []).filter((it) => it.attempt.submittedAt), [items]);
  // 题库和交过卷的记录都没变，就是同一份结果
  const sig = index && items ? `${index.map((p) => p.id).join(",")}|${done.map((it) => `${it.key}:${it.attempt.submittedAt}`).join("|")}` : "";
  useEffect(() => {
    if (!index || !items || kindCache.has(sig)) return;
    let cancelled = false;
    const base = new Map<SectionKind, KindStat>(KINDS.map((k) => [k, { kind: k, sections: 0, practiced: 0, correct: 0, total: 0, answered: 0 }]));
    // 从同场另一套接过来的部分不算题库里多出来的一份
    for (const p of index) for (const s of p.sections) if (!s.from) base.get(s.kind)!.sections++;
    Promise.all(done.map((it) => loadPaper(it.paper.id).then((paper) => ({ it, paper }), () => null))).then((rows) => {
      if (cancelled) return;
      const practiced = new Set<string>();
      for (const row of rows) {
        if (!row) continue;
        const { it, paper } = row;
        for (const s of paper.sections) {
          if (it.section && s.id !== it.section.id) continue;
          const stat = base.get(s.kind)!;
          const qs = s.groups.flatMap((g) => g.questions).filter((q) => q.options?.length && q.answer);
          if (!practiced.has(`${paper.id}#${s.id}`)) {
            practiced.add(`${paper.id}#${s.id}`);
            stat.practiced++;
          }
          stat.total += qs.length;
          stat.correct += qs.filter((q) => it.attempt.answers[q.id] === q.answer).length;
          stat.answered += qs.filter((q) => it.attempt.answers[q.id]).length;
        }
      }
      const result = [...base.values()].filter((s) => s.sections);
      kindCache.set(sig, result);
      setStats(result);
    });
    return () => {
      cancelled = true;
    };
    // sig 已经概括了 index 和 done 的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return kindCache.get(sig) ?? stats;
}

/** 一次整套交卷的四六级折算分 */
export interface ScoreRow {
  key: string;
  title: string;
  at: number; // 交卷时间
  listening: number;
  reading: number;
  listeningN: number;
  readingN: number;
  spentSec?: number;
}

/** 交过卷的整套四六级（专项不算）：按交卷时间从早到晚，给出折算的听力、阅读分 */
export function useCetScores(items: AttemptItem[] | null) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const done = useMemo(() => (items ?? []).filter((it) => !it.section && it.attempt.submittedAt && it.paper.exam.startsWith("cet")), [items]);
  const sig = done.map((it) => `${it.key}:${it.attempt.submittedAt}`).join("|");
  useEffect(() => {
    if (!items) return;
    let cancelled = false;
    void import("./report").then(({ cetScore }) =>
      Promise.all(done.map((it) => loadPaper(it.paper.id).then((paper) => ({ it, paper }), () => null))).then((loaded) => {
        if (cancelled) return;
        const out: ScoreRow[] = [];
        for (const row of loaded) {
          if (!row) continue;
          const s = cetScore(row.paper, row.it.attempt.answers);
          if (!s || !(s.listeningN + s.readingN)) continue;
          out.push({ key: row.it.key, title: row.it.paper.title, at: row.it.attempt.submittedAt!, spentSec: row.it.attempt.spentSec, ...s });
        }
        setRows(out.sort((a, b) => a.at - b.at));
      }),
    );
    return () => {
      cancelled = true;
    };
    // sig 概括了交卷记录的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, !!items]);
  return rows;
}

export interface DayPoint extends DayRow {
  label: string; // 11/2
  weekday: string; // 周一
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 最近 n 天每天的学习数据（没学的天补 0），从早到晚 */
export function lastDays(days: DayRow[], n: number): DayPoint[] {
  const map = new Map(days.map((d) => [d.day, d]));
  const out: DayPoint[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = dayKey(cursor);
    const d = map.get(key) ?? { day: key, reviews: 0, newWords: 0, lookups: 0, questions: 0, correct: 0 };
    out.push({ ...d, label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, weekday: `周${WEEKDAYS[cursor.getDay()]}` });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** 把作答时长说成"1 小时 20 分""12 分钟" */
export function spentText(sec = 0) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ""}`;
}
