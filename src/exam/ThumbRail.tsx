import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
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
        "relative mx-auto block w-[80px] overflow-hidden rounded-[3px] bg-white transition-shadow",
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
  floating,
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
  floating: boolean;
  inset?: number; // 上面浮着工具栏时让出的高度
  onJump: (n: number) => void;
  parts?: { id: string; label: string; sub?: string; page: number; onClick: () => void }[]; // 题型导航：一点跳到那一部分
  currentPart?: string;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  // 当前页滚出缩略图栏时，把它带回视野里（只动这一栏）
  useEffect(() => {
    const el = root?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - root.offsetTop;
    if (top < root.scrollTop + 8 || top + el.offsetHeight > root.scrollTop + root.clientHeight - 8) root.scrollTo({ top: top - root.clientHeight / 3, behavior: "smooth" });
  }, [current, root]);

  return (
    <nav
      ref={setRoot}
      aria-label="页面缩略图"
      style={inset ? { paddingTop: inset } : undefined}
      className={cn(
        "scrollbar-none no-print w-[112px] shrink-0 space-y-3 overflow-y-auto overscroll-contain rounded-[10px] bg-[var(--paper-100)] py-3",
        floating ? "absolute top-0 bottom-1.5 left-1.5 z-30 shadow-[var(--elev-3)]" : "mb-1.5 ml-1.5",
      )}
    >
      {parts && (
        <div className="mx-2 border-b border-[var(--line-soft)] pb-3">
          <p className="px-1 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--ink-subtle)]">目录</p>
          <ol className="relative space-y-px before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-[var(--line)]">
            {parts.map((x) => {
              const on = x.id === currentPart;
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={x.onClick}
                    aria-current={on ? "true" : undefined}
                    title={`${x.label}${x.sub ? ` · Section ${x.sub}` : ""}，第 ${x.page} 页`}
                    className={cn("group relative flex w-full items-center gap-1.5 rounded-[6px] py-1 pr-1 pl-4 text-left text-[12px] leading-[16px] transition-colors", on ? "bg-white font-medium text-[var(--ink)] shadow-[var(--elev-1)]" : "text-[var(--ink-500)] hover:text-[var(--ink)]")}
                  >
                    <span aria-hidden className={cn("absolute top-1/2 left-[2px] size-[7px] -translate-y-1/2 rounded-full ring-2 ring-[var(--paper-100)]", on ? "bg-[var(--blue)]" : "bg-[var(--ink-300)] group-hover:bg-[var(--ink-500)]")} />
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap">{x.label}</span>
                    {x.sub && <span className={cn("num flex-none text-[10px]", on ? "text-[var(--blue)]" : "text-[var(--ink-subtle)]")}>{x.sub}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {pages.map((p) => (
        <Thumb key={p.n} doc={doc} cover={cover} page={p} root={root} current={p.n === current} marked={marked.has(p.n)} onJump={onJump} />
      ))}
    </nav>
  );
}
