import { useCallback, useMemo, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { db, type MarkRow } from "./db";
import type { PdfWord } from "./papers";

export type { MarkRow };
export type Tool = "select" | "pen" | "highlight" | "underline" | "note" | "eraser" | "lasso";
export type Rect = [number, number, number, number];

/** 各工具可选的颜色。高亮用浅色叠在字上（正片叠底），笔和下划线用深色 */
export const COLORS = {
  pen: [
    { id: "red", label: "红", value: "#d0342c" },
    { id: "blue", label: "蓝", value: "#1559c4" },
    { id: "ink", label: "黑", value: "#1f2a3d" },
  ],
  highlight: [
    { id: "yellow", label: "黄", value: "#ffe066" },
    { id: "green", label: "绿", value: "#9fe0a0" },
    { id: "pink", label: "粉", value: "#ffb0cc" },
    { id: "sky", label: "蓝", value: "#a8cdfb" },
  ],
} as const;

export type ColorTool = keyof typeof COLORS;
/** 下划线和笔共用一套颜色 */
export const colorTool = (tool: Tool): ColorTool | null => (tool === "pen" || tool === "underline" ? "pen" : tool === "highlight" ? "highlight" : null);

export function colorValue(id: string) {
  for (const list of Object.values(COLORS)) for (const c of list) if (c.id === id) return c.value;
  return COLORS.pen[0].value;
}

export const PEN_SIZES = [
  { id: 1.1, label: "细" },
  { id: 1.8, label: "中" },
  { id: 3, label: "粗" },
] as const;

export const NOTE_COLOR = "#f2b632";
/** 荧光笔不从字上起笔时画的自由色带有多宽（PDF 点） */
export const MARKER_SIZE = 9;
/** 按住不动多久拉成直线 */
export const HOLD_MS = 300;

/** 手写笔迹的轮廓多边形（perfect-freehand） */
export function strokeOutline(points: number[][], size: number, pressure: boolean, last = true) {
  return getStroke(points, { size, thinning: pressure ? 0.6 : 0.45, smoothing: 0.55, streamline: 0.4, simulatePressure: !pressure, last });
}

/** 手写笔迹的轮廓路径（perfect-freehand 算出的多边形） */
export function strokePath(points: number[][], size: number, pressure: boolean, last = true) {
  const outline = strokeOutline(points, size, pressure, last);
  if (outline.length < 2) return "";
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(2);
  let d = `M${outline[0][0].toFixed(2)},${outline[0][1].toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${x0.toFixed(2)},${y0.toFixed(2)} ${avg(x0, x1)},${avg(y0, y1)} `;
  }
  return d + "Z";
}

/**
 * 点所在（或最近）的单词序号；离所有词都太远时返回 -1。
 * 先比横向距离（点在词上是 0）；上下两行的框都够得着时（框偏高、加上行间空隙会重叠），取竖直中心离点最近的那行——
 * 以前取排在前面的上一行，手指点下一行的词常查成上一行的
 */
export function wordAt(words: PdfWord[], x: number, y: number) {
  let best = -1;
  let bestD = 14; // 超过 14pt 不算
  let bestV = Infinity;
  for (let i = 0; i < words.length; i++) {
    const [, x0, y0, x1, y1] = words[i];
    const pad = (y1 - y0) * 0.35; // 行间空隙也算这一行
    if (y < y0 - pad || y > y1 + pad) continue;
    const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const v = Math.abs(y - (y0 + y1) / 2);
    if (d < bestD - 0.5 || (d <= bestD + 0.5 && v < bestV)) {
      bestD = Math.min(d, bestD);
      bestV = v;
      best = i;
    }
  }
  return best;
}

/**
 * 荧光笔、下划线用：点所在的词；不在任何词上时，取离这一点最近的那一行里最近的词。
 * 离所有词都超过 limit（PDF 点）时返回 -1
 */
export function nearWord(words: PdfWord[], x: number, y: number, limit = 40) {
  const hit = wordAt(words, x, y);
  if (hit >= 0) return hit;
  let line = -1;
  let lineD = limit;
  for (let i = 0; i < words.length; i++) {
    const [, , y0, , y1] = words[i];
    const d = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    if (d < lineD) {
      lineD = d;
      line = i;
    }
  }
  if (line < 0) return -1;
  const ly = words[line][2];
  let best = line;
  let bestD = Infinity;
  for (let i = 0; i < words.length; i++) {
    const [, x0, y0, x1] = words[i];
    if (Math.abs(y0 - ly) >= 3) continue;
    const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 下划线画在哪：词的基线（框底往上约两成）下面一点 */
export const underlineY = (r: Rect) => r[3] - (r[3] - r[1]) * 0.18 + 1.4;

/** 选中从 a 到 b 的单词（阅读顺序上的整词）：同一行连着的词合成一个框，返回框和原文 */
export function wordRange(words: PdfWord[], a: number, b: number): { rects: Rect[]; text: string } {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const rects: Rect[] = [];
  const text: string[] = [];
  for (let i = lo; i <= hi; i++) {
    const [t, x0, y0, x1, y1] = words[i];
    text.push(t);
    const r = rects[rects.length - 1];
    // 同一行、紧挨着才合并；同一行隔着一大段空白（分栏的选项）另起一个框，不把空白也涂上
    if (r && Math.abs(r[1] - y0) < 3 && x0 >= r[0] && x0 - r[2] < Math.max(8, (y1 - y0) * 1.2)) {
      r[2] = Math.max(r[2], x1);
      r[3] = Math.max(r[3], y1);
    } else rects.push([x0, y0, x1, y1]);
  }
  return { rects: rects.map((r) => r.map((v) => +v.toFixed(1)) as Rect), text: text.join(" ") };
}

/** 一条笔记在页面上占的范围，用来跳转和闪烁提示 */
export function markBounds(m: MarkRow): Rect {
  if (m.rects?.length) return [Math.min(...m.rects.map((r) => r[0])), Math.min(...m.rects.map((r) => r[1])), Math.max(...m.rects.map((r) => r[2])), Math.max(...m.rects.map((r) => r[3]))];
  if (m.points?.length) {
    const xs = m.points.map((p) => p[0]);
    const ys = m.points.map((p) => p[1]);
    // 荧光笔色带有宽度，算进去
    const pad = m.kind === "highlight" ? (m.size ?? MARKER_SIZE) / 2 : 0;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  }
  const [x, y] = m.at ?? [0, 0];
  return [x - 8, y - 8, x + 8, y + 8];
}

/** 荧光笔画的色带（不是贴着单词的高亮框）：自由笔迹或拉直的直线 */
export const isMarker = (m: MarkRow) => m.kind === "highlight" && !m.rects?.length && !!m.points?.length;

/** 整条笔记挪动 (dx, dy)（套索拖动、便签拖动） */
export function moveMark(m: MarkRow, dx: number, dy: number): MarkRow {
  const r1 = (v: number) => +v.toFixed(1);
  return {
    ...m,
    ...(m.points && { points: m.points.map(([x, y, p]) => [r1(x + dx), r1(y + dy), p] as [number, number, number]) }),
    ...(m.rects && { rects: m.rects.map(([x0, y0, x1, y1]) => [r1(x0 + dx), r1(y0 + dy), r1(x1 + dx), r1(y1 + dy)] as Rect) }),
    ...(m.at && { at: [r1(m.at[0] + dx), r1(m.at[1] + dy)] as [number, number] }),
  };
}

/** 点是否在多边形里（套索） */
export function inPolygon(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 套索圈住的笔记：包围盒的中心在圈里，或者包围盒四个角有一半以上在圈里 */
export function lassoHits(marks: MarkRow[], poly: number[][]) {
  return marks.filter((m) => {
    const [x0, y0, x1, y1] = markBounds(m);
    if (inPolygon((x0 + x1) / 2, (y0 + y1) / 2, poly)) return true;
    return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].filter(([x, y]) => inPolygon(x, y, poly)).length >= 2;
  });
}

/** 一串笔记合起来的范围 */
export function unionBounds(marks: MarkRow[]): Rect | null {
  if (!marks.length) return null;
  const bs = marks.map(markBounds);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

/** 橡皮擦：点 (x, y) 碰到的笔记 */
export function hitMark(m: MarkRow, x: number, y: number, r: number) {
  if (m.kind === "pen" || isMarker(m)) {
    const reach = r + (m.size ?? 2) / 2;
    const pts = m.points ?? [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[Math.min(i + 1, pts.length - 1)];
      if (distToSegment(x, y, ax, ay, bx, by) <= reach) return true;
    }
    return false;
  }
  if (m.kind === "note") {
    const [ax, ay] = m.at ?? [0, 0];
    return Math.hypot(x - ax, y - ay) <= r + 8;
  }
  return (m.rects ?? []).some(([x0, y0, x1, y1]) => x >= x0 - r && x <= x1 + r && y >= y0 - r && y <= y1 + r + (m.kind === "underline" ? 3 : 0));
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 笔记 id。crypto.randomUUID 只在 https 或 localhost 下可用，平板通过局域网 http 打开时退回随机串 */
const uid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export function newMark(paperId: string, page: number, fields: Omit<MarkRow, "id" | "paperId" | "page" | "createdAt" | "updatedAt">): MarkRow {
  const now = Date.now();
  return { id: uid(), paperId, page, createdAt: now, updatedAt: now, ...fields };
}

type Action = { undo: () => Promise<unknown>; redo: () => Promise<unknown> };

/**
 * 笔记的增删改，都记进撤销栈（只在这次打开试卷期间有效）。
 * add / remove / update 都会写数据库，界面通过 useLiveQuery 自动刷新。
 */
export function useMarkHistory() {
  const undoStack = useRef<Action[]>([]);
  const redoStack = useRef<Action[]>([]);
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const push = useCallback((a: Action) => {
    undoStack.current.push(a);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    bump();
  }, []);

  const add = useCallback(
    async (marks: MarkRow[]) => {
      if (!marks.length) return;
      await db.marks.bulkPut(marks);
      const ids = marks.map((m) => m.id);
      push({ undo: () => db.marks.bulkDelete(ids), redo: () => db.marks.bulkPut(marks) });
    },
    [push],
  );

  const remove = useCallback(
    async (marks: MarkRow[]) => {
      if (!marks.length) return;
      const ids = marks.map((m) => m.id);
      await db.marks.bulkDelete(ids);
      push({ undo: () => db.marks.bulkPut(marks), redo: () => db.marks.bulkDelete(ids) });
    },
    [push],
  );

  const update = useCallback(
    async (before: MarkRow, patch: Partial<MarkRow>) => {
      const after = { ...before, ...patch, updatedAt: Date.now() };
      await db.marks.put(after);
      push({ undo: () => db.marks.put(before), redo: () => db.marks.put(after) });
    },
    [push],
  );

  /** 一次改好几条（套索拖动），撤销时一起回去 */
  const replace = useCallback(
    async (before: MarkRow[], after: MarkRow[]) => {
      if (!before.length) return;
      const now = Date.now();
      const next = after.map((m) => ({ ...m, updatedAt: now }));
      await db.marks.bulkPut(next);
      push({ undo: () => db.marks.bulkPut(before), redo: () => db.marks.bulkPut(next) });
    },
    [push],
  );

  const undo = useCallback(async () => {
    const a = undoStack.current.pop();
    if (!a) return;
    await a.undo();
    redoStack.current.push(a);
    bump();
  }, []);

  const redo = useCallback(async () => {
    const a = redoStack.current.pop();
    if (!a) return;
    await a.redo();
    undoStack.current.push(a);
    bump();
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  return useMemo(() => ({ add, remove, update, replace, undo, redo, canUndo, canRedo }), [add, remove, update, replace, undo, redo, canUndo, canRedo]);
}

export type MarkHistory = ReturnType<typeof useMarkHistory>;

const tokenOf = (t: string) => t.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

/** 卷面上对某个词做的批注：高亮、下划线覆盖了这个词（含变形），或便签里写到了它 */
export async function marksForWord(word: string, lemma: Record<string, string>): Promise<MarkRow[]> {
  const w = word.toLowerCase();
  const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
  const list = await db.marks
    .filter((m) => {
      if (m.kind === "note") return re.test(m.note ?? "");
      if (m.kind === "pen" || !m.text) return false;
      return m.text.split(/\s+/).some((t) => {
        const k = tokenOf(t);
        return k === w || lemma[k] === w;
      });
    })
    .toArray();
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}
