import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import type { Question } from "@/lib/papers";
import type { TransLookup } from "@/lib/trans";
import { cn } from "@/lib/utils";
import { ExplanationCard } from "./Explanation";
import { TransQuote } from "./cardParts";

/**
 * 底部条放的东西，同一时间只放一样：
 * explain 一道题的解析（cue 是认题用的一小段原文，locked 是练习模式还没作答）；sentence 长按一句出的译文。
 * 查词 2026-11-12 起不在这里了：改成词旁边的小卡片（WordCard）
 */
export type BarContent = { kind: "explain"; q: Question; id: string; cue: string; locked: boolean } | { kind: "sentence"; id: string; sentence: string };

/** 竖屏底部抽屉开着时，底部条的内容变成抽屉里临时出现的标签：标签上写什么 */
export function barLabel(c: BarContent) {
  return c.kind === "explain" ? `解析 ${c.q.number}` : "译句";
}

/** 解析头上的上一题、下一题：40px 高，图标在文字外侧 */
function StepButton({ label, disabled, onClick, icon, after }: { label: string; disabled: boolean; onClick: () => void; icon: ReactNode; after?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-10 flex-none items-center gap-0.5 rounded-full text-[13px] text-[var(--ink-700)] transition hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)] disabled:text-[var(--ink-300)] disabled:hover:bg-transparent",
        after ? "pr-2 pl-3" : "pr-3 pl-2",
      )}
    >
      {!after && icon}
      {label}
      {after && icon}
    </button>
  );
}

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button type="button" onClick={onClose} aria-label="关闭" className="flex size-10 flex-none items-center justify-center rounded-full text-[var(--ink-500)] transition hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]">
    <X className="size-4" />
  </button>
);

/**
 * 卷面那一栏底边的条（排在卷面下面，不盖在卷面上）：点了选项条上的"解析"放这道题的解析（最高 50% 高），
 * 长按一句是这句的译文（最高 40%）；同一时间只放一样，里面滚动，卷面不动。选项本身在卷面上题号下面（ChoiceStrip）。
 * 解析头上有上一题、下一题：换题时解析开着，跟着换。卷面滚动不收起；点卷面空白处、Esc、✕ 收起。
 * embedded：竖屏底部抽屉开着时，这些内容作为抽屉里的临时标签放进抽屉，不再另起一条。
 * onHeight 告诉考场条有多高（条高度变了，把正在做的那一题重新让到可见区域）
 */
export function AnswerBar({
  content,
  mine,
  trans,
  embedded,
  onClose,
  step,
  onHeight,
}: {
  content: BarContent;
  mine?: string | null; // 解析里要不要对答案（交卷后、练习模式选过）：见 ExplanationCard
  trans: TransLookup;
  embedded?: boolean;
  onClose: () => void;
  step?: { prev: boolean; next: boolean; go: (dir: 1 | -1) => void }; // 解析头上的上一题、下一题
  onHeight?: (h: number) => void;
}) {
  const self = useRef<HTMLElement>(null);

  // Esc 收起（查词卡片开着时它先收）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || (e.target instanceof HTMLElement && e.target.closest("input, textarea"))) return;
      if (document.querySelector("[data-word-card]")) return;
      e.preventDefault();
      onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const report = useRef(onHeight);
  report.current = onHeight;
  useLayoutEffect(() => {
    const el = self.current;
    if (!el || embedded) return;
    report.current?.(el.offsetHeight);
    const ro = new ResizeObserver(() => report.current?.(el.offsetHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      report.current?.(0);
    };
  }, [embedded]);

  return (
    <section
      ref={self}
      data-answer-bar
      role="region"
      aria-label={content.kind === "explain" ? `第 ${content.q.number} 题解析` : "译句"}
      className={cn(
        "no-print flex flex-col bg-white",
        embedded
          ? "min-h-0 flex-1"
          : cn("animate-bar-in relative z-[28] shrink-0 border-t border-[var(--line)] shadow-[var(--elev-2)]", content.kind === "explain" ? "max-h-[50%]" : "max-h-[40%]"),
      )}
    >
      {content.kind === "explain" ? (
        <>
          {/* 解析：头一行是第几题和认题的那段原文（一眼对得上是哪道题），右边上一题、下一题、✕；下面是解析卡 */}
          <div className={COLUMN}>
            <div className="flex h-12 items-center gap-1 pr-1 pl-4">
              <span className="serif flex-none text-[15px] font-semibold text-[var(--ink)]">第 {content.q.number} 题</span>
              <span className="min-w-0 flex-1 truncate pr-2 pl-2 text-[13px] text-[var(--ink-500)]">{content.cue}</span>
              {step && (
                <>
                  <StepButton label="上一题" disabled={!step.prev} onClick={() => step.go(-1)} icon={<CaretLeft className="size-4" weight="bold" />} />
                  <StepButton label="下一题" disabled={!step.next} onClick={() => step.go(1)} icon={<CaretRight className="size-4" weight="bold" />} after />
                </>
              )}
              <CloseButton onClose={onClose} />
            </div>
          </div>
          {/* 换题从头看起：抽屉按题换一个 */}
          <DrawerBody key={content.id}>
            {content.locked ? <p className="py-2 text-[14px] text-[var(--ink-500)]">先作答，再看解析</p> : <ExplanationCard q={content.q} mine={mine} />}
          </DrawerBody>
        </>
      ) : (
        <>
          {/* 长按一句：这句的译文。卷面上这句淡黄底，收起时去掉 */}
          <div className={COLUMN}>
            <div className="flex h-12 items-center gap-2 pr-1 pl-4">
              <span className="flex-1 text-[15px] font-semibold text-[var(--ink)]">译句</span>
              <CloseButton onClose={onClose} />
            </div>
          </div>
          <DrawerBody>
            <TransQuote sentence={content.sentence} trans={trans(content.sentence)} />
          </DrawerBody>
        </>
      )}
    </section>
  );
}

/** 抽屉：条下面那一块，里面滚动 */
// 条上那一行和下面的抽屉在同一列里（横屏宽的时候居中，左边对齐）
const COLUMN = "mx-auto w-full max-w-[880px]";

const DrawerBody = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--line-soft)] pt-3 pb-4">
    <div className={cn(COLUMN, "px-4")}>{children}</div>
  </div>
);
