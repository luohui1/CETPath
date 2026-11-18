import { useEffect, useState } from "react";
import type { MarkRow } from "@/lib/marks";
import type { Paper, PdfWordsPage } from "@/lib/papers";
import { canShareFile, deliverPdf, exportNotesPdf, notesFileName, type AnswerSheet } from "@/lib/exportPdf";
import { PaperDialog } from "@/components/overlay";
import { Button, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * 导出带笔记的 PDF：可选附答题情况，导出时显示进度。
 * 桌面导完直接下载；平板导完再点一次"分享"（分享面板要用户亲手点，导出要几秒，等不了）
 */
export function ExportDialog({ open, onClose, paper, pages, marks, sheet }: { open: boolean; onClose: () => void; paper: Paper; pages: PdfWordsPage[]; marks: MarkRow[]; sheet: AnswerSheet | null }) {
  const [withSheet, setWithSheet] = useState(true);
  const [phase, setPhase] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const name = notesFileName(paper);
  useEffect(() => {
    if (!open) return;
    setPhase("idle");
    setProgress(0);
    setBytes(null);
  }, [open]);

  const run = async () => {
    setPhase("working");
    try {
      const out = await exportNotesPdf({ paper, pages, marks, sheet: withSheet ? sheet : null, onProgress: (d, t) => setProgress(t ? d / t : 0) });
      if (canShareFile()) {
        setBytes(out);
        setPhase("ready");
      } else {
        await deliverPdf(out, name, false);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  return (
    <PaperDialog
      open={open}
      onClose={() => phase !== "working" && onClose()}
      title="导出带笔记的 PDF"
      description={<span className="break-all">{name}</span>}
      footer={
        <>
          <Button onClick={onClose} disabled={phase === "working"}>
            {phase === "ready" ? "关闭" : "取消"}
          </Button>
          {phase === "ready" && bytes ? (
            <Button variant="primary" onClick={() => void deliverPdf(bytes, name, true).then((r) => r !== "cancelled" && onClose())}>
              分享 / 存储
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void run()} loading={phase === "working"}>
              导出
            </Button>
          )}
        </>
      }
    >
      <div className="mt-5 space-y-4">
        <p className="text-[14px] text-[var(--ink-700)]">{marks.length ? `卷面上的 ${marks.length} 条笔记会画在原卷上。` : "这套卷子还没有笔记，导出的是原卷。"}</p>
        {sheet && (
          <label className={cn("flex min-h-10 cursor-pointer items-center gap-3 text-[14px]", phase !== "idle" && "pointer-events-none opacity-60")}>
            <input type="checkbox" checked={withSheet} onChange={(e) => setWithSheet(e.target.checked)} className="size-[18px] accent-[var(--blue)]" />
            最后附一页答题情况
          </label>
        )}
        {phase !== "idle" && <ProgressBar value={phase === "working" ? progress : 1} label="导出进度" />}
        {phase === "error" && <p className="text-[14px] text-[var(--red)]">导出失败：{error}</p>}
      </div>
    </PaperDialog>
  );
}
