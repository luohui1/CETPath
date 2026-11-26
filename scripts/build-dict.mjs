// 从 ECDICT（https://github.com/skywind3000/ECDICT，MIT 协议）生成前端用的词典数据：
//   public/dict/shards/<a-z|_>.json  查词分片：{ 小写词: Entry }
//   public/dict/lemma.json           词形还原表：{ 变形: 原形 }
//   public/dict/books/<id>.json      词书：Entry[]，按词频排序
//   public/dict/meta.json            统计信息
// 用法：先把 ecdict.csv 放到 data/raw/ecdict/，再运行 npm run build:dict
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "data/raw/ecdict/ecdict.csv");
const out = path.join(root, "public/dict");

const EXAM_TAGS = ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"];
const BOOKS = [
  { id: "cet4", name: "大学英语四级", tag: "cet4" },
  { id: "cet6", name: "大学英语六级", tag: "cet6" },
  { id: "ky", name: "考研英语", tag: "ky" },
  { id: "ielts", name: "雅思核心词汇", tag: "ielts" },
];
const FREQ_LIMIT = 30000;

// ECDICT 的字段不含真实换行（用字面量 \n 表示），逐行解析即可，但要处理引号和逗号
function parseLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function cleanTranslation(t) {
  return t
    .split("\\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("[网络]") && !s.startsWith("[医]") && !s.startsWith("[化]"))
    .slice(0, 6)
    .join("\n");
}

// 本站试卷里出现过的词（卷面单词层 + 听力原文）：这些词不管词频多低都收（2026-11-12 用户点 democratised、gallery-going 查不到）
const TOKEN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
async function corpusWords() {
  const words = new Set();
  const add = (text) => {
    for (const t of text.match(TOKEN) ?? []) {
      const w = t.toLowerCase().replace(/’/g, "'");
      words.add(w);
      if (w.includes("-")) for (const p of w.split("-")) words.add(p);
    }
  };
  let idx = [];
  try {
    idx = JSON.parse(await readFile(path.join(root, "public/papers/index.json"), "utf8"));
  } catch {}
  for (const { id } of idx) {
    try {
      for (const p of JSON.parse(await readFile(path.join(root, `public/papers/pdf/${id}.words.json`), "utf8")).pages) for (const w of p.w) add(w[0]);
    } catch {}
    try {
      const paper = JSON.parse(await readFile(path.join(root, `public/papers/${id}.json`), "utf8"));
      for (const seg of paper.audio?.segments ?? []) for (const l of seg.lines ?? []) add(l.text ?? "");
    } catch {}
  }
  return words;
}
const inPapers = await corpusWords();

const rows = createInterface({ input: createReadStream(src, "utf8"), crlfDelay: Infinity });
let header = null;
const selected = new Map(); // 小写词 -> entry
const exchanges = []; // [原词, exchange]
const corpusBases = new Set(); // 试卷里出现的变形对应的原形（原形也要收，词形还原才落得到）
const allRows = new Map(); // 小写词 -> 原始行：试卷里出现过的；第二遍再补上要用到的原形、被指向的词（全表 77 万行不全存，省内存）
let total = 0;

for await (const line of rows) {
  if (!header) {
    header = parseLine(line);
    continue;
  }
  const c = parseLine(line);
  const r = Object.fromEntries(header.map((h, i) => [h, c[i] ?? ""]));
  total++;
  const word = r.word.trim();
  if (!word) continue;
  if (r.exchange) exchanges.push([word, r.exchange]);

  const tags = r.tag.split(/\s+/).filter((t) => EXAM_TAGS.includes(t));
  const ranks = [Number(r.frq) || 0, Number(r.bnc) || 0].filter((n) => n > 0);
  const f = ranks.length ? Math.min(...ranks) : 0;
  const t = cleanTranslation(r.translation);
  if (!t) continue;
  const lower = word.toLowerCase();
  const seen = !/\s/.test(word) && inPapers.has(lower);
  if (seen) {
    allRows.set(lower, r);
    // 变形（0:原形）：原形也收
    const base = r.exchange.split("/").find((p) => p.startsWith("0:"))?.slice(2).toLowerCase();
    if (base) corpusBases.add(base);
  }
  const keep = tags.length > 0 || (f > 0 && f <= FREQ_LIMIT) || Number(r.collins) > 0 || r.oxford === "1" || seen;
  if (!keep) continue;
  // 词组只保留带考试标签的
  if (/\s/.test(word) && tags.length === 0) continue;

  const entry = { w: word, p: r.phonetic || undefined, t, tags: tags.length ? tags : undefined };
  if (Number(r.collins) > 0) entry.c = Number(r.collins);
  if (r.oxford === "1") entry.o = 1;
  if (f) entry.f = f;
  if (r.exchange) entry.x = r.exchange;

  const key = word.toLowerCase();
  const prev = selected.get(key);
  // 大小写冲突时（may / May）优先小写原形，其次词频更高的
  if (!prev || (word === key && prev.w !== key) || (prev.w !== key && (entry.f || 1e9) < (prev.f || 1e9))) {
    selected.set(key, entry);
  }
}

// 第二遍读表：试卷里出现的变形，它的原形没过筛选的；释义指向别的词（"= democratize"）的，被指向的那个词
const REDIRECT = /^(?:\([^)]*\)\s*)?(?:[a-z]+\.\s*)?(?:<[^>]{1,6}>\s*)?(?:=|同)\s*([A-Za-z][A-Za-z-]+)\s*$/;
const need = new Set([...corpusBases].filter((b) => !selected.has(b)));
for (const e of selected.values()) {
  const m = e.t.match(REDIRECT);
  if (m && !selected.has(m[1].toLowerCase())) need.add(m[1].toLowerCase());
}
{
  let head = null;
  const again = createInterface({ input: createReadStream(src, "utf8"), crlfDelay: Infinity });
  for await (const line of again) {
    if (!head) {
      head = parseLine(line);
      continue;
    }
    const c = parseLine(line);
    const w = (c[0] ?? "").trim().toLowerCase();
    if (!need.has(w) || allRows.has(w)) continue;
    allRows.set(w, Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""])));
  }
}
const toEntry = (r) => {
  const ranks = [Number(r.frq) || 0, Number(r.bnc) || 0].filter((n) => n > 0);
  const tags = r.tag.split(/\s+/).filter((t) => EXAM_TAGS.includes(t));
  const e = { w: r.word.trim(), p: r.phonetic || undefined, t: cleanTranslation(r.translation), tags: tags.length ? tags : undefined };
  if (Number(r.collins) > 0) e.c = Number(r.collins);
  if (r.oxford === "1") e.o = 1;
  if (ranks.length) e.f = Math.min(...ranks);
  if (r.exchange) e.x = r.exchange;
  return e;
};
let addedBases = 0;
for (const base of corpusBases) {
  if (selected.has(base)) continue;
  const r = allRows.get(base);
  if (r && cleanTranslation(r.translation)) {
    selected.set(base, toEntry(r));
    addedBases++;
  }
}
// 释义只是指向别的词的（democratise："v. <主英> = democratize"；"同 colour"）：换成那个词的释义，前面注明
let redirected = 0;
for (const [key, e] of selected) {
  const m = e.t.match(REDIRECT);
  if (!m) continue;
  const target = m[1].toLowerCase();
  const to = selected.get(target) ?? (allRows.get(target) && toEntry(allRows.get(target)));
  if (!to?.t || to.t === e.t) continue;
  e.t = `同 ${to.w}\n${to.t}`;
  e.p ??= to.p;
  redirected++;
  void key;
}
console.log(`按试卷补收：原形 ${addedBases} 个；指向别的词的释义换掉 ${redirected} 个`);

// 词形还原：变形 -> 原形（原形必须在词表里）
const lemma = {};
for (const [word, ex] of exchanges) {
  const base = word.toLowerCase();
  for (const part of ex.split("/")) {
    const [k, v] = part.split(":");
    if (!v) continue;
    if (k === "0") {
      // 本词是 v 的变形
      const l = v.toLowerCase();
      if (selected.has(l) && l !== base) lemma[base] ??= l;
    } else if ("pdi3rts".includes(k) && selected.has(base)) {
      const form = v.toLowerCase();
      if (form !== base && !selected.has(form)) lemma[form] ??= base;
    }
  }
}

// 只清自己生成的分片和词书：public/dict 里还有别的脚本生成的（phrases.json 来自 scripts/build_phrases.py）
await rm(path.join(out, "shards"), { recursive: true, force: true });
await rm(path.join(out, "books"), { recursive: true, force: true });
await mkdir(path.join(out, "shards"), { recursive: true });
await mkdir(path.join(out, "books"), { recursive: true });

const shards = {};
for (const [key, entry] of selected) {
  const s = /^[a-z]/.test(key) ? key[0] : "_";
  (shards[s] ??= {})[key] = entry;
}
const shardSizes = {};
for (const [s, data] of Object.entries(shards)) {
  const json = JSON.stringify(data);
  shardSizes[s] = json.length;
  await writeFile(path.join(out, "shards", `${s}.json`), json);
}
await writeFile(path.join(out, "lemma.json"), JSON.stringify(lemma));

const bookMeta = [];
for (const b of BOOKS) {
  const list = [...selected.values()]
    .filter((e) => e.tags?.includes(b.tag) && !/\s/.test(e.w))
    .sort((a, z) => (a.f || 1e9) - (z.f || 1e9));
  await writeFile(path.join(out, "books", `${b.id}.json`), JSON.stringify(list));
  bookMeta.push({ id: b.id, name: b.name, count: list.length });
}

const meta = {
  source: "ECDICT (MIT License) https://github.com/skywind3000/ECDICT",
  builtAt: new Date().toISOString(),
  entries: selected.size,
  lemmas: Object.keys(lemma).length,
  books: bookMeta,
};
await writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`读取 ${total} 条，保留 ${selected.size} 条，词形还原 ${meta.lemmas} 条`);
console.log("分片大小：", Object.entries(shardSizes).map(([s, n]) => `${s}=${kb(n)}`).join(" "));
console.log("词书：", bookMeta.map((b) => `${b.name} ${b.count}`).join("，"));
