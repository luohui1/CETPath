import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { NoteBlank, Trash } from "@phosphor-icons/react";
import * as G from "@/grasso";
import type { PdfWordsPage } from "@/lib/papers";
import {
  colorValue,
  hitMark,
  HOLD_MS,
  isMarker,
  lassoHits,
  markBounds,
  MARKER_SIZE,
  moveMark,
  nearWord,
  newMark,
  NOTE_COLOR,
  strokePath,
  underlineY,
  unionBounds,
  wordRange,
  type MarkHistory,
  type MarkRow,
  type Rect,
  type Tool,
} from "@/lib/marks";
import { cn } from "@/lib/utils";
import { gesture, onPinchStart } from "./gesture";

/** 卷面笔记的工具状态，考场里统一管理，传给每一页 */
export interface InkState {
  paperId: string;
  tool: Tool;
  color: string; // 当前工具的颜色 id
  penSize: number;
  history: Pick<MarkHistory, "add" | "remove" | "update" | "replace">;
  openNote: string | null;
  onOpenNote: (id: string | null) => void;
  flash: { id: string; n: number } | null; // 从笔记面板跳过来时闪一下
  wordFlash: { page: number; range: [number, number]; n: number } | null; // 解析里"在卷面上标出"：临时蓝色高亮几个词，不写进笔记
  lookupAt: (clientX: number, clientY: number) => void; // 笔双击查词
}

/** 橡皮擦光标：一个小圆圈 */
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="white" fill-opacity="0.6" stroke="#0f1f38" stroke-width="1.2"/></svg>',
)}") 10 10, cell`;
const CURSORS: Record<Tool, string> = {
  select: "auto",
  pen: "crosshair",
  highlight: "text",
  underline: "text",
  note: "copy",
  eraser: ERASER_CURSOR,
  lasso: "crosshair",
};
const DOUBLE_TAP_MS = 350;

/** 平板上用过手写笔之后，手指只用来滚动卷面；手写笔正在写时，手掌碰到屏幕不算 */
const stylus = { seen: false, down: false };

type Pt = [number, number, number];
type Seg = [number, number, number, number];

const PenPath = memo(function PenPath({ m }: { m: MarkRow }) {
  if (m.shape === "line" && m.points && m.points.length >= 2) {
    const [[x0, y0], [x1, y1]] = m.points;
    return (
      <line
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={colorValue(m.color)}
        strokeWidth={(m.size ?? 1.8) * 0.9}
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      d={strokePath(m.points ?? [], m.size ?? 1.8, !!m.pressure)}
      fill={colorValue(m.color)}
    />
  );
});

/** 旧版荧光笔画的色带（现在的荧光笔按词吸附，不再画这种；以前存下的照样显示） */
function Marker({
  points,
  size,
  color,
  line,
}: {
  points: number[][];
  size: number;
  color: string;
  line?: boolean;
}) {
  if (line && points.length >= 2) {
    const [[x0, y0], [x1, y1]] = points;
    return (
      <line
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={color}
        strokeWidth={size}
        strokeLinecap="butt"
      />
    );
  }
  return (
    <polyline
      points={points.map((p) => `${p[0]},${p[1]}`).join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={size}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** 高亮：每行一个圆角矩形。画的时候和画完用同一个，预览就是最后的样子 */
const HighlightRects = ({ rects, color }: { rects: Rect[]; color: string }) => (
  <>
    {rects.map((r, i) => (
      <rect
        key={i}
        x={r[0] - 1}
        y={r[1] - 0.5}
        width={r[2] - r[0] + 2}
        height={r[3] - r[1] + 1}
        rx={1.5}
        fill={color}
      />
    ))}
  </>
);
const UnderlineRects = ({ rects, color }: { rects: Rect[]; color: string }) => (
  <>
    {rects.map((r, i) => (
      <rect
        key={i}
        x={r[0]}
        y={underlineY(r)}
        width={r[2] - r[0]}
        height={1.1}
        rx={0.5}
        fill={color}
      />
    ))}
  </>
);

const translate = (off: [number, number] | null) =>
  off ? `translate(${off[0]} ${off[1]})` : undefined;

/**
 * 一页上的笔记层：高亮（叠在字下面的效果）、下划线、手写笔迹、便签。
 * 选了笔、高亮这些工具时，最上面盖一层接住鼠标或手写笔，不再触发查词和选答案。
 * 手写笔画完停住 0.3 秒不抬笔拉成直线，再动又变回自由笔迹；荧光笔和下划线按整词吸附。
 * 手指点一下是查词（考场统一处理），手写笔双击也是查词。套索：圈住一片笔记，整体拖动或删除。
 */
export const InkLayer = memo(function InkLayer({
  page,
  data,
  scale,
  marks,
  ink,
  band,
}: {
  page: number;
  data: PdfWordsPage;
  scale: number;
  marks: MarkRow[];
  ink: InkState;
  band?: [number, number] | null; // 专项训练只显示页面的一段（PDF 点）
}) {
  const { tool, history } = ink;
  const W = data.width;
  const H = data.height;
  const size = { width: W * scale, height: H * scale };

  // 正在画的手写笔迹；straight 是按住后拉直了
  const drawing = useRef<{
    points: Pt[];
    pressure: boolean;
    straight: boolean;
  } | null>(null);
  // 荧光笔、下划线：从第 a 个词到第 b 个词（阅读顺序）
  const selecting = useRef<{ a: number; b: number } | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const lasso = useRef<number[][] | null>(null);
  const moving = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const noteAt = useRef<[number, number] | null>(null);
  const down = useRef<{ x: number; y: number; t: number; type: string } | null>(
    null,
  );
  // 这一下是笔双击的第二下：不画，抬起时查词（按下时就弹，查词卡会把同一次按下当成"点了外面"马上关掉）
  const skip = useRef<[number, number] | null>(null);
  // 手写笔点了一下：等一会儿看是不是双击，不是再存
  const tapWait = useRef<{
    t: number;
    x: number;
    y: number;
    mark: MarkRow;
    timer: number;
  } | null>(null);
  const active = useRef<number | null>(null); // 正在画的指针，别的手指、手掌不算
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    top: number;
    left: number;
    el: HTMLElement;
  } | null>(null);
  const [live, setLive] = useState<{
    d?: string;
    rects?: Rect[];
    line?: Seg;
    lasso?: number[][];
  } | null>(null);
  const [erased, setErased] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<[number, number] | null>(null);
  // 刚画完、数据库里还没回来的笔记先在本地画着，抬笔那一下不会闪
  const [pending, setPending] = useState<MarkRow[]>([]);
  // 套索选中（或点中一条高亮）的笔记，和正在拖动的位移（松手写进数据库后，等新数据回来再清掉，不会跳回去一下）
  const [sel, setSel] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);

  const stopHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const commit = (list: MarkRow[]) => {
    setPending((p) => [...p, ...list]);
    void history.add(list);
  };
  /** 笔点的那一下不用等了：直接存 */
  const flushTap = () => {
    const w = tapWait.current;
    if (!w) return;
    clearTimeout(w.timer);
    tapWait.current = null;
    void history.add([w.mark]);
  };
  /** 是双击：第一下作废 */
  const dropTap = () => {
    const w = tapWait.current;
    if (!w) return;
    clearTimeout(w.timer);
    tapWait.current = null;
    setPending((p) => p.filter((m) => m.id !== w.mark.id));
  };
  const reset = () => {
    drawing.current =
      selecting.current =
      erasing.current =
      lasso.current =
      moving.current =
        null;
    noteAt.current = null;
    active.current = null;
    pan.current = null;
    skip.current = null;
    stopHold();
    setLive(null);
  };

  // 换工具时丢掉画了一半的东西和选中；等着看双击的那一下直接存
  useEffect(() => {
    reset();
    flushTap();
    setDraft(null);
    setSel(null);
    setDrag(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  // 双指缩放开始：不画任何笔迹
  useEffect(
    () =>
      onPinchStart(() => {
        reset();
        setErased(new Set());
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // 离开卷面时等着的那一下也存上
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushTap(), []);
  // 撤销之后被擦掉的笔记又回来了，不能再藏着；拖动写进去了就不用再偏移；本地先画着的已经回来了就去掉
  useEffect(() => {
    setErased(new Set());
    setDrag(null);
    setSel((s) => (s ? s.filter((id) => marks.some((m) => m.id === id)) : s));
    setPending((p) =>
      p.length
        ? p.filter(
            (x) =>
              x.id === tapWait.current?.mark.id ||
              !marks.some((m) => m.id === x.id),
          )
        : p,
    );
  }, [marks]);

  const all = pending.length
    ? [...marks, ...pending.filter((p) => !marks.some((m) => m.id === p.id))]
    : marks;
  const selected = sel?.length ? all.filter((m) => sel.includes(m.id)) : [];
  const selBox = unionBounds(selected);

  // 选中后按 Delete 删掉，Esc 取消选中
  useEffect(() => {
    if (!sel?.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea")
      )
        return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void history.remove(marks.filter((m) => sel.includes(m.id)));
        setSel(null);
      } else if (e.key === "Escape") setSel(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [sel, marks, history]);

  const toPt = (
    e: PointerEvent<HTMLElement> | globalThis.PointerEvent,
    el: Element,
  ): Pt => {
    const r = el.getBoundingClientRect();
    return [
      +((e.clientX - r.left) / scale).toFixed(1),
      +((e.clientY - r.top) / scale).toFixed(1),
      +(e.pressure || 0.5).toFixed(2),
    ];
  };

  /** 按现在的笔迹画出预览 */
  const paint = () => {
    const d = drawing.current;
    const s = selecting.current;
    if (d) {
      const [x0, y0] = d.points[0];
      const [x1, y1] = d.points[d.points.length - 1];
      if (d.straight)
        setLive({ line: [x0, y0, x1, Math.abs(y1 - y0) <= 3 ? y0 : y1] });
      else {
        // 刚起笔的几个点 perfect-freehand 有时算不出轮廓：沿用上一帧的预览，不闪
        const path = strokePath(d.points, ink.penSize, d.pressure, false);
        setLive((prev) => (path || !prev?.d ? { d: path } : prev));
      }
    } else if (s) setLive({ rects: wordRange(data.w, s.a, s.b).rects });
  };

  /** 停住不动 HOLD_MS 就拉直；离起点太近（只是按了一下）不拉 */
  const armHold = (x: number, y: number) => {
    stopHold();
    const timer = window.setTimeout(() => {
      const d = drawing.current;
      if (!d || Math.hypot(x - d.points[0][0], y - d.points[0][1]) < 6) return;
      d.straight = true;
      paint();
    }, HOLD_MS);
    hold.current = { x, y, timer };
  };
  /** 动了：拉直的变回自由笔迹，重新计时 */
  const moved = (x: number, y: number) => {
    const h = hold.current;
    if (h && Math.hypot(x - h.x, y - h.y) < 2.5) return;
    if (drawing.current?.straight) drawing.current.straight = false;
    armHold(x, y);
  };

  const eraseAt = (x: number, y: number) => {
    const hit = all.filter(
      (m) => !erasing.current!.has(m.id) && hitMark(m, x, y, 4),
    );
    if (!hit.length) return;
    for (const m of hit) erasing.current!.add(m.id);
    setErased(new Set(erasing.current));
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      active.current !== null ||
      pan.current ||
      gesture.pinching
    )
      return;
    const el = e.currentTarget;
    const [x, y, p] = toPt(e, el);
    const now = performance.now();
    down.current = { x: e.clientX, y: e.clientY, t: now, type: e.pointerType };
    const capture = () => {
      try {
        el.setPointerCapture(e.pointerId); // 拖出页面也能接着画
      } catch {
        // 指针已经抬起时会抛错，不影响作画
      }
    };
    // 手写笔双击（同一处、0.35 秒内）：查词，第一下点出来的点不要了
    const w = tapWait.current;
    if (
      e.pointerType === "pen" &&
      w &&
      now - w.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - w.x, e.clientY - w.y) < 10
    ) {
      dropTap();
      active.current = e.pointerId;
      skip.current = [e.clientX, e.clientY];
      capture();
      return;
    }
    flushTap();
    if (tool === "note") {
      // 抬起时才贴：按下就打开的话，同一次按下冒泡到 document 会被便签框当成"点了外面"马上关掉
      active.current = e.pointerId;
      noteAt.current = [x, y];
      return;
    }
    if (e.pointerType === "pen") stylus.seen = stylus.down = true;
    else if (e.pointerType === "touch") {
      // 只有笔能写字：手指一律是拖动卷面；笔正在写时碰到的是手掌，不理
      if (stylus.down) return;
      const stage = el.closest<HTMLElement>(".gr-wb-stage, [data-ink-scroll]");
      if (stage) {
        pan.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          top: stage.scrollTop,
          left: stage.scrollLeft,
          el: stage,
        };
        capture();
      }
      return;
    }
    active.current = e.pointerId;
    capture();
    if (tool === "pen") {
      drawing.current = {
        points: [[x, y, p]],
        pressure: e.pointerType === "pen",
        straight: false,
      };
      armHold(x, y);
      paint();
    } else if (tool === "highlight" || tool === "underline") {
      // 按词吸附：落笔处的词（不在词上就取最近那一行里最近的词）是起点
      const i = nearWord(data.w, x, y);
      if (i < 0) return;
      selecting.current = { a: i, b: i };
      paint();
    } else if (tool === "eraser") {
      erasing.current = new Set();
      eraseAt(x, y);
    } else if (tool === "lasso") {
      // 按在选中的范围里是拖动，否则重新圈
      if (
        selBox &&
        x >= selBox[0] - 6 &&
        x <= selBox[2] + 6 &&
        y >= selBox[1] - 6 &&
        y <= selBox[3] + 6
      ) {
        moving.current = { x, y };
        setDrag([0, 0]);
      } else {
        setSel(null);
        lasso.current = [[x, y]];
        setLive({ lasso: lasso.current });
      }
    }
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (pan.current?.id === e.pointerId) {
      if (gesture.pinching) return;
      const p = pan.current;
      p.el.scrollTop = p.top - (e.clientY - p.y);
      p.el.scrollLeft = p.left - (e.clientX - p.x);
      return;
    }
    if (e.pointerId !== active.current || skip.current || gesture.pinching)
      return;
    if (drawing.current) {
      // 合并事件能拿到两帧之间的所有采样点，笔迹更顺
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length ? events : [e.nativeEvent])
        drawing.current.points.push(toPt(ev, el));
      const [x, y] = drawing.current.points[drawing.current.points.length - 1];
      moved(x, y);
      paint();
    } else if (selecting.current) {
      const [x, y] = toPt(e, el);
      const i = nearWord(data.w, x, y, 80);
      if (i < 0 || i === selecting.current.b) return;
      selecting.current.b = i;
      paint();
    } else if (erasing.current) {
      const [x, y] = toPt(e, el);
      eraseAt(x, y);
    } else if (lasso.current) {
      const [x, y] = toPt(e, el);
      lasso.current.push([x, y]);
      setLive({ lasso: [...lasso.current] });
    } else if (moving.current) {
      const [x, y] = toPt(e, el);
      setDrag([
        +(x - moving.current.x).toFixed(1),
        +(y - moving.current.y).toFixed(1),
      ]);
    }
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.id === e.pointerId) {
      pan.current = null;
      return;
    }
    if (e.pointerId !== active.current) return;
    active.current = null;
    stopHold();
    if (skip.current) {
      const [cx, cy] = skip.current;
      skip.current = null;
      ink.lookupAt(cx, cy);
      return;
    }
    if (noteAt.current) {
      setDraft(noteAt.current);
      noteAt.current = null;
      return;
    }
    if (e.pointerType === "pen") stylus.down = false;
    const d0 = down.current ?? {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      type: e.pointerType,
    };
    const dt = performance.now() - d0.t;
    const dist = Math.hypot(e.clientX - d0.x, e.clientY - d0.y);
    const [ux, uy] = toPt(e, e.currentTarget);
    const d = drawing.current;
    const s = selecting.current;
    const er = erasing.current;
    const loop = lasso.current;
    const mv = moving.current;
    drawing.current =
      selecting.current =
      erasing.current =
      lasso.current =
      moving.current =
        null;
    setLive(null);

    // 手指点一下：查词（考场在 document 上统一查）；点在已有的高亮、下划线上是选中它（显示删除）
    if (d0.type === "touch" && dt < 300 && dist < 8) {
      setErased(new Set());
      if (tool === "highlight" || tool === "underline") {
        const hit = all.find((m) => m.kind === tool && hitMark(m, ux, uy, 2));
        if (hit) {
          setSel([hit.id]);
          e.preventDefault();
        }
      }
      return;
    }
    const penTap = d0.type === "pen" && dt < 250 && dist < 4;
    const later = (m: MarkRow) => {
      // 手写笔点了一下：先画着，0.35 秒内没有第二下才存（第二下就是双击查词）
      setPending((p) => [...p, m]);
      tapWait.current = {
        t: performance.now(),
        x: e.clientX,
        y: e.clientY,
        mark: m,
        timer: window.setTimeout(flushTap, DOUBLE_TAP_MS),
      };
    };

    if (d) {
      const { points, pressure } = d;
      const [x0, y0] = points[0];
      const [x1, y1] = points[points.length - 1];
      // 只点了一下也留一个点
      if (points.length === 1)
        points.push([points[0][0] + 0.1, points[0][1] + 0.1, points[0][2]]);
      const fields = d.straight
        ? {
            kind: "pen" as const,
            shape: "line" as const,
            color: ink.color,
            size: ink.penSize,
            pressure: false,
            points: [
              [x0, y0, 0.5],
              [x1, Math.abs(y1 - y0) <= 3 ? y0 : y1, 0.5],
            ] as Pt[],
          }
        : {
            kind: "pen" as const,
            color: ink.color,
            size: ink.penSize,
            pressure,
            points,
          };
      const m = newMark(ink.paperId, page, fields);
      if (penTap) later(m);
      else commit([m]);
    } else if (s) {
      const kind = tool === "underline" ? "underline" : "highlight";
      // 单击已有的高亮（或下划线）：选中它，显示删除
      const hit =
        s.a === s.b && dist < 4
          ? all.find((m) => m.kind === kind && hitMark(m, ux, uy, 2))
          : undefined;
      if (hit) setSel([hit.id]);
      else {
        const { rects, text } = wordRange(data.w, s.a, s.b);
        // 同一处已经有同样的高亮，就当作取消
        const same = all.find(
          (m) =>
            m.kind === kind &&
            m.text === text &&
            JSON.stringify(m.rects) === JSON.stringify(rects),
        );
        if (same) void history.remove([same]);
        else {
          const m = newMark(ink.paperId, page, {
            kind,
            color: ink.color,
            rects,
            text,
          });
          if (penTap) later(m);
          else commit([m]);
        }
      }
    } else if (er?.size) {
      void history.remove(all.filter((m) => er.has(m.id)));
    } else if (loop) {
      const hits = loop.length > 2 ? lassoHits(visibleMarks(), loop) : [];
      setSel(hits.length ? hits.map((m) => m.id) : null);
    } else if (mv) {
      const [dx, dy] = drag ?? [0, 0];
      if (Math.abs(dx) + Math.abs(dy) > 0.5)
        void history.replace(
          selected,
          selected.map((m) => moveMark(m, dx, dy)),
        );
      else setDrag(null);
    }
  };

  // 截掉的部分不画、不接指针
  const clipPath = band
    ? `inset(${band[0] * scale}px 0 ${(H - band[1]) * scale}px 0)`
    : undefined;
  const inBand = (y: number) => !band || (y >= band[0] && y <= band[1]);
  const visible = erased.size ? all.filter((m) => !erased.has(m.id)) : all;
  const visibleMarks = () =>
    visible.filter((m) => inBand((markBounds(m)[1] + markBounds(m)[3]) / 2));
  // 拖动中的笔记整体偏移
  const off = drag && (drag[0] || drag[1]) ? drag : null;
  const moving$ = off && sel ? new Set(sel) : null;
  const groups = (list: MarkRow[], draw: (m: MarkRow) => ReactNode) =>
    moving$ ? (
      <>
        {list.filter((m) => !moving$.has(m.id)).map(draw)}
        <g transform={translate(off)}>
          {list.filter((m) => moving$.has(m.id)).map(draw)}
        </g>
      </>
    ) : (
      list.map(draw)
    );
  const highlights = visible.filter((m) => m.kind === "highlight");
  const flash = ink.flash && all.find((m) => m.id === ink.flash!.id);
  const wf = ink.wordFlash?.page === page ? ink.wordFlash : null;
  const flashRects =
    wf && wf.range[0] < data.w.length
      ? wordRange(data.w, wf.range[0], Math.min(wf.range[1], data.w.length - 1))
          .rects
      : null;
  const notesOnTop = tool === "select" || tool === "note";
  const liveHighlight = tool === "highlight" && live?.rects;
  const strokes = visible.filter(
    (m) => m.kind === "pen" || m.kind === "underline",
  );
  // 笔迹层也是整页大小：没笔迹、没在画、没选中时不放（每页少一个合成层）
  const inkOn = strokes.length > 0 || !!live || !!selBox || !!flash;

  return (
    <>
      {/* 高亮用正片叠底叠在原卷上，字还是清楚的；混合模式开销大，没有高亮的页不放这一层 */}
      {(highlights.length > 0 || liveHighlight) && (
        <svg
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{ clipPath }}
          {...size}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
        >
          {groups(highlights, (m) =>
            isMarker(m) ? (
              <Marker
                key={m.id}
                points={m.points!}
                size={m.size ?? MARKER_SIZE}
                color={colorValue(m.color)}
                line={m.shape === "line"}
              />
            ) : (
              <g key={m.id}>
                <HighlightRects
                  rects={m.rects ?? []}
                  color={colorValue(m.color)}
                />
              </g>
            ),
          )}
          {liveHighlight && (
            <HighlightRects rects={live.rects!} color={colorValue(ink.color)} />
          )}
        </svg>
      )}
      {/* 解析定位句：和高亮一样叠在字下面，蓝色，3 秒后淡掉 */}
      {flashRects && (
        <svg
          key={wf!.n}
          className="word-flash pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{ clipPath }}
          {...size}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
        >
          {flashRects.map((r, i) => (
            <rect
              key={i}
              x={r[0] - 1.5}
              y={r[1] - 1}
              width={r[2] - r[0] + 3}
              height={r[3] - r[1] + 2}
              rx={2}
              fill="var(--blue-line)"
            />
          ))}
        </svg>
      )}

      {inkOn && (
        <svg
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{ clipPath }}
          {...size}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
        >
          {groups(strokes, (m) =>
            m.kind === "pen" ? (
              <PenPath key={m.id} m={m} />
            ) : (
              <g key={m.id}>
                <UnderlineRects
                  rects={m.rects ?? []}
                  color={colorValue(m.color)}
                />
              </g>
            ),
          )}
          {live?.d && <path d={live.d} fill={colorValue(ink.color)} />}
          {live?.line && (
            <line
              x1={live.line[0]}
              y1={live.line[1]}
              x2={live.line[2]}
              y2={live.line[3]}
              stroke={colorValue(ink.color)}
              strokeWidth={ink.penSize * 0.9}
              strokeLinecap="round"
            />
          )}
          {live?.rects && tool === "underline" && (
            <UnderlineRects rects={live.rects} color={colorValue(ink.color)} />
          )}
          {live?.lasso && (
            <polygon
              points={live.lasso.map((p) => `${p[0]},${p[1]}`).join(" ")}
              fill="rgba(22,119,255,0.06)"
              stroke="var(--blue)"
              strokeWidth={0.8}
              strokeDasharray="3 2"
              strokeLinejoin="round"
            />
          )}
          {selBox && (
            <rect
              x={selBox[0] - 4 + (off?.[0] ?? 0)}
              y={selBox[1] - 4 + (off?.[1] ?? 0)}
              width={selBox[2] - selBox[0] + 8}
              height={selBox[3] - selBox[1] + 8}
              rx={3}
              fill="rgba(22,119,255,0.04)"
              stroke="var(--blue)"
              strokeWidth={0.9}
              strokeDasharray="4 2.5"
            />
          )}
          {flash && <FlashBox key={ink.flash!.n} box={markBounds(flash)} />}
        </svg>
      )}

      {/* 选了笔、高亮等工具时接住指针 */}
      {tool !== "select" && (
        <div
          className="absolute inset-0 z-[5] touch-none select-none [-webkit-touch-callout:none]"
          style={{
            cursor: selBox && tool === "lasso" ? "move" : CURSORS[tool],
            clipPath,
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      )}

      {/* 选中（套索或点中一条高亮）：右上角一个删除 */}
      {selBox && !off && (
        <div
          className="absolute z-[8]"
          style={{
            left: (selBox[2] + 4) * scale - 32,
            top: (selBox[1] - 4) * scale - 44,
          }}
        >
          <button
            type="button"
            onClick={() => {
              void history.remove(selected);
              setSel(null);
            }}
            className="flex h-9 items-center gap-1 rounded-full bg-white px-3 text-[13px] text-[var(--ink-700)] shadow-[var(--elev-2)] transition hover:text-[var(--red)] active:scale-95"
          >
            <Trash className="size-4" /> 删除
          </button>
        </div>
      )}

      {/* 便签 */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          notesOnTop ? "z-[6]" : "z-[1]",
        )}
      >
        {visible
          .filter((m) => m.kind === "note" && inBand(m.at![1]))
          .map((m) => {
            const shift = moving$?.has(m.id) ? off! : null;
            return (
              <NotePin
                key={m.id}
                at={shift ? [m.at![0] + shift[0], m.at![1] + shift[1]] : m.at!}
                scale={scale}
                note={m.note ?? ""}
                open={ink.openNote === m.id}
                onOpen={(o) => ink.onOpenNote(o ? m.id : null)}
                onCommit={(text) =>
                  text.trim()
                    ? text !== m.note && history.update(m, { note: text })
                    : history.remove([m])
                }
                onMove={
                  notesOnTop
                    ? (at) =>
                        history.update(m, {
                          at: [
                            Math.max(0, Math.min(W, at[0])),
                            Math.max(0, Math.min(H, at[1])),
                          ],
                        })
                    : undefined
                }
              />
            );
          })}
        {/* Agent 加的标注：右上角一个小 AI 角标 */}
        {visible
          .filter((m) => m.ai && m.kind !== "pen")
          .map((m) => {
            const b = markBounds(m);
            return (
              <span
                key={`ai-${m.id}`}
                className="absolute rounded-[3px] bg-[var(--blue)] px-[3px] text-[9px] leading-[12px] font-bold text-white shadow-sm"
                style={{ left: b[2] * scale - 4, top: b[1] * scale - 9 }}
              >
                AI
              </span>
            );
          })}
        {draft && (
          <NotePin
            at={draft}
            scale={scale}
            note=""
            open
            onOpen={(o) => !o && setDraft(null)}
            onCommit={(text) =>
              text.trim() &&
              history.add([
                newMark(ink.paperId, page, {
                  kind: "note",
                  color: "note",
                  at: draft,
                  note: text,
                }),
              ])
            }
          />
        )}
      </div>
    </>
  );
});

function FlashBox({ box: [x0, y0, x1, y1] }: { box: Rect }) {
  return (
    <rect
      className="mark-flash"
      x={x0 - 4}
      y={y0 - 4}
      width={x1 - x0 + 8}
      height={y1 - y0 + 8}
      rx={4}
      fill="none"
      stroke="var(--blue)"
      strokeWidth={1.5}
    />
  );
}

/** 便签：卷面上一个小图标，点开写内容，按住拖动换位置。关掉时保存，清空内容就删掉 */
function NotePin({
  at,
  scale,
  note,
  open,
  onOpen,
  onCommit,
  onMove,
}: {
  at: [number, number];
  scale: number;
  note: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  onCommit: (text: string) => unknown;
  onMove?: (at: [number, number]) => unknown;
}) {
  const text = useRef(note);
  const done = useRef(!open); // 这次打开的内容是否已经提交
  const commit = () => {
    if (done.current) return;
    done.current = true;
    void onCommit(text.current);
  };
  useEffect(() => {
    if (open) {
      text.current = note;
      done.current = false;
    } else commit(); // 被别处关掉（比如笔记面板打开了另一张便签）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 拖动：按下后移动超过 4px 才算拖，松手时记新位置；拖过就不再当作点击打开
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const dragged = useRef(false);
  const [shift, setShift] = useState<[number, number] | null>(null);
  useEffect(() => setShift(null), [at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = onMove && !open;

  return (
    <div
      className={cn("pointer-events-auto absolute", drag && "touch-none")}
      style={{
        left: (at[0] + (shift?.[0] ?? 0)) * scale - 10,
        top: (at[1] + (shift?.[1] ?? 0)) * scale - 10,
      }}
      onPointerDown={(e) => {
        if (!drag || e.button !== 0) return;
        press.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          dragging: false,
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (!p.dragging && Math.hypot(dx, dy) < 4) return;
        if (!p.dragging) {
          p.dragging = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // 指针已经抬起
          }
        }
        setShift([dx / scale, dy / scale]);
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p?.dragging || p.id !== e.pointerId) return;
        dragged.current = true;
        e.preventDefault(); // 拖便签不是点词
        void onMove!([
          +(at[0] + (e.clientX - p.x) / scale).toFixed(1),
          +(at[1] + (e.clientY - p.y) / scale).toFixed(1),
        ]);
      }}
      onPointerCancel={() => {
        press.current = null;
        setShift(null);
      }}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <G.Popover
        open={open}
        onOpenChange={(o: boolean) => {
          // 点外面、按 Esc、点"完成"都会走到这里，先保存再关
          if (!o) commit();
          onOpen(o);
        }}
        label="便签"
        width={260}
        trigger={
          <button
            type="button"
            aria-label={note ? `便签：${note}` : "便签"}
            title={note || undefined}
            className={cn(
              "hit40 flex size-5 items-center justify-center rounded-[5px] text-white shadow-[0_1px_2px_rgba(15,39,67,0.2),0_4px_10px_-4px_rgba(134,96,15,0.6)] transition active:scale-95",
              open && "ring-2 ring-[var(--blue)] ring-offset-1",
              shift && "scale-110 cursor-grabbing",
            )}
            style={{ background: NOTE_COLOR }}
          >
            <NoteBlank className="size-3" weight="bold" />
          </button>
        }
      >
        {(close: () => void) => (
          <div>
            <textarea
              autoFocus
              defaultValue={note}
              rows={4}
              placeholder="写下你的想法…"
              onChange={(e) => (text.current = e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  close();
                }
              }}
              className="gr-input gr-textarea h-auto w-full resize-none text-[13px] leading-5"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-subtle">
              {note ? (
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-danger"
                  onClick={() => {
                    text.current = "";
                    close();
                  }}
                >
                  <Trash className="size-3" /> 删除
                </button>
              ) : (
                <span />
              )}
              <span>
                <G.Kbd>Ctrl</G.Kbd> <G.Kbd>Enter</G.Kbd> 完成
              </span>
            </div>
          </div>
        )}
      </G.Popover>
    </div>
  );
}
