import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLineRight, ArrowUp, CaretDown, Check, Pause, Play, RepeatOnce, Scroll, SkipBack, SkipForward, X } from "@phosphor-icons/react";
import * as G from "@/grasso";
import type { AudioLine, PaperAudio } from "@/lib/papers";
import type { TransLookup } from "@/lib/trans";
import { cn, formatDuration } from "@/lib/utils";
import { Tip } from "@/components/overlay";
import { WordText } from "@/components/WordText";
import { AiTransTag } from "./cardParts";
import { AUDIO_CACHE } from "@/lib/audioCache";

/** 判过的题（交卷后、练习模式答过、从错题本来的那道）的答案句：第 seg 段第 i 句 */
export interface AnswerLine {
  seg: string;
  i: number;
  qid: string;
  n: number; // 题号
  judged: boolean; // 判过了；没判过的只在"答案句"开关打开时才显示
}

/** 判过的听力题（按题号）：正确答案和你选的，原文"问题"卡片里显示 */
export type JudgedQs = Record<number, { qid: string; answer?: string; mine?: string }>;

/** 读题行的题号和题干："Question 8. What…"、数据没洗干净的 "Q20; What…"、"20: What…" */
const Q_HEAD = /^\s*(?:Question\s*|Q\s*)?(\d{1,2})\s*[.．:：;；、]\s*|^\s*Question\s*(\d{1,2})\s+/i;
function questionParts(text: string) {
  const m = text.match(Q_HEAD);
  return m ? { n: Number(m[1] ?? m[2]), stem: text.slice(m[0].length).trim() } : { n: undefined, stem: text.trim() };
}
/** 有说话人字段时，文字里残留的 "M:"、"Woman:" 前缀去掉（和角色章重复） */
const SPEAKER_PREFIX = /^\s*(?:M|W|Man|Woman)\s*[:：]\s*/;

export interface ListeningBarHandle {
  /** 卷面上的播放键：从这一段开头播（再按一次暂停） */
  toggleSegment: (id: string) => void;
  /** 播这一句（segment 段里的第 index 句），播完停；单句重复开着就一直重复 */
  playLine: (segment: string, index: number) => void;
}

const RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const NUMS: Record<string, string> = { One: "1", Two: "2", Three: "3", Four: "4", Five: "5" };

/** News Report One -> News 1，Conversation Two -> Conv 2 */
function shortLabel(label: string) {
  return label
    .replace("News Report", "News")
    .replace("Conversation", "Conv")
    .replace("Passage", "Pass")
    .replace("Recording", "Rec")
    .replace(/ (One|Two|Three|Four|Five)$/, (_, n: string) => ` ${NUMS[n]}`);
}

/** 句子的种类（试卷数据里的 lines[].kind）：指导语、读题句（Questions 1 and 2 are based on…）、读题；原文没有 */
type Kind = "directions" | "cue" | "question";
const QUESTION_RE = /^Question\s*(\d+)\b/;
const CUE_RE = /^Questions?\s*(\d+)\s*(?:and|to|-)\s*(\d+)\s*(?:are\s*)?based\s*on/i;

/** 老数据（合成的样卷）没有 kind：读题、读题句按固定说法认，指导语不猜 */
function kindOf(l: AudioLine & { kind?: string }): Kind | undefined {
  if (l.kind === "directions" || l.kind === "cue" || l.kind === "question") return l.kind;
  if (QUESTION_RE.test(l.text)) return "question";
  if (CUE_RE.test(l.text)) return "cue";
  return undefined;
}

/** 全卷按时间排好的每一句 */
interface Line extends AudioLine {
  seg: string;
  i: number; // 段内第几句（lines 里的下标）
  index: number; // 全卷第几句
  kind?: Kind;
}

/** 只播一句：loop 为真就一直重复，否则播完停 */
type Range = { start: number; end: number; loop: boolean; index: number };

function ToolButton({ label, kbd, active, onClick, children, disabled }: { label: string; kbd?: string; active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tip label={label} kbd={kbd} side="top">
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("gr-tool listen-tool", active && "gr-tool-on")}>
        {children}
      </button>
    </Tip>
  );
}

/** 面板顶上的开关：平时是灰字，开着是浅蓝底 */
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("h-8 flex-none rounded-full px-3 text-[13px] whitespace-nowrap transition-colors", on ? "bg-[var(--blue-tint)] text-primary" : "text-muted hover:bg-[var(--fill-quiet)] hover:text-text")}
    >
      {children}
    </button>
  );
}

/**
 * 听力条（工作台底部）：播放/暂停、上一句/下一句、单句重复、逐句暂停、倍速，时间轴上标分段、题号和（判过的题）答案句。
 * 指导语（念注意事项的那段）默认跳过。
 * 原文（逐句精听）不再浮在卷面上：画在停靠区"原文"标签给的格子里（slot），一句一行，点一句就从那句开始播；
 * 判过的题在答案句左边有题号标签，可以整篇或一句一句看译文。
 */
export const ListeningBar = forwardRef<
  ListeningBarHandle,
  {
    audio: PaperAudio;
    /** 每个听力分段对应的题号（来自试卷题组），用来标时间轴上的题号刻度 */
    questionsBySegment?: Record<string, number[]>;
    open: boolean;
    submitted: boolean;
    /** 停靠区"原文"标签开着时，原文画到这里 */
    slot: HTMLElement | null;
    onTranscript: () => void; // 听力条上的"原文"：打开/收起停靠区的原文标签
    onActivate: () => void; // 在原文里点了一句：听力条要露出来
    answerLines: AnswerLine[]; // 所有有 locate.line 的题，judged 标出判过的
    judgedQs: JudgedQs;
    onAnswer: (qid: string) => void; // 点了答案句的题号标签：卷面上打开这道题
    audioPct: number | null; // 录音在后台下载的进度 0–1；没在下是 null
    trans: TransLookup;
    transState: "loading" | "none" | "ready"; // 这套卷的译文层：还在取 / 没有 / 有
    onClose: () => void;
    onSegmentChange: (id: string | null, playing: boolean) => void;
  }
>(
  // 平时不显示，只在需要时打开；关闭时只是隐藏，音频元素一直在，卷面上的播放键随时能用
  function ListeningBar({ audio, questionsBySegment, open, submitted, slot, onTranscript, onActivate, answerLines: allAnswerLines, judgedQs, onAnswer, audioPct, trans, transState, onClose, onSegmentChange }, ref) {
    const el = useRef<HTMLAudioElement>(null);
    const track = useRef<HTMLDivElement>(null);
    const activeRow = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const userScrolledAt = useRef(0); // 手动滑过原文：过一会儿再自动跟着当前句
    const range = useRef<Range | null>(null);
    const pausedAt = useRef(-1); // 逐句暂停时，刚在哪一句停过
    const [playing, setPlaying] = useState(false);
    // 录音的加载状态：点了播放还在缓冲（慢网下第一下要等几秒）、加载失败（给重试）
    const [buffering, setBuffering] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const playedAt = useRef(0); // 上一次开始播放的时间：出错时判断是不是刚点了播放/跳句
    const recoverAt = useRef(0); // 上一次自动从缓存恢复的时间，3 秒内不重复
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(audio.duration);
    const [rate, setRate] = useState(1);
    const [hover, setHover] = useState<number | null>(null);
    const [scrub, setScrub] = useState<number | null>(null);
    const [repeat, setRepeat] = useState(false);
    const [stepMode, setStepMode] = useState(false);
    const [playDirections, setPlayDirections] = useState(false);
    const [reveal, setReveal] = useState(false);
    // 译文：整篇开着，或者单独点开的几句（全卷句序号）
    const [transAll, setTransAll] = useState(false);
    // 答案句开关：打开后没判过的题也标荧光笔和题号（不给答案字母）；记在本机
    const [allAns, setAllAns] = useState(() => {
      try {
        return localStorage.getItem("yz.allAnswerLines") === "1";
      } catch {
        return false;
      }
    });
    const toggleAllAns = () =>
      setAllAns((v) => {
        try {
          localStorage.setItem("yz.allAnswerLines", v ? "0" : "1");
        } catch {
          /* 存不了就算了 */
        }
        return !v;
      });
    const answerLines = useMemo(() => (allAns ? allAnswerLines : allAnswerLines.filter((a) => a.judged)), [allAnswerLines, allAns]);
    const [transOne, setTransOne] = useState<Set<number>>(() => new Set());
    const [tickTip, setTickTip] = useState<number | null>(null); // 时间轴上正指着哪个答案刻度
    const tickDownAt = useRef(0);
    const [, force] = useState(0);
    const panel = !!slot;

    const lines = useMemo<Line[]>(
      () =>
        audio.segments
          .flatMap((s) => s.lines.map((l, i) => ({ ...l, seg: s.id, i, kind: kindOf(l) })))
          .sort((a, b) => a.start - b.start)
          .map((l, index) => ({ ...l, index })),
      [audio],
    );
    const hasLines = lines.length > 0;
    // 上一句/下一句、逐句暂停走的句子：原文和读题（指导语、读题句不算）
    const nav = useMemo(() => lines.filter((l) => l.kind !== "directions" && l.kind !== "cue"), [lines]);

    // 跳过的地方：每段开头的指导语（连同前面没对上文字的部分），以及段中间偶尔出现的指导语
    const zones = useMemo(
      () =>
        audio.segments.flatMap((s, si) => {
          const out: { from: number; to: number }[] = [];
          const ls = s.lines;
          let k = 0;
          while (k < ls.length && kindOf(ls[k]) === "directions") k++;
          const first = k < ls.length ? ls[k].start : s.end;
          if (k > 0 || first - s.start > 1) out.push({ from: si === 0 ? 0 : s.start - 0.3, to: first });
          for (let j = k; j < ls.length; j++) {
            if (kindOf(ls[j]) !== "directions") continue;
            let e = j;
            while (e + 1 < ls.length && kindOf(ls[e + 1]) === "directions") e++;
            out.push({ from: ls[j].start, to: e + 1 < ls.length ? ls[e + 1].start : ls[e].end });
            j = e;
          }
          return out;
        }),
      [audio],
    );
    const skipping = !playDirections;
    const zoneAt = (t: number) => zones.find((z) => t >= z.from && t < z.to - 0.05);

    const shown = scrub ?? time;
    const seg = audio.segments.find((s) => shown >= s.start && shown < s.end);
    // 当前句：句子之间的空隙（作答时间）算前一句；指导语不高亮
    const near = lines.reduce((best, l, i) => (l.start <= shown + 0.01 ? i : best), -1);
    const active = near >= 0 && lines[near].kind !== "directions" ? near : -1;
    const navAt = (t: number) => nav.reduce((best, l, k) => (l.start <= t + 0.05 ? k : best), -1);

    // 题号刻度：每段的题目是连着读的，只标一个范围（如 8–11），位置在第一题开始读的时间
    const ticks = useMemo(
      () =>
        audio.segments.flatMap((s) => {
          const marked = s.lines.flatMap((l, i) => {
            const m = l.text.match(QUESTION_RE);
            return m ? [{ n: Number(m[1]), i }] : [];
          });
          const nums = questionsBySegment?.[s.id]?.length ? questionsBySegment[s.id] : marked.map((q) => q.n);
          if (!nums.length) return [];
          const lo = Math.min(...nums);
          const hi = Math.max(...nums);
          const first = marked[0];
          const at = first ? (lo < first.n && first.i > 0 ? first.i - 1 : first.i) : -1;
          return [{ id: s.id, label: lo === hi ? `${lo}` : `${lo}–${hi}`, t: at >= 0 ? s.lines[at].start : s.start }];
        }),
      [audio, questionsBySegment],
    );

    // 答案句：每句上有哪几道题（标签），时间轴上的刻度（同一时刻的题并成一个）
    const answersAt = useMemo(() => {
      const m = new Map<string, AnswerLine[]>();
      for (const a of answerLines) (m.get(`${a.seg}#${a.i}`) ?? m.set(`${a.seg}#${a.i}`, []).get(`${a.seg}#${a.i}`)!).push(a);
      for (const v of m.values()) v.sort((a, b) => a.n - b.n);
      return m;
    }, [answerLines]);
    const answerTicks = useMemo(() => {
      const out: { t: number; nums: number[] }[] = [];
      for (const [key, as] of answersAt) {
        const l = lines.find((x) => `${x.seg}#${x.i}` === key);
        if (l) out.push({ t: l.start, nums: as.map((a) => a.n) });
      }
      return out.sort((a, b) => a.t - b.t);
    }, [answersAt, lines]);

    useEffect(() => onSegmentChange(seg?.id ?? null, playing), [seg?.id, playing, onSegmentChange]);

    const setRange = (r: Range | null) => {
      range.current = r;
      force((n) => n + 1);
    };

    // 录音元素出过网络错误（断网时正在下的那条连接断了）就一直是出错状态：重新加载一次，之后分段请求由 Service Worker 从缓存切
    const revive = (a: HTMLAudioElement) => {
      if (!a.error) return;
      const t = a.currentTime;
      a.load();
      a.currentTime = t;
      setLoadError(false);
    };
    /** 跳到 t；exact 为假时，落在要跳过的指导语里就跳到指导语后面 */
    const seek = (t: number, andPlay = true, exact = false) => {
      const a = el.current;
      if (!a) return;
      revive(a);
      let x = Math.max(0, Math.min(duration, t));
      const z = !exact && skipping ? zoneAt(x) : undefined;
      if (z) x = z.to;
      a.currentTime = x;
      setTime(x);
      pausedAt.current = -1;
      if (andPlay) void a.play();
    };

    /** 从这一句开始播：单句重复开着就重复这一句，否则接着往下播 */
    const go = (l: Line) => {
      setRange(repeat ? { start: l.start, end: l.end, loop: true, index: l.index } : null);
      seek(l.start, true, true);
    };
    /** 在原文里点了一句：从这句播，听力条露出来 */
    const goFromText = (l: Line) => {
      onActivate();
      go(l);
    };

    /** 播完一句或到了循环点；逐句暂停时每句播完停下；跳过指导语 */
    const checkBounds = useRef<() => void>(undefined);
    checkBounds.current = () => {
      const a = el.current;
      if (!a || a.paused) return;
      const t = a.currentTime;
      const r = range.current;
      if (r) {
        if (t >= r.end - 0.03) {
          if (r.loop) a.currentTime = r.start;
          else {
            a.pause();
            a.currentTime = r.end;
            setRange(null);
          }
        }
        return;
      }
      const z = skipping ? zoneAt(t) : undefined;
      if (z) {
        a.currentTime = z.to;
        return;
      }
      if (stepMode && hasLines) {
        const i = lines.findIndex((l) => l.kind !== "directions" && t >= l.end - 0.03 && t < l.end + 0.35);
        if (i >= 0 && pausedAt.current !== i) {
          pausedAt.current = i;
          a.pause();
        }
      }
    };

    // 播放时每帧检查一次边界（timeupdate 一秒只有四次，不够准）；页面在后台时帧会停，靠 timeupdate 兜底
    useEffect(() => {
      if (!playing) return;
      let raf = 0;
      let shownAt = -1;
      const tick = () => {
        const a = el.current;
        if (a) {
          if (Math.abs(a.currentTime - shownAt) > 0.05) {
            shownAt = a.currentTime;
            setTime(a.currentTime);
          }
          checkBounds.current?.();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [playing]);

    const prevLine = () => {
      const a = el.current;
      if (!a) return;
      if (!nav.length) return seek(a.currentTime - 5, !a.paused, true);
      const t = a.currentTime;
      const k = navAt(t);
      // 一句播了一秒以上，"上一句"先回到这句开头
      go(nav[k >= 0 && t - nav[k].start > 1 ? k : Math.max(0, k - 1)]);
    };
    const nextLine = () => {
      const a = el.current;
      if (!a) return;
      if (!nav.length) return seek(a.currentTime + 5, !a.paused, true);
      const l = nav.find((x) => x.start > a.currentTime + 0.05);
      if (l) go(l);
    };
    const replayLine = () => {
      const k = navAt(el.current?.currentTime ?? 0);
      if (k >= 0) go(nav[k]);
    };
    const toggleRepeat = () => {
      if (repeat) {
        setRepeat(false);
        setRange(null);
        return;
      }
      setRepeat(true);
      const k = navAt(el.current?.currentTime ?? 0);
      if (k >= 0) setRange({ start: nav[k].start, end: nav[k].end, loop: true, index: nav[k].index });
    };
    const togglePlay = () => {
      const a = el.current;
      if (!a) return;
      revive(a);
      if (a.paused) {
        const z = !range.current && skipping ? zoneAt(a.currentTime) : undefined;
        if (z) a.currentTime = z.to;
        void a.play();
      } else a.pause();
    };

    useImperativeHandle(ref, () => ({
      toggleSegment(id) {
        const a = el.current;
        const s = audio.segments.find((x) => x.id === id);
        if (!a || !s) return;
        revive(a);
        if (seg?.id === id && !a.paused) {
          a.pause();
          return;
        }
        if (seg?.id !== id) {
          setRange(null);
          seek(s.start, false);
        }
        void a.play();
      },
      playLine(segment, index) {
        const l = lines.find((x) => x.seg === segment && x.i === index);
        if (!l) return;
        setRange({ start: l.start, end: l.end, loop: repeat, index: l.index });
        seek(l.start, true, true);
      },
    }));

    useEffect(() => {
      if (el.current) el.current.playbackRate = rate;
    }, [rate]);

    // 原文开着时，正在播的那句自动滚到中间（刚手动滑过就先不动）：在贴顶的块头下面。
    // 只滚原文这一栏，不用 scrollIntoView（它会连带滚外面的容器）；位置用矩形量（块头是 sticky，offsetTop 不可靠）
    const centerRow = (row: HTMLElement, smooth: boolean) => {
      const box = list.current;
      if (!box) return;
      const b = box.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      box.scrollTo({ top: box.scrollTop + r.top - b.top - box.clientHeight / 2 + r.height / 2, behavior: smooth ? "smooth" : "auto" });
    };
    const shownSlot = useRef<HTMLElement | null>(null);
    useEffect(() => {
      const row = activeRow.current;
      const first = shownSlot.current !== slot;
      shownSlot.current = slot;
      if (!row || (!first && Date.now() - userScrolledAt.current < 4000)) return;
      centerRow(row, !first);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slot, active]);
    // 问题卡片里的"答案句"：滚到这道题的答案句，让它闪一下（这几秒不自动跟着当前句）
    const [flashLine, setFlashLine] = useState<number | null>(null);
    useEffect(() => {
      if (flashLine === null) return;
      const t = setTimeout(() => setFlashLine(null), 1600);
      return () => clearTimeout(t);
    }, [flashLine]);
    const jumpToLine = (index: number) => {
      const row = list.current?.querySelector<HTMLElement>(`[data-line="${index}"]`);
      if (!row) return;
      userScrolledAt.current = Date.now();
      centerRow(row, true);
      setFlashLine(index);
    };

    // 快捷键（听力条打开时）：空格 播放/暂停，←/→ 上一句/下一句，Shift+←/→ 快退快进 5 秒，R 重听本句，L 单句重复，S 逐句暂停。
    // 在捕获阶段处理并拦下，不会再触发考场的工具快捷键；处理函数放在 ref 里，只注册一次
    const onKeyRef = useRef<(e: KeyboardEvent) => void>(undefined);
    onKeyRef.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]") || document.querySelector(".gr-dialog-layer, .gr-popover-panel") || !el.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.code === "Space") togglePlay();
      else if (e.key === "ArrowLeft") e.shiftKey ? seek(el.current.currentTime - 5, !el.current.paused, true) : prevLine();
      else if (e.key === "ArrowRight") e.shiftKey ? seek(el.current.currentTime + 5, !el.current.paused, true) : nextLine();
      else if (key === "r") replayLine();
      else if (key === "l") toggleRepeat();
      else if (key === "s") setStepMode((v) => !v);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => onKeyRef.current?.(e);
      addEventListener("keydown", onKey, true);
      return () => removeEventListener("keydown", onKey, true);
    }, [open]);

    const close = () => {
      el.current?.pause();
      onClose();
    };

    const timeAt = (clientX: number) => {
      const r = track.current!.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
    };
    const onPointerDown = (e: PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setScrub(timeAt(e.clientX));
    };
    const onPointerMove = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (e.pointerType === "mouse") setHover(t);
      if (scrub !== null) setScrub(t);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (scrub === null || !el.current) return;
      const t = timeAt(e.clientX);
      // 单句重复时拖到哪句就重复哪句；只播一句时拖走了就不再停
      const l = repeat ? nav.find((x) => t >= x.start && t < x.end) : undefined;
      setRange(l ? { start: l.start, end: l.end, loop: true, index: l.index } : null);
      if (repeat && !l) setRepeat(false);
      el.current.currentTime = t;
      setScrub(null);
    };
    const pct = (t: number) => `${(t / Math.max(1, duration)) * 100}%`;
    // 时间轴上的题号标签（"16–18"）挨得太近会叠在一起：按时间轴实际宽度，放不下的后一个不显示（点时间轴照样能跳）
    const [trackW, setTrackW] = useState(0);
    useEffect(() => {
      const el = track.current;
      if (!el) return;
      const ro = new ResizeObserver(() => setTrackW(el.offsetWidth));
      ro.observe(el);
      setTrackW(el.offsetWidth);
      return () => ro.disconnect();
      // 听力条第一次打开时时间轴才渲染出来，要重新挂
    }, [open]);
    const shownTicks = useMemo(() => {
      if (!trackW) return ticks;
      const w = (s: string) => s.length * 7.5;
      const out: typeof ticks = [];
      for (const k of ticks) {
        const last = out[out.length - 1];
        const x = (k.t / Math.max(1, duration)) * trackW;
        if (last && x - (last.t / Math.max(1, duration)) * trackW < (w(last.label) + w(k.label)) / 2 + 6) continue;
        out.push(k);
      }
      return out;
    }, [ticks, trackW, duration]);
    const showText = submitted || reveal;

    // 原文按篇（录音段）分块：块头（段名、题号范围）→ 正文（对话按"轮"，每轮开头一个 M/W 角色章）→ 问题卡片（读题行）。
    // 指导语、题组提示句（cue）不显示：块头已经写了题号范围
    const blocks = useMemo(
      () =>
        audio.segments.map((s) => {
          const rows = lines.filter((l) => l.seg === s.id && l.kind !== "directions" && l.kind !== "cue");
          const body = rows.filter((l) => l.kind !== "question");
          const qs = rows.filter((l) => l.kind === "question").map((l) => ({ l, ...questionParts(l.text) }));
          const nums = questionsBySegment?.[s.id]?.length ? questionsBySegment[s.id] : qs.flatMap((q) => (q.n ? [q.n] : []));
          const lo = nums.length ? Math.min(...nums) : 0;
          const hi = nums.length ? Math.max(...nums) : 0;
          // 有说话人数据才算对话（排成轮、出角色章）；短文、新闻、讲座和没标说话人的对话句子顶格
          // 这一段每一句都有说话人才算对话；只有一部分有的整段按短文排，免得一会儿有章一会儿没章
          const talk = body.length > 0 && body.every((l) => l.speaker);
          // 只按音高分的说话人：能看出哪里换了人（分轮），但分不准谁是男谁是女，不出角色章
          const stamps = talk && s.speakerSource !== "pitch";
          return { s, body, qs, talk, stamps, range: !nums.length ? "" : lo === hi ? `第 ${lo} 题` : `第 ${lo}–${hi} 题` };
        }),
      [audio, lines, questionsBySegment],
    );
    type Block = (typeof blocks)[number];
    // 题号 → 它的答案句（全卷句序号）：问题卡片里"答案句"按钮用
    const answerLineOf = useMemo(() => {
      const m = new Map<number, number>();
      for (const a of answerLines) {
        const l = lines.find((x) => x.seg === a.seg && x.i === a.i);
        if (l && !m.has(a.n)) m.set(a.n, l.index);
      }
      return m;
    }, [answerLines, lines]);

    // 一行原文：整行点了从这句播（行是 div，里面的题号标签、"答案句"、"译"是独立的按钮）
    const rowProps = (l: Line, on: boolean, label?: string) => ({
      ref: on ? activeRow : undefined,
      role: "button",
      tabIndex: 0,
      "aria-label": label,
      "data-line": l.index,
      onClick: () => goFromText(l),
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        goFromText(l);
      },
    });
    const stop = (f: () => void) => (e: MouseEvent) => {
      e.stopPropagation();
      f();
    };
    // 正在播的那句整行淡蓝底；"答案句"跳过来的那句闪一下黄
    const rowClass = (l: Line, on: boolean) =>
      cn(
        "relative flex w-full cursor-pointer items-start gap-2 overflow-hidden rounded-[10px] px-2 py-1 text-left transition-[background-color,box-shadow] duration-300",
        flashLine === l.index ? "bg-[var(--mark-tint)] shadow-[inset_0_0_0_2px_var(--mark)]" : on ? "bg-[color-mix(in_oklab,var(--blue-tint)_45%,white)]" : "hover:bg-[var(--fill-quiet)]",
      );
    // 当前句的播放进度，从左往右铺
    const progressOf = (l: Line) => (
      <span className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--blue-tint)]" style={{ width: `${Math.max(0, Math.min(1, (shown - l.start) / Math.max(0.1, l.end - l.start))) * 100}%` }} />
    );
    // 交卷前原文遮着：灰色条，长短跟着句子
    const bar = (text: string) => (
      <span className="flex h-6 items-center">
        <span className="block h-2 rounded-full bg-[var(--fill-track)]" style={{ width: `${Math.min(100, Math.max(16, text.length / 1.6))}%` }} />
      </span>
    );
    // 译文：整篇开着（这句有译文才跟一行），或单独点了这句的"译"（没有就写"这句还没有译文"）；和英文左对齐
    const transOf = (l: Line) => {
      const one = transOne.has(l.index);
      const tr = showText && (transAll || one) ? trans(l.text) : null;
      const t = tr && (tr.text ? tr.text : one ? (tr.ready ? "这句还没有译文" : "正在取译文…") : null);
      // 译文和英文一样 15px、深灰（2026-11-12 以前 14px 浅灰，用户看不到）
      return t ? <p className={cn("mt-0.5 text-[15px] leading-6", tr?.text ? "text-[var(--ink-700)]" : "text-subtle")}>{t}</p> : null;
    };
    // 只看这一句的译文：只在当前这句右边出现，其他行不占这一栏；整篇译文开着时不用
    const transButton = (l: Line) =>
      showText && !transAll && l.index === active ? (
        <button
          type="button"
          onClick={stop(() =>
            setTransOne((s) => {
              const next = new Set(s);
              if (!next.delete(l.index)) next.add(l.index);
              return next;
            }),
          )}
          aria-pressed={transOne.has(l.index)}
          aria-label={transOne.has(l.index) ? "收起这句的译文" : "看这句的译文"}
          className={cn("relative -my-0.5 flex h-7 min-w-7 flex-none items-center justify-center rounded-full text-[13px] transition-colors", transOne.has(l.index) ? "text-primary" : "text-[var(--ink-500)] hover:bg-white")}
        >
          译
        </button>
      ) : null;
    // 角色章：M 实心墨色方章白字，W 空心描边方章墨字
    const stamp = (sp: string) => (
      <span
        aria-label={sp === "M" ? "男" : sp === "W" ? "女" : sp}
        className={cn("flex size-[18px] items-center justify-center rounded-[4px] text-[11px] leading-none font-bold", sp === "M" ? "bg-[var(--ink)] text-white" : "text-[var(--ink)] shadow-[inset_0_0_0_1.5px_var(--ink)]")}
      >
        {sp.slice(0, 1).toUpperCase()}
      </span>
    );
    // 判过的题：答案句左边蓝色题号标签（几道题并排），点了卷面上打开这道题
    const tagsOf = (l: Line) =>
      answersAt.get(`${l.seg}#${l.i}`)?.map((a) => (
        <button
          key={a.qid}
          type="button"
          onClick={stop(() => onAnswer(a.qid))}
          aria-label={`第 ${a.n} 题的答案在这一句，点了在卷面上打开这道题`}
          className="num relative mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-[var(--blue-tint)] px-1 align-[1px] text-[12px] leading-none font-semibold text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--blue-line)] before:absolute before:-inset-2 before:content-[''] hover:bg-[var(--blue)] hover:text-white"
        >
          {a.n}
        </button>
      ));

    // 正文一句：对话里同一个人连着的几句是一轮，轮与轮之间 10px、轮里 2px；短文句与句之间 4px
    const bodyRow = (b: Block, l: Line, k: number) => {
      const on = l.index === active;
      const turnStart = b.talk && (k === 0 || b.body[k - 1].speaker !== l.speaker);
      const text = b.talk && l.speaker ? l.text.replace(SPEAKER_PREFIX, "") : l.text;
      const tags = tagsOf(l);
      return (
        <div key={l.index} {...rowProps(l, on, showText ? undefined : "这一句")} className={cn(rowClass(l, on), k > 0 && (b.talk ? (turnStart ? "mt-2.5" : "mt-0.5") : "mt-1"))}>
          {on && progressOf(l)}
          {b.stamps && <span className="relative mt-[3px] w-[18px] flex-none">{turnStart && l.speaker && stamp(l.speaker)}</span>}
          <div className="relative min-w-0 flex-1">
            {showText ? (
              <p className="text-[15px] leading-6">
                {tags}
                {/* 点一下从这句播；长按（或右键）一个词查词。答案句文字后面一道荧光笔 */}
                <WordText text={text} trigger="hold" className={cn(on ? "text-text" : "text-muted", tags && "hl-mark")} />
              </p>
            ) : (
              <div className="flex items-center">
                {tags}
                <span className="min-w-0 flex-1">{bar(text)}</span>
              </div>
            )}
            {transOf(l)}
          </div>
          {transButton(l)}
        </div>
      );
    };

    // 问题卡片：这一篇的读题行，浅灰底；题号是衬线体"8."。判过之后题干右边正确答案（蓝圈）、答错的你的选项（红色划掉）或"没答"，
    // 题号前面一个"答案句"按钮。判之前只有题号和题干。数据里没有读题行的题不补
    const questionCard = (b: Block) => {
      if (!b.qs.length) return null;
      const anyJump = b.qs.some((q) => q.n && answerLineOf.has(q.n));
      return (
        <div className="mt-4" data-questions>
          <h4 className="px-2 pb-1.5 text-[13px] text-[var(--ink-500)]">问题</h4>
          <div className="rounded-[10px] bg-[var(--fill-quiet)] p-1">
            {b.qs.map(({ l, n, stem }, k) => {
              const on = l.index === active;
              const j = n ? judgedQs[n] : undefined;
              const at = n ? answerLineOf.get(n) : undefined;
              return (
                <div key={l.index} {...rowProps(l, on, showText ? undefined : n ? `第 ${n} 题` : "这一题")} className={cn(rowClass(l, on), k > 0 && "mt-0.5")}>
                  {on && progressOf(l)}
                  {anyJump && (
                    <span className="relative -my-0.5 w-7 flex-none">
                      {at !== undefined && (
                        <button
                          type="button"
                          onClick={stop(() => jumpToLine(at))}
                          title="答案句"
                          aria-label={`第 ${n} 题的答案句`}
                          className="flex size-7 items-center justify-center rounded-full text-[var(--blue)] hover:bg-white"
                        >
                          <ArrowUp className="size-4" weight="bold" />
                        </button>
                      )}
                    </span>
                  )}
                  <span className="serif relative min-w-7 flex-none text-[15px] leading-6 font-semibold text-[var(--ink)] tabular-nums">{n ? `${n}.` : ""}</span>
                  <div className="relative min-w-0 flex-1">
                    {showText ? <WordText text={stem || l.text} trigger="hold" as="p" className="text-[15px] leading-6 text-text" /> : bar(stem || l.text)}
                    {transOf(l)}
                  </div>
                  {j && (
                    <span className="relative flex h-6 flex-none items-center gap-1.5" data-judged={n}>
                      {j.answer && (
                        <span aria-label={`正确答案 ${j.answer}`} className="flex size-6 items-center justify-center rounded-full bg-white text-[13px] font-semibold text-[var(--blue)] shadow-[inset_0_0_0_1.5px_var(--blue)]">
                          {j.answer}
                        </span>
                      )}
                      {/* 答错的：蓝圈后面一行红色小字"你选 C"（单个字母加删除线、斜杠都不好认） */}
                      {j.mine && j.mine !== j.answer && <span className="text-[13px] whitespace-nowrap text-[var(--red)]">你选 {j.mine}</span>}
                      {!j.mine && <span className="text-[13px] text-[var(--ink-500)]">没答</span>}
                    </span>
                  )}
                  {transButton(l)}
                </div>
              );
            })}
          </div>
        </div>
      );
    };

    // 原文：放在停靠区"原文"标签里。顶上一行是几个开关（播放说明、显示原文、译文），下面一篇一块，块头贴顶
    const transcript = slot && (
      <>
        <div className="flex min-h-11 flex-none flex-wrap items-center justify-end gap-x-1 gap-y-0.5 border-b border-[var(--fill-quiet)] px-2 py-1.5">
          <Toggle on={playDirections} onClick={() => setPlayDirections(!playDirections)}>
            播放说明
          </Toggle>
          {!submitted && (
            <Toggle on={reveal} onClick={() => setReveal(!reveal)}>
              显示原文
            </Toggle>
          )}
          {/* 交卷前原文遮着，译文也遮着 */}
          {showText && hasLines && (
            <Toggle on={transAll} onClick={() => setTransAll(!transAll)}>
              译文
            </Toggle>
          )}
          {showText && hasLines && (
            <Toggle on={allAns} onClick={toggleAllAns}>
              答案句
            </Toggle>
          )}
        </div>
        {!hasLines ? (
          <p className="px-5 py-10 text-center text-[14px] text-subtle">这套听力还没有逐句时间，只能按时间轴拖动。</p>
        ) : (
          <div
            ref={list}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
            onWheel={() => (userScrolledAt.current = Date.now())}
            onTouchMove={() => (userScrolledAt.current = Date.now())}
          >
            {showText && (transAll || transOne.size > 0) && (
              <div className="flex items-center gap-2 px-2 pt-2.5">
                {transState === "none" ? <span className="text-[13px] text-subtle">这套听力还没有译文</span> : <AiTransTag />}
              </div>
            )}
            {blocks.map((b, bi) =>
              b.body.length || b.qs.length ? (
                <section key={b.s.id} data-seg={b.s.id} className={cn(bi > 0 && "mt-5")}>
                  {/* 块头：贴顶，滚到哪篇顶上就是哪篇；正在播的那篇左边一道蓝 */}
                  <h3
                    className={cn(
                      "sticky top-0 z-[3] -mx-2 flex items-baseline gap-3 border-b border-[var(--line)] bg-white py-2.5 pr-4 pl-4 text-[14px] leading-5 font-semibold text-[var(--ink)]",
                      b.s.id === seg?.id && "before:absolute before:top-2 before:bottom-2 before:left-1.5 before:w-[3px] before:rounded-full before:bg-[var(--blue)] before:content-['']",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{b.s.label}</span>
                    {b.range && <span className="num flex-none text-[13px] font-normal whitespace-nowrap text-[var(--ink-500)]">{b.range}</span>}
                  </h3>
                  {/* 一句一行（大多要逐句看、逐句听）；对话一轮内句距小、轮与轮之间空开，轮首出角色章 */}
                  <div className="pt-2">{b.body.map((l, k) => bodyRow(b, l, k))}</div>
                  {questionCard(b)}
                </section>
              ) : null,
            )}
          </div>
        )}
      </>
    );

    return (
      <div className={cn("gr-wb-panel no-print relative shrink-0 overflow-visible", open ? "animate-pop" : "hidden")} data-listen-bar>
        {slot && transcript && createPortal(transcript, slot)}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2.5 py-2">
          <ToolButton label="上一句" kbd="←" onClick={prevLine}>
            <SkipBack className="size-[18px]" />
          </ToolButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "暂停" : "播放"}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg shadow-[var(--shadow-button)] transition hover:bg-primary-hover active:scale-[0.97]"
          >
            {playing ? <Pause className="size-[18px]" weight="fill" /> : <Play className="ml-0.5 size-[18px]" weight="fill" />}
          </button>
          <ToolButton label="下一句" kbd="→" onClick={nextLine}>
            <SkipForward className="size-[18px]" />
          </ToolButton>
          <ToolButton label="单句重复" kbd="L" active={repeat} onClick={toggleRepeat} disabled={!hasLines}>
            <RepeatOnce className="size-[18px]" />
          </ToolButton>

          {loadError ? (
            <button
              type="button"
              className="w-[92px] shrink-0 text-center text-[13px] font-medium text-[var(--red)] hover:underline"
              onClick={() => {
                const a = el.current;
                if (!a) return;
                setLoadError(false);
                const t = a.currentTime;
                a.load();
                a.currentTime = t;
                void a.play().catch(() => setLoadError(true));
              }}
            >
              录音没加载出来，重试
            </button>
          ) : buffering && playing ? (
            // 点到还没下到的位置：写下载进度，不干转圈
            <div className="num w-[92px] shrink-0 text-center text-[13px] font-medium text-subtle">{audioPct !== null ? `录音下载中 ${Math.floor(audioPct * 100)}%` : "加载录音…"}</div>
          ) : (
            <div className="num relative w-[92px] shrink-0 text-center text-[13px] font-medium text-subtle">
              <span className="text-text">{formatDuration(shown)}</span> / {formatDuration(duration)}
              {audioPct !== null && (
                <span className="absolute inset-x-0 top-full -mt-0.5 text-center text-[11px] leading-3 font-normal text-[var(--ink-500)]" aria-label={`录音下载 ${Math.floor(audioPct * 100)}%`}>
                  录音 {Math.floor(audioPct * 100)}%
                </span>
              )}
            </div>
          )}

          {/* 时间轴：窄屏（竖放的平板）单独占一行，放在按钮上面 */}
          <div className="relative order-first h-14 min-w-0 basis-full lg:order-none lg:mx-1 lg:basis-0 lg:flex-1">
            {audio.segments.map((s) => (
              <span
                key={s.id}
                className={cn("absolute top-0 truncate pr-1 text-[13px] leading-4 font-medium", s.id === seg?.id ? "text-primary" : "text-subtle")}
                style={{ left: pct(s.start), maxWidth: pct(s.end - s.start) }}
              >
                {shortLabel(s.label)}
              </span>
            ))}
            <div
              ref={track}
              className="group absolute inset-x-0 top-[18px] flex h-5 cursor-pointer touch-none items-center"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)}
            >
              <div className="relative h-1.5 w-full rounded-full bg-[var(--fill-track)]">
                <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: pct(shown) }} />
                {audio.segments.slice(1).map((s) => (
                  <span key={s.id} className="absolute -top-px h-[calc(100%+2px)] w-[2px] bg-white" style={{ left: pct(s.start) }} />
                ))}
              </div>
              <span className="absolute size-4 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,39,67,0.3),inset_0_0_0_0.5px_var(--line-soft)] transition-transform group-active:scale-110" style={{ left: pct(shown) }} />
              {hover !== null && (
                <span className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-[8px] bg-[var(--glass-strong)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[13px] text-text shadow-[var(--shadow-glass)] tabular-nums backdrop-blur" style={{ left: pct(hover) }}>
                  {formatDuration(hover)}
                </span>
              )}
            </div>
            {shownTicks.map(({ id, label, t }) => (
              <button
                key={id}
                type="button"
                onClick={() => seek(t, true, true)}
                className="serif absolute top-[39px] -translate-x-1/2 text-[13px] leading-4 font-semibold whitespace-nowrap text-subtle hover:text-primary"
                style={{ left: pct(t) }}
                aria-label={`跳到第 ${label} 题的提问`}
              >
                {label}
              </button>
            ))}
            {/* 判过的题：答案句的时间点上一个蓝色小刻度（2×6），悬停或按住显示第几题，点了从这句播 */}
            {answerTicks.map(({ t, nums }, k) => (
              <button
                key={`${t}-${k}`}
                type="button"
                data-answer-tick
                // 点一下从这句播；手指按住只是看第几题，松手不跳
                onClick={() => performance.now() - tickDownAt.current < 400 && seek(t, true, true)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setTickTip(k)}
                onPointerLeave={() => setTickTip((x) => (x === k ? null : x))}
                onPointerDown={(e) => {
                  tickDownAt.current = performance.now();
                  if (e.pointerType !== "mouse") setTickTip(k);
                }}
                onPointerUp={(e) => e.pointerType !== "mouse" && setTickTip(null)}
                onPointerCancel={() => setTickTip(null)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`第 ${nums.join("、")} 题的答案句`}
                className="absolute top-[13px] z-[2] h-3 w-4 -translate-x-1/2 touch-none [-webkit-touch-callout:none]"
                style={{ left: pct(t) }}
              >
                <span className="absolute bottom-0 left-1/2 h-[6px] w-[2px] -translate-x-1/2 bg-[var(--blue)]" />
              </button>
            ))}
            {tickTip !== null && answerTicks[tickTip] && (
              <span
                className="pointer-events-none absolute -top-7 z-[3] -translate-x-1/2 rounded-[8px] bg-[var(--ink)] px-2 py-0.5 text-[13px] whitespace-nowrap text-white shadow-[var(--elev-2)]"
                style={{ left: pct(answerTicks[tickTip].t) }}
              >
                第 {answerTicks[tickTip].nums.join("、")} 题
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <ToolButton label="逐句暂停" kbd="S" active={stepMode} onClick={() => setStepMode(!stepMode)} disabled={!hasLines}>
              <ArrowLineRight className="size-[18px]" />
            </ToolButton>
            <G.Popover
              width={120}
              align="end"
              label="播放速度"
              className="[&_.gr-popover-panel]:top-auto [&_.gr-popover-panel]:bottom-[calc(100%+8px)] [&_.gr-popover-panel]:min-w-0 [&_.gr-popover-panel]:p-1.5"
              trigger={
                <button type="button" className="gr-tool listen-tool w-[60px] gap-0.5" aria-label="播放速度">
                  <span className="gr-tool-text tabular-nums">{rate}x</span>
                  <CaretDown className="size-3" />
                </button>
              }
            >
              {(closeMenu) =>
                RATES.map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => {
                      setRate(x);
                      closeMenu();
                    }}
                    className="flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-[13px] tabular-nums hover:bg-[var(--blue-tint)]"
                  >
                    {x}x {x === rate && <Check className="size-3.5 text-primary" weight="bold" />}
                  </button>
                ))
              }
            </G.Popover>
            {/* 原文：打开停靠区的"原文"标签，再点收起（开着是视图开关，浅蓝底） */}
            <button type="button" className={cn("gr-tool listen-tool", panel && "gr-tool-soft")} onClick={onTranscript} aria-pressed={panel} aria-label="原文">
              <Scroll className="size-[18px]" weight={panel ? "fill" : "regular"} />
              <span className="gr-tool-text hidden md:inline">原文</span>
            </button>
            <span className="h-5 w-px bg-[var(--fill-track)]" />
            <button type="button" className="gr-iconbtn listen-tool" onClick={close} aria-label="关闭听力（暂停）">
              <X className="size-[18px]" />
            </button>
          </div>
        </div>

        {/* 点了播放才开始加载：时长、分段时间都在试卷数据里，不用预加载；预加载在慢网下会先把二三十兆录音整个拉下来，
            卷面 PDF 要排在它后面（2026-11-08 线上量过） */}
        <audio
          ref={el}
          src={audio.src}
          preload="none"
          onPlay={() => {
            playedAt.current = Date.now();
            setPlaying(true);
            setLoadError(false);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onError={() => {
            setBuffering(false);
            setPlaying(false);
            // 整份录音已经在缓存里（后台下完的），出错多半是断网把原来那条连接弄断了：重新加载，从缓存接着放，不让人点重试
            const a = el.current;
            const resume = Date.now() - playedAt.current < 8000;
            void (async () => {
              const cached = typeof caches !== "undefined" ? await caches.open(AUDIO_CACHE).then((c) => c.match(audio.src)).catch(() => null) : null;
              if (a && cached && Date.now() - recoverAt.current > 3000) {
                recoverAt.current = Date.now();
                revive(a);
                if (resume) void a.play().catch(() => setLoadError(true));
              } else setLoadError(true);
            })();
          }}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime);
            checkBounds.current?.();
          }}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        />
      </div>
    );
  },
);
