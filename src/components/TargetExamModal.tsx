import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { CalendarBlank, Check } from "@phosphor-icons/react";
import { PaperDialog } from "@/components/overlay";
import { Button } from "@/components/ui";
import type { ExamId } from "@/lib/papers";
import { setSetting, useSettings, useSettingsReady } from "@/lib/settings";
import {
  applyTargetExam,
  inferExamFromName,
  resolveTargetExam,
  TARGET_EXAMS,
} from "@/lib/targetExam";
import { cn } from "@/lib/utils";

/**
 * 全局备考目标选择/切换弹窗：
 * 1) 当用户首次使用且尚未设置 targetExam 时，在非 /welcome 页面自动引导设定唯一备考目标；
 *    若旧版本已设置 examName + examDate，则静默回填 targetExam 不打断老用户；
 * 2) 也支持通过 open / onClose 受控打开，供侧边栏目标牌与首页倒计时切换。
 */
export function TargetExamModal({
  open: controlledOpen,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const settings = useSettings();
  const ready = useSettingsReady();
  const { pathname } = useLocation();
  const autoCheckedRef = useRef(false);

  const [autoOpen, setAutoOpen] = useState(false);
  const isOpen = Boolean(controlledOpen || autoOpen);

  const currentExam = resolveTargetExam(settings);
  const [picked, setPicked] = useState<ExamId>(currentExam);
  const [date, setDate] = useState<string>(settings.examDate ?? "");
  const [syncBook, setSyncBook] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPicked(resolveTargetExam(settings));
      setDate(settings.examDate ?? "");
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (!ready || autoCheckedRef.current) return;
    if (settings.targetExam) {
      autoCheckedRef.current = true;
      return;
    }
    if (pathname === "/welcome") return;

    const inferred = inferExamFromName(settings.examName);
    if (inferred && settings.examDate) {
      autoCheckedRef.current = true;
      void setSetting("targetExam", inferred);
      void setSetting("lastExam", inferred);
      return;
    }

    autoCheckedRef.current = true;
    setPicked(inferred ?? resolveTargetExam(settings));
    setAutoOpen(true);
  }, [ready, settings, pathname]);

  const handleClose = () => {
    setAutoOpen(false);
    onClose?.();
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await applyTargetExam(picked, {
        examDate: date ? date : null,
        syncBook,
      });
      setAutoOpen(false);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PaperDialog
      open={isOpen}
      onClose={handleClose}
      width={540}
      title="选择你的备考目标"
      description="设定后，全站真题、专项、听力精练、口语、错题本与统计均会聚焦该考种；日后可随时在左侧边栏底部或设置中切换。"
      footer={
        <>
          <Button onClick={handleClose} disabled={saving}>
            {settings.targetExam ? "取消" : "先用默认"}
          </Button>
          <Button variant="primary" onClick={() => void handleConfirm()} loading={saving}>
            <Check className="size-4" weight="bold" />
            确定目标
          </Button>
        </>
      }
    >
      <div className="mt-4 space-y-2">
        {TARGET_EXAMS.map((item) => {
          const active = picked === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPicked(item.id)}
              aria-pressed={active}
              className={cn(
                "relative flex w-full items-center gap-3 overflow-hidden rounded-[11px] border px-4 py-3 text-left transition",
                active
                  ? "border-[var(--blue)] bg-[var(--blue-tint)]/40 shadow-xs"
                  : "border-[var(--line)] bg-[var(--paper-50)] hover:border-[var(--ink-300)] hover:bg-white",
              )}
            >
              <span
                className={cn(
                  "flex size-5 flex-none items-center justify-center rounded-full border",
                  active
                    ? "border-[var(--blue)] bg-[var(--blue)] text-white"
                    : "border-[var(--line-control)] bg-white",
                )}
              >
                {active && <Check className="size-3" weight="bold" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-[var(--ink)]">{item.name}</span>
                  <span className="num rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink-500)] shadow-[inset_0_0_0_1px_var(--line)]">
                    {item.badge}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-[var(--ink-500)]">{item.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper-50)] px-3.5 py-2.5">
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink-700)]">
          <CalendarBlank className="size-4 text-[var(--ink-500)]" />
          <span>考试日期（可选）：</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 rounded-[7px] border border-[var(--line)] bg-white px-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--blue)]"
          />
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-[var(--ink-700)] select-none">
          <input
            type="checkbox"
            checked={syncBook}
            onChange={(e) => setSyncBook(e.target.checked)}
            className="size-3.5 accent-[var(--blue)]"
          />
          同步匹配对应词书
        </label>
      </div>
    </PaperDialog>
  );
}
