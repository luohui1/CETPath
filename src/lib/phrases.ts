import { loadLemma } from "./dict";

/*
 * 短语（2026-11-12）：点词时认出这个词所在的短语（come up with、in terms of、make up one's mind…）。
 * 短语表 public/dict/phrases.json 由 scripts/build_phrases.py 从 ECDICT 生成，只收本站试卷里真出现过的（约 7700 条，压缩后 200KB），
 * 第一次查词时才取。词都是词形还原后的写法；占位符：~poss（one's：his/their…）、~refl（oneself）、~any（sb/sth：只对得上代词）。
 */

export interface PhraseHit {
  phrase: string; // 词典里的写法（make up one's mind）；隔开的动词短语写成 cut … down to
  trans: string;
  from: number; // 在句子词序列里的起止（含）
  to: number;
  pos: number[]; // 短语里每个词的位置（隔开的动词短语中间那几个词不算）
  between?: string; // 隔开的动词短语中间隔着的词（its entry queues）
}

type Row = [string[], string, string, number, number?]; // 词、原写法、意思、出现次数、能不能隔开（动词 + 小品词）
interface Node {
  next: Map<string, Node>;
  rows?: number[];
}

const POSS = new Set(["my", "your", "his", "her", "its", "our", "their", "one's"]);
const REFL = new Set(["myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves", "themselves", "oneself"]);
const OBJ = new Set(["me", "you", "him", "her", "it", "us", "them", "this", "that", "these", "those", "someone", "somebody", "something", "anyone", "anything", "everyone", "everything"]);
const MAX_LEN = 6;
// 动词短语里可以和动词隔开的小品词，以及隔着的词里不该出现的（出现了多半已经是另一个分句）
const PARTICLES = new Set(["up", "down", "out", "off", "in", "on", "over", "back", "away", "around", "round", "through", "apart", "aside", "together", "forward", "along", "across", "about", "by"]);
const BREAK = new Set([
  ...["and", "but", "or", "that", "which", "who", "whom", "whose", "because", "if", "when", "while", "than", "so", "where"],
  // 情态动词、介词：隔着的是分句或介词短语，不是宾语（voice could soon take over、talk with them about）
  ...["can", "could", "will", "would", "shall", "should", "may", "might", "must"],
  ...["from", "with", "to", "for", "of", "at", "into", "onto", "as", "like", "without", "within"],
  // 助动词：隔着的是另一个谓语（studies programmes have sprung up 不是 study … up）
  ...["have", "has", "had", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did"],
]);
const MAX_GAP = 4;
const NO_GAP = new Set(["be", "have", "do"]);
// 真能和动词拆开的小品词（cut its queues down、heat things up）。in/on/by/about 多半是介词：took part in 不是 take … in
const SEPARABLE = new Set(["up", "down", "out", "off", "back", "away", "over", "around", "round", "through", "apart", "aside", "together", "forward"]);
// 隔着的词像分词（involved、loading、generated）就不是宾语
const PARTICIPLE = /^[a-z]{3,}(ing|ed)$|^[a-z]{3,}ly$/; // 还有 -ly 副词（falling dramatically over）
const OBJ_WORDS = new Set(["something", "nothing", "anything", "everything"]);

let table: Promise<{ rows: Row[]; root: Node }> | null = null;

function loadTable() {
  if (!table) {
    table = fetch("/dict/phrases.json")
      .then((r) => {
        if (!r.ok) throw new Error(`短语表 ${r.status}`);
        return r.json() as Promise<{ p: Row[] }>;
      })
      .then(({ p }) => {
        const root: Node = { next: new Map() };
        p.forEach(([toks], i) => {
          let node = root;
          for (const t of toks) {
            let child = node.next.get(t);
            if (!child) node.next.set(t, (child = { next: new Map() }));
            node = child;
          }
          (node.rows ??= []).push(i);
        });
        return { rows: p, root };
      });
    table.catch(() => (table = null));
  }
  return table;
}

const clean = (t: string) => t.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, "");

/**
 * 句子里第 at 个词所在的短语：从它前面最多 5 个词起往后走前缀树，凡是盖住第 at 个词的都算；
 * 长的在前（come up with 先于 come up），一样长的按在试卷里出现得多的在前。最多给 max 个
 */
export async function findPhrases(tokens: string[], at: number, max = 2): Promise<PhraseHit[]> {
  if (at < 0 || at >= tokens.length) return [];
  const [{ rows, root }, lemma] = await Promise.all([loadTable(), loadLemma()]);
  const raw = tokens.map(clean);
  const lem = raw.map((t) => lemma[t] ?? t);
  const keysAt = (k: number) => {
    const keys = [lem[k], raw[k]];
    if (OBJ.has(raw[k])) keys.push("~any");
    if (POSS.has(raw[k]) || raw[k].endsWith("'s")) keys.push("~poss");
    if (REFL.has(raw[k])) keys.push("~refl");
    return keys;
  };
  // 沿前缀树往后走；pos 是短语里每个词在句子里的位置。动词短语的动词和小品词之间可以隔着宾语：
  // "cut its entry queues down to" 要认成 cut … down to，不能只认出 down to（2026-11-12 用户报）。
  // 只在第一个词后面隔：隔 1–4 个词，隔着的词里不能有标点、and/but/that 这类分句的词，隔完紧跟的得是小品词
  const found: { row: number; pos: number[]; gap: boolean }[] = [];
  // 隔着的词里有小品词（go down in）、分句词、介词、标点就不再往后隔
  const stopAt = (j: number) =>
    !raw[j] || BREAK.has(raw[j]) || PARTICLES.has(raw[j]) || (PARTICIPLE.test(raw[j]) && !OBJ_WORDS.has(raw[j])) || /[,.;:!?]$/.test(tokens[j]);
  const walk = (node: Node, k: number, pos: number[], gap: boolean) => {
    if (k >= raw.length || pos.length >= MAX_LEN) return;
    if (raw[k])
      for (const key of new Set(keysAt(k))) {
        const child = node.next.get(key);
        if (!child) continue;
        const p = [...pos, k];
        // 隔开的只认词典里动词打头、第二个词是小品词的短语（what … about 这种不算）
        if (child.rows && p.includes(at)) for (const row of child.rows) if (!gap || rows[row][4]) found.push({ row, pos: p, gap });
        walk(child, k + 1, p, gap);
      }
    // 助动词 be/have/do 不隔（"has cut its entry queues down" 不能认成 have … down）
    if (pos.length === 1 && !gap && !NO_GAP.has(lem[pos[0]]) && !/[,.;:!?]$/.test(tokens[pos[0]]))
      for (let g = 1; g <= MAX_GAP && k + g < raw.length; g++) {
        if (stopAt(k + g - 1)) break;
        if (SEPARABLE.has(raw[k + g])) walk(node, k + g, pos, true);
      }
  };
  for (let s = Math.max(0, at - MAX_LEN - MAX_GAP + 1); s <= at; s++) walk(root, s, [], false);
  // 长的在前；一样长的，隔开的动词短语在前（cut … down 先于 down to）；再按在试卷里出现得多的
  found.sort((a, b) => b.pos.length - a.pos.length || Number(b.gap) - Number(a.gap) || rows[b.row][3] - rows[a.row][3]);
  const out: PhraseHit[] = [];
  const seen = new Set<string>();
  // 几个隔开的动词短语落在同一个小品词上时，只留动词离得最近的那个
  const closest = new Map<string, number>();
  for (const f of found)
    if (f.gap) {
      const tail = f.pos.slice(1).join(",");
      closest.set(tail, Math.max(closest.get(tail) ?? -1, f.pos[0]));
    }
  for (const f of found) {
    const [, phrase, trans] = rows[f.row];
    if (seen.has(phrase.toLowerCase())) continue;
    if (f.gap && closest.get(f.pos.slice(1).join(",")) !== f.pos[0]) continue;
    // 被已选的长短语整个盖住的（at the end 之于 at the end of）不再列
    if (out.some((o) => f.pos.every((k) => o.pos.includes(k)))) continue;
    seen.add(phrase.toLowerCase());
    // 隔开的写成 cut … down to，旁边带上隔着的词
    const shown = f.gap ? phrase.replace(/^(\S+)\s/, "$1 … ") : phrase;
    const between = f.gap ? tokens.slice(f.pos[0] + 1, f.pos[1]).join(" ") : undefined;
    out.push({ phrase: shown, trans, from: f.pos[0], to: f.pos[f.pos.length - 1], pos: f.pos, between });
    if (out.length >= max) break;
  }
  return out;
}
