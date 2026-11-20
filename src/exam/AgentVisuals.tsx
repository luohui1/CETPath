import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/lib/agent";

/** Agent 回答里嵌的可视化：长难句结构图、解题步骤、词汇卡片（都来自工具调用的参数） */
const parse = <T,>(c: ToolCall): T | null => {
  try {
    return JSON.parse(c.args) as T;
  } catch {
    return null;
  }
};

type Part = { text: string; role?: string; level?: number; label?: string; note?: string };
const ROLE: Record<string, { name: string; cls: string }> = {
  subject: { name: "主语", cls: "bg-[#dbe8ff] text-[#1d4fb8]" },
  predicate: { name: "谓语", cls: "bg-[#ffe1e1] text-[#b42318]" },
  object: { name: "宾语/表语", cls: "bg-[#ddf5e3] text-[#18794e]" },
  clause: { name: "从句", cls: "bg-[#f1e6ff] text-[#6b3fb8]" },
  modifier: { name: "修饰", cls: "bg-[#fff1d6] text-[#a15c07]" },
  other: { name: "其他", cls: "bg-[var(--paper-100)] text-[var(--ink-700)]" },
};

function SentenceMap({ data }: { data: { sentence?: string; translation?: string; parts?: Part[] } }) {
  const [on, setOn] = useState<number | null>(null);
  const parts = (data.parts ?? []).filter((p) => p && typeof p.text === "string");
  if (!parts.length) return null;
  const cur = on != null ? parts[on] : null;
  return (
    <div className="mt-2 rounded-[12px] p-3 ring-1 ring-[var(--line)]">
      <p className="mb-2 text-[12px] font-medium text-[var(--ink-500)]">句子结构 · 点色块看作用</p>
      <div className="flex flex-wrap items-end gap-x-1 gap-y-2 font-serif text-[15px] leading-[1.5]">
        {parts.map((p, i) => {
          const r = ROLE[p.role ?? "other"] ?? ROLE.other;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOn(on === i ? null : i)}
              className={cn("rounded-[6px] px-1.5 py-0.5 text-left transition", r.cls, (p.level ?? 0) > 0 && "border-b-2 border-dashed border-current", on === i && "ring-2 ring-[var(--blue)]")}
              style={{ marginTop: (p.level ?? 0) * 6 }}
            >
              {p.text}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--ink-500)]">
        {Object.entries(ROLE)
          .filter(([k]) => parts.some((p) => (p.role ?? "other") === k))
          .map(([k, r]) => (
            <span key={k} className="flex items-center gap-1">
              <span className={cn("size-2.5 rounded-[3px]", r.cls)} />
              {r.name}
            </span>
          ))}
      </div>
      {cur && (
        <p className="mt-2 rounded-[8px] bg-[var(--paper-100)] px-2.5 py-2 text-[13px] leading-[1.6]">
          <b>{cur.label || ROLE[cur.role ?? "other"]?.name}</b>
          {cur.note ? ` · ${cur.note}` : ""}
        </p>
      )}
      {data.translation && <p className="mt-2 border-t border-[var(--line-soft)] pt-2 text-[14px] leading-[1.6] text-[var(--ink-700)]">{data.translation}</p>}
    </div>
  );
}

type Step = { title?: string; detail?: string; quote?: string };
function Steps({ data }: { data: { question?: string; steps?: Step[]; answer?: string } }) {
  const steps = (data.steps ?? []).filter((s) => s && (s.title || s.detail));
  const [shown, setShown] = useState(1);
  if (!steps.length) return null;
  const done = shown >= steps.length;
  return (
    <div className="mt-2 rounded-[12px] p-3 ring-1 ring-[var(--line)]">
      {data.question && <p className="mb-2 text-[12px] font-medium text-[var(--ink-500)]">{data.question}</p>}
      <ol className="space-y-2">
        {steps.slice(0, shown).map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-[var(--blue)] text-[11px] font-semibold text-white">{i + 1}</span>
            <div className="min-w-0 flex-1 text-[14px] leading-[1.6]">
              {s.title && <p className="font-semibold">{s.title}</p>}
              {s.detail && <p className="text-[var(--ink-700)]">{s.detail}</p>}
              {s.quote && <p className="mt-1 border-l-[3px] border-[var(--blue-line,#bcd3f5)] pl-2 font-serif text-[14px] text-[var(--ink-700)]">{s.quote}</p>}
            </div>
          </li>
        ))}
      </ol>
      {!done ? (
        <button type="button" onClick={() => setShown(shown + 1)} className="mt-2 rounded-full px-3 py-1 text-[13px] font-medium text-[var(--blue)] ring-1 ring-[var(--blue-line,#bcd3f5)] hover:bg-[var(--blue-tint)]">
          下一步（{shown}/{steps.length}）
        </button>
      ) : (
        data.answer && <p className="mt-2 rounded-[8px] bg-[var(--blue-tint)] px-2.5 py-2 text-[14px] font-semibold text-[var(--blue)]">{data.answer}</p>
      )}
    </div>
  );
}

type Card = { front?: string; phonetic?: string; back?: string; example?: string };
function Cards({ data }: { data: { cards?: Card[] } }) {
  const cards = (data.cards ?? []).filter((c) => c && c.front);
  const [flip, setFlip] = useState<Record<number, boolean>>({});
  if (!cards.length) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {cards.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setFlip({ ...flip, [i]: !flip[i] })}
          className={cn("min-h-[88px] rounded-[12px] p-3 text-left ring-1 transition", flip[i] ? "bg-[var(--blue-tint)] ring-[var(--blue-line,#bcd3f5)]" : "bg-white ring-[var(--line)] hover:ring-[var(--blue-line,#bcd3f5)]")}
        >
          {!flip[i] ? (
            <>
              <p className="font-serif text-[17px] font-semibold">{c.front}</p>
              {c.phonetic && <p className="text-[12px] text-[var(--ink-500)]">{c.phonetic}</p>}
              <p className="mt-2 text-[11px] text-[var(--ink-500)]">点一下翻面</p>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-[1.5] font-medium">{c.back}</p>
              {c.example && <p className="mt-1.5 font-serif text-[13px] leading-[1.5] text-[var(--ink-700)]">{c.example}</p>}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

export const VISUAL_TOOLS = new Set(["show_sentence_map", "show_steps", "show_cards"]);

export function AgentVisual({ call }: { call: ToolCall }) {
  if (call.name === "show_sentence_map") {
    const d = parse<{ sentence?: string; translation?: string; parts?: Part[] }>(call);
    return d ? <SentenceMap data={d} /> : null;
  }
  if (call.name === "show_steps") {
    const d = parse<{ question?: string; steps?: Step[]; answer?: string }>(call);
    return d ? <Steps data={d} /> : null;
  }
  if (call.name === "show_cards") {
    const d = parse<{ cards?: Card[] }>(call);
    return d ? <Cards data={d} /> : null;
  }
  return null;
}
