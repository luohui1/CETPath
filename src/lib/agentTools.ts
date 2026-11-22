import { db } from "./db";
import {
  getEntry,
  phonetic,
  shortTranslation,
  toLemma,
  translationLines,
} from "./dict";
import { State } from "ts-fsrs";
import {
  addToVocab,
  isMastered,
  removeFromVocab,
  STATE_LABELS,
} from "./learning";
import { masteryId, scoredQuestions } from "./mistakes";
import { getProfile, saveProfile } from "./profile";
import { touchMemory } from "./agent";
import { lookupOnline } from "./youdao";
import { addMethod } from "./methods";
import { KIND_NAMES, type Paper, type PdfWordsPage } from "./papers";
import { newMark, wordRange } from "./marks";
import { locate, type SyntaxPiece } from "./syntax";
import { sentenceKey } from "./trans";
import type { ToolCall } from "./agent";

/** Agent 的工具在浏览器里执行：词典、生词本、错题本都在学习者本机。env 是做题页的上下文（AI 助教页没有试卷） */
export type ToolEnv = {
  paper?: Paper;
  answers?: Record<string, string>;
  ink?: (signal?: AbortSignal) => Promise<string>;
  pages?: PdfWordsPage[] | null;
  where?: () => string; // 学习者此刻在卷面上看哪：第几页、哪部分、点开的哪题
};
type Result = { label: string; result: string };

/** 在线词典的释义；只有拼写建议、没有释义的不算 */
async function onlineEntry(w: string) {
  const e = (await lookupOnline(w))?.entry;
  return e?.t ? e : undefined;
}

export async function runTool(
  name: string,
  raw: string,
  env: ToolEnv,
): Promise<Result> {
  let a: Record<string, unknown>;
  try {
    a = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { label: `${name}：参数不对`, result: "参数不是合法的 JSON" };
  }
  try {
    switch (name) {
      case "lookup_word": {
        const w = String(a.word ?? "").trim();
        const lemma = await toLemma(w);
        const e = (await getEntry(lemma)) ?? (await onlineEntry(w));
        if (!e)
          return {
            label: `查词 · ${w}（词典里没有）`,
            result: `本机词典和在线词典都没查到 ${w}`,
          };
        const ph = phonetic(e);
        return {
          label: `查词 · ${lemma}`,
          result: [lemma + (ph ? ` /${ph}/` : ""), ...translationLines(e)].join(
            "\n",
          ),
        };
      }
      case "add_to_vocab": {
        const w = String(a.word ?? "").trim();
        if (!w) return { label: "生词本：没有词", result: "没给要加的词" };
        const phrase = /\s/.test(w);
        const lemma = phrase ? w.toLowerCase().replace(/\s+/g, " ") : await toLemma(w);
        const meaning = typeof a.meaning === "string" ? a.meaning.trim().slice(0, 200) : "";
        // 离线词典没有的词和短语：先查在线词典，再不行用 Agent 给的释义，释义随词存进生词本
        const entry =
          (await getEntry(lemma)) ??
          (await onlineEntry(w)) ??
          (meaning ? { w: phrase ? w : lemma, t: meaning } : undefined);
        if (!entry)
          return {
            label: `生词本：缺释义 ${w}`,
            result: `词典里查不到 ${w}，请带上 meaning（简短中文释义）再调用一次 add_to_vocab`,
          };
        const sentence =
          typeof a.sentence === "string" ? a.sentence.slice(0, 400) : "";
        await addToVocab(
          lemma,
          env.paper && sentence
            ? { paperId: env.paper.id, paperTitle: env.paper.title, sentence }
            : undefined,
          entry,
        );
        return {
          label: `已加入生词本 · ${lemma}`,
          result: `已把 ${lemma} 加进生词本`,
        };
      }
      case "list_vocab": {
        const w = typeof a.word === "string" ? a.word.trim() : "";
        if (w) {
          const lemma = await toLemma(w);
          const item = await db.vocab.get(lemma);
          if (!item)
            return {
              label: `生词本 · ${lemma} 不在里面`,
              result: `${lemma} 不在生词本里`,
            };
          const card = await db.cards.get(lemma);
          const e = item.gloss ?? (await getEntry(lemma));
          return {
            label: `查了生词本 · ${lemma}`,
            result: `${lemma} 在生词本里（${new Date(item.addedAt).toLocaleDateString()} 加入${item.sources[0] ? `，出自 ${item.sources[0].paperTitle}` : ""}）；${e ? shortTranslation(e) : ""}；${card ? (isMastered(card) ? "已掌握" : `${STATE_LABELS[card.state]}，下次复习 ${new Date(card.due).toLocaleDateString()}`) : "还没开始背"}`,
          };
        }
        const limit = Math.min(50, Math.max(1, Number(a.limit) || 20));
        const now = Date.now();
        let words: string[];
        let title: string;
        if (a.filter === "due") {
          const due = (
            await db.cards.where("due").belowOrEqual(now).toArray()
          ).filter((c) => c.origin === "vocab");
          // 删掉的词卡片可能还留着（学过的不删卡片），只算还在生词本里的
          const inBook = new Set(
            await db.vocab
              .bulkGet(due.map((c) => c.word))
              .then((rows) => rows.filter(Boolean).map((r) => r!.word)),
          );
          due.splice(0, due.length, ...due.filter((c) => inBook.has(c.word)));
          words = due.map((c) => c.word);
          title = `今天该复习的生词 ${words.length} 个`;
        } else {
          const all = await db.vocab.orderBy("addedAt").reverse().toArray();
          words = all.map((v) => v.word);
          title = `生词本共 ${all.length} 个词，最近加的`;
        }
        const lines = await Promise.all(
          words.slice(0, limit).map(async (x) => {
            const item = await db.vocab.get(x);
            const e = item?.gloss ?? (await getEntry(x));
            return `- ${x}${e ? `：${shortTranslation(e)}` : ""}`;
          }),
        );
        return {
          label: `看了生词本（${words.length} 个）`,
          result: `${title}：\n${lines.join("\n") || "（没有）"}`,
        };
      }
      case "remove_from_vocab": {
        const lemma = await toLemma(String(a.word ?? "").trim());
        if (!(await db.vocab.get(lemma)))
          return {
            label: `生词本 · ${lemma} 本来就不在`,
            result: `${lemma} 不在生词本里`,
          };
        await removeFromVocab(lemma);
        return {
          label: `从生词本删了 · ${lemma}`,
          result: `已把 ${lemma} 从生词本删掉`,
        };
      }
      case "add_method": {
        const text = String(a.text ?? "").trim();
        if (!text) return { label: "思路库：没有内容", result: "没给要记的方法" };
        const kind = typeof a.kind === "string" ? a.kind.trim() : "";
        await addMethod({
          text,
          kind: kind || undefined,
          from: "agent",
          source: env.paper ? { paperId: env.paper.id, paperTitle: env.paper.title } : undefined,
        });
        return { label: `已收进解题思路库${kind ? ` · ${kind}` : ""}`, result: "已收进解题思路库" };
      }
      case "mark_known": {
        const lemma = await toLemma(String(a.word ?? "").trim());
        const card = await db.cards.get(lemma);
        if (!card)
          return {
            label: `生词本 · ${lemma} 没有记忆卡片`,
            result: `${lemma} 不在生词本/背词卡片里，先加进生词本`,
          };
        // 标成已掌握：进入复习状态、稳定度拉到 30 天以上，两个月后再出现
        const now = Date.now();
        await db.cards.put({
          ...card,
          state: State.Review,
          stability: Math.max(card.stability, 30),
          scheduled_days: 60,
          due: now + 60 * 86_400_000,
          last_review: now,
        });
        return {
          label: `标成已掌握 · ${lemma}`,
          result: `已把 ${lemma} 标成已掌握，两个月后再复习`,
        };
      }
      case "add_to_mistakes": {
        if (!env.paper)
          return {
            label: "错题本：这里没有试卷",
            result: "当前不在做题页，没有试卷，加不了错题",
          };
        const n = Number(a.number);
        const hit = scoredQuestions(env.paper).find(({ q }) => q.number === n);
        if (!hit)
          return {
            label: `错题本：没有第 ${n} 题`,
            result: `这套卷没有能加进错题本的第 ${n} 题（只有选择题能加）`,
          };
        const id = masteryId(env.paper.id, hit.q.id);
        const note =
          typeof a.note === "string" && a.note.trim()
            ? a.note.slice(0, 300)
            : undefined;
        const now = Date.now();
        const row = await db.mastery.get(id);
        if (row)
          await db.mastery.put({
            ...row,
            retiredAt: undefined,
            ...(note ? { note } : {}),
          });
        else
          await db.mastery.put({
            id,
            paperId: env.paper.id,
            questionId: hit.q.id,
            kind: hit.kind,
            firstWrongAt: now,
            history: [
              {
                at: now,
                right: false,
                mode: "practice",
                chosen: env.answers?.[hit.q.id],
              },
            ],
            ...(note ? { note } : {}),
          });
        return {
          label: `已加入错题本 · 第 ${n} 题`,
          result: `已把第 ${n} 题加进错题本${note ? `，笔记：${note}` : ""}`,
        };
      }
      case "get_weak_points": {
        const open = (await db.mastery.toArray()).filter((r) => !r.retiredAt);
        const by = new Map<string, number>();
        for (const r of open)
          by.set(
            KIND_NAMES[r.kind] ?? r.kind,
            (by.get(KIND_NAMES[r.kind] ?? r.kind) ?? 0) + 1,
          );
        const kinds = [...by]
          .sort((x, y) => y[1] - x[1])
          .map(([k, c]) => `- ${k}：${c} 题`);
        return {
          label: "看了你的薄弱点",
          result: `学习者档案：
${(await getProfile()) || "（还没有）"}
错题本里还没掌握的题（按题型）：\n${kinds.join("\n") || "（错题本是空的）"}`,
        };
      }
      case "annotate_paper": {
        if (!env.paper || !env.pages)
          return {
            label: "标注：这里没有试卷",
            result: "当前不在做题页，没法标注",
          };
        const text = String(a.text ?? "").trim();
        if (a.style === "long_sentence")
          return {
            label: "标注：长难句改用结构卡片",
            result: "长难句不要用 annotate_paper，改用 mark_long_sentence 把整句的主干、修饰成分和译文标在卷面上",
          };
        const style = a.style === "underline" ? "underline" : "highlight";
        const hit = findSpan(env.pages, text, Number(a.page) || undefined);
        if (!hit)
          return {
            label: `标注：卷面上没找到“${text.slice(0, 30)}”`,
            result: `卷面上没找到这段原文：${text.slice(0, 80)}。要用卷面上的原词原句（可以只给开头几个词）`,
          };
        const { rects, text: got } = wordRange(
          env.pages[hit.page - 1].w,
          hit.a,
          hit.b,
        );
        const kind = style === "highlight" ? "highlight" : "underline";
        const color = style === "highlight" ? "yellow" : "red";
        const note =
          typeof a.note === "string" && a.note.trim()
            ? a.note.trim().slice(0, 200)
            : "";
        const last = rects[rects.length - 1];
        const W = env.pages[hit.page - 1].width;
        const marks = [
          newMark(env.paper.id, hit.page, {
            kind,
            color,
            rects,
            text: got,
            ai: true,
            ...(note ? { note } : {}),
          }),
        ];
        // 释义写成旁边的便签，卷面上看得见
        if (note)
          marks.push(
            newMark(env.paper.id, hit.page, {
              kind: "note",
              color: "note",
              at: [Math.min(W - 12, last[2] + 8), last[1] + 2],
              note,
              ai: true,
            }),
          );
        await db.marks.bulkPut(marks);
        const what = style === "highlight" ? "高亮" : "划线";
        return {
          label: `第 ${hit.page} 页${what} · ${got.slice(0, 40)}${note ? `（${note.slice(0, 20)}）` : ""}`,
          result: `已在第 ${hit.page} 页${what}：${got}${note ? `，旁边写了：${note}` : ""}`,
        };
      }
      case "mark_long_sentence": {
        if (!env.paper || !env.pages)
          return { label: "长难句：这里没有试卷", result: "当前不在做题页，没法标" };
        const text = String(a.sentence ?? "").trim();
        const hit = findSpan(env.pages, text, Number(a.page) || undefined);
        if (!hit)
          return {
            label: `长难句：卷面上没找到“${text.slice(0, 30)}”`,
            result: `卷面上没找到这句：${text.slice(0, 80)}。照抄卷面上的整句原文`,
          };
        const pg = env.pages[hit.page - 1];
        const en = pg.s[pg.w[hit.a][5]];
        if (!en) return { label: "长难句：没对上卷面的句子", result: "卷面上这里没有完整的句子，换一句" };
        // 片段要在卷面这句里找得到（大小写、弯引号不计），找不到的丢掉
        const pieces = (x: unknown): SyntaxPiece[] =>
          (Array.isArray(x) ? x : [])
            .map((p) => ({
              t: String(p?.text ?? p?.t ?? "").trim(),
              r: String(p?.role ?? p?.r ?? "").trim(),
              ...(p?.of ? { of: String(p.of) } : {}),
              ...(p?.note ? { note: String(p.note) } : {}),
            }))
            .filter((p) => p.t && p.r && locate(en, p.t));
        const main = pieces(a.main);
        if (!main.length)
          return {
            label: "长难句：主干没对上原句",
            result: `主干片段在卷面原句里找不到。卷面上这句是：${en}。main 里的 text 要照抄这句里的原词`,
          };
        const key = sentenceKey(en);
        const now = Date.now();
        await db.aiSyntax.put({
          id: `${env.paper.id}:${key}`,
          paperId: env.paper.id,
          key,
          entry: {
            group: "ai",
            en,
            main,
            parts: pieces(a.parts),
            points: (Array.isArray(a.points) ? a.points : []).map(String).filter(Boolean).slice(0, 4),
            zh: String(a.translation ?? "").trim(),
          },
          createdAt: now,
          updatedAt: now,
        });
        return {
          label: `第 ${hit.page} 页标了长难句 · ${en.slice(0, 40)}`,
          result: `已标在第 ${hit.page} 页：卷面上这句划了蓝虚线，学习者点一下就能看主干、修饰成分和译文。正文不用再把结构写一遍`,
        };
      }
      case "update_profile": {
        const text = typeof a.profile === "string" ? a.profile.trim() : "";
        if (!text)
          return { label: "档案：内容是空的", result: "profile 为空，没改" };
        touchMemory(); // 聊完后台的整理是按旧档案算的，作废
        await saveProfile(text);
        return { label: "更新了学习者档案", result: "档案已更新" };
      }
      case "show_sentence_map":
        return {
          label: "画了句子结构图",
          result: "结构图已显示给学习者，正文不用再逐块重复，只补一两句要点",
        };
      case "show_answer_map":
        return {
          label: "画了答案解析图",
          result: "答案解析图已显示给学习者，正文只用一两句话点出关键",
        };
      case "show_steps":
        return {
          label: "列了解题步骤",
          result:
            "解题步骤已显示给学习者（可以一步步展开），正文只用一句话总结",
        };
      case "show_cards": {
        let n = 0;
        try {
          n = (JSON.parse(raw) as { cards?: unknown[] }).cards?.length ?? 0;
        } catch {
          /* 参数坏了按 0 张 */
        }
        return {
          label: `做了 ${n} 张词汇卡`,
          result: "卡片已显示给学习者，正文不用重复",
        };
      }
      case "show_quiz": {
        const n = quizOf({ id: "", name, args: raw })?.questions.length ?? 0;
        return n
          ? {
              label: `出了 ${n} 道练习题`,
              result: `题卡已经显示给学习者（${n} 道），他会自己点选作答；正文不要重复题目和答案`,
            }
          : {
              label: "练习题格式不对",
              result:
                "questions 为空或格式不对，每题要有 stem、四个 options、answer（A–D）、explain",
            };
      }
    }
    return { label: `不认识的工具 ${name}`, result: `没有这个工具：${name}` };
  } catch (e) {
    return { label: `${name} 出错了`, result: `出错：${(e as Error).message}` };
  }
}

export type QuizQ = {
  stem: string;
  options: string[];
  answer: string;
  explain: string;
};

/** show_quiz 的参数 → 题卡；格式不对的题丢掉 */
export function quizOf(
  c: ToolCall,
): { title?: string; questions: QuizQ[] } | null {
  try {
    const a = JSON.parse(c.args) as { title?: unknown; questions?: unknown };
    const questions = (Array.isArray(a.questions) ? a.questions : []).filter(
      (q): q is QuizQ =>
        !!q &&
        typeof q.stem === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.options.length <= 4 &&
        q.options.every((o: unknown) => typeof o === "string") &&
        typeof q.answer === "string" &&
        "ABCD".slice(0, q.options.length).includes(q.answer) &&
        q.answer.length === 1,
    );
    return questions.length
      ? { title: typeof a.title === "string" ? a.title : undefined, questions }
      : null;
  } catch {
    return null;
  }
}

/** 在卷面文字层里找一段原文（按词比，忽略大小写和标点）；找不到整段就用前几个词定位、按词数往后取 */
/**
 * Agent 要标的一段原文在卷面上的位置：整段一字不差最好；对不上时要开头 4 个词和结尾 3 个词都对得上、
 * 中间隔的词数差不多，免得只凭开头几个词标到别处去
 */
export function findSpan(pages: PdfWordsPage[], text: string, page?: number): { page: number; a: number; b: number } | null {
  // 卷面词层不收数字（In 2020 只有 In），要标的原文里的数字也去掉
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
  const want = text.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return null;
  const order = page && pages[page - 1] ? [page - 1, ...pages.map((_, i) => i).filter((i) => i !== page - 1)] : pages.map((_, i) => i);
  const at = (w: string[], i: number, seq: string[]) => seq.every((x, k) => w[i + k] === x);
  for (const pi of order) {
    const w = pages[pi].w.map((x) => norm(x[0]));
    for (let i = 0; i + want.length <= w.length; i++) if (at(w, i, want)) return { page: pi + 1, a: i, b: i + want.length - 1 };
  }
  if (want.length < 6) return null;
  const head = want.slice(0, 4);
  const tail = want.slice(-3);
  const slack = Math.max(3, Math.round(want.length * 0.25));
  for (const pi of order) {
    const w = pages[pi].w.map((x) => norm(x[0]));
    for (let i = 0; i < w.length; i++) {
      if (!at(w, i, head)) continue;
      for (let len = want.length - slack; len <= want.length + slack; len++) {
        const j = i + len - tail.length;
        if (j > i + head.length - 1 && j + tail.length <= w.length && at(w, j, tail)) return { page: pi + 1, a: i, b: j + tail.length - 1 };
      }
    }
  }
  return null;
}

export function findText(
  pages: PdfWordsPage[],
  text: string,
  page?: number,
  shown?: (page: number, y: number) => boolean, // 只认卷面上显示着的地方（专项练习只显示那一部分）
): { page: number; a: number; b: number } | null {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
  const want = text.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return null;
  const order =
    page && pages[page - 1]
      ? [page - 1, ...pages.map((_, i) => i).filter((i) => i !== page - 1)]
      : pages.map((_, i) => i);
  for (const n of [
    want.length,
    Math.min(want.length, 5),
    Math.min(want.length, 3),
  ])
    for (const pi of order) {
      const w = pages[pi].w.map((x) => norm(x[0]));
      for (let i = 0; i + n <= w.length; i++) {
        let ok = true;
        for (let k = 0; k < n && ok; k++) ok = w[i + k] === want[k];
        if (ok && (!shown || shown(pi + 1, pages[pi].w[i][2])))
          return {
            page: pi + 1,
            a: i,
            b: Math.min(w.length - 1, i + want.length - 1),
          };
      }
    }
  return null;
}
