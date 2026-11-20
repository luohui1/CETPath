import { db } from "./db";
import { getEntry, phonetic, toLemma, translationLines } from "./dict";
import { addToVocab } from "./learning";
import { masteryId, scoredQuestions } from "./mistakes";
import { getProfile, saveProfile } from "./profile";
import { touchMemory } from "./agent";
import { KIND_NAMES, type Paper, type PdfWordsPage } from "./papers";
import { newMark, wordRange } from "./marks";
import type { ToolCall } from "./agent";

/** Agent 的工具在浏览器里执行：词典、生词本、错题本都在学习者本机。env 是做题页的上下文（AI 助教页没有试卷） */
export type ToolEnv = {
  paper?: Paper;
  answers?: Record<string, string>;
  ink?: (signal?: AbortSignal) => Promise<string>;
  pages?: PdfWordsPage[] | null;
};
type Result = { label: string; result: string };

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
        const e = await getEntry(lemma);
        if (!e)
          return {
            label: `查词 · ${w}（词典里没有）`,
            result: `本机词典里没有 ${w}`,
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
        const lemma = await toLemma(w);
        const entry = await getEntry(lemma);
        // 词典里没有的不加：生词本和背词卡片都要靠词典释义
        if (!entry)
          return {
            label: `生词本：词典里没有 ${w}`,
            result: `本机词典里没有 ${w}，没加进生词本；可以告诉学习者它的意思，让他自己决定怎么记`,
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
        const style =
          a.style === "underline" || a.style === "long_sentence"
            ? a.style
            : "highlight";
        const hit = findText(env.pages, text, Number(a.page) || undefined);
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
        const color =
          style === "highlight"
            ? "yellow"
            : style === "long_sentence"
              ? "blue"
              : "red";
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
              note: (style === "long_sentence" ? "长难句：" : "") + note,
              ai: true,
            }),
          );
        await db.marks.bulkPut(marks);
        const what =
          style === "highlight"
            ? "高亮"
            : style === "long_sentence"
              ? "标了长难句"
              : "划线";
        return {
          label: `第 ${hit.page} 页${what} · ${got.slice(0, 40)}${note ? `（${note.slice(0, 20)}）` : ""}`,
          result: `已在第 ${hit.page} 页${what}：${got}${note ? `，旁边写了：${note}` : ""}`,
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
function findText(
  pages: PdfWordsPage[],
  text: string,
  page?: number,
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
        if (ok)
          return {
            page: pi + 1,
            a: i,
            b: Math.min(w.length - 1, i + want.length - 1),
          };
      }
    }
  return null;
}
