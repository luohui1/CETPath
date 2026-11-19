import { useEffect, useState } from "react";
import { db, type MarkRow, type MemoryRow } from "./db";
import { kindName, type Paper, type PdfWordsPage } from "@/lib/papers";

/** AI 助教：问题经服务器（server/agent_server.py）转发到管理后台配好的模型；长期记忆存在本机 memory 表，每次提问随请求带上 */
export type ToolCall = { id: string; name: string; args: string };
/** 对话里的一条：助手可以带工具调用（calls），工具结果是 role: "tool"（label 是给人看的一行） */
export type ChatMsg = {
  role: "user" | "assistant" | "tool";
  content: string;
  calls?: ToolCall[];
  callId?: string;
  label?: string;
};
// 只带最近几轮、每条截短：长对话也不会超过后端的请求上限
const MAX_TURNS = 12;
const MAX_CHARS = 3000;
const trimTurns = (m: ChatMsg[]) =>
  // 至少从最后一个提问开始带上：一轮里工具调用多了也不能把问题本身截掉
  m
    .slice(
      Math.max(
        0,
        Math.min(
          m.length - MAX_TURNS,
          m.map((x) => x.role).lastIndexOf("user"),
        ),
      ),
    )
    .map((x) =>
      x.role === "tool"
        ? {
            role: "tool",
            tool_call_id: x.callId,
            content: x.content.slice(0, MAX_CHARS),
          }
        : {
            role: x.role,
            content: x.content.slice(0, MAX_CHARS),
            ...(x.calls?.length ? { tool_calls: x.calls } : {}),
          },
    );
// question：AI 助教页直接提的问题（不针对某一句，sentence 为空）
export type AgentContext = {
  paper?: string;
  sentence: string;
  question?: string;
  word?: string;
  syntax?: unknown;
  review?: string;
  reviewReady?: boolean;
  paperText?: string;
  marks?: string;
};

let status: Promise<boolean> | null = null;
/** 设置页改了模型后重新问一次是否开通 */
export const resetAgentStatus = () => {
  status = null;
  modelsP = null;
};
export function agentEnabled(): Promise<boolean> {
  status ??= fetch("/api/agent/status")
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((d: { enabled?: boolean }) => !!d.enabled)
    .catch(() => false)
    .then((on) => {
      if (!on) setTimeout(() => (status = null), 60_000); // 没开通或离线：过一会儿再问
      return on;
    });
  return status;
}

export function useAgentEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void agentEnabled().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

const memoryForPrompt = async () =>
  (await db.memory.orderBy("updatedAt").reverse().limit(60).toArray()).map(
    (m) => ({ id: m.id, kind: m.kind, text: m.text }),
  );

async function failure(r: Response) {
  try {
    const d = (await r.json()) as { error?: string };
    return new Error(d.error || `出错了（${r.status}）`);
  } catch {
    return new Error(
      r.status === 404 || r.status === 502
        ? "AI 助教的服务没开"
        : `出错了（${r.status}）`,
    );
  }
}

/** 流式提问：每收到一段字调一次 onText（传累计的全文），返回完整回答 */
export async function streamChat(
  messages: ChatMsg[],
  context: AgentContext,
  onText: (all: string) => void,
  signal?: AbortSignal,
  tools = false,
): Promise<{ text: string; calls: ToolCall[] }> {
  const r = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: trimTurns(messages),
      context,
      memory: await memoryForPrompt(),
      model: pickedModel(),
      tools,
    }),
    signal,
  });
  if (!r.ok || !r.body) throw await failure(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let all = "";
  let calls: ToolCall[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return { text: all, calls };
      const d = JSON.parse(payload) as {
        t?: string;
        error?: string;
        calls?: ToolCall[];
      };
      if (d.error) throw new Error(d.error);
      if (d.t) onText((all += d.t));
      if (d.calls) calls = d.calls;
    }
  }
  return { text: all, calls };
}

// 学习者在设置里改过、删过、清空过记忆的时间：整理期间有人动过，就丢掉这次整理的结果（它是按旧记忆算的）
let editedAt = 0;
export const touchMemory = () => void (editedAt = Date.now());

/** 聊完一轮：让模型从这段对话里整理长期记忆，按它给的加、改、删写进本机。返回新记下的条目 */
export async function remember(messages: ChatMsg[]): Promise<string[]> {
  const started = Date.now();
  const r = await fetch("/api/agent/remember", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: trimTurns(messages),
      memory: await memoryForPrompt(),
    }),
  });
  if (!r.ok) return [];
  const ops = (await r.json()) as {
    add: Pick<MemoryRow, "kind" | "text">[];
    update: { id: number; text: string }[];
    remove: number[];
  };
  const added: string[] = [];
  if (editedAt >= started) return added;
  await db.transaction("rw", db.memory, async () => {
    const now = Date.now();
    const have = new Set((await db.memory.toArray()).map((m) => m.text));
    for (const a of ops.add ?? []) {
      if (have.has(a.text)) continue;
      await db.memory.add({
        kind: a.kind,
        text: a.text,
        createdAt: now,
        updatedAt: now,
      });
      added.push(a.text);
    }
    for (const u of ops.update ?? [])
      if (await db.memory.get(u.id))
        await db.memory.update(u.id, { text: u.text, updatedAt: now });
    if (ops.remove?.length) await db.memory.bulkDelete(ops.remove);
  });
  return added;
}

export const MEMORY_KINDS: Record<MemoryRow["kind"], string> = {
  weak: "薄弱",
  pref: "偏好",
  fact: "情况",
};

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** 还没交卷时给 Agent 的进度：每个题型答了几题、各选了什么，不带正确答案 */
export function progressSummary(
  paper: Paper,
  answers: Record<string, string>,
): string {
  const lines = ["还没交卷。"];
  for (const s of paper.sections) {
    const qs = s.groups
      .flatMap((g) => g.questions)
      .filter((q) => q.options?.length);
    if (!qs.length) continue;
    const picked = qs.filter((q) => answers[q.id]);
    lines.push(
      `【${kindName(s.kind, paper.exam)} ${qs[0].number}–${qs[qs.length - 1].number}】已答 ${picked.length}/${qs.length}${picked.length ? `：${picked.map((q) => `${q.number}${answers[q.id]}`).join(" ")}` : ""}`,
    );
  }
  return lines.join("\n");
}

/**
 * 复盘用的作答摘要：先是总分和每个题型的对错、用时（单题秒表没开时用按部分累计的时间），
 * 再逐条列错题、没答的和超时的题（带选项原文，完形这类没有题干的也看得懂）。明细太长时只截明细，题型总览总在。
 */
export function reviewSummary(
  paper: Paper,
  answers: Record<string, string>,
  sec: Record<string, number> | null,
  limits: Record<string, number>,
  sectionSec?: Record<string, number>,
): string {
  const all = paper.sections.flatMap((s) =>
    s.groups
      .flatMap((g) => g.questions)
      .filter((q) => q.options?.length)
      .map((q) => ({ s, q })),
  );
  const right = all.filter(({ q }) => answers[q.id] === q.answer).length;
  const head = [
    `选择题答对 ${right}/${all.length}，没答 ${all.filter(({ q }) => !answers[q.id]).length} 题`,
  ];
  const detail: string[] = [];
  let spent = 0;
  for (const s of paper.sections) {
    const qs = all.filter((x) => x.s === s).map((x) => x.q);
    if (!qs.length) continue;
    const name = `${kindName(s.kind, paper.exam)} ${qs[0].number}–${qs[qs.length - 1].number}`;
    const ok = qs.filter((q) => answers[q.id] === q.answer).length;
    const t = Math.max(
      qs.reduce((a, q) => a + (sec?.[q.id] ?? 0), 0),
      sectionSec?.[s.id] ?? 0,
    );
    const lim = qs.reduce((a, q) => a + (limits[q.id] ?? 0), 0);
    spent += t;
    head.push(
      `【${name}】对 ${ok}/${qs.length}，用时 ${t ? mmss(t) : "没记录"}${lim ? `（建议 ${mmss(lim)}）` : ""}`,
    );
    for (const q of qs) {
      const a = answers[q.id];
      const used = sec?.[q.id] ?? 0;
      const slow = used > (limits[q.id] ?? Infinity);
      if (a === q.answer && !slow) continue;
      const opt = (k?: string) => {
        const o = k ? q.options?.find((x) => x.key === k) : undefined;
        return o ? `${o.key}「${o.text.slice(0, 60)}」` : (k ?? "");
      };
      const why =
        a === q.answer
          ? `对了但超时（选 ${opt(a)}）`
          : a
            ? `选 ${opt(a)}，正确 ${opt(q.answer)}`
            : `没答，正确 ${opt(q.answer)}`;
      const stem = q.stem
        ? `；题干：${q.stem.replace(/\s+/g, " ").slice(0, 140)}`
        : "";
      const exp =
        a !== q.answer && q.explanation
          ? `；解析：${q.explanation.replace(/\s+/g, " ").slice(0, 160)}`
          : "";
      detail.push(
        `- [${name}] 第 ${q.number} 题：${why}${used ? `，用时 ${mmss(used)}${slow ? `（建议 ${mmss(limits[q.id])}）` : ""}` : ""}${stem}${exp}`,
      );
    }
  }
  head[0] += `，记录到的作答用时 ${mmss(spent)}`;
  const top = head.join("\n");
  const budget = 9000 - top.length - 40;
  let body = "";
  for (const d of detail) {
    if (body.length + d.length + 1 > budget) {
      body += `\n（还有 ${detail.length - body.split("\n").filter(Boolean).length} 条明细放不下，略）`;
      break;
    }
    body += (body ? "\n" : "") + d;
  }
  return `${top}\n\n逐题明细：\n${body || "（全对，没有超时）"}`;
}

// ---------- 可选模型 ----------
const MODEL_KEY = "yz-agent-model";
export const pickedModel = () => localStorage.getItem(MODEL_KEY) || undefined;
export const setPickedModel = (v: string) => localStorage.setItem(MODEL_KEY, v);
type Models = { models: string[]; default: string };
let modelsP: Promise<Models> | null = null;
/** 后台允许切的模型（第一个是默认） */
export function useAgentModels(): Models | null {
  const [m, setM] = useState<Models | null>(null);
  useEffect(() => {
    modelsP ??= fetch("/api/agent/models")
      .then((r) => (r.ok ? r.json() : { models: [], default: "" }))
      .catch(() => ({ models: [], default: "" }));
    let live = true;
    void modelsP.then((d) => live && setM(d));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

/** 整套卷的原文（按页，从卷面文字层取），让 Agent 问到哪题都看得到题目和文章 */
export function paperText(pages: PdfWordsPage[] | null, max = 30000): string {
  if (!pages) return "";
  let out = "";
  pages.forEach((p, i) => {
    const t = p.s.join(" ").replace(/\s+/g, " ").trim();
    if (t) out += `\n[第 ${i + 1} 页] ${t}`;
  });
  return out.length > max ? out.slice(0, max) + "\n（后面省略）" : out.trim();
}

/** 学习者在卷面上的标注：高亮、划线的原文和批注，便签内容（手写笔迹没有文字，只计数） */
export function marksSummary(marks: MarkRow[] | undefined, max = 3000): string {
  if (!marks?.length) return "";
  const name = {
    highlight: "高亮",
    underline: "划线",
    note: "便签",
    pen: "",
  } as const;
  const lines = [...marks]
    .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
    .filter((m) => m.kind !== "pen" && (m.text || m.note))
    .map(
      (m) =>
        `第 ${m.page} 页 ${name[m.kind]}：${m.text ? `“${m.text}”` : ""}${m.note ? `${m.text ? " 批注：" : ""}${m.note}` : ""}`,
    );
  const pens = marks.filter((m) => m.kind === "pen").length;
  if (pens) lines.push(`另有手写笔迹 ${pens} 处`);
  const out = lines.join("\n");
  return out.length > max ? out.slice(0, max) + "\n（后面省略）" : out;
}
