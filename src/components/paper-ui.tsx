// 「考场与文具」风格的小件：答题卡式进度、红章、试卷缩略图，和让纸"像纸"的回形针、便签索引、荧光笔、装订孔
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 答题卡式的进度：一排小椭圆，做了的涂黑（像机读卡）。题多时一个泡代表几题；不换行 */
export function Bubbles({ total, done, max = 25, color, className }: { total: number; done: number; max?: number; color?: string; className?: string }) {
  const n = Math.max(1, Math.min(total, max));
  const filled = total ? Math.round((Math.min(done, total) / total) * n) : 0;
  return (
    <div className={cn("flex flex-nowrap gap-[3px] overflow-hidden", className)} role="img" aria-label={`${done} / ${total}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("bubble", i < filled && "bubble-on")} style={color && i < filled ? { background: color, borderColor: color } : undefined} />
      ))}
    </div>
  );
}

/** 字符串哈希：同一个 id 每次算出来一样，章的歪斜角度就固定了 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 红章：盖在做完的卷子上；tone="blue" 是蓝章。
 * 印泥有噪点蒙版；按 id 固定歪 -8°～-4°（没给 id 就按文字），每次渲染都一样，像真盖上去的。
 * animate：盖下去的动作（交卷、打卡达成时）
 */
export function Stamp({
  children,
  tone = "red",
  flat,
  size,
  double,
  animate,
  id,
  className,
  style,
}: {
  children: ReactNode;
  tone?: "red" | "blue";
  flat?: boolean;
  size?: "lg";
  double?: boolean;
  animate?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const seed = id ?? (typeof children === "string" || typeof children === "number" ? String(children) : "stamp");
  const rot = -8 + (hash(seed) % 400) / 100;
  return (
    <span
      className={cn("stamp", tone === "blue" && "stamp-blue", flat && "stamp-flat", size === "lg" && "stamp-lg", double && "stamp-double", animate && "stamp-in", className)}
      style={{ "--stamp-rot": `${rot.toFixed(2)}deg`, ...style } as CSSProperties}
    >
      {children}
    </span>
  );
}

const THUMB_SHADOW = "shadow-[0_0_0_1px_rgba(28,35,48,0.08),0_1px_2px_rgba(28,35,48,0.08),0_6px_14px_-8px_rgba(28,35,48,0.35)]";

/** 一张纸：原卷第一页（scripts/make_thumbs.py 生成）；没有图或 blank 就画一张有横线的空白纸 */
function Sheet({ id, blank, frame, className, style }: { id?: string; blank?: boolean; frame?: boolean; className?: string; style?: CSSProperties }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={cn("block overflow-hidden rounded-[3px] bg-white", THUMB_SHADOW, frame && "p-[2px]", className)} style={{ aspectRatio: "210 / 297", ...style }}>
      <span className="relative block size-full overflow-hidden rounded-[2px] bg-white">
        {id && ok && !blank ? (
          <img src={`/papers/pdf/${encodeURIComponent(id)}.thumb.jpg`} alt="" draggable={false} onError={() => setOk(false)} className="size-full object-cover object-top" />
        ) : (
          <span className="absolute inset-[16%_14%] bg-[repeating-linear-gradient(var(--line)_0_1px,transparent_1px_6px)] opacity-80" />
        )}
      </span>
    </span>
  );
}

/**
 * 试卷缩略图。frame：2px 白边（试卷架上的卷子）；
 * fan：三页错开的扇形——第一页是原卷，后两页只露出边（接着做题）
 */
export function PaperThumb({ id, width = 72, frame, fan, className, children }: { id: string; width?: number; frame?: boolean; fan?: boolean; className?: string; children?: ReactNode }) {
  if (fan) {
    const h = (width * 297) / 210;
    return (
      <span className={cn("relative block flex-none", className)} style={{ width: width + 12, height: h + 6 }}>
        <Sheet blank className="absolute bottom-0 left-1.5 origin-bottom rotate-[-4deg]" style={{ width }} />
        <Sheet blank className="absolute bottom-0 left-1.5 origin-bottom rotate-[4deg]" style={{ width }} />
        <Sheet id={id} frame={frame} className="absolute bottom-0 left-1.5" style={{ width }} />
        {children}
      </span>
    );
  }
  return (
    <span className={cn("relative block flex-none", className)} style={{ width }}>
      <Sheet id={id} frame={frame} />
      {children}
    </span>
  );
}

/** 回形针：夹在卡片左上角，压住缩略图 */
export function Clip({ className, style }: { className?: string; style?: CSSProperties }) {
  const d = "M8 16V33A3 3 0 0 0 14 33V9A5 5 0 0 0 4 9V35A7 7 0 0 0 18 35V18";
  return (
    <svg viewBox="0 0 20 46" width={18} height={42} className={cn("pointer-events-none absolute z-10 drop-shadow-[0_1.5px_1px_rgba(28,35,48,0.28)]", className)} style={style} aria-hidden>
      <path d={d} fill="none" stroke="#8a929c" strokeWidth="2.3" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" transform="translate(-0.5 -0.4)" />
    </svg>
  );
}

/**
 * 便签索引：从卡片边上伸出的小标签（纸-200 底、墨字），像档案夹上的索引。
 * vertical：竖着贴在左边（试卷架的年份）；默认横着贴在上边（设置的分组）
 */
export function StickyTab({ children, vertical, className }: { children: ReactNode; vertical?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center bg-[var(--paper-200)] font-semibold text-[var(--ink-700)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(28,35,48,0.08)]",
        vertical ? "w-9 justify-center rounded-l-[8px] py-3 [writing-mode:vertical-rl]" : "h-7 rounded-t-[8px] px-3 text-[12px] tracking-[0.08em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// 画过的荧光笔不再画第二遍（切页回来直接显示）
const drawn = new Set<string>();

/** 荧光笔划痕：标题关键词背后一道荧光黄、两端不齐；第一次进入视口时从左往右 240ms 画出来 */
export function Highlight({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = typeof children === "string" ? children : "";
  const [wait, setWait] = useState(() => typeof IntersectionObserver !== "undefined" && !drawn.has(key) && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!wait || !ref.current) return;
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        drawn.add(key);
        setWait(false);
        io.disconnect();
      },
      { threshold: 0.6 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [wait, key]);
  return (
    <span ref={ref} className={cn("hl hl-draw", wait && "hl-wait", className)}>
      {children}
    </span>
  );
}

/** 装订孔：答题卡顶上一排三个孔，透出桌面 */
export function Punch({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-center gap-12", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-[11px] rounded-full bg-[var(--paper-200)] shadow-[inset_0_1.5px_2px_rgba(28,35,48,0.32),0_1px_0_rgba(255,255,255,0.95)]" />
      ))}
    </div>
  );
}

/** 滚动时看现在读到哪一年（顶边过了 140px 的最后一个） */
export function useCurrentYear(years: number[]) {
  const [cur, setCur] = useState<number | undefined>(years[0]);
  const key = years.join(",");
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let c = years[0];
        for (const y of years) if ((document.getElementById(`y${y}`)?.getBoundingClientRect().top ?? Infinity) <= 140) c = y;
        setCur(c);
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
    };
    // key 概括了 years
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cur;
}
