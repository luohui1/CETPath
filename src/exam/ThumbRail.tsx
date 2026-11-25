import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SidebarSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { NOTE_COLOR } from "@/lib/marks";
import { gate, getThumb, onThumb, queueThumb, setThumb, thumbKey } from "./pagePool";

/** 缩略图按原卷的 0.15 倍画（高清屏再乘像素比），画一次存成图片，放在内存里：换卷子回来不用再画。
 *  正文画过的页已经顺手存了小图，直接用；没画过的排在正文要画的页之后 */
const THUMB_SCALE = 0.15;

function renderThumb(doc: PDFDocumentProxy, key: string, page: number, alive: () => boolean): Promise<string | null> {
  return queueThumb(async () => {
    if (!alive()) return null;
    const ready = getThumb(key);
    if (ready) return ready;
    const p = await doc.getPage(page);
    const viewport = p.getViewport({ scale: THUMB_SCALE * Math.min(window.devicePixelRatio || 1, 2) });
    const c = document.createElement("canvas");
    c.width = Math.floor(viewport.width);
    c.height = Math.floor(viewport.height);
    const task = p.render({ canvasContext: c.getContext("2d", { alpha: false })!, viewport });
    task.onContinue = (cont: () => void) => gate(null, cont);
    await task.promise;
    const url = c.toDataURL("image/jpeg", 0.82);
    c.width = c.height = 0;
    if (!getThumb(key)) setThumb(key, url);
    return getThumb(key) ?? url;
  });
}

// 滑块宽度：缩略图一列，有题型目录时右边再并一列
export const railWidth = (parts: boolean) => (parts ? 330 : 120);

type Part = { id: string; label: string; sub?: string; page: number; onClick: () => void };

// 题型分档滑条：每个题型一个挡位，拖动或点挡位跳到那一部分，翻卷子时滑块跟着走
function PartSlider({ parts, current }: { parts: Part[]; current?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = Math.max(0, parts.findIndex((x) => x.id === current));
  const idx = drag ?? at;
  const last = parts.length - 1;
  const pct = (i: number) => (last ? (i / last) * 100 : 50);
  const stopAt = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (x - r.left) / r.width)) * last);
  };
  const go = (i: number) => {
    setDrag(null);
    parts[i]?.onClick();
  };
  const cur = parts[idx];
  return (
    <div>
      <p className="pb-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--ink-subtle)]">题型</p>
      <div
        role="slider"
        tabIndex={0}
        aria-label="题型"
        aria-valuemin={1}
        aria-valuemax={parts.length}
        aria-valuenow={idx + 1}
        aria-valuetext={cur?.label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(stopAt(e.clientX));
        }}
        onPointerMove={(e) => drag !== null && setDrag(stopAt(e.clientX))}
        onPointerUp={(e) => drag !== null && go(stopAt(e.clientX))}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") go(Math.min(last, idx + 1));
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(Math.max(0, idx - 1));
          else return;
          e.preventDefault();
        }}
        className="relative mx-[11px] h-6 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-line)]"
      >
        <div ref={track} className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[var(--paper-300,var(--line))]">
          <div className={cn("h-full rounded-full bg-[var(--blue)]", drag === null && "transition-[width] duration-200")} style={{ width: `${pct(idx)}%` }} />
        </div>
        {parts.map((x, i) => (
          <span
            key={x.id}
            aria-hidden
            className={cn("absolute top-1/2 size-[6px] -translate-1/2 rounded-full", i <= idx ? "bg-white/90" : "bg-[var(--ink-300)]")}
            style={{ left: `${pct(i)}%` }}
          />
        ))}
        <span
          aria-hidden
          className={cn("absolute top-1/2 size-[22px] -translate-1/2 rounded-full bg-white shadow-[0_0_0_1px_var(--line),var(--elev-2)]", drag === null ? "transition-[left] duration-200 ease-out" : "scale-110")}
          style={{ left: `${pct(idx)}%` }}
        />
      </div>
      <div className="relative mx-[11px] mt-2 h-4">
        {parts.map((x, i) => (
          <button
            key={x.id}
            type="button"
            tabIndex={-1}
            onClick={() => go(i)}
            title={`${x.label}${x.sub ? ` · Section ${x.sub}` : ""}，第 ${x.page} 页`}
            className={cn("absolute top-0 -translate-x-1/2 text-[11px] leading-4 whitespace-nowrap transition-colors", i === idx ? "font-semibold text-[var(--blue)]" : "text-[var(--ink-500)] hover:text-[var(--ink)]")}
            style={{ left: `${pct(i)}%` }}
          >
            {x.label.slice(0, 2)}
          </button>
        ))}
      </div>
      {cur && (
        <div className="mt-4 rounded-[8px] bg-white px-2.5 py-2 shadow-[var(--elev-1)]">
          <p className="text-[13px] font-medium text-[var(--ink)]">
            {cur.label}
            {cur.sub && <span className="num ml-1.5 text-[11px] font-normal text-[var(--ink-500)]">Section {cur.sub}</span>}
          </p>
          <p className="num mt-0.5 text-[11px] text-[var(--ink-subtle)]">第 {cur.page} 页起 · {idx + 1}/{parts.length}</p>
        </div>
      )}
    </div>
  );
}

export interface RailPage {
  n: number; // 原卷页码，从 1 开始
  width: number;
  height: number;
}

const Thumb = memo(function Thumb({ doc, cover, page, root, current, marked, onJump }: { doc: PDFDocumentProxy; cover?: string; page: RailPage; root: HTMLElement | null; current: boolean; marked: boolean; onJump: (n: number) => void }) {
  const key = thumbKey(doc.fingerprints[0] ?? "pdf", page.n);
  // 第一页先用试卷封面小图
  const [url, setUrl] = useState(() => getThumb(key) ?? (page.n === 1 ? (cover ?? null) : null));
  const box = useRef<HTMLButtonElement>(null);
  // 正文画到这一页时存的小图
  useEffect(() => onThumb(key, setUrl), [key]);
  useEffect(() => {
    if (getThumb(key) || !box.current || !root) return;
    let alive = true;
    let wait = 0;
    // 滚到附近才画；刚打开时先让正文的前两页画完
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        wait = window.setTimeout(() => {
          renderThumb(doc, key, page.n, () => alive).then((u) => alive && u && setUrl(u), () => {});
        }, 400);
      },
      { root, rootMargin: "240px 0px" },
    );
    io.observe(box.current);
    return () => {
      alive = false;
      clearTimeout(wait);
      io.disconnect();
    };
  }, [doc, key, page.n, root]);

  return (
    <button
      ref={box}
      type="button"
      onClick={() => onJump(page.n)}
      aria-label={`第 ${page.n} 页${marked ? "，有笔记" : ""}`}
      aria-current={current ? "page" : undefined}
      data-page={page.n}
      className={cn(
        "relative mx-auto block w-[96px] overflow-hidden rounded-[3px] bg-white transition-shadow",
        current ? "shadow-[0_0_0_2px_var(--blue),var(--elev-1)]" : "shadow-[var(--elev-1)] hover:shadow-[0_0_0_1px_var(--blue-line),var(--elev-1)]",
      )}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      {url && <img src={url} alt="" draggable={false} className="size-full" />}
      {marked && <span className="absolute top-1 right-1 size-[7px] rounded-full ring-[1.5px] ring-white" style={{ background: NOTE_COLOR }} aria-hidden />}
      <span className={cn("num absolute bottom-1 left-1/2 -translate-x-1/2 rounded-[4px] px-1.5 text-[12px] leading-[18px]", current ? "bg-[var(--blue)] text-white" : "bg-white/90 text-[var(--ink-700)]")}>{page.n}</span>
    </button>
  );
});

/** 页面缩略图栏：每页一张，当前页蓝框，有笔记的页右上角一个小点，点了跳过去。平板竖屏时浮在卷面上 */
export function ThumbRail({
  doc,
  cover,
  pages,
  current,
  marked,
  open,
  docked,
  onClose,
  inset = 0,
  onJump,
  parts,
  currentPart,
}: {
  doc: PDFDocumentProxy;
  cover?: string; // 试卷封面小图（第一页）
  pages: RailPage[];
  current: number;
  marked: Set<number>;
  open: boolean;
  docked: boolean;
  onClose: () => void;
  inset?: number; // 上面浮着工具栏时让出的高度
  onJump: (n: number) => void;
  parts?: Part[]; // 题型导航：一点跳到那一部分
  currentPart?: string;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const width = railWidth(!!parts);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open, onClose]);
  // 当前页滚出缩略图栏时，把它带回视野里（只动这一栏）
  useEffect(() => {
    const el = root?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - root.offsetTop;
    if (top < root.scrollTop + 8 || top + el.offsetHeight > root.scrollTop + root.clientHeight - 8) root.scrollTo({ top: top - root.clientHeight / 3, behavior: "smooth" });
  }, [current, root]);

  return (
    <div
      style={{ width: docked && !open ? 0 : width, ...(inset ? { paddingTop: inset } : {}) }}
      aria-hidden={!open}
      inert={!open}
      onPointerDown={(e) => (from.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const f = from.current;
        from.current = null;
        if (f && f.x - e.clientX > 48 && Math.abs(e.clientY - f.y) < f.x - e.clientX) onClose();
      }}
      className={cn(
        "no-print flex flex-none flex-col overflow-hidden rounded-[12px] bg-[var(--paper-100)] duration-200 ease-out",
        docked
          ? cn("mb-1.5 transition-[width,margin,opacity]", open ? "ml-1.5" : "ml-0 opacity-0")
          : cn("absolute top-0 bottom-1.5 left-1.5 z-30 shadow-[var(--elev-3)] transition-[translate,opacity]", !open && "-translate-x-[calc(100%+16px)] opacity-0"),
        !open && "pointer-events-none",
      )}
    >
      <div className="flex flex-none items-center justify-between py-1.5 pr-1.5 pl-3" style={{ width }}>
        <span className="text-[12px] font-medium text-[var(--ink-500)]">页面</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起缩略图"
          title="收起缩略图（T）"
          className="grid size-8 place-items-center rounded-[8px] text-[var(--ink-500)] transition-colors hover:bg-[var(--paper-200)] hover:text-[var(--ink)]"
        >
          <SidebarSimple className="size-[19px]" weight="fill" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1" style={{ width }}>
      <nav ref={setRoot} aria-label="页面缩略图" className="scrollbar-none w-[120px] flex-none space-y-3 overflow-y-auto overscroll-contain pt-1 pb-3">
        {pages.map((p) => (
          <Thumb key={p.n} doc={doc} cover={cover} page={p} root={root} current={p.n === current} marked={marked.has(p.n)} onJump={onJump} />
        ))}
      </nav>
      {parts && (
        <div className="min-w-0 flex-1 border-l border-[var(--line-soft)] px-3 pt-2 pb-3">
          <PartSlider parts={parts} current={currentPart} />
        </div>
      )}
      </div>
    </div>
  );
}
