/**
 * 句子译文层（docs/设计任务-I轮-听力与译文与小窗.md §0）：public/papers/trans/<id>.json，由数据线 scripts/build_trans.py 生成。
 * 卷面句子（words.json 的 pages[].s）和听力原文句子（audio.segments[].lines[].text）用同一个键：
 *   norm = NFKC → 小写 → 非 [a-z0-9] 的连续字符换成一个空格 → 去两头空格
 *   key  = norm 的 FNV-1a 32 位，8 位小写十六进制
 * Python 那边是 scripts/trans_key.py，两边的单测都用 "Hello,  World!" → "hello world" → d58b3fa7。
 * 这个文件不引用别的模块，Node 能直接跑它的单测（src/lib/trans.test.mjs）。
 */

/** 句子规范化：只留小写字母和数字，中间一个空格 */
export function normSentence(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 句子的键：norm 的 FNV-1a 32 位（norm 只剩 ASCII，字符码就是字节） */
export function sentenceKey(text: string): string {
  const s = normSentence(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 译文层文件 */
export interface TransFile {
  id: string;
  by: "ai" | string; // 现在全是 AI 译文，界面上标"AI 译文"
  version: number;
  sentences: Record<string, string>;
}

const cache = new Map<string, Promise<TransFile | null>>();

/**
 * 取一套卷的译文层。文件不存在、取不到、不是 JSON（开发服务器对不存在的路径会回 index.html）都当没有译文，返回 null，不报错。
 * 同一套只取一次；取失败（断网）的下次再试
 */
export function loadTrans(paperId: string): Promise<TransFile | null> {
  let p = cache.get(paperId);
  if (!p) {
    p = fetch(`/papers/trans/${encodeURIComponent(paperId)}.json`)
      .then(async (r) => {
        if (!r.ok || !/json/i.test(r.headers.get("content-type") ?? "")) return null;
        const data = (await r.json()) as TransFile;
        return data && typeof data.sentences === "object" ? data : null;
      })
      .catch(() => {
        cache.delete(paperId);
        return null;
      });
    cache.set(paperId, p);
  }
  return p;
}

/** 界面查一句译文的结果：ready 为假是译文层还在取；取完了 text 为 null 就是这句没有译文 */
export interface TransResult {
  text: string | null;
  ready: boolean;
}
export type TransLookup = (sentence: string) => TransResult;

/** 在译文层里找一句的译文；没有返回 null */
export function findTrans(file: TransFile | null | undefined, text: string): string | null {
  if (!file || !text.trim()) return null;
  return file.sentences[sentenceKey(text)] ?? null;
}
