import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  Eye,
  EyeSlash,
  Lightbulb,
  Pause,
  Play,
  RepeatOnce,
  Sparkle,
  SpeakerHigh,
  Target,
  Translate,
  X,
} from "@phosphor-icons/react";
import { Badge, Button, Card, EmptyState, ProgressBar, Spinner } from "@/components/ui";
import { WordText } from "@/components/WordText";
import { db, bumpDay } from "@/lib/db";
import { addToVocab } from "@/lib/learning";
import { cn } from "@/lib/utils";
import {
  buildClozeTokens,
  buildPhraseChunks,
  isAnswerMatch,
  type ClozeDifficulty,
  type PhraseChunk,
} from "./cloze";
import type { StudioPack, StudioSegment, StudioSignalItem } from "./materials";
import { SpeakerTag } from "./MaterialBar";
import { SentenceAudioBar } from "./SentenceAudioBar";
import { patchDictationStat, type StudioProgress } from "./storage";
import type { useClipAudio } from "./useClipAudio";

type DictationSubMode = "cloze" | "chunk" | "blind" | "signal";

const SUB_MODES: { id: DictationSubMode; label: string }[] = [
  { id: "cloze", label: "挖空听写" },
  { id: "chunk", label: "听音拼句" },
  { id: "blind", label: "盲听刮刮卡" },
  { id: "signal", label: "考点信号句" },
];

const DIFFS: { id: ClozeDifficulty; label: string }[] = [
  { id: "light", label: "轻度 25%" },
  { id: "medium", label: "中度 50%" },
  { id: "full", label: "全句默写" },
];

const RATES = [0.75, 0.9, 1, 1.25];
const AUTOPLAY_KEY = "yz-studio-autoplay";

const SIGNAL_WORDS_RE =
  /\b(however|but|yet|actually|instead|rather|in fact|nevertheless|although|though|despite|unfortunately|especially|primarily|mainly|because|therefore|consequently|finally|except|unless|only if)\b/gi;

function readAutoPlay(): boolean {
  try {
    const v = localStorage.getItem(AUTOPLAY_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

function HighlightSignalText({ text }: { text: string }) {
  const ranges = useMemo(() => {
    const out: { a: number; b: number; cls: string }[] = [];
    for (const m of text.matchAll(SIGNAL_WORDS_RE)) {
      if (m.index !== undefined) {
        out.push({ a: m.index, b: m.index + m[0].length, cls: "am-hl font-semibold" });
      }
    }
    return out;
  }, [text]);
  return (
    <WordText
      as="p"
      text={text}
      ranges={ranges}
      className="serif text-[16px] leading-[1.7] text-[var(--ink)]"
    />
  );
}

export function DictationTab({
  pack,
  seg,
  clip,
  progress,
}: {
  pack: StudioPack;
  seg: StudioSegment;
  clip: ReturnType<typeof useClipAudio>;
  progress: StudioProgress;
}) {
  const [subMode, setSubMode] = useState<DictationSubMode>("cloze");
  const [difficulty, setDifficulty] = useState<ClozeDifficulty>("light");
  const [linePos, setLinePos] = useState(0);
  const [loop, setLoop] = useState(false);
  const [autoPlay, setAutoPlay] = useState<boolean>(readAutoPlay);

  // 挖空听写状态
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [peekedBlanks, setPeekedBlanks] = useState<Record<number, boolean>>({});
  const [focusedBlank, setFocusedBlank] = useState<number | null>(null);
  const [checkedLineKey, setCheckedLineKey] = useState<string | null>(null);
  const [doneLineKeys, setDoneLineKeys] = useState<Record<string, boolean>>({});
  const [addedVocab, setAddedVocab] = useState<Record<string, boolean>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // 听音拼句状态
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const [chunkChecked, setChunkChecked] = useState<"none" | "right" | "wrong">("none");

  // 盲听刮刮卡状态
  const [blindGlobal, setBlindGlobal] = useState<"blind" | "en" | "both">("blind");
  const [revealedEn, setRevealedEn] = useState<Record<number, boolean>>({});
  const [revealedZh, setRevealedZh] = useState<Record<number, boolean>>({});
  const [segFollowIdx, setSegFollowIdx] = useState<number | null>(null);

  // 考点信号句特训状态
  const [signalScope, setSignalScope] = useState<"seg" | "paper">("seg");
  const [signalPos, setSignalPos] = useState(0);
  const [signalPicked, setSignalPicked] = useState<Record<string, string>>({});

  // 用户在页面有过交互后，切句/切段/切题即可合法自动播放
  const userInteractedRef = useRef(false);
  const firstSegLoadedRef = useRef(false);
  const sentenceListRef = useRef<HTMLDivElement | null>(null);

  const lines = seg.lines;
  const safeLinePos = Math.min(linePos, Math.max(0, lines.length - 1));
  const curLine = lines[safeLinePos];
  const prevLine = safeLinePos > 0 ? lines[safeLinePos - 1] : undefined;
  const paperId = pack.paper.id;
  const segKey = `${paperId}:${seg.id}`;
  const lineKey = curLine ? `${segKey}:${curLine.index}:${difficulty}` : "";

  const toggleAutoPlay = () => {
    userInteractedRef.current = true;
    setAutoPlay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, next ? "1" : "0");
      } catch {
        // 忽略存储异常
      }
      return next;
    });
  };

  const toggleLoop = () => {
    userInteractedRef.current = true;
    setLoop((prev) => {
      const next = !prev;
      clip.setActiveLoop(next);
      return next;
    });
  };

  // 切换段落时重置句子游标和单句交互状态
  useEffect(() => {
    if (firstSegLoadedRef.current) {
      // 用户切换顶部片段或换卷属于明确手动操作
      userInteractedRef.current = true;
    } else {
      firstSegLoadedRef.current = true;
    }
    setLinePos(0);
    setInputs({});
    setPeekedBlanks({});
    setFocusedBlank(null);
    setCheckedLineKey(null);
    setPickedIds([]);
    setChunkChecked("none");
    setRevealedEn({});
    setRevealedZh({});
    setSignalPos(0);
  }, [paperId, seg.id]);

  // 切换句子、难度或子模式时重置输入状态
  useEffect(() => {
    setInputs({});
    setPeekedBlanks({});
    setFocusedBlank(null);
    setCheckedLineKey(null);
    setPickedIds([]);
    setChunkChecked("none");
  }, [safeLinePos, difficulty, subMode]);

  const tokens = useMemo(() => {
    if (!curLine) return [];
    return buildClozeTokens(curLine.text, `${segKey}:${curLine.index}`, difficulty);
  }, [curLine, segKey, difficulty]);

  const blankIndices = useMemo(() => tokens.filter((t) => t.blank).map((t) => t.index), [tokens]);

  const chunks = useMemo<PhraseChunk[]>(() => {
    if (!curLine) return [];
    return buildPhraseChunks(curLine.text, `${segKey}:${curLine.index}`);
  }, [curLine, segKey]);

  const checkSignalList: StudioSignalItem[] = useMemo(() => {
    if (signalScope === "seg" && seg.signalItems.length > 0) return seg.signalItems;
    return pack.allSignalItems;
  }, [signalScope, seg.signalItems, pack.allSignalItems]);

  const safeSigPos = Math.min(signalPos, Math.max(0, checkSignalList.length - 1));
  const curSignal = checkSignalList[safeSigPos];

  // 切句时自动播音 + 自动聚焦第一个空位（仅用户发生交互后触发，不弹自动播放报错）
  useEffect(() => {
    if (!autoPlay || !userInteractedRef.current) return;
    if ((subMode === "cloze" || subMode === "chunk") && curLine) {
      const pk = `${subMode}:${segKey}:${curLine.index}`;
      void clip.playRange(curLine.playStart, curLine.playEnd, {
        key: pk,
        loop,
        silentAutoplayBlock: true,
      });
    }
    // 仅在切换句子、片段或模式时触发，不因开关 loop 重新打断播放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey, curLine?.index, subMode, autoPlay]);

  useEffect(() => {
    if (subMode !== "cloze" || checkedLineKey === lineKey || !blankIndices.length) return;
    if (!userInteractedRef.current) return;
    const t = window.setTimeout(() => {
      inputRefs.current[blankIndices[0]]?.focus();
    }, 40);
    return () => clearTimeout(t);
  }, [segKey, curLine?.index, difficulty, subMode, checkedLineKey, lineKey, blankIndices]);

  // 考点信号句切题时自动播音
  useEffect(() => {
    if (subMode !== "signal" || !curSignal || !autoPlay || !userInteractedRef.current) return;
    const st = curSignal.prevLine ? curSignal.prevLine.playStart : curSignal.targetLine.playStart;
    void clip.playRange(st, curSignal.targetLine.playEnd, {
      key: `sig-ctx:${curSignal.q.id}`,
      loop: false,
      silentAutoplayBlock: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subMode, curSignal?.q.id, autoPlay]);

  // 盲听整段连播时跟踪高亮当前句（只在句序号变化时更新一次状态）
  const segPlayKey = `seg:${segKey}`;
  useEffect(() => {
    if (subMode !== "blind" || clip.activeKey !== segPlayKey || clip.status === "idle") {
      setSegFollowIdx(null);
      return;
    }
    return clip.subscribeProgress((info) => {
      if (info.key !== segPlayKey) return;
      let hit: number | null = null;
      for (const ln of lines) {
        if (info.currentTime >= ln.playStart - 0.05 && info.currentTime <= ln.playEnd + 0.05) {
          hit = ln.index;
          break;
        }
      }
      setSegFollowIdx((prev) => (prev === hit ? prev : hit));
    });
  }, [subMode, clip, segPlayKey, lines]);

  // 右侧句子单自动把当前句滚入可见区域
  useEffect(() => {
    const box = sentenceListRef.current;
    if (!box || !curLine) return;
    const activeEl = box.querySelector<HTMLElement>(`[data-studio-line="${curLine.index}"]`);
    if (!activeEl) return;
    const top = activeEl.offsetTop;
    const bottom = top + activeEl.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: bottom - box.clientHeight + 8, behavior: "smooth" });
    }
  }, [curLine]);

  const checkCloze = useCallback(() => {
    if (!curLine || !blankIndices.length) return;
    userInteractedRef.current = true;
    let rightCount = 0;
    for (const idx of blankIndices) {
      const expected = tokens[idx].word ?? tokens[idx].text;
      if (isAnswerMatch(inputs[idx] ?? "", expected)) rightCount++;
    }
    const acc = (rightCount / blankIndices.length) * 100;
    setCheckedLineKey(lineKey);
    setDoneLineKeys((prev) => ({
      ...prev,
      [`${segKey}:${curLine.index}`]: rightCount === blankIndices.length,
    }));
    patchDictationStat(segKey, acc, "cloze");
    void bumpDay({ questions: 1, correct: rightCount === blankIndices.length ? 1 : 0 });
  }, [curLine, blankIndices, tokens, inputs, lineKey, segKey]);

  const goLine = useCallback(
    (nextPos: number) => {
      userInteractedRef.current = true;
      setLinePos(Math.max(0, Math.min(lines.length - 1, nextPos)));
    },
    [lines.length],
  );

  // 全局快捷键：Ctrl+Space 重听当前句；已核对或拼对后再按 Enter 进下一句并自动播音
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space" && curLine && (subMode === "cloze" || subMode === "chunk")) {
        e.preventDefault();
        userInteractedRef.current = true;
        clip.toggleRange(`${subMode}:${segKey}:${curLine.index}`, curLine.playStart, curLine.playEnd, { loop });
        return;
      }
      if (
        e.key === "Enter" &&
        !e.defaultPrevented &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        safeLinePos < lines.length - 1
      ) {
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable]")) return;
        const canAdvanceCloze = subMode === "cloze" && checkedLineKey === lineKey;
        const canAdvanceChunk = subMode === "chunk" && chunkChecked === "right";
        if (canAdvanceCloze || canAdvanceChunk) {
          e.preventDefault();
          goLine(safeLinePos + 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [curLine, subMode, segKey, clip, loop, safeLinePos, lines.length, checkedLineKey, lineKey, chunkChecked, goLine]);

  const revealFirstHint = () => {
    userInteractedRef.current = true;
    for (const idx of blankIndices) {
      const expected = tokens[idx].word ?? tokens[idx].text;
      const curVal = inputs[idx] ?? "";
      if (!isAnswerMatch(curVal, expected)) {
        const nextHintLen = Math.min(expected.length, curVal.trim().length + 1);
        setInputs((prev) => ({ ...prev, [idx]: expected.slice(0, nextHintLen) }));
        inputRefs.current[idx]?.focus();
        break;
      }
    }
  };

  const revealSingleBlank = (idx: number) => {
    userInteractedRef.current = true;
    const expected = tokens[idx]?.word ?? tokens[idx]?.text ?? "";
    if (!expected) return;
    setPeekedBlanks((prev) => ({ ...prev, [idx]: true }));
    setInputs((prev) => ({ ...prev, [idx]: expected }));
    const posInBlanks = blankIndices.indexOf(idx);
    const nextBlank = blankIndices.find(
      (bIdx, i) => i > posInBlanks && !isAnswerMatch(inputs[bIdx] ?? "", tokens[bIdx].word ?? ""),
    );
    if (nextBlank !== undefined) {
      window.setTimeout(() => inputRefs.current[nextBlank]?.focus(), 30);
    }
  };

  const handleQuickAddVocab = async (word: string, sentence: string, zh?: string | null) => {
    const clean = word.replace(/[^A-Za-z'’-]/g, "").toLowerCase();
    if (!clean) return;
    if (!(await db.vocab.get(clean))) {
      await addToVocab(clean, {
        paperId,
        paperTitle: `${pack.paper.title} · ${seg.shortLabel}`,
        sentence,
        zh: zh ?? undefined,
      });
    }
    setAddedVocab((prev) => ({ ...prev, [clean]: true }));
  };

  // 拼句逻辑
  const chunkMap = useMemo(() => new Map(chunks.map((c) => [c.id, c])), [chunks]);
  const remainingChunks = useMemo(
    () => chunks.filter((c) => !pickedIds.includes(c.id)),
    [chunks, pickedIds],
  );

  const pickChunk = (id: number) => {
    if (chunkChecked === "right") return;
    userInteractedRef.current = true;
    setChunkChecked("none");
    setPickedIds((prev) => {
      const next = [...prev, id];
      if (next.length === chunks.length) {
        const ok = next.every((cid, i) => chunkMap.get(cid)?.order === i);
        setChunkChecked(ok ? "right" : "wrong");
        if (ok && curLine) {
          setDoneLineKeys((d) => ({ ...d, [`${segKey}:${curLine.index}`]: true }));
          patchDictationStat(segKey, 100, "chunk");
          void bumpDay({ questions: 1, correct: 1 });
        } else {
          void bumpDay({ questions: 1, correct: 0 });
        }
      }
      return next;
    });
  };

  const unpickChunk = (id: number) => {
    if (chunkChecked === "right") return;
    setChunkChecked("none");
    setPickedIds((prev) => prev.filter((x) => x !== id));
  };

  const stat = progress.dictation[segKey];

  if (!lines.length) {
    return <EmptyState title="当前片段暂无可精听原文" desc="请从上方切换其他片段或试卷。" />;
  }

  const renderSentenceSideList = () => {
    const doneInSeg = lines.filter((ln) => doneLineKeys[`${segKey}:${ln.index}`]).length;
    return (
      <Card className="p-3.5 lg:sticky lg:top-4">
        <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-2.5">
          <span className="text-[13px] font-semibold text-[var(--ink)]">本段句子单</span>
          <span className="num text-[12px] text-[var(--ink-500)]">
            完成 {doneInSeg} / {lines.length}
          </span>
        </div>

        <div ref={sentenceListRef} className="max-h-[480px] space-y-1 overflow-y-auto pr-1">
          {lines.map((ln, idx) => {
            const done = !!doneLineKeys[`${segKey}:${ln.index}`];
            const isCur = idx === safeLinePos;
            const revealed =
              done ||
              (isCur && subMode === "cloze" && checkedLineKey === lineKey) ||
              (isCur && subMode === "chunk" && chunkChecked === "right");
            const durSec = (ln.playEnd - ln.playStart).toFixed(1);

            return (
              <button
                key={ln.index}
                type="button"
                data-studio-line={ln.index}
                onClick={() => {
                  userInteractedRef.current = true;
                  if (isCur) {
                    clip.toggleRange(`${subMode}:${segKey}:${ln.index}`, ln.playStart, ln.playEnd, { loop });
                  } else {
                    goLine(idx);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left transition",
                  isCur
                    ? "bg-[var(--blue-tint)]/65 shadow-[inset_3px_0_0_var(--blue)]"
                    : "hover:bg-[var(--paper-100)]",
                )}
                title={ln.qNumbers.length ? `第 ${idx + 1} 句 · 考点 Q${ln.qNumbers.join(",")}` : `点击听第 ${idx + 1} 句`}
              >
                <span
                  className={cn(
                    "bubble flex-none",
                    done && "border-[var(--green)] bg-[var(--green)]",
                    !done && isCur && "bubble-on",
                  )}
                />
                <span
                  className={cn(
                    "num w-5 flex-none text-[12px]",
                    isCur ? "font-semibold text-[var(--blue)]" : "text-[var(--ink-500)]",
                  )}
                >
                  {idx + 1}
                </span>
                <SpeakerTag speaker={ln.speaker} reliable={seg.speakerReliable} />

                <div className="min-w-0 flex-1">
                  {revealed ? (
                    <span className="serif block truncate text-[13px] text-[var(--ink-700)]">{ln.text}</span>
                  ) : (
                    <span className="flex h-4 items-center">
                      <span
                        className="block h-1.5 rounded-full bg-[var(--paper-200)]"
                        style={{ width: `${Math.min(100, Math.max(28, ln.text.length * 1.15))}%` }}
                      />
                    </span>
                  )}
                </div>

                {ln.qNumbers.length > 0 && (
                  <span className="num flex-none rounded bg-[var(--mark-tint)] px-1 py-0.5 text-[10px] font-semibold text-[var(--mark-ink)]">
                    Q{ln.qNumbers[0]}
                  </span>
                )}
                <span className="num flex-none text-[11px] text-[var(--ink-300)]">{durSec}s</span>
              </button>
            );
          })}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-3.5">
      {/* 顶部模式与播控开关栏 */}
      <Card className="flex flex-wrap items-center justify-between gap-2.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SUB_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                userInteractedRef.current = true;
                clip.pause();
                setSubMode(m.id);
              }}
              className={cn("pill", subMode === m.id && "pill-on")}
            >
              {m.label}
              {m.id === "signal" && pack.allSignalItems.length > 0 && (
                <span className="num ml-1 text-[11px] opacity-75">
                  {seg.signalItems.length || pack.allSignalItems.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] p-0.5">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => clip.setRate(r)}
                className={cn(
                  "num rounded-[6px] px-2 py-1 text-[12px] font-medium transition",
                  clip.rate === r ? "bg-white text-[var(--blue)] shadow-xs" : "text-[var(--ink-500)] hover:text-[var(--ink)]",
                )}
              >
                {r}x
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleAutoPlay}
            aria-pressed={autoPlay}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium transition",
              autoPlay
                ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--paper-50)]",
            )}
            title="切句或切换片段后自动播放当前句"
          >
            <SpeakerHigh className="size-3.5" />
            切句自动播
          </button>

          <button
            type="button"
            onClick={toggleLoop}
            aria-pressed={loop}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium transition",
              loop
                ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--paper-50)]",
            )}
          >
            <RepeatOnce className="size-3.5" />
            单句循环
          </button>

          {stat && (
            <Badge tone="success">
              历史最高 <span className="num">{stat.bestAcc}%</span>
            </Badge>
          )}
        </div>
      </Card>

      {clip.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--danger-soft-line)] bg-[var(--red-tint)] px-4 py-2.5 text-[13px] text-[var(--red)]">
          <span>{clip.error}</span>
          <button
            type="button"
            onClick={() => {
              userInteractedRef.current = true;
              clip.replay();
            }}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-white px-2.5 text-[12px] font-semibold text-[var(--red)] shadow-xs hover:bg-[var(--paper-50)]"
          >
            <ArrowClockwise className="size-3.5" /> 重试播放
          </button>
        </div>
      )}

      {/* ==================== 1. 挖空听写 ==================== */}
      {subMode === "cloze" && curLine && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
          <Card className="card-raised p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <SpeakerTag speaker={curLine.speaker} reliable={seg.speakerReliable} />
                <span className="text-[13px] font-medium text-[var(--ink-500)]">
                  第 <span className="num text-[var(--ink)]">{safeLinePos + 1}</span> / {lines.length} 句
                </span>
                {curLine.qNumbers.length > 0 && (
                  <Badge tone="accent">
                    <Target className="mr-1 size-3" />
                    考点句 Q{curLine.qNumbers.join(",")}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {DIFFS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDifficulty(d.id)}
                    className={cn(
                      "h-7 rounded-[7px] px-2.5 text-[12px] font-medium transition",
                      difficulty === d.id
                        ? "bg-[var(--ink)] text-white"
                        : "bg-[var(--paper-100)] text-[var(--ink-700)] hover:bg-[var(--paper-200)]",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeLinePos === 0}
                  onClick={() => goLine(safeLinePos - 1)}
                  title="上一句"
                >
                  <CaretLeft className="size-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeLinePos >= lines.length - 1}
                  onClick={() => goLine(safeLinePos + 1)}
                  title="下一句"
                >
                  <CaretRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <ProgressBar
              value={(safeLinePos + 1) / Math.max(1, lines.length)}
              className="mt-3"
              label="精听进度"
            />

            <SentenceAudioBar
              clip={clip}
              playKey={`cloze:${segKey}:${curLine.index}`}
              start={curLine.playStart}
              end={curLine.playEnd}
              loop={loop}
              ctxStart={prevLine?.playStart}
              ctxKey={prevLine ? `cloze-ctx:${segKey}:${curLine.index}` : undefined}
              onBeforePlay={() => {
                userInteractedRef.current = true;
              }}
              className="mt-4"
            />

            {/* 挖空听写文具横格区 */}
            <div className="serif mt-4 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] px-5 py-6 text-[20px] leading-[2.45] text-[var(--ink)]">
              {tokens.map((tok, i) => {
                if (!tok.blank) {
                  return <span key={i}>{tok.text}</span>;
                }
                const expected = tok.word ?? tok.text;
                const val = inputs[tok.index] ?? "";
                const checked = checkedLineKey === lineKey;
                const matched = isAnswerMatch(val, expected);
                const isPeeked = !!peekedBlanks[tok.index];
                const chWidth = Math.max(4, Math.min(22, Math.max(expected.length, val.length) + 1));

                if (checked) {
                  if (matched) {
                    return (
                      <span
                        key={i}
                        className={cn(
                          "mx-0.5 inline-block rounded-[4px] border-b-2 px-1.5 font-semibold",
                          isPeeked
                            ? "border-[var(--mark-ink)]/55 bg-[var(--mark-tint)]/60 text-[var(--mark-ink)]"
                            : "border-[var(--green)] bg-[var(--green-tint)] text-[var(--green-dark)]",
                        )}
                      >
                        {expected}
                      </span>
                    );
                  }
                  const clean = expected.replace(/[^A-Za-z'’-]/g, "").toLowerCase();
                  return (
                    <span key={i} className="mx-0.5 inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--red-tint)] px-1.5">
                      {val.trim() && (
                        <span className="text-[16px] text-[var(--red)] line-through">{val.trim()}</span>
                      )}
                      <span className="font-semibold text-[var(--green-dark)]">{expected}</span>
                      {clean && (
                        <button
                          type="button"
                          onClick={() => void handleQuickAddVocab(clean, curLine.text, curLine.zh)}
                          className="ml-0.5 font-sans text-[11px] font-medium text-[var(--blue)] hover:underline"
                          title="加入生词本"
                        >
                          {addedVocab[clean] ? "已存" : "+生词"}
                        </button>
                      )}
                    </span>
                  );
                }

                return (
                  <span key={i} className="relative mx-0.5 inline-flex items-center">
                    <input
                      ref={(el) => {
                        inputRefs.current[tok.index] = el;
                      }}
                      type="text"
                      value={val}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      style={{ width: `${chWidth}ch` }}
                      aria-label={`听写第 ${tok.index + 1} 空，双击可揭晓单词`}
                      title="双击可直接揭晓此空"
                      onFocus={() => setFocusedBlank(tok.index)}
                      onBlur={() => setFocusedBlank((cur) => (cur === tok.index ? null : cur))}
                      onDoubleClick={() => revealSingleBlank(tok.index)}
                      onChange={(e) => {
                        const nextVal = e.target.value;
                        setInputs((prev) => ({ ...prev, [tok.index]: nextVal }));
                        if (isPeeked && !isAnswerMatch(nextVal, expected)) {
                          setPeekedBlanks((prev) => ({ ...prev, [tok.index]: false }));
                        }
                        if (nextVal.length >= expected.length && isAnswerMatch(nextVal, expected)) {
                          const posInBlanks = blankIndices.indexOf(tok.index);
                          const nextBlank = blankIndices.find(
                            (bIdx, p) => p > posInBlanks && !isAnswerMatch(inputs[bIdx] ?? "", tokens[bIdx].word ?? ""),
                          );
                          if (nextBlank !== undefined) {
                            window.setTimeout(() => inputRefs.current[nextBlank]?.focus(), 30);
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          checkCloze();
                        } else if (e.key === " " && !e.ctrlKey && !e.metaKey) {
                          e.preventDefault();
                          const posInBlanks = blankIndices.indexOf(tok.index);
                          const nextBlank =
                            blankIndices.find(
                              (bIdx, p) => p > posInBlanks && !isAnswerMatch(inputs[bIdx] ?? "", tokens[bIdx].word ?? ""),
                            ) ?? blankIndices[Math.min(blankIndices.length - 1, posInBlanks + 1)];
                          if (nextBlank !== undefined && nextBlank !== tok.index) {
                            inputRefs.current[nextBlank]?.focus();
                          }
                        } else if (e.key === "Backspace" && val === "") {
                          const posInBlanks = blankIndices.indexOf(tok.index);
                          if (posInBlanks > 0) {
                            e.preventDefault();
                            inputRefs.current[blankIndices[posInBlanks - 1]]?.focus();
                          }
                        }
                      }}
                      className={cn(
                        "serif inline-block border-b-2 px-1 text-center text-[19px] leading-7 transition outline-none",
                        isPeeked && matched
                          ? "border-[var(--mark-ink)]/60 bg-[var(--mark-tint)]/55 text-[var(--ink)]"
                          : val && matched
                            ? "border-[var(--green)] bg-white/90 text-[var(--green-dark)]"
                            : "border-[var(--ink-300)] bg-white/80 text-[var(--ink)] focus:border-[var(--blue)] focus:bg-[var(--blue-tint)]/35",
                      )}
                    />
                    {focusedBlank === tok.index && !matched && (
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          revealSingleBlank(tok.index);
                        }}
                        className="ml-0.5 inline-flex size-5 items-center justify-center rounded bg-white text-[var(--ink-500)] shadow-xs hover:text-[var(--blue)]"
                        title="单独揭晓这一空"
                        aria-label="单独揭晓这一空"
                      >
                        <Eye className="size-3.5" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {checkedLineKey !== lineKey ? (
                <>
                  <Button variant="primary" onClick={checkCloze}>
                    <Check className="size-4" weight="bold" /> 核对答案
                  </Button>
                  <Button variant="secondary" onClick={revealFirstHint}>
                    <Lightbulb className="size-4" /> 提示一字母
                  </Button>
                  <span className="ml-auto hidden text-[12px] text-[var(--ink-500)] xl:inline">
                    Ctrl+Space 重听 · Space 下一空 · 双击空位看词 · Enter 核对
                  </span>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setInputs({});
                      setPeekedBlanks({});
                      setCheckedLineKey(null);
                      window.setTimeout(() => inputRefs.current[blankIndices[0]]?.focus(), 30);
                    }}
                  >
                    <ArrowClockwise className="size-4" /> 重写这句
                  </Button>
                  {safeLinePos < lines.length - 1 && (
                    <Button variant="primary" onClick={() => goLine(safeLinePos + 1)}>
                      继续下一句 (Enter) <CaretRight className="size-4" />
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* 核对后展示可点词原句 + 中文译文 */}
            {checkedLineKey === lineKey && (
              <div className="mt-4 space-y-2 rounded-[10px] border border-[var(--line-soft)] bg-white p-4">
                <div className="text-[12px] text-[var(--ink-500)]">
                  原句精读（点击任意单词查词并加入生词本）
                </div>
                <p className="serif text-[17px] leading-[1.7] text-[var(--ink)]">
                  <WordText text={curLine.text} />
                </p>
                {curLine.zh && (
                  <p className="border-t border-[var(--line-soft)] pt-2 text-[14px] leading-[1.6] text-[var(--ink-700)]">
                    {curLine.zh}
                  </p>
                )}
              </div>
            )}
          </Card>

          {renderSentenceSideList()}
        </div>
      )}

      {/* ==================== 2. 听音拼句 ==================== */}
      {subMode === "chunk" && curLine && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
          <Card className="card-raised p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3.5">
              <div className="flex items-center gap-2">
                <SpeakerTag speaker={curLine.speaker} reliable={seg.speakerReliable} />
                <span className="text-[14px] font-medium text-[var(--ink-700)]">
                  听音拼句 · 第 <span className="num text-[var(--ink)]">{safeLinePos + 1}</span> / {lines.length} 句
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeLinePos === 0}
                  onClick={() => goLine(safeLinePos - 1)}
                >
                  <CaretLeft className="size-3.5" /> 上一句
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeLinePos >= lines.length - 1}
                  onClick={() => goLine(safeLinePos + 1)}
                >
                  下一句 <CaretRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <SentenceAudioBar
              clip={clip}
              playKey={`chunk:${segKey}:${curLine.index}`}
              start={curLine.playStart}
              end={curLine.playEnd}
              loop={loop}
              ctxStart={prevLine?.playStart}
              ctxKey={prevLine ? `chunk-ctx:${segKey}:${curLine.index}` : undefined}
              onBeforePlay={() => {
                userInteractedRef.current = true;
              }}
              className="mt-4"
            />

            {/* 已拼句子区 */}
            <div
              className={cn(
                "mt-4 min-h-[88px] rounded-[12px] border-2 border-dashed p-4 transition",
                chunkChecked === "right"
                  ? "border-[var(--green)] bg-[var(--green-tint)]/50"
                  : chunkChecked === "wrong"
                    ? "border-[var(--red)] bg-[var(--red-tint)]/50"
                    : "border-[var(--line-control)] bg-[var(--paper-50)]",
              )}
            >
              {pickedIds.length === 0 ? (
                <p className="py-3 text-center text-[14px] text-[var(--ink-500)]">
                  点击下方打乱的意群词块，按听到的顺序拼回完整原句
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pickedIds.map((cid, pos) => {
                    const ch = chunkMap.get(cid);
                    if (!ch) return null;
                    const wrongSpot = chunkChecked === "wrong" && ch.order !== pos;
                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => unpickChunk(cid)}
                        className={cn(
                          "serif rounded-[9px] border px-3 py-1.5 text-[16px] shadow-xs transition",
                          chunkChecked === "right"
                            ? "border-[var(--green)] bg-white text-[var(--green-dark)]"
                            : wrongSpot
                              ? "border-[var(--red)] bg-white text-[var(--red)]"
                              : "border-[var(--blue-line)] bg-white text-[var(--ink)] hover:border-[var(--red)]",
                        )}
                      >
                        {ch.text}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 词块池 */}
            <div className="mt-4 flex flex-wrap gap-2">
              {remainingChunks.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => pickChunk(ch.id)}
                  className="card-press serif rounded-[9px] border border-[var(--line)] bg-white px-3.5 py-2 text-[16px] text-[var(--ink)] hover:border-[var(--blue)] hover:bg-[var(--blue-tint)]/40"
                >
                  {ch.text}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPickedIds([]);
                  setChunkChecked("none");
                }}
              >
                <ArrowClockwise className="size-3.5" /> 清空重拼
              </Button>
              {chunkChecked === "wrong" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const ordered = [...chunks].sort((a, b) => a.order - b.order).map((c) => c.id);
                    setPickedIds(ordered);
                    setChunkChecked("right");
                  }}
                >
                  还原正确语序
                </Button>
              )}
              {chunkChecked === "right" && safeLinePos < lines.length - 1 && (
                <Button variant="primary" size="sm" onClick={() => goLine(safeLinePos + 1)}>
                  继续下一句 (Enter) <CaretRight className="size-3.5" />
                </Button>
              )}
            </div>

            {chunkChecked === "right" && (
              <div className="mt-4 space-y-2 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper-50)] p-4">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--green-dark)]">
                  <Check className="size-4" weight="bold" /> 语序完全正确！点击句中单词可查看释义
                </div>
                <p className="serif text-[17px] leading-[1.7] text-[var(--ink)]">
                  <WordText text={curLine.text} />
                </p>
                {curLine.zh && <p className="text-[14px] text-[var(--ink-700)]">{curLine.zh}</p>}
              </div>
            )}
          </Card>

          {renderSentenceSideList()}
        </div>
      )}

      {/* ==================== 3. 盲听刮刮卡 ==================== */}
      {subMode === "blind" && (
        <Card className="card-raised p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--line-soft)] pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant={clip.activeKey === segPlayKey && clip.status !== "idle" ? "secondary" : "primary"}
                size="sm"
                onClick={() => {
                  userInteractedRef.current = true;
                  clip.toggleRange(segPlayKey, seg.start, seg.end, { loop: false });
                }}
              >
                {clip.activeKey === segPlayKey && clip.loading ? (
                  <>
                    <Spinner className="size-3.5" /> 缓冲整段…
                  </>
                ) : clip.activeKey === segPlayKey && clip.playing ? (
                  <>
                    <Pause className="size-3.5" weight="fill" /> 暂停整段连播
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" weight="fill" /> 整段连播 ({Math.round(seg.end - seg.start)}s)
                  </>
                )}
              </Button>
              <p className="text-[13px] text-[var(--ink-500)]">
                先盲听理解，再逐层揭开英文与译文
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: "blind", label: "全盲听遮罩" },
                  { id: "en", label: "全部显英文" },
                  { id: "both", label: "中英全显" },
                ] as const
              ).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setBlindGlobal(g.id);
                    setRevealedEn({});
                    setRevealedZh({});
                  }}
                  className={cn("pill", blindGlobal === g.id && "pill-on")}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[var(--line-soft)]">
            {lines.map((ln, idx) => {
              const showEn = blindGlobal !== "blind" || !!revealedEn[ln.index];
              const showZh = blindGlobal === "both" || !!revealedZh[ln.index];
              const linePlayKey = `blind:${segKey}:${ln.index}`;
              const isRowActive =
                (clip.activeKey === linePlayKey && clip.status !== "idle") || segFollowIdx === ln.index;
              const isRowLoading = clip.activeKey === linePlayKey && clip.loading;

              return (
                <div
                  key={ln.index}
                  className={cn(
                    "flex flex-col gap-2 py-3 transition-colors sm:flex-row sm:items-start sm:gap-3",
                    isRowActive && "rounded-[8px] bg-[var(--blue-tint)]/45 px-2.5",
                  )}
                >
                  <div className="flex flex-none items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        userInteractedRef.current = true;
                        clip.toggleRange(linePlayKey, ln.playStart, ln.playEnd, { loop });
                      }}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-full transition",
                        isRowActive
                          ? "bg-[var(--blue)] text-white"
                          : "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--blue)] hover:text-[var(--blue)]",
                      )}
                      aria-label={`播放第 ${idx + 1} 句`}
                    >
                      {isRowLoading ? (
                        <Spinner className="size-3.5 text-white" />
                      ) : clip.activeKey === linePlayKey && clip.playing ? (
                        <Pause className="size-3.5" weight="fill" />
                      ) : (
                        <Play className="size-3.5" weight="fill" />
                      )}
                    </button>
                    <span className="num w-6 text-[12px] text-[var(--ink-500)]">{idx + 1}</span>
                    <SpeakerTag speaker={ln.speaker} reliable={seg.speakerReliable} />
                  </div>

                  <div className="min-w-0 flex-1">
                    {showEn ? (
                      <p className="serif text-[16px] leading-[1.7] text-[var(--ink)]">
                        <WordText text={ln.text} />
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevealedEn((prev) => ({ ...prev, [ln.index]: true }))}
                        className="group flex w-full items-center gap-2 rounded-[8px] border border-dashed border-[var(--line-control)] bg-[var(--paper-50)] px-3 py-2 text-left text-[13px] text-[var(--ink-500)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
                      >
                        <Eye className="size-4 flex-none" />
                        <span>点击揭开第 {idx + 1} 句英文原文</span>
                      </button>
                    )}

                    {showZh && ln.zh && (
                      <p className="mt-1 text-[14px] leading-[1.6] text-[var(--ink-500)]">{ln.zh}</p>
                    )}
                  </div>

                  <div className="flex flex-none items-center gap-1.5">
                    {ln.qNumbers.length > 0 && (
                      <Badge tone="accent">考点 Q{ln.qNumbers.join(",")}</Badge>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedEn((prev) => ({ ...prev, [ln.index]: !showEn }))
                      }
                      className="rounded-[7px] px-2 py-1 text-[12px] text-[var(--ink-500)] hover:bg-[var(--paper-100)] hover:text-[var(--ink)]"
                      title={showEn ? "遮住英文" : "看英文"}
                    >
                      {showEn ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    {ln.zh && (
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedZh((prev) => ({ ...prev, [ln.index]: !showZh }))
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[12px]",
                          showZh
                            ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                            : "text-[var(--ink-500)] hover:bg-[var(--paper-100)]",
                        )}
                      >
                        <Translate className="size-3.5" /> 译
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ==================== 4. 考点信号句特训 ==================== */}
      {subMode === "signal" && (
        <Card className="card-raised p-5 sm:p-6">
          {!checkSignalList.length ? (
            <EmptyState
              title="当前试卷暂未收录答案句精确定位"
              desc="你可以切到其他真题试卷，或先使用「挖空听写」「盲听刮刮卡」。"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-3.5">
                <div className="flex items-center gap-2">
                  <Badge tone="primary">
                    <Sparkle className="mr-1 size-3" weight="fill" />
                    第 {curSignal.number} 题考点出处句
                  </Badge>
                  <span className="num text-[13px] text-[var(--ink-500)]">
                    {safeSigPos + 1} / {checkSignalList.length}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {seg.signalItems.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          userInteractedRef.current = true;
                          setSignalScope("seg");
                          setSignalPos(0);
                        }}
                        className={cn("pill", signalScope === "seg" && "pill-on")}
                      >
                        本段 {seg.signalItems.length} 题
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          userInteractedRef.current = true;
                          setSignalScope("paper");
                          setSignalPos(0);
                        }}
                        className={cn("pill", signalScope === "paper" && "pill-on")}
                      >
                        全卷 {pack.allSignalItems.length} 题
                      </button>
                    </>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeSigPos === 0}
                    onClick={() => {
                      userInteractedRef.current = true;
                      setSignalPos((p) => Math.max(0, p - 1));
                    }}
                  >
                    <CaretLeft className="size-3.5" /> 上一题
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeSigPos >= checkSignalList.length - 1}
                    onClick={() => {
                      userInteractedRef.current = true;
                      setSignalPos((p) => Math.min(checkSignalList.length - 1, p + 1));
                    }}
                  >
                    下一题 <CaretRight className="size-3.5" />
                  </Button>
                </div>
              </div>

              <SentenceAudioBar
                clip={clip}
                playKey={`sig-ctx:${curSignal.q.id}`}
                start={curSignal.prevLine ? curSignal.prevLine.playStart : curSignal.targetLine.playStart}
                end={curSignal.targetLine.playEnd}
                loop={false}
                onBeforePlay={() => {
                  userInteractedRef.current = true;
                }}
                badge={
                  <button
                    type="button"
                    onClick={() => {
                      userInteractedRef.current = true;
                      clip.toggleRange(
                        `sig-only:${curSignal.q.id}`,
                        curSignal.targetLine.playStart,
                        curSignal.targetLine.playEnd,
                      );
                    }}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                      clip.activeKey === `sig-only:${curSignal.q.id}` && clip.status !== "idle"
                        ? "bg-[var(--blue)] text-white"
                        : "bg-white text-[var(--ink-700)] shadow-xs hover:text-[var(--blue)]",
                    )}
                  >
                    {clip.activeKey === `sig-only:${curSignal.q.id}` && clip.playing
                      ? "暂停仅答案句"
                      : "仅听答案句"}
                  </button>
                }
                className="mt-4"
              />

              {curSignal.q.stem && (
                <p className="serif mt-4 text-[16px] font-medium text-[var(--ink)]">
                  {curSignal.number}. {curSignal.q.stem}
                </p>
              )}

              {/* 四选一选项 */}
              <div className="mt-4 space-y-2">
                {(curSignal.q.options ?? []).map((opt) => {
                  const chosen = signalPicked[curSignal.q.id];
                  const answered = !!chosen;
                  const isRight = curSignal.q.answer === opt.key;
                  const isMine = chosen === opt.key;

                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={answered}
                      onClick={() => {
                        userInteractedRef.current = true;
                        setSignalPicked((prev) => ({ ...prev, [curSignal.q.id]: opt.key }));
                        const ok = curSignal.q.answer === opt.key;
                        patchDictationStat(segKey, ok ? 100 : 50, "signal");
                        void bumpDay({ questions: 1, correct: ok ? 1 : 0 });
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-[10px] border px-4 py-3 text-left transition",
                        !answered
                          ? "border-[var(--line)] bg-white hover:border-[var(--blue)] hover:bg-[var(--blue-tint)]/30"
                          : isRight
                            ? "border-[var(--green)] bg-[var(--green-tint)]"
                            : isMine
                              ? "border-[var(--red)] bg-[var(--red-tint)]"
                              : "border-[var(--line-soft)] bg-[var(--paper-50)] opacity-65",
                      )}
                    >
                      <span
                        className={cn(
                          "num mt-0.5 flex size-6 flex-none items-center justify-center rounded-full text-[13px] font-semibold",
                          !answered
                            ? "bg-[var(--paper-100)] text-[var(--ink-700)]"
                            : isRight
                              ? "bg-[var(--green)] text-white"
                              : isMine
                                ? "bg-[var(--red)] text-white"
                                : "bg-[var(--paper-200)] text-[var(--ink-500)]",
                        )}
                      >
                        {opt.key}
                      </span>
                      <span className="serif flex-1 text-[16px] leading-[1.55] text-[var(--ink)]">
                        {opt.text}
                      </span>
                      {answered && isRight && <Check className="mt-1 size-4 text-[var(--green)]" weight="bold" />}
                      {answered && isMine && !isRight && <X className="mt-1 size-4 text-[var(--red)]" weight="bold" />}
                    </button>
                  );
                })}
              </div>

              {/* 选完后揭晓原文答案句、信号词高亮和解析 */}
              {signalPicked[curSignal.q.id] && (
                <div className="mt-5 space-y-3 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">
                      正确答案 {curSignal.q.answer}
                    </Badge>
                    {curSignal.q.explain?.signal && (
                      <Badge tone="accent">出题信号：{curSignal.q.explain.signal}</Badge>
                    )}
                  </div>

                  {curSignal.prevLine && (
                    <p className="serif text-[14px] leading-[1.6] text-[var(--ink-500)]">
                      上一句铺垫：<WordText text={curSignal.prevLine.text} />
                    </p>
                  )}

                  <div className="rounded-[9px] bg-white p-3.5 shadow-xs">
                    <div className="mb-1 text-[12px] font-medium text-[var(--blue)]">答案出处句（高亮转折/信号词）</div>
                    <HighlightSignalText text={curSignal.targetLine.text} />
                    {curSignal.targetLine.zh && (
                      <p className="mt-2 border-t border-[var(--line-soft)] pt-2 text-[14px] text-[var(--ink-700)]">
                        {curSignal.targetLine.zh}
                      </p>
                    )}
                  </div>

                  {(curSignal.q.explain?.brief || curSignal.q.explain?.reasoning || curSignal.q.explanation) && (
                    <p className="text-[13px] leading-[1.65] text-[var(--ink-700)]">
                      <span className="font-semibold text-[var(--ink)]">解析：</span>
                      {curSignal.q.explain?.brief ||
                        curSignal.q.explain?.reasoning ||
                        curSignal.q.explanation}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
