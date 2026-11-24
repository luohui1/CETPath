import { sentenceKey } from "./trans.ts";

/*
 * 长难句解析层 public/papers/syntax/<id>.json（scripts/build_syntax.py 生成，格式见 docs/设计任务-J轮-长难句.md）：
 * 只收仔细阅读两篇文章里的长难句，按句子键（同译文层 sentenceKey）对上卷面的句子。
 * 不涉及答案，交卷前也能看。
 */

export interface SyntaxPiece {
  t: string; // 原句里的片段（原样）
  r: string; // 成分：主语、谓语、宾语……；定语从句、插入语……
  of?: string; // 修饰谁（原句里的片段）
  note?: string;
}

export interface SyntaxEntry {
  group: string; // 题组 id（rc1 / rc2）
  en: string;
  main: SyntaxPiece[]; // 主干，按句中先后
  parts: SyntaxPiece[]; // 从句、修饰成分、特殊结构
  points: string[]; // 难点
  zh: string; // 按结构拆开后的译文
}

export interface SyntaxFile {
  id: string;
  by: "ai" | string;
  version: number;
  sentences: Record<string, SyntaxEntry>;
}

const cache = new Map<string, Promise<SyntaxFile | null>>();

/** 取一套卷子的长难句层；没有（404、离线没缓存）返回 null */
export function loadSyntax(paperId: string): Promise<SyntaxFile | null> {
  let p = cache.get(paperId);
  if (!p) {
    p = fetch(`/papers/syntax/${encodeURIComponent(paperId)}.json`)
      .then(async (r) => {
        if (!r.ok || !/json/i.test(r.headers.get("content-type") ?? "")) return null;
        const data = (await r.json()) as SyntaxFile;
        return data && typeof data.sentences === "object" && Object.keys(data.sentences).length ? data : null;
      })
      .catch(() => {
        cache.delete(paperId);
        return null;
      });
    cache.set(paperId, p);
  }
  return p;
}

export function findSyntax(file: SyntaxFile | null | undefined, sentence: string): SyntaxEntry | null {
  return (file && sentence && file.sentences[sentenceKey(sentence)]) || null;
}

const fold = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

/** 片段在句子里的位置（大小写、弯引号不计，整词匹配；同 build_syntax.py 的 find_ci），从 from 起找 */
export function locate(text: string, piece: string, from = 0): [number, number] | null {
  const n = fold(piece.replace(/\s+/g, " ").trim());
  if (!n) return null;
  const re = new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![a-z0-9])`, "g");
  re.lastIndex = from;
  const m = re.exec(fold(text));
  return m ? [m.index, m.index + m[0].length] : null;
}

/** 句子切成一段段：每段带主干成分（没有是 null）和它在哪几个修饰成分里（parts 的序号） */
export interface SyntaxRun {
  text: string;
  main: string | null;
  inParts: number[];
  opens: number[]; // 这段开头开始的修饰成分
  closes: number[]; // 这段结尾结束的修饰成分
}

export function syntaxRuns(e: SyntaxEntry): SyntaxRun[] {
  const text = e.en;
  const mains: [number, number, string][] = [];
  let pos = 0;
  for (const m of e.main) {
    const at = locate(text, m.t, pos);
    if (at) {
      mains.push([at[0], at[1], m.r]);
      pos = at[1];
    }
  }
  const parts = e.parts.map((p) => locate(text, p.t));
  const cuts = new Set([0, text.length]);
  for (const [a, b] of mains) cuts.add(a).add(b);
  for (const p of parts) if (p) cuts.add(p[0]).add(p[1]);
  const xs = [...cuts].sort((a, b) => a - b);
  const runs: SyntaxRun[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [a, b] = [xs[i], xs[i + 1]];
    const main = mains.find(([x, y]) => x <= a && b <= y)?.[2] ?? null;
    const inParts = parts.flatMap((p, k) => (p && p[0] <= a && b <= p[1] ? [k] : []));
    runs.push({
      text: text.slice(a, b),
      main,
      inParts,
      opens: parts.flatMap((p, k) => (p && p[0] === a ? [k] : [])),
      closes: parts.flatMap((p, k) => (p && p[1] === b ? [k] : [])),
    });
  }
  return runs;
}
