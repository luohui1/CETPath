import type { ReactNode } from "react";

/*
 * AI 回答的轻量 Markdown：### 小标题、- / 1. 列表、> 引用（例句）、**重点**、`英文片段`、「英文片段」。
 * 只认这几种，其余原样当文字（不解析 HTML），流式输出到一半的不完整标记也照常显示。
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|「[^」\n]+」)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**"))
      out.push(
        <strong key={k} className="font-semibold text-[var(--ink)] [background:linear-gradient(transparent_62%,color-mix(in_oklab,var(--yellow,#f5c542)_45%,transparent)_62%)]">
          {t.slice(2, -2)}
        </strong>,
      );
    else if (t.startsWith("`"))
      out.push(
        <code key={k} className="rounded-[5px] bg-[var(--blue-tint)] px-1 py-px font-serif text-[0.95em] text-[var(--blue)]">
          {t.slice(1, -1)}
        </code>,
      );
    else
      out.push(
        <span key={k} className="font-serif text-[var(--blue)]">
          「{t.slice(1, -1)}」
        </span>,
      );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "h" | "p" | "quote"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const prev = out.at(-1);
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      out.push({ kind: "p", text: "" });
    } else if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) {
      out.push({ kind: "h", text: m[1] });
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      if (prev?.kind === "ul") prev.items.push(m[1]);
      else out.push({ kind: "ul", items: [m[1]] });
    } else if ((m = line.match(/^\s*\d+[.)、]\s*(.*)$/))) {
      if (prev?.kind === "ol") prev.items.push(m[1]);
      else out.push({ kind: "ol", items: [m[1]] });
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      if (prev?.kind === "quote") prev.text += "\n" + m[1];
      else out.push({ kind: "quote", text: m[1] });
    } else if (prev?.kind === "p" && prev.text) {
      prev.text += "\n" + line;
    } else {
      out.push({ kind: "p", text: line });
    }
  }
  return out.filter((b) => b.kind !== "p" || b.text);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-[15px] leading-[1.75] text-[var(--ink-700)]">
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h")
          return (
            <h4 key={k} className="flex items-center gap-2 pt-1 text-[15px] font-semibold text-[var(--ink)] before:h-3.5 before:w-[3px] before:rounded-full before:bg-[var(--blue)]">
              {inline(b.text.replace(/\*\*/g, ""), k)}
            </h4>
          );
        if (b.kind === "quote")
          return (
            <blockquote key={k} className="rounded-r-[8px] border-l-[3px] border-[var(--blue)] bg-[var(--paper-100)] px-3 py-2 font-serif whitespace-pre-wrap text-[var(--ink)]">
              {inline(b.text, k)}
            </blockquote>
          );
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind;
          return (
            <List key={k} className={b.kind === "ul" ? "list-disc space-y-1 pl-5 marker:text-[var(--blue)]" : "list-decimal space-y-1 pl-5 marker:font-semibold marker:text-[var(--blue)]"}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={k} className="whitespace-pre-wrap">
            {inline(b.text, k)}
          </p>
        );
      })}
    </div>
  );
}
