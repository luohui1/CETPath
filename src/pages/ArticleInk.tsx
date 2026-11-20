import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUUpLeft, ArrowUUpRight, Check, Cursor, Eraser, Highlighter, Lasso, NoteBlank, Pen, TextUnderline, type Icon } from "@phosphor-icons/react";
import { InkLayer, type InkState } from "@/exam/InkLayer";
import { db } from "@/lib/db";
import { COLORS, colorTool, PEN_SIZES, useMarkHistory, type ColorTool, type Tool } from "@/lib/marks";
import type { PdfWord, PdfWordsPage } from "@/lib/papers";
import { cn } from "@/lib/utils";

/*
 * 外刊上的手写：直接用做题页那套笔记层（InkLayer）和工具，笔记也存在同一张表里（paperId 是 article:<id>，只有第 1 页）。
 * 正文那一栏宽度固定（680px），所以把它当成一张"卷面"：词的坐标从页面上量出来，单位就是 px。
 */
const TOOLS: { id: Tool; label: string; short?: string; Icon: Icon }[] = [
  { id: "select", label: "选择：查词", short: "选择", Icon: Cursor },
  { id: "pen", label: "手写笔", short: "笔", Icon: Pen },
  { id: "highlight", label: "高亮", short: "高亮", Icon: Highlighter },
  { id: "underline", label: "下划线", short: "划线", Icon: TextUnderline },
  { id: "note", label: "便签", short: "便签", Icon: NoteBlank },
  { id: "lasso", label: "套索", Icon: Lasso },
  { id: "eraser", label: "橡皮擦", Icon: Eraser },
];

function measure(box: HTMLElement): PdfWordsPage {
  const r = box.getBoundingClientRect();
  const w: PdfWord[] = [];
  const s: string[] = [];
  box.querySelectorAll<HTMLElement>("[data-p]").forEach((para) => {
    const si = s.length;
    s.push(para.querySelector(".w")?.parentElement?.textContent ?? "");
    para.querySelectorAll<HTMLElement>(".w").forEach((el) => {
      const e = el.getBoundingClientRect();
      w.push([el.textContent ?? "", e.left - r.left, e.top - r.top, e.right - r.left, e.bottom - r.top, si]);
    });
  });
  return { width: box.offsetWidth, height: box.offsetHeight, w, s };
}

/** hidden：开着译文时译文会把后面的段落往下挤，笔记坐标对不上，先不显示 */
export function ArticleInk({ id, box, on, hidden, onClose }: { id: string; box: RefObject<HTMLDivElement | null>; on: boolean; hidden?: boolean; onClose: () => void }) {
  const paperId = `article:${id}`;
  const [tool, setTool] = useState<Tool>("pen");
  const [colors, setColors] = useState<Record<ColorTool, string>>({ pen: COLORS.pen[0].id, highlight: COLORS.highlight[0].id });
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [data, setData] = useState<PdfWordsPage | null>(null);
  const history = useMarkHistory();
  const marks = useLiveQuery(() => db.marks.where("[paperId+page]").equals([paperId, 1]).toArray(), [paperId]) ?? [];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setData(measure(el)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  useEffect(() => {
    if (on) setTool((t) => (t === "select" ? "pen" : t));
  }, [on]);

  const lookupAt = useCallback((cx: number, cy: number) => {
    // 笔记层盖在字上面，要穿过它找到下面的词
    (document.elementsFromPoint(cx, cy).find((el) => el.classList.contains("w")) as HTMLElement | undefined)?.click();
  }, []);
  const active: Tool = on ? tool : "select";
  const ct = colorTool(active);
  const { add, remove, update, replace } = history;
  const ink = useMemo<InkState>(
    () => ({ paperId, tool: active, color: ct ? colors[ct] : "", penSize: PEN_SIZES[1].id, history: { add, remove, update, replace }, openNote, onOpenNote: setOpenNote, flash: null, wordFlash: null, lookupAt }),
    [paperId, active, ct, colors, add, remove, update, replace, openNote, lookupAt],
  );

  return (
    <>
      {data && !hidden && <InkLayer page={1} data={data} scale={1} marks={marks} ink={ink} />}
      {on && !hidden && (
        <div className="animate-pop scrollbar-none fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[14px] bg-white/95 p-1.5 font-sans shadow-[var(--elev-2),0_0_0_1px_var(--line-soft)] backdrop-blur">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} className={cn("gr-tool", tool === t.id && "gr-tool-on")}>
              <t.Icon className="size-[19px]" weight={tool === t.id ? "fill" : "duotone"} />
              {t.short && <span className="gr-tool-text hidden whitespace-nowrap sm:inline">{t.short}</span>}
            </button>
          ))}
          {ct && (
            <>
              <span className="mx-1 h-5 w-px bg-[var(--line)]" />
              {COLORS[ct].map((c) => (
                <button key={c.id} type="button" aria-label={c.label} onClick={() => setColors((x) => ({ ...x, [ct]: c.id }))} className={cn("mx-0.5 size-6 rounded-full transition", colors[ct] === c.id ? "ring-2 ring-[var(--blue)] ring-offset-2" : "hover:scale-110")} style={{ background: c.value }} />
              ))}
            </>
          )}
          <span className="mx-1 h-5 w-px bg-[var(--line)]" />
          <button type="button" title="撤销" aria-label="撤销" disabled={!history.canUndo} onClick={() => void history.undo()} className="gr-tool">
            <ArrowUUpLeft className="size-[19px]" />
          </button>
          <button type="button" title="重做" aria-label="重做" disabled={!history.canRedo} onClick={() => void history.redo()} className="gr-tool">
            <ArrowUUpRight className="size-[19px]" />
          </button>
          <button type="button" onClick={onClose} className="ml-1 flex h-8 items-center gap-1 rounded-[10px] bg-[var(--blue)] px-3 text-[13px] font-medium text-white">
            <Check className="size-4" />
            完成
          </button>
        </div>
      )}
    </>
  );
}
