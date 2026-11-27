import { Check, Shuffle, WarningCircle } from "@phosphor-icons/react";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { StudioSegment, WrongAudioTarget } from "./materials";
import type { StudioProgress } from "./storage";

export type MaterialSource = "wrong" | "cet4" | "cet6";

export interface PaperOption {
  id: string;
  title: string;
  wrongTarget?: WrongAudioTarget;
}

/** 对话角色方章（对齐考场 ListeningBar：M 实心墨方章白字，W 空心描边方章墨字） */
export function SpeakerTag({ speaker, reliable = true }: { speaker?: string; reliable?: boolean }) {
  if (!speaker) return null;
  const isM = speaker === "M";
  const label = reliable
    ? speaker.slice(0, 1).toUpperCase()
    : speaker === "M"
      ? "A"
      : speaker === "W"
        ? "B"
        : speaker.slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex size-[18px] flex-none items-center justify-center rounded-[4px] text-[11px] leading-none font-bold select-none",
        reliable
          ? isM
            ? "bg-[var(--ink)] text-white"
            : "bg-white text-[var(--ink)] shadow-[inset_0_0_0_1.5px_var(--ink)]"
          : "bg-[var(--paper-200)] text-[var(--ink-700)]",
      )}
      title={reliable ? (isM ? "男声 (M)" : "女声 (W)") : `说话人 ${label}`}
    >
      {label}
    </span>
  );
}

export function MaterialBar({
  source,
  onSourceChange,
  wrongCount,
  papers,
  paperId,
  onPaperChange,
  segments,
  segId,
  onSegChange,
  onRandom,
  loadingPack,
  progress,
  tabMode,
  wrongQNumbers,
  cachePct,
}: {
  source: MaterialSource;
  onSourceChange: (s: MaterialSource) => void;
  wrongCount: number;
  papers: PaperOption[];
  paperId: string;
  onPaperChange: (id: string) => void;
  segments: StudioSegment[];
  segId: string;
  onSegChange: (id: string) => void;
  onRandom: () => void;
  loadingPack: boolean;
  progress: StudioProgress;
  tabMode: "dictation" | "shadowing";
  wrongQNumbers: number[];
  cachePct?: number | null;
}) {
  const wrongSet = new Set(wrongQNumbers);
  const sources: { id: MaterialSource; label: string; count?: number }[] = [
    ...(wrongCount > 0 ? [{ id: "wrong" as const, label: "错题联动", count: wrongCount }] : []),
    { id: "cet6", label: "六级真题" },
    { id: "cet4", label: "四级真题" },
  ];
  const activeSeg = segments.find((x) => x.id === segId);

  return (
    <Card className="mb-4 p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="选材范围">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={source === s.id}
              onClick={() => onSourceChange(s.id)}
              className={cn("pill inline-flex items-center gap-1.5", source === s.id && "pill-on")}
            >
              {s.id === "wrong" && <WarningCircle className="size-3.5 text-[var(--red)]" weight="fill" />}
              <span>{s.label}</span>
              {s.count !== undefined && (
                <span className="num rounded-full bg-[var(--red-tint)] px-1.5 py-px text-[11px] font-semibold text-[var(--red)]">
                  {s.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[260px]">
          <select
            aria-label="选择真题试卷"
            value={paperId}
            onChange={(e) => onPaperChange(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-[9px] border border-[var(--line)] bg-[var(--paper-50)] px-3 text-[13px] font-medium text-[var(--ink)] outline-none focus:border-[var(--blue)]"
          >
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.wrongTarget ? `（错题 Q${p.wrongTarget.qNumbers.join(",")}）` : ""}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={onRandom} disabled={loadingPack || papers.length === 0}>
            <Shuffle className="size-3.5" />
            随机换一段
          </Button>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--line-soft)] pt-2.5">
          <span className="mr-1 text-[12px] text-[var(--ink-500)]">片段：</span>
          {segments.map((s) => {
            const key = `${paperId}:${s.id}`;
            const dStat = progress.dictation[key];
            const shStat = progress.shadowing[key];
            const done = tabMode === "dictation" ? !!dStat : !!shStat && shStat.doneLines > 0;
            const hasWrong = s.questions.some((q) => wrongSet.has(q.number));
            const isSel = s.id === segId;

            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSegChange(s.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition",
                  isSel
                    ? "bg-[var(--blue)] text-white"
                    : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:border-[var(--blue-line)] hover:bg-[var(--paper-50)]",
                )}
              >
                <span>{s.shortLabel}</span>
                {s.hasDialogue && (
                  <span
                    className={cn(
                      "rounded px-1 text-[10px]",
                      isSel ? "bg-white/20 text-white" : "bg-[var(--blue-tint)] text-[var(--blue)]",
                    )}
                  >
                    对话
                  </span>
                )}
                {hasWrong && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isSel ? "bg-[#ffd666]" : "bg-[var(--red)]",
                    )}
                    title="包含错题本中的听力题"
                  />
                )}
                {done && (
                  <Check
                    className={cn("size-3.5", isSel ? "text-white" : "text-[var(--green)]")}
                    weight="bold"
                  />
                )}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2">
            {cachePct === 1 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--green-tint)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--green-dark)]">
                <span className="size-1.5 rounded-full bg-[var(--green)]" />
                原声已缓存
              </span>
            ) : cachePct !== null && cachePct !== undefined && cachePct >= 0 && cachePct < 1 ? (
              <span className="num inline-flex items-center gap-1 rounded-full bg-[var(--blue-tint)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--blue)]">
                原声缓存 {Math.floor(cachePct * 100)}%
              </span>
            ) : null}

            {activeSeg && (
              <Badge tone="neutral">
                <span className="num">{activeSeg.lines.length}</span> 句原声
              </Badge>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
