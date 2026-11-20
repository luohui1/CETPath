import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { getStroke } from "perfect-freehand";
import { ArrowCounterClockwise, Check, Eraser } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/*
 * 外刊上的手写：一层 SVG 盖在正文上。每一笔挂在离它最近的那个词上（坐标是相对这个词的偏移），
 * 所以切换译文两栏、窗口变宽变窄、文字重新换行时，圈和划线跟着词走。存在本机 localStorage。
 */
type Stroke = { p: number; o?: number; c: string; pts: [number, number, number][] }; // o：挂在第 p 段字符位置 o 的词上，pts 是相对它左上角的像素偏移
type Tool = string; // 颜色，或 "erase"
const COLORS = ["#2b6de5", "#d64545", "#23272f"];
const inkKey = (id: string) => `yz-article-ink:${id}`;

function svgPath(pts: number[][]) {
  const o = getStroke(pts, { size: 3.4, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure: pts.every((p) => p[2] === 0.5) });
  if (!o.length) return "";
  const d = o.reduce<(string | number)[]>((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ["M", ...o[0], "Q"]);
  return d.join(" ") + " Z";
}

export function ArticleInk({ id, box, on, onClose }: { id: string; box: RefObject<HTMLDivElement | null>; on: boolean; onClose: () => void }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<{ c: string; pts: number[][] } | null>(null);
  const [tool, setTool] = useState<Tool>(COLORS[0]);
  const [, setTick] = useState(0);
  const drawing = useRef(false);

  useEffect(() => setStrokes(JSON.parse(localStorage.getItem(inkKey(id)) || "[]")), [id]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  const save = (s: Stroke[]) => {
    setStrokes(s);
    localStorage.setItem(inkKey(id), JSON.stringify(s));
  };

  /** 每段相对正文容器的位置 */
  const paraRect = (p: number) => {
    const root = box.current;
    const el = root?.querySelector<HTMLElement>(`[data-p="${p}"]`);
    if (!root || !el) return null;
    const r = root.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return { x: e.left - r.left, y: e.top - r.top, w: e.width || 1, h: e.height || 1 };
  };
  const wordAt = (p: number, o: number) => {
    const root = box.current;
    const el = root?.querySelector<HTMLElement>(`[data-p="${p}"] .w[data-o="${o}"]`);
    if (!root || !el) return null;
    const r = root.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return { x: e.left - r.left, y: e.top - r.top };
  };
  const abs = (s: Stroke) => {
    if (s.o !== undefined) {
      const w = wordAt(s.p, s.o);
      return w ? s.pts.map(([dx, dy, pr]) => [w.x + dx, w.y + dy, pr]) : [];
    }
    const r = paraRect(s.p);
    return r ? s.pts.map(([fx, fy, pr]) => [r.x + fx * r.w, r.y + fy * r.h, pr]) : [];
  };
  const local = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pointerType === "pen" ? e.pressure : 0.5];
  };
  const erase = (x: number, y: number) => {
    const keep = strokes.filter((s) => !abs(s).some(([px, py]) => Math.hypot(px - x, py - y) < 12));
    if (keep.length !== strokes.length) save(keep);
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const pt = local(e);
    if (tool === "erase") return erase(pt[0], pt[1]);
    setLive({ c: tool, pts: [pt] });
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const pt = local(e);
    if (tool === "erase") return erase(pt[0], pt[1]);
    setLive((l) => l && { ...l, pts: [...l.pts, pt] });
  };
  const up = () => {
    drawing.current = false;
    if (!live || live.pts.length < 2) return setLive(null);
    // 落在哪一段：起笔点所在（或最近）的那段
    const root = box.current!;
    const n = root.querySelectorAll("[data-p]").length;
    let best = 0;
    let bestD = Infinity;
    const [x0, y0] = live.pts[0];
    for (let p = 0; p < n; p++) {
      const r = paraRect(p);
      if (!r) continue;
      const d = y0 < r.y ? r.y - y0 : y0 > r.y + r.h ? y0 - r.y - r.h : 0;
      if (d < bestD) [best, bestD] = [p, d];
      if (d === 0) break;
    }
    // 挂到这段里离笔迹中心最近的词上
    const cx = live.pts.reduce((a, q) => a + q[0], 0) / live.pts.length;
    const cy = live.pts.reduce((a, q) => a + q[1], 0) / live.pts.length;
    const rr = root.getBoundingClientRect();
    let o = -1;
    let ox = 0;
    let oy = 0;
    let od = Infinity;
    for (const w of root.querySelectorAll<HTMLElement>(`[data-p="${best}"] .w`)) {
      const e = w.getBoundingClientRect();
      const d = Math.hypot(e.left - rr.left + e.width / 2 - cx, e.top - rr.top + e.height / 2 - cy);
      if (d < od) [o, ox, oy, od] = [Number(w.dataset.o), e.left - rr.left, e.top - rr.top, d];
    }
    const r = paraRect(best)!;
    const stroke: Stroke =
      o >= 0
        ? { p: best, o, c: live.c, pts: live.pts.map(([x, y, pr]) => [x - ox, y - oy, pr] as [number, number, number]) }
        : { p: best, c: live.c, pts: live.pts.map(([x, y, pr]) => [(x - r.x) / r.w, (y - r.y) / r.h, pr] as [number, number, number]) };
    save([...strokes, stroke]);
    setLive(null);
    void x0;
  };

  return (
    <>
      <svg
        className="absolute inset-0 z-10 size-full overflow-visible"
        style={{ pointerEvents: on ? "auto" : "none", touchAction: on ? "none" : "auto", cursor: on ? (tool === "erase" ? "cell" : "crosshair") : undefined }}
        onPointerDown={on ? down : undefined}
        onPointerMove={on ? move : undefined}
        onPointerUp={on ? up : undefined}
        onPointerCancel={on ? up : undefined}
      >
        {strokes.map((s, i) => (
          <path key={i} d={svgPath(abs(s))} fill={s.c} opacity={0.9} />
        ))}
        {live && <path d={svgPath(live.pts)} fill={live.c} opacity={0.9} />}
      </svg>
      {on && (
        <div className="animate-pop fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--ink)]/95 p-1.5 text-white shadow-[0_10px_30px_rgba(20,30,50,0.25)] backdrop-blur">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setTool(c)} className={cn("flex size-8 items-center justify-center rounded-full transition-colors", tool === c ? "bg-white/20" : "hover:bg-white/10")} aria-label="笔">
              <span className="size-4 rounded-full ring-2 ring-white/70" style={{ background: c }} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button type="button" onClick={() => setTool("erase")} className={cn("flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px]", tool === "erase" ? "bg-white/20" : "hover:bg-white/10")}>
            <Eraser className="size-4" />
            橡皮
          </button>
          <button type="button" disabled={!strokes.length} onClick={() => save(strokes.slice(0, -1))} className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] hover:bg-white/10 disabled:opacity-40">
            <ArrowCounterClockwise className="size-4" />
            撤销
          </button>
          <button type="button" onClick={onClose} className="flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[13px] font-medium text-[var(--ink)]">
            <Check className="size-4" />
            完成
          </button>
        </div>
      )}
    </>
  );
}
