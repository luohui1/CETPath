import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Agent 回答和卷面的连接：点引用的原文滚到卷面那一句并闪一下，点“第 N 题”跳到那题。只在做题页有 */
export type PaperLink = {
  locate: (text: string) => boolean;
  question: (n: number) => boolean;
};
export const PaperLinkCtx = createContext<PaperLink | null>(null);
const usePaperLink = () => useContext(PaperLinkCtx);

const LINK =
  "cursor-pointer text-left underline decoration-dotted decoration-[1.5px] underline-offset-[3px] hover:decoration-solid";

export function Quote({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  const link = usePaperLink();
  const [miss, setMiss] = useState(false);
  if (!link || !/[A-Za-z]/.test(text))
    return <span className={className}>{children}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      title={miss ? "卷面上没找到这句" : "在卷面上看"}
      onClick={(e) => {
        e.stopPropagation();
        setMiss(!link.locate(text));
      }}
      onKeyDown={(e) => e.key === "Enter" && setMiss(!link.locate(text))}
      className={cn(className, LINK, miss && "no-underline")}
    >
      {children}
    </span>
  );
}

export function QLink({ n, children }: { n: number; children: ReactNode }) {
  const link = usePaperLink();
  if (!link) return <>{children}</>;
  return (
    <span
      role="button"
      tabIndex={0}
      title="跳到这题"
      onClick={() => link.question(n)}
      onKeyDown={(e) => e.key === "Enter" && link.question(n)}
      className={cn("font-medium text-[var(--blue)]", LINK)}
    >
      {children}
    </span>
  );
}
