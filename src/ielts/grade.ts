import type {
  FillAnswerRule,
  IeltsAnswerValue,
  IeltsKeyAnswer,
  IeltsKeyGroup,
  IeltsPaperGroup,
  IeltsQuestionKind,
  IeltsSkill,
} from "./types";

export const letter = (i: number): string => String.fromCharCode(65 + i);

export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?'"()]+|[\s.,;:!?'"()]+$/g, "");
}

const compactKey = (s: unknown): string => norm(s).replace(/ /g, "");

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const rec = (cur: number[], rest: number[]) => {
    if (!rest.length) {
      out.push(cur);
      return;
    }
    rest.forEach((x, i) => rec([...cur, x], rest.filter((_, j) => j !== i)));
  };
  rec([], [...Array(n).keys()]);
  return out;
}

export function fillOk(a: FillAnswerRule, user: IeltsAnswerValue | undefined): boolean {
  if (user == null) return false;
  const u = (Array.isArray(user) ? user : [user]).map(compactKey);
  if (u.length !== a.k || u.some((x) => !x)) return false;
  if (a.mode === "tuple") return a.tuples.some((t) => t.every((x, i) => compactKey(x) === u[i]));
  const per = a.per.map((alts) => alts.map(compactKey));
  return permutations(a.k).some((p) => p.every((pi, i) => per[pi].includes(u[i])));
}

export function groupNumbers(g: { first: number; last: number }): number[] {
  const out: number[] = [];
  for (let n = g.first; n <= g.last; n++) out.push(n);
  return out;
}

function getAns(answers: Record<string, IeltsAnswerValue>, n: number): IeltsAnswerValue | undefined {
  return answers[String(n)] ?? (answers as Record<number, IeltsAnswerValue>)[n];
}

/**
 * Pure exam-time answered check: uses ONLY `IeltsPaperGroup` (never requires `IeltsKey`).
 */
export function isAnswered(g: IeltsPaperGroup, answers: Record<string, IeltsAnswerValue>, n: number): boolean {
  if (g.type === "fill") {
    const k = g.blanks[String(n)] ?? 1;
    const v = getAns(answers, n);
    if (v == null) return false;
    const arr = Array.isArray(v) ? v : [v];
    return arr.length >= k && arr.slice(0, k).every((x) => String(x ?? "").trim() !== "");
  }
  if (g.type === "multi") {
    const it = g.items.find((x) => n >= x.n && n < x.n + x.count);
    if (!it) return false;
    const sel = getAns(answers, it.n);
    const list = Array.isArray(sel) ? sel : [];
    return list.length > n - it.n;
  }
  const v = getAns(answers, n);
  return v != null && v !== "";
}

export function questionKindOf(g: IeltsPaperGroup): IeltsQuestionKind {
  if (g.type === "match") {
    if (g.view === "table") return "match-table";
    if (g.view === "headings") return "match-headings";
    return "match-drag";
  }
  return g.type;
}

export function correctText(pg: IeltsPaperGroup, kg: IeltsKeyGroup, n: number): string {
  const a: IeltsKeyAnswer | undefined = kg.answers[String(n)];
  if (!a) return "";
  if (pg.type === "fill" && "k" in a) {
    if (a.mode === "tuple") return a.tuples.map((t) => t.join(" & ")).join("  /  ");
    return a.per.map((alts) => alts.join(" / ")).join("  &  ");
  }
  if (pg.type === "multi") {
    const it = pg.items.find((x) => n >= x.n && n < x.n + x.count);
    const ma = it ? kg.answers[String(it.n)] : undefined;
    if (ma && "set" in ma) return ma.set.map(letter).join(", ");
    return "";
  }
  if (pg.type === "match" && "i" in a) return pg.options[a.i]?.k ?? "";
  if (pg.type === "tfng" && "i" in a) return pg.items[n - pg.first]?.options[a.i] ?? "";
  if ("i" in a) return letter(a.i);
  return "";
}

export function userText(pg: IeltsPaperGroup, n: number, v: IeltsAnswerValue | undefined): string {
  if (v == null || v === "") return "";
  if (pg.type === "fill") return Array.isArray(v) ? v.map(String).join(" & ") : String(v);
  if (pg.type === "match" && typeof v === "number") return pg.options[v]?.k ?? "";
  if (pg.type === "tfng" && typeof v === "number") return pg.items[n - pg.first]?.options[v] ?? "";
  if (pg.type === "multi") return (Array.isArray(v) ? v : []).map((x) => letter(Number(x))).join(", ");
  if (typeof v === "number") return letter(v);
  return String(v);
}

export interface GradedPerQ {
  ok: boolean;
  partial?: boolean; // true on multi-select items when 0 < earned < count
  earned: number;
  max: number;
  user: IeltsAnswerValue | null;
  userText: string;
  correct: string;
}

export interface GradedUnit {
  unitKey: string; // "15" or "21-22"
  label: string;   // "15" or "21–22"
  first: number;
  count: number;
  qtype: IeltsQuestionKind;
  earned: number;
  max: number;
  ok: boolean;     // earned === max
  answered: boolean;
  userText: string;
  correctText: string;
}

export function gradeGroup(
  pg: IeltsPaperGroup,
  kg: IeltsKeyGroup,
  answers: Record<string, IeltsAnswerValue>,
): { perQ: Record<number, GradedPerQ>; units: GradedUnit[] } {
  const perQ: Record<number, GradedPerQ> = {};
  const units: GradedUnit[] = [];
  const qtype = questionKindOf(pg);

  if (pg.type === "fill") {
    for (const n of groupNumbers(pg)) {
      const a = kg.answers[String(n)] as FillAnswerRule | undefined;
      const rawU = getAns(answers, n);
      const ok = !!(a && fillOk(a, rawU));
      const ut = userText(pg, n, rawU);
      const ct = correctText(pg, kg, n);
      perQ[n] = { ok, earned: ok ? 1 : 0, max: 1, user: rawU ?? null, userText: ut, correct: ct };
      units.push({
        unitKey: String(n),
        label: String(n),
        first: n,
        count: 1,
        qtype,
        earned: ok ? 1 : 0,
        max: 1,
        ok,
        answered: isAnswered(pg, answers, n),
        userText: ut,
        correctText: ct,
      });
    }
  } else if (pg.type === "multi") {
    for (const it of pg.items) {
      const a = kg.answers[String(it.n)] as { set: number[]; first: number; count: number };
      const rawU = getAns(answers, it.n);
      const sel = Array.isArray(rawU) ? rawU.map(Number) : [];
      const earned = sel.filter((i) => a.set.includes(i)).length;
      const okAll = earned === it.count;
      const partial = earned > 0 && !okAll;
      const ut = userText(pg, it.n, sel);
      const ct = a.set.map(letter).join(", ");
      const unitKey = it.count > 1 ? `${it.n}-${it.n + it.count - 1}` : String(it.n);
      const label = it.count > 1 ? `${it.n}–${it.n + it.count - 1}` : String(it.n);
      for (let k = 0; k < it.count; k++) {
        perQ[it.n + k] = {
          ok: okAll,
          partial,
          earned,
          max: it.count,
          user: sel.length ? sel : null,
          userText: ut,
          correct: ct,
        };
      }
      units.push({
        unitKey,
        label,
        first: it.n,
        count: it.count,
        qtype,
        earned,
        max: it.count,
        ok: okAll,
        answered: sel.length > 0,
        userText: ut,
        correctText: ct,
      });
    }
  } else {
    for (const n of groupNumbers(pg)) {
      const a = kg.answers[String(n)] as { i: number } | undefined;
      const rawU = getAns(answers, n);
      const ok = rawU != null && a != null && Number(rawU) === a.i;
      const ut = userText(pg, n, rawU);
      const ct = correctText(pg, kg, n);
      perQ[n] = { ok, earned: ok ? 1 : 0, max: 1, user: rawU ?? null, userText: ut, correct: ct };
      units.push({
        unitKey: String(n),
        label: String(n),
        first: n,
        count: 1,
        qtype,
        earned: ok ? 1 : 0,
        max: 1,
        ok,
        answered: isAnswered(pg, answers, n),
        userText: ut,
        correctText: ct,
      });
    }
  }
  return { perQ, units };
}

export function gradeSection(
  paperGroups: IeltsPaperGroup[],
  keyGroups: IeltsKeyGroup[],
  answers: Record<string, IeltsAnswerValue>,
): { raw: number; total: number; perQ: Record<number, GradedPerQ>; units: GradedUnit[] } {
  const perQ: Record<number, GradedPerQ> = {};
  const units: GradedUnit[] = [];
  const keyMap = new Map(keyGroups.map((k) => [k.first, k]));
  for (const pg of paperGroups) {
    const kg = keyMap.get(pg.first);
    if (!kg) continue;
    const g = gradeGroup(pg, kg, answers);
    Object.assign(perQ, g.perQ);
    units.push(...g.units);
  }
  const raw = units.reduce((s, u) => s + u.earned, 0);
  const total = units.reduce((s, u) => s + u.max, 0);
  return { raw, total, perQ, units };
}

const LISTENING_TABLE: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6],
  [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5],
];
const READING_ACADEMIC_TABLE: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6],
  [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5],
];
const READING_GT_TABLE: [number, number][] = [
  [40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6],
  [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5],
];

export function band(skill: IeltsSkill, raw: number, total: number, gt = false): number | null {
  if (skill !== "listening" && skill !== "reading") return null;
  const r = total && total !== 40 ? Math.round((raw * 40) / total) : raw;
  const table = skill === "listening" ? LISTENING_TABLE : gt ? READING_GT_TABLE : READING_ACADEMIC_TABLE;
  for (const [min, b] of table) if (r >= min) return b;
  return r >= 1 ? 2 : 0;
}

/** Round average of bands to nearest 0.5 per official IELTS rounding rules (.25 -> .5, .75 -> next whole) */
export function roundIeltsBand(avg: number): number {
  const frac = avg - Math.floor(avg);
  if (frac < 0.25) return Math.floor(avg);
  if (frac < 0.75) return Math.floor(avg) + 0.5;
  return Math.floor(avg) + 1;
}

export function wordCount(text: unknown): number {
  const m = String(text ?? "").trim().match(/\S+/g);
  return m ? m.length : 0;
}
