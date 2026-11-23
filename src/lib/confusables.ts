/*
 * 易混词（记忆树的"易混"分支）：public/dict/confusables.json 由 scripts/build_confusables.py 生成。
 * 一部分来自 Lexkite 的易混词数据集（CC BY 4.0，带区分提示和典型错句），其余是词书里拼写只差一两个字母的形近词。
 */
export interface Confusable {
  word: string;
  brief: string;
  /** Lexkite 的区分提示；形近词没有 */
  tip?: { tip: string; wrong: string; right: string; note: string };
}

type Data = { w: Record<string, [string, string, number][]>; g: [string, string, string, string][] };
let cache: Promise<Data> | null = null;

export async function confusablesOf(word: string): Promise<Confusable[]> {
  cache ??= fetch("/dict/confusables.json").then((r) => (r.ok ? (r.json() as Promise<Data>) : { w: {}, g: [] }));
  cache.catch(() => (cache = null));
  const d = await cache;
  return (d.w[word.toLowerCase()] ?? []).map(([w, brief, g]) => {
    const t = g >= 0 ? d.g[g] : undefined;
    return { word: w, brief, tip: t && { tip: t[0], wrong: t[1], right: t[2], note: t[3] } };
  });
}
