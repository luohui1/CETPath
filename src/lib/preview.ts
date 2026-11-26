/**
 * 预览版（npm run build:preview，纯静态托管，没有后台）：
 * 页面里所有 /api/ 请求在浏览器里就地处理。Agent 用学习者自己在设置里填的 OpenAI 兼容接口，
 * 浏览器直接调（Key 只存在本机）；没填就回一段演示回答。系统提示词和工具定义构建时从 server/agent_server.py 导出。
 */
export const IS_PREVIEW = import.meta.env.VITE_PREVIEW === "1";

export type PreviewModel = { base_url: string; api_key: string; model: string };
export const PREVIEW_MODEL_KEY = "yz-preview-model";
const CFG_KEY = PREVIEW_MODEL_KEY;
export const DEMO_MODEL = "演示回答";
/** 正式版模型下拉里"自己的模型"那一项 */
export const ownModelName = (c: PreviewModel) => `自定义 · ${c.model}`;
const PICK_KEY = "yz-agent-model"; // 和 agent.ts 的 MODEL_KEY 一致

export function previewModel(): PreviewModel | null {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "null") as PreviewModel | null;
    return c?.base_url && c.api_key && c.model ? c : null;
  } catch {
    return null;
  }
}
export const savePreviewModel = (c: PreviewModel | null) => (c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY));

type Prompts = { system: string; longGuide: string; cetGuides: Record<string, string>; cetWords: [string, string][]; remember: string; tools: unknown[] };
let promptsP: Promise<Prompts> | null = null;
const prompts = () => {
  promptsP ??= fetch("/agent-prompts.json").then((r) => {
    if (!r.ok) throw new Error("预览版缺少 Agent 提示词文件");
    return r.json() as Promise<Prompts>;
  });
  promptsP.catch(() => (promptsP = null));
  return promptsP;
};

const json = (status: number, d: unknown) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function today() {
  const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60_000);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

type Ctx = Record<string, unknown>;
type Turn = { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string };

// 下面几段照搬 server/agent_server.py 的同名函数：拼给模型的上下文要和线上一致
function profileBlock(d: Ctx) {
  const parts: string[] = [];
  if (typeof d.profile === "string" && d.profile.trim()) parts.push("### 学习者档案（长期记忆）\n" + d.profile.slice(0, 3000));
  if (typeof d.stats === "string" && d.stats.trim()) parts.push("### 学习数据（应用自动统计）\n" + d.stats.slice(0, 1500));
  return parts.join("\n\n") || "（还不了解这位学习者）";
}

function cetKind(last: string, ctx: Ctx, words: [string, string][]): string | null {
  if (ctx.article || !/四级|六级/.test(String(ctx.paper ?? ""))) return null;
  const view = String(ctx.view ?? "");
  const sec = view.match(/（(听力|选词填空|长篇阅读|仔细阅读|阅读理解|写作|翻译)）/);
  const num = /第\s*(\d{1,2})\s*题/;
  if (!num.test(last) && !words.some(([, p]) => new RegExp(p).test(last)) && sec)
    return ({ 听力: "listening", 选词填空: "banked", 长篇阅读: "matching", 仔细阅读: "careful", 阅读理解: "careful", 写作: "writing", 翻译: "translation" } as Record<string, string>)[sec[1]];
  for (const src of [last, view]) {
    const m = src.match(num);
    if (!m) {
      const hit = words.find(([, p]) => new RegExp(p).test(src));
      if (hit) return hit[0];
      continue;
    }
    const n = Number(m[1]);
    return n <= 25 ? "listening" : n <= 35 ? "banked" : n <= 45 ? "matching" : n <= 55 ? "careful" : null;
  }
  return null;
}

function contextBlock(ctx: Ctx) {
  const p: string[] = [];
  if (ctx.article) {
    p.push(`学习者在读一篇外刊：${s(ctx.paper, 200)}（${s(ctx.article, 300)}）。这不是考试卷，没有作答记录，别提复盘和错题。按四六级阅读的角度讲：长难句、同义替换、话题词汇；让出题就按四六级阅读题型（仔细阅读单选、段落匹配、选词填空）用 show_quiz 出。`);
    if (ctx.paperText) p.push("文章原文（标题在第一行）：\n" + s(ctx.paperText, 30000));
    if (ctx.sentence) p.push(`正在看的句子：${s(ctx.sentence, 1200)}`);
    if (ctx.word) p.push(`他点的词：${s(ctx.word, 60)}`);
    return p.join("\n");
  }
  if (ctx.paper) {
    const title = s(ctx.paper, 80);
    p.push(`试卷：${title}`);
    if (/四级|六级/.test(title)) p.push("这是大学英语四六级（CET）的卷子：只从四六级的角度讲，不要提考研。");
    else if (title.includes("考研")) p.push("这是考研英语的卷子：从考研的角度讲。");
  }
  if (ctx.sentence) p.push(`正在看的句子：${s(ctx.sentence, 1200)}`);
  if (ctx.question && !ctx.sentence) p.push("这次不是针对某个句子，是一般的备考问题。");
  if (ctx.review && ctx.reviewReady === false) p.push("学习者正在做这套卷，还没交卷。下面是作答进度；他问到具体题目时照常直接解答：\n" + s(ctx.review, 2000));
  else if (ctx.review) p.push("这次是做完一套题后的复盘。作答数据（错题、没答和超时的题逐条列出）：\n" + s(ctx.review, 9000));
  if (ctx.view) p.push("学习者此刻在卷面上的位置：" + s(ctx.view, 300));
  if (ctx.marks) p.push("学习者在卷面上的标注（高亮、划线、便签）：\n" + s(ctx.marks, 3000));
  if (ctx.ink) p.push("学习者的手写笔记（已从笔迹识别成文字，可能有个别字认错）。先读懂它们：他圈了哪些词、写了什么释义、可能卡在哪；被问到笔记时归纳成几条要点，别逐条照念：\n" + s(ctx.ink, 3000));
  if (ctx.paperText)
    p.push("这套卷的原文（按页，从卷面文字层取；扫描卷可能有个别识别错字，按上下文理解）。问到某题时直接从这里找题目、选项和文章。每句一行，文章正文按卷面分好了段，标着〔第 N 段〕（每篇从 1 数，跨页接着数）；说“第几段”“第几句”、引用原文时都按这里的分段和分句来，别自己重新数：\n" + s(ctx.paperText, 40000));
  if (ctx.word) p.push(`他点的词：${s(ctx.word, 60)}`);
  if (ctx.syntax) p.push(`这句已有的结构解析（可参考，有错可以纠正）：${JSON.stringify(ctx.syntax).slice(0, 2000)}`);
  return p.join("\n");
}

type InCall = { id?: unknown; name?: unknown; args?: unknown };
function cleanTurns(msgs: unknown): Turn[] {
  const out: Turn[] = [];
  for (const m of Array.isArray(msgs) ? (msgs as Record<string, unknown>[]) : []) {
    if (!m || typeof m.content !== "string") continue;
    if (m.role === "user") out.push({ role: "user", content: m.content.slice(0, 4000) });
    else if (m.role === "assistant") {
      const calls = ((m.tool_calls as InCall[] | undefined) ?? []).filter((c) => typeof c?.id === "string" && typeof c.name === "string");
      out.push({
        role: "assistant",
        content: m.content.slice(0, 4000),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: String(c.args || "{}").slice(0, 6000) } })) } : {}),
      });
    } else if (m.role === "tool" && typeof m.tool_call_id === "string") out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content.slice(0, 4000) });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function upstream(c: PreviewModel, body: Record<string, unknown>, signal?: AbortSignal | null) {
  let r: Response;
  try {
    r = await fetch(c.base_url.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.api_key}` },
      body: JSON.stringify({ model: c.model, ...body }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("连不上你填的接口：检查接口地址；也可能是这家接口不允许网页直接调用");
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let msg = t.slice(0, 200);
    try {
      const d = JSON.parse(t) as { error?: { message?: string } | string };
      msg = (typeof d.error === "string" ? d.error : d.error?.message) || msg;
    } catch {
      /* 不是 JSON */
    }
    throw new Error(r.status === 401 ? "API Key 不对" : `模型接口出错（${r.status}）${msg ? "：" + msg : ""}`);
  }
  return r;
}

const sse = (d: unknown) => `data: ${typeof d === "string" ? d : JSON.stringify(d)}\n\n`;
const streamOf = (run: (push: (d: unknown) => void) => Promise<void>) => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        const push = (d: unknown) => ctrl.enqueue(enc.encode(sse(d)));
        try {
          await run(push);
        } catch (e) {
          // 学习者点了停止：让读流的一端也收到 AbortError，恢复问题而不是把半截回答存成完整的
          if ((e as Error).name === "AbortError") return ctrl.error(e);
          push({ error: (e as Error).message });
        }
        push("[DONE]");
        ctrl.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};

const DEMO = `这是**预览版的演示回答**，还没有接上真实模型。

要让 Agent 真正讲题：打开 **设置 → Agent 模型**，填上你自己的接口地址、API Key 和模型名（DeepSeek、硅基流动、通义千问、OpenRouter 这类 OpenAI 兼容接口都行）。Key 只存在这台设备的浏览器里，由浏览器直接发给你填的接口。

接上以后，Agent 能看到这套卷的原文、你的作答和用时、卷面笔记，按「解释题目 → 定位思路 → 定位句及解释 → 解题和排除」讲题，也能画句子结构图、查词、往生词本里加词。`;

async function chat(data: Ctx, signal?: AbortSignal | null) {
  const c = previewModel();
  if (!c)
    return streamOf(async (push) => {
      for (const piece of DEMO.match(/[\s\S]{1,6}/g) ?? []) {
        signal?.throwIfAborted();
        push({ t: piece });
        await new Promise((r) => setTimeout(r, 18));
      }
    });
  const pr = await prompts();
  const turns = cleanTurns(data.messages);
  if (!turns.length || !["user", "tool"].includes(turns[turns.length - 1].role)) return json(400, { error: "没有问题" });
  const ctx = (data.context && typeof data.context === "object" ? data.context : {}) as Ctx;
  const last = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  let sys = pr.system + `\n\n今天是 ${today()}。` + "\n\n## 关于这位学习者\n" + profileBlock(data);
  if (ctx.sentence || /长难句|句子|这句|主干|结构|拆解|从句/.test(last)) sys += pr.longGuide;
  const kind = cetKind(last, ctx, pr.cetWords);
  if (kind) sys += "\n\n## 这类题怎么讲（名师方法，照这个思路讲，但不要提出处；回答格式仍按上面的要求，简短）\n" + pr.cetGuides[kind];
  const cb = contextBlock(ctx);
  if (cb) sys += "\n\n" + cb;
  let r: Response;
  try {
    r = await upstream(c, { messages: [{ role: "system", content: sys }, ...turns], stream: true, max_tokens: 8000, ...(data.tools ? { tools: pr.tools } : {}) }, signal);
  } catch (e) {
    return json(502, { error: (e as Error).message });
  }
  return streamOf(async (push) => {
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let d: { content?: string; reasoning_content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
        try {
          d = JSON.parse(payload).choices?.[0]?.delta ?? {};
        } catch {
          continue;
        }
        if (d.reasoning_content) push({ think: d.reasoning_content });
        for (const tc of d.tool_calls ?? []) {
          const k = tc.index ?? 0;
          const x = calls.get(k) ?? { id: "", name: "", args: "" };
          x.id = tc.id || x.id;
          x.name = x.name || tc.function?.name || "";
          x.args += tc.function?.arguments ?? "";
          calls.set(k, x);
        }
        if (d.content) push({ t: d.content });
      }
    }
    const out = [...calls.entries()].sort((a, b) => a[0] - b[0]).filter(([, x]) => x.name).map(([k, x]) => ({ id: x.id || `call_${k}`, name: x.name, args: x.args || "{}" }));
    if (out.length) push({ calls: out });
  });
}

async function complete(c: PreviewModel, messages: unknown[], max_tokens: number, temperature: number) {
  const r = await upstream(c, { messages, stream: false, max_tokens, temperature });
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return (d.choices?.[0]?.message?.content ?? "").trim();
}

/** 设置页"测试连接" */
export async function testPreviewModel(c: PreviewModel): Promise<string> {
  return complete(c, [{ role: "user", content: "用一句中文回答：你是什么模型？" }], 60, 0);
}

async function handle(path: string, body: Ctx, signal?: AbortSignal | null): Promise<Response> {
  const c = previewModel();
  switch (path) {
    case "/api/agent/status":
      return json(200, { enabled: true, locked: false, activated: true });
    case "/api/agent/models":
      return json(200, c ? { models: [c.model], default: c.model } : { models: [DEMO_MODEL], default: DEMO_MODEL });
    case "/api/agent/chat":
      return chat(body, signal);
    case "/api/agent/sent": {
      const sent = s(body.sentence, 800).trim();
      if (!c || !sent) return json(503, { error: "预览版没接模型" });
      try {
        return json(200, { zh: (await complete(c, [{ role: "user", content: "把下面这句英语考试原文翻成通顺的中文，只输出译文：\n" + sent }], 600, 0.2)).slice(0, 600) });
      } catch (e) {
        return json(502, { error: (e as Error).message });
      }
    }
    case "/api/agent/remember": {
      const turns = cleanTurns(body.messages);
      if (!c || !turns.length) return json(200, { profile: null });
      const pr = await prompts();
      const convo = turns.filter((t) => (t.role === "user" || t.role === "assistant") && t.content).map((t) => `${t.role === "user" ? "学习者" : "助教"}：${t.content.slice(0, 1500)}`).join("\n");
      try {
        const text = (await complete(c, [{ role: "system", content: pr.remember + `\n今天是 ${today()}，写日期时用完整年份。` }, { role: "user", content: `现在的档案：\n${s(body.profile, 3000) || "（空的）"}\n\n对话：\n${convo}` }], 1600, 0)).replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim();
        return json(200, { profile: !text || text.toUpperCase().startsWith("NOCHANGE") ? null : text.slice(0, 4000) });
      } catch (e) {
        return json(502, { error: (e as Error).message });
      }
    }
    case "/api/auth/me":
      return json(401, { error: "预览版没有账号" });
  }
  return json(503, { error: "预览版没有这项服务" });
}

/** 预览版启动时调用：接管同源的 /api/ 请求，默认按"先不登录"进入应用 */
export function installPreview() {
  document.documentElement.classList.add("yz-preview");
  localStorage.setItem("yz-guest", "1");
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/")) return orig(input, init);
    let body: Ctx = {};
    try {
      body = init?.body && typeof init.body === "string" ? (JSON.parse(init.body) as Ctx) : {};
    } catch {
      /* 不是 JSON */
    }
    return handle(u.pathname, body, init?.signal);
  };
}

/**
 * 正式版：学习者在设置里填了自己的 OpenAI 兼容接口时，模型下拉多一项"自定义 · 模型名"。
 * 选了它（或服务器没开 Agent、要激活码）就在浏览器里直接调他自己的接口；否则照旧走服务器。
 */
export function installOwnModel() {
  const orig = window.fetch.bind(window);
  let server: Promise<boolean> | null = null;
  const probe = (init?: RequestInit) =>
    (server ??= orig("/api/agent/status", { headers: init?.headers })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { enabled?: boolean; locked?: boolean; activated?: boolean }) => !!d.enabled && !(d.locked && !d.activated))
      .catch(() => false));
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = previewModel();
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!c || u.origin !== location.origin || !u.pathname.startsWith("/api/agent/")) return orig(input, init);
    const own = ownModelName(c);
    switch (u.pathname) {
      case "/api/agent/status":
        server = null;
        await probe(init);
        return json(200, { enabled: true, locked: false, activated: true });
      case "/api/agent/models": {
        if (!(await probe(init))) return json(200, { models: [own], default: own });
        type M = { models?: string[]; default?: string };
        const d: M = await orig(input, init)
          .then((r) => (r.ok ? (r.json() as Promise<M>) : {}))
          .catch(() => ({}));
        const list = (d.models?.length ? d.models : d.default ? [d.default] : []).filter((m) => m !== own);
        return json(200, { models: [...list, own], default: d.default || list[0] || own });
      }
      case "/api/agent/chat":
      case "/api/agent/remember":
      case "/api/agent/sent": {
        let body: Ctx = {};
        try {
          body = init?.body && typeof init.body === "string" ? (JSON.parse(init.body) as Ctx) : {};
        } catch {
          /* 不是 JSON */
        }
        if (localStorage.getItem(PICK_KEY) === own || !(await probe(init))) return handle(u.pathname, body, init?.signal);
      }
    }
    return orig(input, init);
  };
}
