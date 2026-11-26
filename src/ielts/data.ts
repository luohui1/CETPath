import { useEffect, useState } from "react";
import type {
  IeltsExplain,
  IeltsIndex,
  IeltsIndexEntry,
  IeltsKey,
  IeltsPaper,
  IeltsSkill,
  SpeakingData,
  WritingJjItem,
} from "./types";

const cache = new Map<string, Promise<unknown>>();
const resolved = new Map<string, unknown>();

async function fetchJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    const p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const d = (await r.json()) as T;
      resolved.set(url, d);
      return d;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url) as Promise<T>;
}

export const peekIeltsIndex = () => resolved.get("/ielts/index.json") as IeltsIndex | undefined;
export const loadIeltsIndex = () => fetchJson<IeltsIndex>("/ielts/index.json");
export const loadWritingJj = () => fetchJson<WritingJjItem[]>("/ielts/writing-jj.json");
export const loadSpeaking = () => fetchJson<SpeakingData>("/ielts/speaking.json");

export function useIeltsIndex() {
  const [index, setIndex] = useState<IeltsIndex | null>(() => peekIeltsIndex() ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!index) loadIeltsIndex().then(setIndex, (e: Error) => setError(e.message));
  }, [index]);
  return { index, error };
}

/**
 * Load pure exam paper payload (NO answers, NO transcripts, NO explanations).
 * Supports virtual `wj:<id>` single-task writing items and `listeningRef` sharing.
 */
export async function loadIeltsPaper(id: string): Promise<IeltsPaper> {
  if (id.startsWith("wj:")) {
    const wid = id.slice(3);
    const list = await loadWritingJj();
    const it = list.find((x) => x.id === wid);
    if (!it) throw new Error("写作机经题库中找不到这道题");
    return {
      id,
      family: "wj",
      exam: "ielts-a",
      title: it.title || `Writing Task ${it.part}`,
      writing: [{ part: it.part, title: `Writing Task ${it.part}`, html: it.html }],
    };
  }
  const p = await fetchJson<IeltsPaper>(`/ielts/papers/${encodeURIComponent(id)}.json`);
  if (p.listeningRef && !p.listening) {
    const ref = await fetchJson<IeltsPaper>(`/ielts/papers/${encodeURIComponent(p.listeningRef)}.json`);
    return { ...p, listening: ref.listening };
  }
  return p;
}

/**
 * Prefetch grading key into browser/SW cache at exam start so offline submission works,
 * without returning or mounting answers into the exam UI.
 */
export function warmIeltsKey(id: string): void {
  if (id.startsWith("wj:")) return;
  void loadIeltsKey(id).catch(() => {});
}

/** Load lightweight grading key (called ONLY when sealing & grading a submitted skill). */
export async function loadIeltsKey(id: string): Promise<IeltsKey | null> {
  if (id.startsWith("wj:")) return null;
  const k = await fetchJson<IeltsKey>(`/ielts/keys/${encodeURIComponent(id)}.json`);
  if (k.listeningRef && !k.listening) {
    const ref = await fetchJson<IeltsKey>(`/ielts/keys/${encodeURIComponent(k.listeningRef)}.json`);
    return { ...k, listening: ref.listening };
  }
  return k;
}

/**
 * Load review pack (transcripts, explanations, passage source quotes, model essays).
 * Caller MUST verify the run/section is unlocked for review before calling.
 */
export async function loadIeltsExplain(id: string): Promise<IeltsExplain> {
  if (id.startsWith("wj:")) {
    const wid = id.slice(3);
    const map = await fetchJson<Record<string, { sample?: string }>>("/ielts/writing-jj-explain.json");
    const list = await loadWritingJj();
    const it = list.find((x) => x.id === wid);
    return {
      id,
      writing: it ? [{ part: it.part, sample: map[wid]?.sample ?? "" }] : [],
    };
  }
  const ex = await fetchJson<IeltsExplain>(`/ielts/explain/${encodeURIComponent(id)}.json`);
  if (ex.listeningRef && !ex.listening) {
    const ref = await fetchJson<IeltsExplain>(`/ielts/explain/${encodeURIComponent(ex.listeningRef)}.json`);
    return { ...ex, listening: ref.listening };
  }
  return ex;
}

export function ieltsPaperLabel(e: Pick<IeltsIndexEntry, "family" | "book" | "name" | "group" | "title">): string {
  if (e.family === "cam" && e.book) return `剑雅 ${e.book} Test ${String(e.name ?? "").replace(/^Test\s*/i, "")}`;
  if (e.family === "gt" && e.book) return `剑雅 ${e.book} G类 ${String(e.name ?? "").replace(/^Test\s*/i, "")}`;
  if (e.family === "jj" && e.group) return `机经 Pro ${e.group.replace("机经Pro套题", "").replace(/[（）]/g, "")} ${e.name ?? ""}`.trim();
  return e.title;
}

export const IELTS_SKILLS_ZH: Record<IeltsSkill, string> = {
  listening: "听力",
  reading: "阅读",
  writing: "写作",
};

export const IELTS_SKILLS_EN: Record<IeltsSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
};

export const IELTS_QTYPE_ZH: Record<string, string> = {
  fill: "填空题",
  single: "单选题",
  multi: "多选题",
  tfng: "判断题 (TFNG/YNNG)",
  "match-table": "矩阵配对",
  "match-headings": "段落标题配对",
  "match-drag": "词块/特征配对",
};
