import { db } from "./db";

/** 词典条目，字段名和 scripts/build-dict.mjs 输出的一致 */
export interface DictEntry {
  w: string;
  p?: string; // 音标
  t: string; // 中文释义，多行
  tags?: string[];
  c?: number; // 柯林斯星级
  o?: 1; // 牛津核心词
  f?: number; // 词频排名
  x?: string; // 词形变化，如 p:went/d:gone/i:going/3:goes
}

export interface LookupResult {
  query: string; // 原文里的写法
  lemma: string; // 还原后的原形
  entry: DictEntry;
  form?: string; // 变形说明，如 "复数"、"英式拼写"
  /** 连字符复合词整体查不到时，各部分分别的结果（gallery-going → gallery、going）；entry/lemma 是第一个部分的，老的调用方照旧能用 */
  parts?: LookupResult[];
}

const shardCache = new Map<string, Promise<Record<string, DictEntry>>>();
let lemmaPromise: Promise<Record<string, string>> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：${res.status}`);
  return res.json() as Promise<T>;
}

function shardOf(word: string) {
  const s = word[0];
  return s >= "a" && s <= "z" ? s : "_";
}

function loadShard(s: string) {
  let p = shardCache.get(s);
  if (!p) {
    p = getJson<Record<string, DictEntry>>(`/dict/shards/${s}.json`);
    p.catch(() => shardCache.delete(s));
    shardCache.set(s, p);
  }
  return p;
}

export function loadLemma() {
  if (!lemmaPromise) {
    lemmaPromise = getJson<Record<string, string>>("/dict/lemma.json");
    lemmaPromise.catch(() => (lemmaPromise = null));
  }
  return lemmaPromise;
}

export async function getEntry(word: string): Promise<DictEntry | undefined> {
  const key = word.toLowerCase();
  const shard = await loadShard(shardOf(key));
  const v = await db.vocab.get(key);
  // 离线词典里没有的短语、在线查到的词：加入生词本时存了释义（生词本、复习、考场的生词面板都走这里）
  const base = shard[key] ?? v?.gloss;
  const own = v?.meaning?.trim();
  if (!own) return base;
  const mine = own.split("\n").map((l) => l.trim()).filter(Boolean);
  const rest = base ? translationLines(base).filter((l) => !mine.includes(l)) : [];
  return { ...(base ?? { w: v!.word }), t: [...mine, ...rest].join("\n") };
}

const FORM_NAMES: Record<string, string> = {
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
  "3": "第三人称单数",
  r: "比较级",
  t: "最高级",
  s: "复数",
};

/** 根据原形的 exchange 字段说明 query 是哪种变形 */
export function describeForm(query: string, entry: DictEntry): string | undefined {
  if (!entry.x || query === entry.w.toLowerCase()) return undefined;
  const names = entry.x
    .split("/")
    .map((part) => part.split(":"))
    .filter(([k, v]) => v?.toLowerCase() === query && FORM_NAMES[k])
    .map(([k]) => FORM_NAMES[k]);
  return names.length ? [...new Set(names)].join("、") : undefined;
}

// 常见规则变形的兜底（lemma 表里没有时）
function guessBases(w: string): string[] {
  const out: string[] = [];
  if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.endsWith("s")) out.push(w.slice(0, -1));
  if (w.endsWith("ied")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith("ing")) out.push(w.slice(0, -3), w.slice(0, -3) + "e");
  if (w.endsWith("ly")) out.push(w.slice(0, -2));
  if (w.endsWith("'s")) out.push(w.slice(0, -2));
  return out.filter((x) => x.length > 1);
}

/**
 * 英式拼写换成美式（词典里多半只有美式，或者英式那条只写"= democratize"）：
 * democratised → democratized、colour → color、centre → center、travelled → traveled、defence → defense、analyse → analyze
 */
function americanize(w: string): string[] {
  const rules: [RegExp, string][] = [
    [/is(e|es|ed|ing|er|ers|ation|ations|ational)$/, "iz$1"],
    [/ys(e|es|ed|ing)$/, "yz$1"],
    [/our(s|ed|ing|ful|fully|able|ite|ites|less|ism)?$/, "or$1"],
    [/([^aeiou])re(s|d)?$/, "$1er$2"],
    [/ll(ed|ing|er|ers)$/, "l$1"],
    [/ence(s)?$/, "ense$1"],
    [/ogue(s)?$/, "og$1"],
    [/ae/, "e"],
    [/oe/, "e"],
  ];
  return rules.filter(([re]) => re.test(w)).map(([re, to]) => w.replace(re, to));
}

/** 缩写：you'll = you will；won't = will not */
const CONTRACTION: Record<string, string> = { "n't": "not", "'ll": "will", "'d": "would / had", "'re": "are", "'ve": "have", "'m": "am" };
const IRREGULAR_NT: Record<string, string> = { wo: "will", ca: "can", sha: "shall", ai: "am" };

/**
 * 查词：先查原词，再按词形还原表和规则找原形；还查不到的，试英式拼写、缩写；
 * 连字符复合词整体查不到就分开查（gallery-going：gallery + going，以前只给 gallery）
 */
export async function lookup(raw: string): Promise<LookupResult | null> {
  const query = raw.trim().replace(/[’]/g, "'").toLowerCase();
  if (!query) return null;
  const plain = await lookupPlain(query);
  if (plain) return plain;
  for (const v of americanize(query)) {
    const r = await lookupPlain(v);
    if (r) return { ...r, query, form: r.form ? `${r.form}（英式拼写）` : "英式拼写" };
  }
  const c = query.match(/^([a-z]+?)(n't|'ll|'d|'re|'ve|'m)$/);
  if (c) {
    const head = c[2] === "n't" && IRREGULAR_NT[c[1]] ? IRREGULAR_NT[c[1]] : c[1];
    const r = await lookupPlain(head);
    if (r) return { ...r, query, form: `缩写（= ${head} ${CONTRACTION[c[2]]}）` };
  }
  if (query.includes("-")) {
    const parts: LookupResult[] = [];
    for (const part of query.split("-")) {
      const r = part.length > 1 ? await lookup(part) : null;
      if (r) parts.push(r);
    }
    if (parts.length) return { query, lemma: parts[0].lemma, entry: parts[0].entry, parts };
  }
  return null;
}

async function lookupPlain(query: string): Promise<LookupResult | null> {
  const lemmaMap = await loadLemma();
  const base = lemmaMap[query];
  if (base) {
    const entry = await getEntry(base);
    if (entry) return { query, lemma: base, entry, form: describeForm(query, entry) };
  }
  const direct = await getEntry(query);
  if (direct) return { query, lemma: query, entry: direct };
  for (const guess of guessBases(query)) {
    const entry = await getEntry(lemmaMap[guess] ?? guess);
    if (entry) return { query, lemma: entry.w.toLowerCase(), entry, form: describeForm(query, entry) };
  }
  return null;
}

/** 只做词形还原，不加载释义（用于标记生词） */
export async function toLemma(raw: string): Promise<string> {
  const q = raw.toLowerCase().replace(/[’]/g, "'");
  const map = await loadLemma();
  return map[q] ?? q;
}

export const TAG_LABELS: Record<string, string> = {
  zk: "中考",
  gk: "高考",
  cet4: "四级",
  cet6: "六级",
  ky: "考研",
  toefl: "托福",
  ielts: "雅思",
  gre: "GRE",
};

export function translationLines(entry: DictEntry): string[] {
  return entry.t.split("\n").filter(Boolean);
}

export function shortTranslation(entry: DictEntry, max = 2): string {
  return translationLines(entry).slice(0, max).join("；");
}

export function phonetic(entry: DictEntry): string | undefined {
  return entry.p ? `/${entry.p}/` : undefined;
}

export interface BookInfo {
  id: string;
  name: string;
  count: number;
}

export async function loadBookMeta(): Promise<BookInfo[]> {
  const meta = await getJson<{ books: BookInfo[] }>("/dict/meta.json");
  return meta.books;
}

const bookCache = new Map<string, Promise<DictEntry[]>>();
export function loadBook(id: string): Promise<DictEntry[]> {
  let p = bookCache.get(id);
  if (!p) {
    p = getJson<DictEntry[]>(`/dict/books/${id}.json`);
    p.catch(() => bookCache.delete(id));
    bookCache.set(id, p);
  }
  return p;
}
