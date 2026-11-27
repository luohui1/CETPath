import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { ArrowCounterClockwise, ChatCenteredText, Pause, Play } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { useClipAudio } from "./useClipAudio";

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

function fmtSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

/**
 * 句子可视化声学条：
 * 0 重渲染实时推进播放条，支持直接点击/拖动轨道任意位置切入重听，并提供「连听前句」与「重听」按钮。
 */
export function SentenceAudioBar({
  clip,
  playKey,
  start,
  end,
  loop = false,
  ctxStart,
  ctxKey,
  onBeforePlay,
  onEnded,
  badge,
  className,
}: {
  clip: ReturnType<typeof useClipAudio>;
  playKey: string;
  start: number;
  end: number;
  loop?: boolean;
  ctxStart?: number;
  ctxKey?: string;
  onBeforePlay?: () => void;
  onEnded?: () => void;
  badge?: ReactNode;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const curRef = useRef<HTMLSpanElement | null>(null);

  const dur = Math.max(0.1, end - start);
  const isThisMain = clip.activeKey === playKey && clip.status !== "idle";
  const isThisCtx = !!ctxKey && clip.activeKey === ctxKey && clip.status !== "idle";
  const isActiveAny = isThisMain || isThisCtx;
  const isLoading = isActiveAny && clip.loading;
  const isPlaying = isActiveAny && clip.playing;

  // 通过订阅直接操作 DOM，避免在输入听写期间触发 60fps 组件重渲染
  useEffect(() => {
    const applyRatio = (ratio: number, tSec: number) => {
      const pct = `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(2)}%`;
      if (fillRef.current) fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;
      if (curRef.current) curRef.current.textContent = fmtSeconds(tSec);
    };

    if (!isActiveAny) applyRatio(0, 0);

    return clip.subscribeProgress((info) => {
      if (info.key !== playKey && info.key !== ctxKey) return;
      const localRatio = (info.currentTime - start) / dur;
      applyRatio(localRatio, Math.max(0, Math.min(dur, info.currentTime - start)));
    });
  }, [clip, playKey, ctxKey, start, dur, isActiveAny]);

  const ratioAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return Math.max(0, Math.min(0.98, (e.clientX - box.left) / box.width));
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] px-3.5 py-2.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => {
          onBeforePlay?.();
          if (isThisCtx && ctxStart !== undefined && ctxKey) {
            clip.toggleRange(ctxKey, ctxStart, end, { loop: false, onEnded });
          } else {
            clip.toggleRange(playKey, start, end, { loop, onEnded });
          }
        }}
        aria-label={isPlaying ? "暂停" : "听这一句"}
        className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-[var(--blue)] text-white shadow-[0_2px_6px_-2px_rgba(22,119,255,0.45)] transition hover:bg-[var(--blue-hover)] active:scale-[0.97]"
      >
        {isLoading ? (
          <Spinner className="size-4 text-white" />
        ) : isPlaying ? (
          <Pause className="size-[18px]" weight="fill" />
        ) : (
          <Play className="ml-0.5 size-[18px]" weight="fill" />
        )}
      </button>

      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="num text-[var(--ink-700)]">
              <span ref={curRef} className="text-[var(--ink)]">
                0:00
              </span>{" "}
              / {fmtSeconds(dur)}
            </span>
            {isLoading && <span className="text-[11px] font-medium text-[var(--blue)]">缓冲原音…</span>}
            {isThisCtx && <span className="text-[11px] font-medium text-[var(--blue)]">前句衔接中</span>}
          </div>
          {badge}
        </div>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="句子原声进度条，点击可从该位置重听"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          onPointerDown={(e) => {
            onBeforePlay?.();
            clip.seekToRatio(ratioAt(e), start, end, { key: playKey, loop, onEnded });
          }}
          className="group relative flex h-4 cursor-pointer touch-none items-center"
        >
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--paper-200)]">
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)]"
              style={{ width: "0%" }}
            />
          </div>
          <span
            ref={thumbRef}
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(28,35,48,0.35),inset_0_0_0_1px_rgba(22,119,255,0.45)] transition-transform group-hover:scale-110"
            style={{ left: "0%" }}
          />
        </div>
      </div>

      <div className="flex flex-none items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            onBeforePlay?.();
            void clip.playRange(start, end, { key: playKey, loop, onEnded });
          }}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[var(--line)] bg-white px-2.5 text-[12px] font-medium text-[var(--ink-700)] hover:border-[var(--blue-line)] hover:text-[var(--blue)]"
          title="从头重听本句 (Ctrl + Space)"
        >
          <ArrowCounterClockwise className="size-3.5" /> 重听
        </button>

        {ctxStart !== undefined && ctxKey && (
          <button
            type="button"
            onClick={() => {
              onBeforePlay?.();
              clip.toggleRange(ctxKey, ctxStart, end, { loop: false, onEnded });
            }}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium transition",
              isThisCtx
                ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:border-[var(--blue-line)] hover:text-[var(--blue)]",
            )}
            title="带上上一句语境连听"
          >
            <ChatCenteredText className="size-3.5" />
            <span className="hidden sm:inline">连听前句</span>
            <span className="sm:hidden">带前句</span>
          </button>
        )}
      </div>
    </div>
  );
}
