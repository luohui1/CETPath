import type { AttemptRow } from "./db";
import { kindName, type ExamId, type Paper, type Question, type SectionKind } from "./papers";

/** 每题的建议用时（秒）：秒表超过就变红，卷面用时小字也标红 */
export const SUGGEST_SEC: Record<SectionKind, number> = {
  listening: 60,
  cloze: 60,
  banked: 60,
  matching: 90,
  reading: 120,
  order: 120,
  translation: 15 * 60,
  writing: 30 * 60,
};

/** 题目 id → 建议用时（秒） */
export function suggestMap(paper: Paper) {
  const m: Record<string, number> = {};
  for (const s of paper.sections) for (const g of s.groups) for (const q of g.questions) m[q.id] = SUGGEST_SEC[s.kind];
  return m;
}

/** 写了多少：英译汉按汉字算"字"，其余按英文单词算"词" */
export function countText(t: string): [number, string] {
  const han = t.match(/[一-鿿]/g)?.length ?? 0;
  const words = t.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
  return han > words ? [han, "字"] : [words, "词"];
}

/** 用时说成 1:20（题）或 38 分钟（部分） */
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

export interface ReportSection {
  id: string;
  kind: SectionKind;
  name: string;
  correct: number;
  total: number; // 选择题数；写作翻译是 0
  written?: [number, string]; // 写作、翻译：写了多少
  sec?: number; // 这一部分花的秒数（旧记录没有）
  perQuestion?: number; // 平均每题秒数
}

export interface Report {
  score: number;
  total: number;
  pct: number | null; // 没有选择题时为 null
  sections: ReportSection[];
  wrong: { q: Question; chosen: string }[];
  skipped: Question[];
  slowest: { q: Question; sec: number; over: boolean }[];
}

/**
 * 四六级按官方计分规则折算的听力、阅读分（满分各 248.5）。2016 年起的题型：
 * 听力 1–15 题每题 7.1 分、16–25 题每题 14.2 分；阅读选词填空（26–35）每题 3.55 分、长篇阅读（36–45）7.1 分、仔细阅读（46–55）14.2 分。
 * 2015 年的旧题型按同样的题号折算（误差在几分以内）。写作、翻译要人工判，不算在里面。考研卷返回 null。
 */
export const CET_PART_MAX = 248.5;
const cetPoints = (n: number) => (n <= 15 ? 7.1 : n <= 25 ? 14.2 : n <= 35 ? 3.55 : n <= 45 ? 7.1 : 14.2);

export function cetScore(paper: Paper, answers: Record<string, string>): { listening: number; reading: number; listeningN: number; readingN: number } | null {
  if (!paper.exam.startsWith("cet")) return null;
  let listening = 0;
  let reading = 0;
  let listeningN = 0;
  let readingN = 0;
  for (const s of paper.sections) {
    const isListening = s.kind === "listening";
    const isReading = s.kind === "banked" || s.kind === "matching" || s.kind === "reading";
    if (!isListening && !isReading) continue;
    for (const g of s.groups)
      for (const q of g.questions) {
        if (!q.options?.length || !q.answer || !q.number) continue;
        const right = answers[q.id] === q.answer;
        if (isListening) {
          listeningN++;
          if (right) listening += cetPoints(q.number);
        } else {
          readingN++;
          if (right) reading += cetPoints(q.number);
        }
      }
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { listening: r1(listening), reading: r1(reading), listeningN, readingN };
}

/** 交卷单的数据：总分、各部分（正确率、用时）、错题、未答、最慢的 5 题 */
export function buildReport(paper: Paper, attempt: AttemptRow): Report {
  const answers = attempt.answers;
  const counts = new Map<SectionKind, number>();
  for (const s of paper.sections) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const limits = suggestMap(paper);
  const sections: ReportSection[] = paper.sections.map((s) => {
    const qs = s.groups.flatMap((g) => g.questions);
    const choice = qs.filter((q) => q.options?.length && q.answer);
    const sec = attempt.sectionSec?.[s.id];
    const name = kindName(s.kind, paper.exam as ExamId) + (counts.get(s.kind)! > 1 && s.subtitle ? ` ${s.subtitle}` : "");
    const base = { id: s.id, kind: s.kind, name, sec, perQuestion: sec && qs.length ? sec / qs.length : undefined };
    if (!choice.length) {
      const written = qs.reduce((n, q) => n + countText(attempt.texts[q.id] ?? "")[0], 0);
      const unit = qs.some((q) => countText(attempt.texts[q.id] ?? "")[1] === "字") ? "字" : "词";
      return { ...base, correct: 0, total: 0, written: [written, unit] as [number, string] };
    }
    return { ...base, correct: choice.filter((q) => answers[q.id] === q.answer).length, total: choice.length };
  });
  const choice = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).filter((q) => q.options?.length && q.answer);
  const score = choice.filter((q) => answers[q.id] === q.answer).length;
  const slowest = Object.entries(attempt.questionSec ?? {})
    .map(([id, sec]) => ({ q: choice.find((q) => q.id === id) ?? paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).find((q) => q.id === id), sec }))
    .filter((x): x is { q: Question; sec: number } => !!x.q && x.sec >= 1)
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 5)
    .map((x) => ({ ...x, over: x.sec > (limits[x.q.id] ?? Infinity) }));
  return {
    score,
    total: choice.length,
    pct: choice.length ? Math.round((score / choice.length) * 100) : null,
    sections,
    wrong: choice.filter((q) => answers[q.id] && answers[q.id] !== q.answer).map((q) => ({ q, chosen: answers[q.id] })),
    skipped: choice.filter((q) => !answers[q.id]),
    slowest,
  };
}
