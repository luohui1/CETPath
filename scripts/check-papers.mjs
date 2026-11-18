// 校验 public/papers/*.json 的格式，并重新生成试卷目录 public/papers/index.json。
// 新增或修改试卷后运行：npm run check:papers
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public/papers");
const EXAMS = ["kaoyan1", "kaoyan2", "cet4", "cet6"];
// banked：选词填空，matching：长篇阅读（段落信息匹配），reading：阅读理解 / 仔细阅读
const KINDS = ["listening", "cloze", "banked", "matching", "reading", "order", "translation", "writing"];

function check(paper, file) {
  const errors = [];
  const err = (msg) => errors.push(`${file}: ${msg}`);
  if (paper.id !== path.basename(file, ".json")) err(`id "${paper.id}" 和文件名不一致`);
  if (!EXAMS.includes(paper.exam)) err(`exam 必须是 ${EXAMS.join(" / ")}`);
  if (!Number.isInteger(paper.year)) err("year 必须是整数");
  if (!paper.title) err("缺少 title");
  if (!Array.isArray(paper.sections) || !paper.sections.length) err("sections 不能为空");

  const ids = new Set();
  const segIds = new Set(paper.audio?.segments?.map((s) => s.id) ?? []);
  // 所有试卷都按原卷 PDF 显示
  if (!paper.pdf?.src || !paper.pdf?.words) err("缺少原卷 pdf（src 和 words）");
  else for (const f of [paper.pdf.src, paper.pdf.words]) if (!existsSync(path.join(root, "public", f))) err(`原卷文件不存在：${f}`);
  if (paper.audio) {
    if (!existsSync(path.join(root, "public", paper.audio.src))) err(`音频文件不存在：${paper.audio.src}`);
    for (const s of paper.audio.segments ?? []) {
      if (!(s.end > s.start)) err(`听力分段 ${s.id} 的时间不对`);
    }
  }

  for (const s of paper.sections ?? []) {
    if (!KINDS.includes(s.kind)) err(`section ${s.id} 的 kind 必须是 ${KINDS.join(" / ")}`);
    for (const g of s.groups ?? []) {
      if (g.audioSegment && !segIds.has(g.audioSegment)) err(`group ${g.id} 引用了不存在的听力分段 ${g.audioSegment}`);
      if (s.kind === "order") {
        const slots = (g.sequence ?? []).filter((x) => /^\d+$/.test(x)).map(Number);
        const nums = g.questions.map((q) => q.number);
        if (slots.join() !== nums.join()) err(`段落排序 ${g.id} 的 sequence 空位 ${slots.join(",")} 和题号 ${nums.join(",")} 对不上`);
      }
      const blanks = new Set();
      for (const p of g.passage?.paragraphs ?? []) for (const m of p.matchAll(/\{\{(\d+)\}\}/g)) blanks.add(Number(m[1]));
      for (const q of g.questions ?? []) {
        if (ids.has(q.id)) err(`题目 id 重复：${q.id}`);
        ids.add(q.id);
        if (q.options?.length) {
          const keys = q.options.map((o) => o.key);
          if (!q.answer) err(`选择题 ${q.id} 缺少 answer`);
          else if (!keys.includes(q.answer)) err(`题目 ${q.id} 的答案 ${q.answer} 不在选项 ${keys.join("")} 里`);
        }
        if (!q.page || q.box?.length !== 4) err(`题目 ${q.id} 没有在原卷上定位（page、box）`);
        if (s.kind === "cloze" && g.passage && !blanks.has(q.number)) err(`完形填空第 ${q.number} 题在文章里没有 {{${q.number}}} 空位`);
      }
    }
  }
  return errors;
}

/**
 * 四六级目录只收正式场次的整卷，和常见真题目录一致：每年 6 月、12 月两场；
 * 2020 年上半年因疫情改成 7 月（一套组合卷）和 9 月两场，照收。
 * 不收：样卷；只印了作文和翻译的"空卷"（这几场第 2、3 套的听力、阅读和第 1 套相同，原卷只印不同的部分）；
 * 2022 年 9 月、2023 年 3 月这类延考场次。文件留在 public/papers/ 里，只是不进目录。
 */
function unlisted(paper, questions) {
  if (!paper.exam?.startsWith("cet")) return null;
  if (paper.sample || paper.label?.includes("样卷") || !paper.month) return "样卷";
  if (!questions.some((q) => q.options?.length)) return "只有作文和翻译";
  const regular = paper.month === 6 || paper.month === 12 || (paper.year === 2020 && (paper.month === 7 || paper.month === 9));
  return regular ? null : `${paper.year} 年 ${paper.month} 月不是正式场次`;
}

const index = [];
const problems = [];
const skipped = [];
for (const f of (await readdir(dir)).sort()) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  let paper;
  try {
    paper = JSON.parse(await readFile(path.join(dir, f), "utf8"));
  } catch (e) {
    problems.push(`${f}: JSON 格式错误：${e.message}`);
    continue;
  }
  const errs = check(paper, f);
  problems.push(...errs);
  if (errs.length) continue;
  const questions = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions));
  const why = unlisted(paper, questions);
  if (why) {
    skipped.push(`${paper.id}（${why}）`);
    continue;
  }
  index.push({
    id: paper.id,
    exam: paper.exam,
    year: paper.year,
    ...(paper.month ? { month: paper.month } : {}),
    ...(paper.set ? { set: paper.set } : {}),
    title: paper.title,
    ...(paper.label ? { label: paper.label } : {}),
    ...(paper.sample ? { sample: true } : {}),
    questionCount: questions.length,
    hasAudio: !!paper.audio,
    ...(paper.durationMinutes ? { durationMinutes: paper.durationMinutes } : {}),
    // 专项训练按部分列出
    sections: paper.sections.map((s) => {
      const qs = s.groups.flatMap((g) => g.questions);
      return {
        id: s.id,
        kind: s.kind,
        part: s.part,
        title: s.title,
        ...(s.subtitle ? { subtitle: s.subtitle } : {}),
        questionCount: qs.length,
        choiceCount: qs.filter((q) => q.options?.length).length,
        // 从同场另一套接过来的部分（scripts/share_listening.py）：专项训练里不重复列
        ...(s.from ? { from: s.from } : {}),
      };
    }),
  });
}

index.sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0) || (a.set ?? 0) - (b.set ?? 0));
await writeFile(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");

if (problems.length) {
  console.error(`发现 ${problems.length} 个问题（有问题的试卷不会进入目录）：`);
  for (const p of problems) console.error("  - " + p);
  process.exitCode = 1;
}
console.log(`目录已生成：${index.length} 套试卷`);
if (skipped.length) console.log(`没进目录的 ${skipped.length} 套：${skipped.join("、")}`);
