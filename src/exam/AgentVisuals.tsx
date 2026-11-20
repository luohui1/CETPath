import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/lib/agent";

/** Agent 回答里嵌的可视化：长难句结构图、解题步骤、词汇卡片（都来自工具调用的参数） */
/** 模型给的参数不一定是数组：不是就当空 */
const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const parse = <T,>(c: ToolCall): T | null => {
  try {
    return JSON.parse(c.args) as T;
  } catch {
    return null;
  }
};

type Part = {
  text: string;
  role?: string;
  level?: number;
  label?: string;
  note?: string;
};
const ROLE: Record<string, { name: string; cls: string }> = {
  subject: { name: "主语", cls: "bg-[#dbe8ff] text-[#1d4fb8]" },
  predicate: { name: "谓语", cls: "bg-[#ffe1e1] text-[#b42318]" },
  object: { name: "宾语/表语", cls: "bg-[#ddf5e3] text-[#18794e]" },
  clause: { name: "从句", cls: "bg-[#f1e6ff] text-[#6b3fb8]" },
  modifier: { name: "修饰", cls: "bg-[#fff1d6] text-[#a15c07]" },
  other: { name: "其他", cls: "bg-[var(--paper-100)] text-[var(--ink-700)]" },
};

function SentenceMap({
  data,
}: {
  data: { sentence?: string; translation?: string; parts?: Part[] };
}) {
  const [on, setOn] = useState<number | null>(null);
  const parts = arr<Part>(data.parts)
    .filter((p) => p && typeof p.text === "string")
    .map((p) => ({
      ...p,
      label: str(p.label),
      note: str(p.note),
      level: typeof p.level === "number" ? p.level : 0,
    }));
  if (!parts.length) return null;
  const cur = on != null ? parts[on] : null;
  return (
    <div className="mt-2 rounded-[12px] p-3 ring-1 ring-[var(--line)]">
      <p className="mb-2 text-[12px] font-medium text-[var(--ink-500)]">
        句子结构 · 点色块看作用
      </p>
      <div className="flex flex-wrap items-end gap-x-1 gap-y-2 font-serif text-[15px] leading-[1.5]">
        {parts.map((p, i) => {
          const r = ROLE[p.role ?? "other"] ?? ROLE.other;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOn(on === i ? null : i)}
              className={cn(
                "rounded-[6px] px-1.5 py-0.5 text-left transition",
                r.cls,
                (p.level ?? 0) > 0 && "border-b-2 border-dashed border-current",
                on === i && "ring-2 ring-[var(--blue)]",
              )}
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
      {str(data.translation) && (
        <p className="mt-2 border-t border-[var(--line-soft)] pt-2 text-[14px] leading-[1.6] text-[var(--ink-700)]">
          {data.translation}
        </p>
      )}
    </div>
  );
}

type Step = { title?: string; detail?: string; quote?: string };
function Steps({
  data,
}: {
  data: { question?: string; steps?: Step[]; answer?: string };
}) {
  const steps = arr<Step>(data.steps)
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      title: str(s.title),
      detail: str(s.detail),
      quote: str(s.quote),
    }))
    .filter((s) => s.title || s.detail);
  const [shown, setShown] = useState(1);
  if (!steps.length) return null;
  const done = shown >= steps.length;
  return (
    <div className="mt-2 rounded-[12px] p-3 ring-1 ring-[var(--line)]">
      {str(data.question) && (
        <p className="mb-2 text-[12px] font-medium text-[var(--ink-500)]">
          {data.question}
        </p>
      )}
      <ol className="space-y-2">
        {steps.slice(0, shown).map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-[var(--blue)] text-[11px] font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 text-[14px] leading-[1.6]">
              {s.title && <p className="font-semibold">{s.title}</p>}
              {s.detail && <p className="text-[var(--ink-700)]">{s.detail}</p>}
              {s.quote && (
                <p className="mt-1 border-l-[3px] border-[var(--blue-line,#bcd3f5)] pl-2 font-serif text-[14px] text-[var(--ink-700)]">
                  {s.quote}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!done ? (
        <button
          type="button"
          onClick={() => setShown(shown + 1)}
          className="mt-2 rounded-full px-3 py-1 text-[13px] font-medium text-[var(--blue)] ring-1 ring-[var(--blue-line,#bcd3f5)] hover:bg-[var(--blue-tint)]"
        >
          下一步（{shown}/{steps.length}）
        </button>
      ) : (
        str(data.answer) && (
          <p className="mt-2 rounded-[8px] bg-[var(--blue-tint)] px-2.5 py-2 text-[14px] font-semibold text-[var(--blue)]">
            {data.answer}
          </p>
        )
      )}
    </div>
  );
}

type Card = {
  front?: string;
  phonetic?: string;
  pos?: string;
  back?: string;
  here?: string;
  collocations?: string[];
  synonyms?: string[];
  example?: string;
};
/** 例句里把这个词标出来 */
function Mark({ text, word }: { text: string; word: string }) {
  const k = text.toLowerCase().indexOf(word.toLowerCase());
  if (!word || k < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, k)}
      <b className="rounded-[3px] bg-[#fff1b8] px-0.5 font-semibold text-[var(--ink)]">
        {text.slice(k, k + word.length)}
      </b>
      {text.slice(k + word.length)}
    </>
  );
}
function Cards({ data }: { data: { cards?: Card[] } }) {
  const cards = arr<Card>(data.cards)
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      front: str(c.front),
      phonetic: str(c.phonetic),
      pos: str(c.pos),
      back: str(c.back),
      here: str(c.here),
      example: str(c.example),
      collocations: arr<string>(c.collocations).filter(
        (x) => typeof x === "string",
      ),
      synonyms: arr<string>(c.synonyms).filter((x) => typeof x === "string"),
    }))
    .filter((c) => c.front);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!cards.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {cards.map((c, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(28,35,48,0.06)] ring-1 ring-[var(--line)]"
        >
          <button
            type="button"
            onClick={() => setOpen({ ...open, [i]: !open[i] })}
            className="flex w-full items-center gap-3 bg-gradient-to-r from-[#eef4ff] to-white px-3.5 py-2.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="font-serif text-[18px] font-semibold text-[var(--ink)]">
                {c.front}
              </span>
              {c.phonetic && (
                <span className="ml-2 text-[12px] text-[var(--ink-500)]">
                  {c.phonetic}
                </span>
              )}
              {c.pos && (
                <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-[var(--blue)] ring-1 ring-[var(--blue-line,#bcd3f5)]">
                  {c.pos}
                </span>
              )}
            </span>
            <span className="text-[12px] text-[var(--blue)]">
              {open[i] ? "收起" : "看释义"}
            </span>
          </button>
          {open[i] && (
            <div className="space-y-2 px-3.5 pt-2 pb-3 text-[14px] leading-[1.6]">
              {c.back && <p className="font-medium">{c.back}</p>}
              {c.here && (
                <p className="text-[13px] text-[var(--ink-700)]">
                  <span className="mr-1 rounded-[4px] bg-[#fff1d6] px-1 text-[11px] text-[#a15c07]">
                    卷面里
                  </span>
                  {c.here}
                </p>
              )}
              {c.collocations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--ink-500)]">
                    搭配
                  </span>
                  {c.collocations.map((x) => (
                    <span
                      key={x}
                      className="rounded-full bg-[var(--paper-100)] px-2 py-0.5 font-serif text-[13px]"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              )}
              {c.synonyms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--ink-500)]">
                    同义替换
                  </span>
                  {c.synonyms.map((x) => (
                    <span
                      key={x}
                      className="rounded-full bg-[#ddf5e3] px-2 py-0.5 font-serif text-[13px] text-[#18794e]"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              )}
              {c.example && (
                <p className="border-l-[3px] border-[var(--blue-line,#bcd3f5)] pl-2.5 font-serif text-[14px] text-[var(--ink-700)]">
                  <Mark text={c.example} word={c.front!.split(/\s|…/)[0]} />
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type Opt = { letter?: string; text?: string; right?: boolean; why?: string };
type Pair = { source?: string; option?: string };
function AnswerMap({
  data,
}: {
  data: {
    question?: string;
    answer?: string;
    quote?: string;
    pairs?: Pair[];
    options?: Opt[];
  };
}) {
  const pairs = arr<Pair>(data.pairs)
    .map((p) => ({ source: str(p?.source), option: str(p?.option) }))
    .filter((p) => p.source && p.option);
  const opts = arr<Opt>(data.options)
    .map((o) => ({
      letter: str(o?.letter),
      text: str(o?.text),
      right: o?.right === true,
      why: str(o?.why),
    }))
    .filter((o) => o.letter || o.text);
  const [on, setOn] = useState<string | null>(null);
  if (!str(data.quote) && !opts.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-[14px] ring-1 ring-[var(--line)]">
      <div className="flex items-center gap-2 bg-[var(--paper-100)] px-3.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {str(data.question) ?? "答案解析"}
        </span>
        {str(data.answer) && (
          <span className="rounded-full bg-[var(--blue)] px-2.5 py-0.5 text-[12px] font-semibold text-white">
            {str(data.answer)}
          </span>
        )}
      </div>
      <div className="space-y-3 px-3.5 py-3">
        {str(data.quote) && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-[var(--ink-500)]">
              ① 原文定位句
            </p>
            <p className="rounded-[8px] bg-[#f6f9ff] px-2.5 py-2 font-serif text-[14px] leading-[1.6] text-[var(--ink)]">
              {str(data.quote)}
            </p>
          </div>
        )}
        {pairs.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-[var(--ink-500)]">
              ② 原文 ⇄ 选项（同义替换）
            </p>
            <div className="space-y-1.5">
              {pairs.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[13px]"
                >
                  <span className="rounded-[6px] bg-[#dbe8ff] px-2 py-1 font-serif text-[#1d4fb8]">
                    {p.source}
                  </span>
                  <span className="text-[var(--ink-500)]">⇄</span>
                  <span className="rounded-[6px] bg-[#ddf5e3] px-2 py-1 font-serif text-[#18794e]">
                    {p.option}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {opts.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-[var(--ink-500)]">
              ③ 逐个选项 · 点开看理由
            </p>
            <div className="space-y-1">
              {opts.map((o) => (
                <button
                  key={o.letter ?? o.text}
                  type="button"
                  onClick={() =>
                    setOn(on === o.letter ? null : (o.letter ?? null))
                  }
                  className={cn(
                    "block w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] leading-[1.5] ring-1",
                    o.right
                      ? "bg-[var(--blue-tint)] ring-[var(--blue-line,#bcd3f5)]"
                      : "bg-white ring-[var(--line-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "mr-1.5 font-semibold",
                      o.right ? "text-[var(--blue)]" : "text-[var(--red)]",
                    )}
                  >
                    {o.right ? "✓" : "✗"} {o.letter}
                  </span>
                  <span className="font-serif">{o.text}</span>
                  {on === o.letter && o.why && (
                    <span className="mt-1 block text-[12px] text-[var(--ink-700)]">
                      {o.why}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const VISUAL_TOOLS = new Set([
  "show_sentence_map",
  "show_steps",
  "show_cards",
  "show_answer_map",
]);

export function AgentVisual({ call }: { call: ToolCall }) {
  if (call.name === "show_sentence_map") {
    const d = parse<{
      sentence?: string;
      translation?: string;
      parts?: Part[];
    }>(call);
    return d ? <SentenceMap data={d} /> : null;
  }
  if (call.name === "show_steps") {
    const d = parse<{ question?: string; steps?: Step[]; answer?: string }>(
      call,
    );
    return d ? <Steps data={d} /> : null;
  }
  if (call.name === "show_answer_map") {
    const d = parse<{
      question?: string;
      answer?: string;
      quote?: string;
      pairs?: Pair[];
      options?: Opt[];
    }>(call);
    return d ? <AnswerMap data={d} /> : null;
  }
  if (call.name === "show_cards") {
    const d = parse<{ cards?: Card[] }>(call);
    return d ? <Cards data={d} /> : null;
  }
  return null;
}
