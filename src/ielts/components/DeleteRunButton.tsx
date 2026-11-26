import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { deleteIeltsAttempt, isIeltsRunEmpty } from "../store";
import type { IeltsAttemptRow } from "../types";

/**
 * 删除单条雅思做题记录按钮：
 * - 若该记录尚未作答任何题目且未交卷（例如刚点进考场看了一眼），单击立即删除；
 * - 若已有作答进度或已交卷，第一次点击变为红底「确认删除」，3 秒内再次点击才真正删除，防止误删成绩。
 */
export function DeleteRunButton({
  run,
  label,
  iconOnly = false,
  className,
  onDeleted,
}: {
  run: IeltsAttemptRow;
  label?: string;
  iconOnly?: boolean;
  className?: string;
  onDeleted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isIeltsRunEmpty(run) || confirming) {
      setConfirming(false);
      void deleteIeltsAttempt(run.id).then(() => onDeleted?.());
    } else {
      setConfirming(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={confirming ? "再次点击确认删除该记录" : (label ?? "删除这条记录")}
      aria-label={confirming ? "确认删除记录" : (label ?? "删除记录")}
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-[8px] text-[12.5px] font-medium transition-colors",
        confirming
          ? "h-7 bg-[var(--red)] px-2.5 text-white shadow-xs"
          : iconOnly
            ? "size-8 text-[var(--ink-400)] hover:bg-[var(--red-tint)] hover:text-[var(--red)]"
            : "h-7 px-2 text-[var(--ink-500)] hover:bg-[var(--red-tint)] hover:text-[var(--red)]",
        className,
      )}
    >
      <Trash className="size-3.5 shrink-0" />
      {confirming ? "确认删除" : !iconOnly && (label ?? "删除")}
    </button>
  );
}
