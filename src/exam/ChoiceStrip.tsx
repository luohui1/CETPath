import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { BookmarkSimple, CaretLeft, CaretRight, Lightbulb } from "@phosphor-icons/react";
import type { Box, PdfWordsPage, Question } from "@/lib/papers";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/overlay";

/** 题目选项条打开时：字母键选答案，Shift+字母划掉，R 标记（判过之后只能标记），← → 上一题、下一题，Esc 收起 */
function useChoiceKeys(p: { q: Question; judged: boolean; explaining: boolean; onChoose: (key: string) => void; onStrike: (key: string) => void; onFlag: () => void; onStep: (dir: 1 | -1) => void; onClose: () => void }) {
  const ref = useRef(p);
  ref.current = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { q, judged, explaining, onChoose, onStrike, onFlag, onStep, onClose } = ref.current;
      // Esc：底下开着解析时先收解析（那边自己处理），否则收起选项条
      if (e.key === "Escape") {
        if (!explaining) onClose();
        return;
      }
      // 底下开着解析时也一样翻题，解析跟着换
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        onStep(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      const key = e.key.toUpperCase();
      const isOption = q.options!.some((o) => o.key === key);
      if (key === "R" && !isOption) {
        e.preventDefault();
        onFlag();
      } else if (isOption && !judged) {
        e.preventDefault();
        if (e.shiftKey) onStrike(key);
        else onChoose(key);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

export interface ChoiceStripProps {
  q: Question;
  box: Box; // 题号（或完形空位）的框
  inline: boolean; // 题号在行中间
  data: PdfWordsPage;
  limit: number; // 这一页显示到哪儿（PDF 点，专项训练截掉的部分不算）：条放不下就放到题号上面
  scale: number;
  chosen?: string;
  judged: boolean; // 交卷后，或练习模式选过
  flagged: boolean;
  struck: string[];
  explainable: boolean; // 能不能看解析（全真模拟交卷前不能）
  explaining: boolean; // 底下正在放这道题的解析
  canPrev: boolean;
  canNext: boolean;
  onChoose: (key: string) => void;
  onStrike: (key: string) => void;
  onFlag: () => void;
  onExplain: () => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}

/** 条上的小图标按钮：32 宽、28 高（条高 32），点按区域上下各补 2px；tone 换掉默认的灰色 */
function StripIcon({ label, tip, kbd, pressed, tone, disabled, onClick, children }: { label: string; tip?: string; kbd?: string; pressed?: boolean; tone?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={tip ?? label} kbd={kbd}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={pressed}
        aria-label={label}
        className={cn(
          "relative grid h-7 w-8 flex-none place-items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] disabled:cursor-default disabled:text-[var(--ink-300)] disabled:hover:bg-transparent",
          tone ?? "text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

/**
 * 卷面上的选项条：点了题号就贴着题号出来，一排小字母，后面是"标记""解析"和上一题、下一题。
 * 页边题号（听力、阅读选择题）贴在题号正上方，不挡下面的选项文字；上面没地方才放下面。
 * 题号在行中间的（选词填空、完形空位）以题号为中心、贴在下面，离页面底边不够一条高就放到上面。
 * 跟着卷面滚动；选完留在这道题上，不自动跳题。出了页面右边整体左移。选项是词的（完形）写出词，排不下就换行
 */
export function ChoiceStrip(p: ChoiceStripProps) {
  const { q, chosen, judged, struck, scale } = p;
  useChoiceKeys(p);
  const words = q.options!.every((o) => o.text && o.text.length <= 28);
  const out = (key: string) => struck.includes(key) && chosen !== key;
  const tone = (key: string) => {
    // 判过之后：正确项描蓝，选错的红底
    if (judged && q.answer === key) return "bg-[var(--blue-tint)] text-[var(--blue)] shadow-[inset_0_0_0_1.5px_var(--blue)]";
    if (chosen === key) return judged ? "bg-[var(--red)] text-white" : "bg-primary text-primary-fg";
    if (out(key)) return "text-[var(--ink-300)]";
    return "text-[var(--ink)] group-hover:bg-[var(--blue-tint)] group-hover:text-[var(--blue)]";
  };
  // 普通点击选答案；按住 Shift 点是划掉或恢复
  const click = (e: MouseEvent, key: string) => (e.shiftKey ? p.onStrike(key) : p.onChoose(key));

  // 条的宽高量出来再定位（宽度不随位置变：max-content，最宽到页宽减两边 8px）；量到之前先按估计的
  const self = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = self.current;
    if (!el) return;
    const measure = () => setSize((s) => (s && s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageW = p.data.width * scale;
  const n = q.options!.length;
  const w = size?.w ?? (words ? Math.min(pageW - 16, 520) : n * 31 + 141);
  const h = size?.h ?? 32;
  const [x0, y0, x1, y1] = p.box;
  // 页边的题号：左边和题号对齐；行中间的：以题号为中心。都不出页面
  const want = p.inline ? ((x0 + x1) / 2) * scale - w / 2 : x0 * scale;
  const left = Math.max(8, Math.min(want, pageW - w - 8));
  const below = y1 * scale + 2;
  const above = y0 * scale - 2 - h;
  // 页边题号（选择题）：放在题号上面，不挡下面 A)B)C)D) 的选项文字（放下面会把 A 项整行盖住）；上面没地方才放下面。
  // 行中间的题号（完形、选词）：放下面，底边不够再放上面
  const top = p.inline ? (below + h > p.limit * scale - 4 ? above : below) : above >= 4 ? above : below;

  return (
    <div
      ref={self}
      data-choice-strip
      role="group"
      aria-label={`第 ${q.number} 题的选项`}
      className={cn("animate-pop absolute z-[12] flex items-center gap-px rounded-[8px] bg-white p-0.5 shadow-[var(--elev-2)]", words && "flex-wrap")}
      style={{ left, top, width: "max-content", maxWidth: pageW - 16 }}
    >
      {q.options!.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={judged}
          onClick={(e) => click(e, o.key)}
          aria-pressed={chosen === o.key}
          aria-label={words ? undefined : `选 ${o.key}`}
          className="group relative flex h-7 flex-none items-center px-px before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] disabled:cursor-default"
        >
          {words ? (
            <span className={cn("flex h-7 items-center gap-1 rounded-full pr-2.5 pl-1 transition-colors", tone(o.key))}>
              <span className="num w-5 text-center text-[12px] font-semibold">{o.key}</span>
              <span className={cn("font-serif text-[13px] whitespace-nowrap", out(o.key) && "line-through decoration-[1.5px]")}>{o.text}</span>
            </span>
          ) : (
            <span className={cn("relative grid size-7 place-items-center rounded-full text-[13px] font-semibold transition-colors", tone(o.key))}>
              {o.key}
              {/* 划掉的选项加一道斜线 */}
              {out(o.key) && <span className="pointer-events-none absolute inset-x-1 top-1/2 h-[1.5px] -rotate-45 rounded-full bg-[var(--ink-300)]" />}
            </span>
          )}
        </button>
      ))}
      <span className="mx-1 h-4 w-px flex-none bg-[var(--line)]" aria-hidden />
      <StripIcon label={p.flagged ? "取消标记" : "标记待检查"} tip={p.flagged ? "取消标记" : "标记待检查（R）"} pressed={p.flagged} tone={p.flagged ? "text-[var(--star-ink)]" : undefined} onClick={p.onFlag}>
        <BookmarkSimple className="size-4" weight={p.flagged ? "fill" : "duotone"} />
      </StripIcon>
      {(judged || p.explainable) && (q.explain || q.explanation) && (
        <StripIcon label="解析" pressed={p.explaining} tone={p.explaining ? "bg-[var(--blue-tint)] text-[var(--blue)]" : undefined} onClick={p.onExplain}>
          <Lightbulb className="size-4" weight={p.explaining ? "fill" : "duotone"} />
        </StripIcon>
      )}
      <StripIcon label="上一题" kbd="←" disabled={!p.canPrev} onClick={() => p.onStep(-1)}>
        <CaretLeft className="size-4" weight="bold" />
      </StripIcon>
      <StripIcon label="下一题" kbd="→" disabled={!p.canNext} onClick={() => p.onStep(1)}>
        <CaretRight className="size-4" weight="bold" />
      </StripIcon>
    </div>
  );
}
