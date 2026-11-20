import { useEffect, useState } from "react";
import type { MarkRow, MemoryRow } from "./db";
import { getProfile, learningStats, saveProfile } from "./profile";
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

// 激活码：服务器设了激活码时，没激活的设备用不了 Agent（省模型额度）。输一次存在本机，每次请求带上
const CODE_KEY = "yz-agent-code";
const agentHeaders = (json = false): Record<string, string> => {
  const code = localStorage.getItem(CODE_KEY);
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(code ? { "X-Agent-Code": code } : {}),
  };
};

/** on：能用；off：服务器没配模型或连不上；locked：要输激活码 */
export type AgentState = "on" | "off" | "locked";
let status: Promise<AgentState> | null = null;
/** 设置页改了模型、激活成功、请求被拒时重新问一次 */
export const resetAgentStatus = () => {
  status = null;
  modelsP = null;
  dispatchEvent(new Event("yz-agent-status"));
};
export function agentState(): Promise<AgentState> {
  status ??= fetch("/api/agent/status", { headers: agentHeaders() })
    .then((r) => (r.ok ? r.json() : {}))
    .then(
      (d: {
        enabled?: boolean;
        locked?: boolean;
        activated?: boolean;
      }): AgentState =>
        !d.enabled ? "off" : d.locked && !d.activated ? "locked" : "on",
    )
    .catch((): AgentState => "off")
    .then((s) => {
      if (s === "off") setTimeout(() => (status = null), 60_000); // 没开通或离线：过一会儿再问
      return s;
    });
  return status;
}
export const agentEnabled = () => agentState().then((s) => s === "on");

export function useAgentState(): AgentState | null {
  const [s, setS] = useState<AgentState | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void agentState().then((v) => live && setS(v));
    load();
    addEventListener("yz-agent-status", load);
    return () => {
      live = false;
      removeEventListener("yz-agent-status", load);
    };
  }, []);
  return s;
}

export function useAgentEnabled(): boolean | null {
  const s = useAgentState();
  return s === null ? null : s === "on";
}

/** 激活这台设备；成功返回 null，否则返回错误提示 */
export async function activateAgent(code: string): Promise<string | null> {
  const c = code.trim();
  try {
    const r = await fetch("/api/agent/activate", {
      method: "POST",
      headers: agentHeaders(true),
      body: JSON.stringify({ code: c }),
    });
    if (r.ok) {
      localStorage.setItem(CODE_KEY, c);
      resetAgentStatus();
      return null;
    }
    return ((await r.json()) as { error?: string }).error ?? "激活码不对";
  } catch {
    return "连不上服务器";
  }
}

const profileForPrompt = async () => ({
  profile: await getProfile(),
  stats: await learningStats(),
});

async function failure(r: Response) {
  if (r.status === 403) resetAgentStatus();
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
    headers: agentHeaders(true),
    body: JSON.stringify({
      messages: trimTurns(messages),
      context,
      ...(await profileForPrompt()),
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

/** 聊完一轮：让模型按这段对话改写学习者档案，有变化就存回本机。返回档案改没改 */
export async function remember(messages: ChatMsg[]): Promise<boolean> {
  const started = Date.now();
  const profile = await getProfile();
  const r = await fetch("/api/agent/remember", {
    method: "POST",
    headers: agentHeaders(true),
    body: JSON.stringify({ messages: trimTurns(messages), profile }),
  });
  if (!r.ok) return false;
  const d = (await r.json()) as { profile?: string | null };
  // 整理期间学习者自己改过档案（或 Agent 用工具改过）：这次结果是按旧档案算的，丢掉
  if (!d.profile || d.profile.trim() === profile.trim() || editedAt >= started)
    return false;
  // 另一段对话先存了新档案：这次也是按旧档案算的，丢掉，免得把它刚记下的覆盖掉
  if ((await getProfile()).trim() !== profile.trim()) return false;
  await saveProfile(d.profile);
  return true;
}

export const MEMORY_KINDS: Record<MemoryRow["kind"], string> = {
  weak: "薄弱",
  pref: "偏好",
  fact: "情况",
  profile: "档案",
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
    modelsP ??= fetch("/api/agent/models", { headers: agentHeaders() })
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
