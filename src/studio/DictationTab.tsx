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
  Target,
  Translate,
  X,
} from "@phosphor-icons/react";
import { Badge, Button, Card, EmptyState, ProgressBar } from "@/components/ui";
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

const SIGNAL_WORDS_RE =
  /\b(however|but|yet|actually|instead|rather|in fact|nevertheless|although|though|despite|unfortunately|especially|primarily|mainly|because|therefore|consequently|finally|except|unless|only if)\b/gi;

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
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 挖空听写状态
  const [inputs, setInputs] = useState<Record<number, string>>({});
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

  // 考点信号句特训状态
  const [signalScope, setSignalScope] = useState<"seg" | "paper">("seg");
  const [signalPos, setSignalPos] = useState(0);
  const [signalPicked, setSignalPicked] = useState<Record<string, string>>({});

  const lines = seg.lines;
  const safeLinePos = Math.min(linePos, Math.max(0, lines.length - 1));
  const curLine = lines[safeLinePos];
  const paperId = pack.paper.id;
  const segKey = `${paperId}:${seg.id}`;
  const lineKey = curLine ? `${segKey}:${curLine.index}:${difficulty}` : "";

  // 切换段落时重置句子游标和单句交互状态
  useEffect(() => {
    setLinePos(0);
    setInputs({});
    setCheckedLineKey(null);
    setPickedIds([]);
    setChunkChecked("none");
    setRevealedEn({});
    setRevealedZh({});
    setSignalPos(0);
    setActiveKey(null);
  }, [paperId, seg.id]);

  // 切换句子或难度时重置输入与拼句状态
  useEffect(() => {
    setInputs({});
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

  const playSegmentLine = useCallback(
    (id: string, start: number, end: number) => {
      if (clip.playing && activeKey === id) {
        clip.pause();
        setActiveKey(null);
        return;
      }
      setActiveKey(id);
      void clip.playRange(start, end, {
        loop,
        onEnded: () => setActiveKey(null),
      });
    },
    [clip, activeKey, loop],
  );

  // 全局快捷键 Ctrl+Space 重播当前句
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space" && curLine && (subMode === "cloze" || subMode === "chunk")) {
        e.preventDefault();
        playSegmentLine(`line:${curLine.index}`, curLine.start, curLine.end);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [curLine, subMode, playSegmentLine]);

  const checkCloze = () => {
    if (!curLine || !blankIndices.length) return;
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
  };

  const revealFirstHint = () => {
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

  const checkSignalList: StudioSignalItem[] = useMemo(() => {
    if (signalScope === "seg" && seg.signalItems.length > 0) return seg.signalItems;
    return pack.allSignalItems;
  }, [signalScope, seg.signalItems, pack.allSignalItems]);

  const safeSigPos = Math.min(signalPos, Math.max(0, checkSignalList.length - 1));
  const curSignal = checkSignalList[safeSigPos];
  const stat = progress.dictation[segKey];

  if (!lines.length) {
    return <EmptyState title="当前片段暂无可精听原文" desc="请从上方切换其他片段或试卷。" />;
  }

  return (
    <div className="space-y-4">
      {/* 顶部模式与语速栏 */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {SUB_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSubMode(m.id)}
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
            onClick={() => setLoop((v) => !v)}
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
        <div className="rounded-[10px] border border-[var(--danger-soft-line)] bg-[var(--red-tint)] px-4 py-2.5 text-[13px] text-[var(--red)]">
          {clip.error}
        </div>
      )}

      {/* ==================== 1. 挖空听写 ==================== */}
      {subMode === "cloze" && curLine && (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-4">
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
              <span className="num text-[12px] text-[var(--ink-300)]">
                ({(curLine.end - curLine.start).toFixed(1)}s)
              </span>
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
            </div>
          </div>

          <ProgressBar
            value={(safeLinePos + 1) / Math.max(1, lines.length)}
            className="mt-3"
            label="精听进度"
          />

          {/* 播控与快捷键提示 */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              onClick={() => playSegmentLine(`line:${curLine.index}`, curLine.start, curLine.end)}
            >
              {clip.playing && activeKey === `line:${curLine.index}` ? (
                <>
                  <Pause className="size-4" weight="fill" /> 暂停播放
                </>
              ) : (
                <>
                  <Play className="size-4" weight="fill" /> 听这一句
                </>
              )}
            </Button>

            <Button
              variant="secondary"
              disabled={safeLinePos === 0}
              onClick={() => setLinePos((p) => Math.max(0, p - 1))}
            >
              <CaretLeft className="size-4" /> 上一句
            </Button>
            <Button
              variant="secondary"
              disabled={safeLinePos >= lines.length - 1}
              onClick={() => setLinePos((p) => Math.min(lines.length - 1, p + 1))}
            >
              下一句 <CaretRight className="size-4" />
            </Button>

            <span className="ml-auto hidden text-[12px] text-[var(--ink-500)] sm:inline">
              快捷键：Ctrl + Space 重听 · Enter 核对
            </span>
          </div>

          {/* 挖空输入区域 */}
          <div className="serif mt-6 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] px-5 py-6 text-[20px] leading-[2.35] text-[var(--ink)]">
            {tokens.map((tok, i) => {
              if (!tok.blank) {
                return <span key={i}>{tok.text}</span>;
              }
              const expected = tok.word ?? tok.text;
              const val = inputs[tok.index] ?? "";
              const checked = checkedLineKey === lineKey;
              const matched = isAnswerMatch(val, expected);
              const chWidth = Math.max(4, Math.min(18, expected.length + 1));

              if (checked) {
                if (matched) {
                  return (
                    <span
                      key={i}
                      className="mx-0.5 inline-block rounded-[4px] border-b-2 border-[var(--green)] bg-[var(--green-tint)] px-1.5 font-semibold text-[var(--green-dark)]"
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
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[tok.index] = el;
                  }}
                  type="text"
                  value={val}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  style={{ width: `${chWidth}ch` }}
                  aria-label={`听写第 ${tok.index + 1} 空`}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setInputs((prev) => ({ ...prev, [tok.index]: nextVal }));
                    // 若完整拼出且精确匹配，平滑跳到下一个尚未填对的空位
                    if (
                      nextVal.length >= expected.length &&
                      isAnswerMatch(nextVal, expected)
                    ) {
                      const posInBlanks = blankIndices.indexOf(tok.index);
                      const nextBlank = blankIndices[posInBlanks + 1];
                      if (nextBlank !== undefined && !isAnswerMatch(inputs[nextBlank] ?? "", tokens[nextBlank].word ?? "")) {
                        setTimeout(() => inputRefs.current[nextBlank]?.focus(), 30);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      checkCloze();
                    }
                  }}
                  className={cn(
                    "serif mx-0.5 inline-block border-b-2 bg-white/80 px-1 text-center text-[19px] leading-7 transition outline-none",
                    val && isAnswerMatch(val, expected)
                      ? "border-[var(--green)] text-[var(--green-dark)]"
                      : "border-[var(--ink-300)] text-[var(--ink)] focus:border-[var(--blue)] focus:bg-[var(--blue-tint)]/30",
                  )}
                />
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
                  <Lightbulb className="size-4" /> 提示一个字母
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setInputs({});
                    setCheckedLineKey(null);
                  }}
                >
                  <ArrowClockwise className="size-4" /> 重写这句
                </Button>
                {safeLinePos < lines.length - 1 && (
                  <Button variant="primary" onClick={() => setLinePos((p) => p + 1)}>
                    继续下一句 <CaretRight className="size-4" />
                  </Button>
                )}
              </>
            )}
          </div>

          {/* 核对后展示可点词原句 + 中文译文 */}
          {checkedLineKey === lineKey && (
            <div className="mt-5 space-y-2 rounded-[10px] border border-[var(--line-soft)] bg-white p-4">
              <div className="flex items-center gap-2 text-[12px] text-[var(--ink-500)]">
                <span>原句精读（点击任意单词查词并加入生词本）</span>
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

          {/* 底部句号跳转气泡 */}
          <div className="mt-6 flex flex-wrap gap-1.5 border-t border-[var(--line-soft)] pt-4">
            {lines.map((ln, idx) => {
              const done = doneLineKeys[`${segKey}:${ln.index}`];
              const isCur = idx === safeLinePos;
              return (
                <button
                  key={ln.index}
                  type="button"
                  onClick={() => setLinePos(idx)}
                  className={cn(
                    "num relative inline-flex h-7 min-w-[28px] items-center justify-center rounded-[7px] px-2 text-[12px] font-medium transition",
                    isCur
                      ? "bg-[var(--blue)] text-white"
                      : done
                        ? "bg-[var(--green-tint)] text-[var(--green-dark)]"
                        : "bg-[var(--paper-100)] text-[var(--ink-700)] hover:bg-[var(--paper-200)]",
                  )}
                  title={ln.qNumbers.length ? `考点句 Q${ln.qNumbers.join(",")}` : `第 ${idx + 1} 句`}
                >
                  {idx + 1}
                  {ln.qNumbers.length > 0 && (
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 size-2 rounded-full",
                        isCur ? "bg-[#ffe66d]" : "bg-[var(--mark-ink)]",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* ==================== 2. 听音拼句 ==================== */}
      {subMode === "chunk" && curLine && (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-4">
            <div className="flex items-center gap-2">
              <SpeakerTag speaker={curLine.speaker} reliable={seg.speakerReliable} />
              <span className="text-[14px] font-medium text-[var(--ink-700)]">
                听音拼句 · 第 <span className="num text-[var(--ink)]">{safeLinePos + 1}</span> / {lines.length} 句
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => playSegmentLine(`chunk:${curLine.index}`, curLine.start, curLine.end)}
              >
                {clip.playing && activeKey === `chunk:${curLine.index}` ? (
                  <>
                    <Pause className="size-3.5" weight="fill" /> 暂停
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" weight="fill" /> 听录音
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={safeLinePos === 0}
                onClick={() => setLinePos((p) => Math.max(0, p - 1))}
              >
                上一句
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={safeLinePos >= lines.length - 1}
                onClick={() => setLinePos((p) => Math.min(lines.length - 1, p + 1))}
              >
                下一句
              </Button>
            </div>
          </div>

          {/* 已拼句子区 */}
          <div
            className={cn(
              "mt-5 min-h-[88px] rounded-[12px] border-2 border-dashed p-4 transition",
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
      )}

      {/* ==================== 3. 盲听刮刮卡 ==================== */}
      {subMode === "blind" && (
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-3">
            <p className="text-[13px] text-[var(--ink-500)]">
              先盲听理解，再逐层揭开英文与译文（可单独点击每一行）
            </p>
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
              const isPlaying = clip.playing && activeKey === `blind:${ln.index}`;

              return (
                <div
                  key={ln.index}
                  className={cn(
                    "flex flex-col gap-2 py-3.5 transition-colors sm:flex-row sm:items-start sm:gap-3",
                    isPlaying && "rounded-[8px] bg-[var(--blue-tint)]/35 px-2.5",
                  )}
                >
                  <div className="flex flex-none items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => playSegmentLine(`blind:${ln.index}`, ln.start, ln.end)}
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-full transition",
                        isPlaying
                          ? "bg-[var(--blue)] text-white"
                          : "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--blue)] hover:text-[var(--blue)]",
                      )}
                      aria-label={`播放第 ${idx + 1} 句`}
                    >
                      {isPlaying ? <Pause className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
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
        <Card className="p-5 sm:p-6">
          {!checkSignalList.length ? (
            <EmptyState
              title="当前试卷暂未收录答案句精确定位"
              desc="你可以切到其他真题试卷，或先使用「挖空听写」「盲听刮刮卡」。"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-4">
                <div className="flex items-center gap-2">
                  <Badge tone="primary">
                    <Sparkle className="mr-1 size-3" weight="fill" />
                    第 {curSignal.number} 题考点出处句
                  </Badge>
                  <span className="num text-[13px] text-[var(--ink-500)]">
                    {safeSigPos + 1} / {checkSignalList.length}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {seg.signalItems.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
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
                          setSignalScope("paper");
                          setSignalPos(0);
                        }}
                        className={cn("pill", signalScope === "paper" && "pill-on")}
                      >
                        全卷 {pack.allSignalItems.length} 题
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <Button
                  variant="primary"
                  onClick={() => {
                    const st = curSignal.prevLine ? curSignal.prevLine.start : curSignal.targetLine.start;
                    playSegmentLine(
                      `sig-ctx:${curSignal.q.id}`,
                      st,
                      curSignal.targetLine.end,
                    );
                  }}
                >
                  {clip.playing && activeKey === `sig-ctx:${curSignal.q.id}` ? (
                    <>
                      <Pause className="size-4" weight="fill" /> 暂停
                    </>
                  ) : (
                    <>
                      <Play className="size-4" weight="fill" /> 听考点句（带上一句语境）
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    playSegmentLine(
                      `sig-only:${curSignal.q.id}`,
                      curSignal.targetLine.start,
                      curSignal.targetLine.end,
                    )
                  }
                >
                  {clip.playing && activeKey === `sig-only:${curSignal.q.id}` ? (
                    <>
                      <Pause className="size-4" weight="fill" /> 暂停
                    </>
                  ) : (
                    "仅听答案句"
                  )}
                </Button>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeSigPos === 0}
                    onClick={() => setSignalPos((p) => Math.max(0, p - 1))}
                  >
                    上一题
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={safeSigPos >= checkSignalList.length - 1}
                    onClick={() => setSignalPos((p) => Math.min(checkSignalList.length - 1, p + 1))}
                  >
                    下一题
                  </Button>
                </div>
              </div>

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
