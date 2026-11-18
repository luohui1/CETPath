import type { ReactNode } from "react";
import type { TransResult } from "@/lib/trans";
import { cn } from "@/lib/utils";

/*
 * 做题页里"卡片"的共用小件：解析卡、查词卡用同一套层次——
 * 小节：小标题在上（13px 灰、半粗），内容在下；原文块：浅底、左边一道蓝线，上面一行是出处和按钮，下面是衬线体的原句。
 */

/** 一个小节：标题在上，右边可以放一个动作；内容在下 */
export function CardSection({ label, action, children, className }: { label: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h4 className="mb-1.5 flex min-h-6 items-center gap-2 text-[13px] font-semibold text-[var(--ink-500)]">
        {label}
        {action && <span className="ml-auto flex items-center">{action}</span>}
      </h4>
      {children}
    </section>
  );
}

/**
 * 原文块：出处一行（右边放"在卷面上标出""听这一句"），衬线体的原句，下面可以跟一行译文。
 * 译文 2026-11-12 从 13px 浅灰调到 15px 深灰（用户："很小，我都没看到"）；subClassName 可以再改
 */
export function QuoteBlock({
  caption,
  actions,
  children,
  sub,
  subClassName,
  className,
}: {
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  subClassName?: string;
  className?: string;
}) {
  return (
    <figure className={cn("rounded-[10px] bg-[var(--paper-50)] py-2.5 pr-3 pl-3.5 shadow-[inset_2px_0_0_var(--blue-line),inset_0_0_0_1px_var(--line-soft)]", className)}>
      {(caption || actions) && (
        <figcaption className="-mt-0.5 mb-1 flex min-h-8 flex-wrap items-center gap-x-2 text-[13px] text-[var(--ink-500)]">
          {caption}
          {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
        </figcaption>
      )}
      <blockquote className="serif text-[15px] leading-[1.6] text-[var(--ink)]">{children}</blockquote>
      {sub && <p className={cn("mt-1.5 text-[15px] leading-[1.7] text-[var(--ink-700)]", subClassName)}>{sub}</p>}
    </figure>
  );
}

/** 原文块里的小按钮（蓝字、浅蓝底悬停，32px 高） */
export function QuoteAction({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-[var(--blue)] transition-colors hover:bg-[var(--blue-tint)] active:bg-[var(--blue-tint)]">
      {icon}
      {children}
    </button>
  );
}

/** "AI 译文"小章：和解析卡的"AI 解析"一个样子 */
export function AiTransTag() {
  return <span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">AI 译文</span>;
}

/**
 * 一句的译文：上面英文原句（衬线，点到的词加粗），下面中文译文，右上角"AI 译文"小章；没有译文写一句"这句还没有译文"。
 * 这里译文就是要看的东西：18px 墨色，比英文还醒目（以前 13px 浅灰，用户看不到）
 */
export function TransQuote({ sentence, word, nth, trans }: { sentence: string; word?: string; nth?: number; trans: TransResult }) {
  return (
    <QuoteBlock
      actions={trans.text ? <AiTransTag /> : undefined}
      sub={!trans.ready ? "正在取译文…" : (trans.text ?? "这句还没有译文")}
      subClassName={trans.text ? "mt-2 text-[18px] leading-[1.7] text-[var(--ink)]" : "text-[var(--ink-500)]"}
    >
      <MarkWord text={sentence} word={word} nth={nth} />
    </QuoteBlock>
  );
}

/** 句子里把某个词（含它的变形）加粗、下面一道浅蓝线；给了 nth 就只标第 nth 处（从 0 数，"the" 这类一句里好几个的只标点到的那个） */
export function MarkWord({ text, word, nth }: { text: string; word?: string; nth?: number }) {
  if (!word) return <>{text}</>;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(\\b${esc}\\w*)`, "gi"));
  const count = (parts.length - 1) / 2;
  const only = nth !== undefined && nth < count ? nth * 2 + 1 : null;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 && (only === null || i === only) ? (
          <b key={i} className="font-semibold underline decoration-[var(--blue-line)] decoration-2 underline-offset-[3px]">
            {p}
          </b>
        ) : (
          p
        ),
      )}
    </>
  );
}
