import { db, type MethodRow } from "./db";
import { streamChat } from "./agent";
import { paperPath } from "./attempts";
import { extractTranslationFromJson, parseAiSyntaxJson, type SyntaxEntry } from "./syntax";
import { sentenceKey } from "./trans";

export const GENERAL = "通用";
export const SYNTAX_KIND = "长难句";

export type AddMethodInput = Pick<MethodRow, "from"> &
  Partial<Pick<MethodRow, "text" | "kind" | "sentence" | "translation" | "syntax" | "source">>;

export function isSentenceMethod(m: Pick<MethodRow, "sentence" | "syntax">): boolean {
  return Boolean(m.sentence || m.syntax);
}

/** 从思路库一条记录跳回原出处（真题卷面 / 雅思 / 外刊） */
export function methodPaperHref(m: Pick<MethodRow, "source" | "sentence">): string | null {
  const pid = m.source?.paperId;
  if (!pid) return null;
  if (pid.startsWith("ielts:")) return `/ielts/start/${encodeURIComponent(pid.slice(6))}`;
  if (pid.startsWith("article:")) return `/articles/${encodeURIComponent(pid.slice(8))}`;
  const base = paperPath(pid);
  if (m.source?.questionId) return `${base}?focus=${encodeURIComponent(m.source.questionId)}`;
  const sent = m.source?.sentence || m.sentence;
  if (sent) return `${base}?sent=${encodeURIComponent(sent)}&syntax=1`;
  return base;
}

/** 收进思路库；解题思路按全文去重，长难句按归一化句子键去重并合并更完整的结构/译文 */
export async function addMethod(m: AddMethodInput) {
  const rawSentence = (m.syntax?.en || m.sentence || "").trim().replace(/\s+/g, " ");
  const now = Date.now();
  if (rawSentence) {
    const sKey = sentenceKey(rawSentence);
    const translation = (m.translation?.trim() || m.syntax?.zh?.trim() || "").trim() || undefined;
    const rawText = (m.text ?? "").trim();
    const note = (rawText && sentenceKey(rawText) !== sKey ? rawText : "") || (m.syntax?.points?.length ? m.syntax.points.join("；") : "");
    const kind = m.kind?.trim() || SYNTAX_KIND;
    const old = await db.methods
      .filter((r) => (!!r.sentence && sentenceKey(r.sentence) === sKey) || (!r.sentence && r.kind === SYNTAX_KIND && sentenceKey(r.text) === sKey))
      .first();
    if (old) {
      await db.methods.update(old.id, {
        updatedAt: now,
        sentence: old.sentence || rawSentence,
        kind: m.kind?.trim() || old.kind || SYNTAX_KIND,
        ...(m.syntax ? { syntax: m.syntax } : {}),
        ...(translation ? { translation } : {}),
        ...(note ? { text: note } : {}),
        ...(m.source ? { source: m.source } : {}),
      });
      return old.id;
    }
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await db.methods.put({
      id,
      text: note || rawSentence,
      kind,
      from: m.from,
      sentence: rawSentence,
      ...(translation ? { translation } : {}),
      ...(m.syntax ? { syntax: m.syntax } : {}),
      source: m.source,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  const text = (m.text ?? "").trim();
  if (!text) return null;
  const old = await db.methods.filter((r) => !r.sentence && r.text === text).first();
  if (old) {
    await db.methods.update(old.id, { updatedAt: now, ...(m.kind ? { kind: m.kind } : {}), ...(m.source ? { source: m.source } : {}) });
    return old.id;
  }
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db.methods.put({ id, text, kind: m.kind?.trim() || undefined, from: m.from, source: m.source, createdAt: now, updatedAt: now });
  return id;
}

export const updateMethod = (
  id: string,
  patch: Partial<Pick<MethodRow, "text" | "kind" | "sentence" | "translation" | "syntax">>,
) => db.methods.update(id, { ...patch, updatedAt: Date.now() });

export const removeMethod = (id: string) => db.methods.delete(id);

export const hasMethod = async (text: string) => !!(await db.methods.filter((r) => !r.sentence && r.text === text.trim()).first());

export async function hasSentenceMethod(sentence: string): Promise<boolean> {
  const sKey = sentenceKey(sentence);
  if (!sKey) return false;
  return !!(await db.methods
    .filter((r) => (!!r.sentence && sentenceKey(r.sentence) === sKey) || (!r.sentence && r.kind === SYNTAX_KIND && sentenceKey(r.text) === sKey))
    .first());
}

/** 调用当前已接入的 AI 模型拆解一句英文长难句，生成卷面同款 SyntaxEntry 与译文 */
export async function analyzeSentenceSyntax(
  sentence: string,
  signal?: AbortSignal,
): Promise<{ syntax: SyntaxEntry | null; translation?: string }> {
  const en = sentence.trim().replace(/\s+/g, " ");
  if (!en) throw new Error("请先输入英文长难句");
  const prompt = [
    "请拆解下面这句英文长难句，严格只输出一个 JSON 对象，不要 markdown 代码块或额外解释：",
    '{"main":[{"t":"主干原文片段","r":"主语|谓语|宾语|表语|宾语补足语|形式主语|真正主语|形式宾语|真正宾语"}],"parts":[{"t":"从句或修饰片段原文","r":"定语从句|非限制性定语从句|同位语从句|宾语从句|主语从句|表语从句|时间状语从句|条件状语从句|原因状语从句|让步状语从句|目的状语从句|结果状语从句|比较状语从句|方式状语从句|介词短语|现在分词短语|过去分词短语|不定式短语|动名词短语|独立主格|同位语|插入语|并列成分|倒装|强调句|省略","of":"被修饰的原文词/短语(可选)","note":"一句中文说明(可选)"}],"points":["1-3条语法难点，每条一句"],"zh":"通顺准确的中文译文"}',
    "要求：main 和 parts 中每个 t 必须逐词照抄原句里的连续原文（大小写可忽略，不能改写词形）；main 按句中先后顺序排列（2-5 项）。",
    `原句：${en}`,
  ].join("\n");

  const r = await streamChat(
    [{ role: "user", content: prompt }],
    { sentence: en },
    () => {},
    signal,
    false,
  );
  const syntax = parseAiSyntaxJson(en, r.text, "method");
  const translation = syntax?.zh || extractTranslationFromJson(r.text);
  if (!syntax && !translation) throw new Error("AI 返回格式未能识别，可直接先保存或到 AI 助教里拆解");
  return { syntax, translation };
}
