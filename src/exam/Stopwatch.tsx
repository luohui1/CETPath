import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconStopwatch } from "@/components/icons";
import { Tip } from "@/components/overlay";
import { cn, formatDuration } from "@/lib/utils";

interface TimerState {
  qid: string | null; // 正在计的题；手动随便计时可以没有
  sec: number;
  running: boolean;
  /** 整节一起计（选词填空、长篇阅读、完形、新题型）：这一节的 id。每答一题记一段，接着计下一题 */
  set: string | null;
}

export interface QuestionTimer extends TimerState {
  /** 从 0 开始计这道题（先把手上那题记下）；set 是整节一起计时的那一节 */
  start: (qid: string, set?: string) => void;
  /** 选定答案：这道题的时间记下来，秒表归零等下一题 */
  commit: (qid?: string) => void;
  /** 整节计时里答了一题：从上一次到现在的时间记给它，接着计 next（没有就停） */
  lap: (qid: string, next: string | null) => void;
  toggle: () => void;
  reset: () => void;
}

const IDLE: TimerState = { qid: null, sec: 0, running: false, set: null };

/**
 * 单题秒表（B0.2）：页面可见时每秒走一格；时间在选定答案、换题、离开页面时记到 questionSec（累加）。
 * enabled 为 false（交卷了）时把手上的记下来并停住
 */
export function useQuestionTimer({ enabled, onCommit }: { enabled: boolean; onCommit: (qid: string, sec: number) => void }): QuestionTimer {
  const [state, setState] = useState<TimerState>(IDLE);
  const cur = useRef(state);
  const save = useRef(onCommit);
  save.current = onCommit;
  const set = useCallback((s: TimerState) => {
    cur.current = s;
    setState(s);
  }, []);
  const flush = useCallback(() => {
    const { qid, sec } = cur.current;
    if (qid && sec >= 1) save.current(qid, sec);
  }, []);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") set({ ...cur.current, sec: cur.current.sec + 1 });
    }, 1000);
    return () => clearInterval(t);
  }, [state.running, set]);

  // 交卷了、离开页面：手上这题的时间记下来
  useEffect(() => {
    if (enabled) return;
    flush();
    set(IDLE);
  }, [enabled, flush, set]);
  useEffect(() => flush, [flush]);

  const api = useMemo(
    () => ({
      start(qid: string, group?: string) {
        if (!enabled) return;
        if (cur.current.qid === qid && cur.current.set === (group ?? null)) return set({ ...cur.current, running: true });
        flush();
        set({ qid, sec: 0, running: true, set: group ?? null });
      },
      commit(qid?: string) {
        if (qid && cur.current.qid !== qid) return;
        flush();
        set(IDLE);
      },
      lap(qid: string, next: string | null) {
        const { sec, running } = cur.current;
        if (sec >= 1) save.current(qid, sec);
        set(next ? { ...cur.current, qid: next, sec: 0, running } : IDLE);
      },
      toggle() {
        if (enabled) set({ ...cur.current, running: !cur.current.running });
      },
      reset() {
        set({ ...cur.current, sec: 0, running: false });
      },
    }),
    [enabled, flush, set],
  );
  return { ...state, ...api };
}

/**
 * 工具栏右侧的秒表：左边"第 12 题"（点了跳过去），右边秒表 + mm:ss（衬线、墨色，超过建议时长变红）。
 * 点一下暂停/继续，长按归零
 */
export function Stopwatch({ timer, label, limit, onJump }: { timer: QuestionTimer; label?: string; limit?: number; onJump?: () => void }) {
  const press = useRef<{ t: ReturnType<typeof setTimeout>; long: boolean } | null>(null);
  const over = !!limit && timer.sec > limit;
  const idle = !timer.running && timer.sec === 0;
  const tip = timer.running ? "暂停（长按归零）" : timer.sec ? "继续（长按归零）" : "开始计时";
  return (
    <div className="flex items-center">
      {label && (
        <Tip label="跳到这道题">
          <button type="button" onClick={onJump} className="gr-tool px-2" aria-label={`正在计时：${label}，点了跳过去`}>
            <span className="gr-tool-text whitespace-nowrap text-[var(--ink-700)]">{label}</span>
          </button>
        </Tip>
      )}
      <Tip label={tip}>
        <button
          type="button"
          className={cn("gr-tool gap-1.5 px-2", timer.running && "bg-[var(--paper-50)]")}
          aria-label={`单题秒表 ${formatDuration(timer.sec)}，${tip}`}
          aria-pressed={timer.running}
          onPointerDown={() => {
            const p: { t?: ReturnType<typeof setTimeout>; long: boolean } = { long: false };
            p.t = setTimeout(() => {
              p.long = true;
              timer.reset();
            }, 600);
            press.current = p as { t: ReturnType<typeof setTimeout>; long: boolean };
          }}
          onPointerUp={() => press.current && clearTimeout(press.current.t)}
          onPointerLeave={() => press.current && clearTimeout(press.current.t)}
          onClick={() => {
            if (press.current?.long) return void (press.current = null);
            timer.toggle();
          }}
        >
          <IconStopwatch size={19} accent={timer.running ? "blue" : "none"} />
          <span className={cn("num min-w-[3.1em] text-left text-[15px]", over ? "text-[var(--red)]" : idle ? "text-[var(--ink-300)]" : timer.running ? "text-[var(--ink)]" : "text-[var(--ink-500)]")}>
            {formatDuration(timer.sec)}
          </span>
        </button>
      </Tip>
    </div>
  );
}
