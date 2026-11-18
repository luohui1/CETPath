// 浮层：文字提示用 Grasso 的 Tooltip；对话框是一张浮起的纸（自己画，不带通用图标）
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as G from "@/grasso";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

/** 图标按钮的文字提示，可带快捷键；children 必须是一个可聚焦元素 */
export function Tip({ label, kbd, side = "bottom", children }: { label: string; kbd?: string; side?: "top" | "bottom"; children: ReactElement }) {
  return (
    <G.Tooltip
      side={side}
      content={
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {label}
          {kbd && <G.Kbd>{kbd}</G.Kbd>}
        </span>
      }
    >
      {children}
    </G.Tooltip>
  );
}

/** 对话框：桌面暗一点，中间浮起一张纸；board 时顶上一道红线（交卷单）。Esc、点空白处关闭 */
export function PaperDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 420,
  board,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  board?: boolean;
  className?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, [href], input, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="animate-pop fixed inset-0 z-[80] grid place-items-center bg-[rgba(28,35,48,0.3)] p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} className={cn("card card-float w-full rounded-[14px] p-6", board && "board pt-8", className)} style={{ maxWidth: width }}>
        <h2 id={id} className="t-h2">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-[14px] leading-[22px] text-[var(--ink-500)]">{description}</p>}
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** 确认对话框：交卷、重做这类需要打断的操作；children 放在说明下面（交卷单的数字） */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  onConfirm,
  danger,
  board,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmText: string;
  onConfirm: () => void;
  danger?: boolean;
  board?: boolean;
  children?: ReactNode;
}) {
  return (
    <PaperDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      description={description}
      board={board}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      {children}
    </PaperDialog>
  );
}
