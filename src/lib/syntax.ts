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

/** 判断一段文本是否更像一句英文长句（非中文问题/方法） */
export function looksLikeEnglishSentence(text: string, minWords = 8): boolean {
  const s = text.trim();
  if (!s || /[\u4e00-\u9fff]/.test(s)) return false;
  const words = s.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g);
  return (words?.length ?? 0) >= minWords;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed) candidates.push(trimmed);
  for (const m of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // ignore malformed candidate
    }
  }
  return null;
}

/** 从 AI 输出的 JSON 中尽力提取译文（即使结构字段校验未通过也能保留翻译） */
export function extractTranslationFromJson(raw: string): string | undefined {
  const obj = extractJsonObject(raw);
  if (!obj) return undefined;
  const zh = typeof obj.zh === "string" ? obj.zh.trim() : typeof obj.translation === "string" ? obj.translation.trim() : "";
  return zh || undefined;
}

/** 把 AI 返回的 JSON 校验并转换成卷面同款 SyntaxEntry；片段必须在原句中找得到 */
export function parseAiSyntaxJson(en: string, raw: string, group = "method"): SyntaxEntry | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const text = en.trim();
  if (!text) return null;

  const main: SyntaxPiece[] = [];
  let pos = 0;
  for (const item of Array.isArray(obj.main) ? obj.main : []) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const t = String(rec.t ?? rec.text ?? "").trim();
    const r = String(rec.r ?? rec.role ?? "").trim();
    if (!t || !r) continue;
    const at = locate(text, t, pos);
    if (!at) continue;
    main.push({ t: text.slice(at[0], at[1]), r });
    pos = at[1];
  }

  const parts: SyntaxPiece[] = [];
  for (const item of Array.isArray(obj.parts) ? obj.parts : []) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const t = String(rec.t ?? rec.text ?? "").trim();
    const r = String(rec.r ?? rec.role ?? "").trim();
    if (!t || !r) continue;
    const at = locate(text, t);
    if (!at) continue;
    const of = typeof rec.of === "string" ? rec.of.trim() : "";
    const note = typeof rec.note === "string" ? rec.note.trim() : "";
    parts.push({
      t: text.slice(at[0], at[1]),
      r,
      ...(of ? { of } : {}),
      ...(note ? { note } : {}),
    });
  }

  const points = (Array.isArray(obj.points) ? obj.points : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 4);
  const zh = typeof obj.zh === "string" ? obj.zh.trim() : typeof obj.translation === "string" ? obj.translation.trim() : "";
  if (!main.length || (!zh && !parts.length)) return null;
  return { group, en: text, main, parts, points, zh };
}

type AgentMapPart = { text?: string; role?: string; level?: number; label?: string; note?: string };

/** 把 AI 助教 show_sentence_map 工具的数据转换成 SyntaxEntry */
export function sentenceMapToSyntaxEntry(data: { sentence?: string; translation?: string; parts?: AgentMapPart[] }): SyntaxEntry | null {
  const rawParts = (Array.isArray(data.parts) ? data.parts : []).filter((p) => p && typeof p.text === "string" && p.text.trim());
  const built = rawParts
    .map((p) => p.text!.trim())
    .join(" ")
    .replace(/\s+([,.;:?!'"’”)\]])/g, "$1")
    .replace(/([('"‘“[])\s+/g, "$1");
  const en = (typeof data.sentence === "string" && data.sentence.trim() ? data.sentence.trim() : built).replace(/\s+/g, " ");
  if (!en) return null;

  const mainRole = (role?: string) => (role === "subject" ? "主语" : role === "predicate" ? "谓语" : role === "object" ? "宾语" : "");
  const extractMain = (strictLevel: boolean) => {
    const out: SyntaxPiece[] = [];
    let pos = 0;
    for (const p of rawParts) {
      if (strictLevel && (p.level ?? 0) > 0) continue;
      const r = mainRole(p.role);
      if (!r) continue;
      const at = locate(en, p.text!, pos);
      if (!at) continue;
      out.push({ t: en.slice(at[0], at[1]), r });
      pos = at[1];
    }
    return out;
  };
  let main = extractMain(true);
  if (!main.length) main = extractMain(false);
  if (!main.length) return null;

  const parts: SyntaxPiece[] = [];
  const pts: string[] = [];
  for (const p of rawParts) {
    const isMod = p.role === "clause" || p.role === "modifier" || (p.level ?? 0) > 0 || (p.role === "other" && !!(p.label || p.note));
    if (!isMod) continue;
    const t = p.text!.trim();
    if (!/[A-Za-z0-9]/.test(t)) continue;
    const at = locate(en, t);
    if (!at) continue;
    const label = typeof p.label === "string" ? p.label.trim() : "";
    const note = typeof p.note === "string" ? p.note.trim() : "";
    const head = label.split(/[，,：:·(（]/)[0]?.trim() ?? "";
    const r = head || (p.role === "clause" ? "从句" : p.role === "modifier" ? "修饰短语" : "插入/同位");
    const ofMatch = label.match(/修饰\s*(.+)$/);
    const of = ofMatch?.[1]?.trim();
    const restLabel = label && head && label !== head && !ofMatch ? label.slice(head.length).replace(/^[，,：:·\s]+/, "") : "";
    const fullNote = [restLabel, note].filter(Boolean).join(" · ");
    parts.push({
      t: en.slice(at[0], at[1]),
      r,
      ...(of ? { of } : {}),
      ...(fullNote ? { note: fullNote } : {}),
    });
    const pt = [label, note].filter(Boolean).join("：");
    if (pt && !pts.includes(pt) && pts.length < 4) pts.push(pt);
  }

  return {
    group: "agent",
    en,
    main,
    parts,
    points: pts,
    zh: typeof data.translation === "string" ? data.translation.trim() : "",
  };
}

