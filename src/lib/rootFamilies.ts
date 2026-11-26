import { fetchDict } from "./dict";
import { useMemo } from "react";
import { useCachedLiveQuery } from "@/lib/live";
import { db } from "@/lib/db";
import { memoryLevel } from "@/lib/learning";

/** 一个词根家族里的词：[词, 简义, 词根前的语素 [[写法, 含义]], 词根后的写法, 词书词频（不在词书是 0）] */
export type FamilyWord = [string, string, [string, string][], string, number];

export interface Family {
  r: string;
  g: string;
  w: FamilyWord[];
}

let cache: Promise<Family[]> | null = null;

/** 词根家族 public/dict/roots/families.json（scripts/build_roots.py 生成） */
export function loadFamilies() {
  cache ??= fetchDict("/dict/roots/families.json").then((r) => (r.ok ? (r.json() as Promise<Family[]>) : []));
  cache.catch(() => (cache = null));
  return cache;
}

export const familyKey = (f: Family) => `${f.r}|${f.g}`;

/** 一个词的记忆：等级 0–5（见 LEVELS），在不在生词本里 */
export interface Mem {
  lv: number;
  vocab: boolean;
}

export const NO_MEM: Mem = { lv: 0, vocab: false };

/** 记忆等级的颜色：一条从浅到深的品牌蓝，没碰过的是浅灰 */
export const LV_COLOR = ["var(--paper-300)", "#c7dcff", "#8fb8ff", "#4d94ff", "#1677ff", "#0b3d91"];

/** 用过的、背过的、生词本里的都算"自己的词" */
export const mine = (m: Mem | undefined) => !!m && (m.lv > 0 || m.vocab);

/** 生词本 + 词卡 → 每个词的记忆；数据变了自动刷新 */
export function useMemory() {
  const rows = useCachedLiveQuery("memory-map", async () => {
    const [cards, vocab] = await Promise.all([db.cards.toArray(), db.vocab.toCollection().primaryKeys()]);
    return { cards: cards.map((c) => [c.word, memoryLevel(c)] as [string, number]), vocab: vocab as string[] };
  });
  return useMemo(() => {
    if (!rows) return null;
    const inVocab = new Set(rows.vocab);
    const m = new Map<string, Mem>();
    for (const [w, lv] of rows.cards) m.set(w, { lv, vocab: inVocab.has(w) });
    for (const w of inVocab) if (!m.has(w)) m.set(w, { lv: 0, vocab: true });
    return m;
  }, [rows]);
}

/** 一个词所在的词根家族（词多的在前） */
export async function familiesOf(word: string) {
  const fs = await loadFamilies();
  return fs.filter((f) => f.w.some((x) => x[0] === word)).sort((a, b) => b.w.length - a.w.length);
}
