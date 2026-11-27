import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  Microphone,
  Pause,
  Play,
  SpeakerHigh,
  Stop,
  Trash,
  Users,
  Waveform,
} from "@phosphor-icons/react";
import { Badge, Button, Card, EmptyState, ProgressBar, Spinner } from "@/components/ui";
import { WordText } from "@/components/WordText";
import { bumpDay } from "@/lib/db";
import { cn, formatDuration } from "@/lib/utils";
import { diffSpokenWords } from "./cloze";
import type { StudioPack, StudioSegment } from "./materials";
import { SpeakerTag } from "./MaterialBar";
import { SentenceAudioBar } from "./SentenceAudioBar";
import {
  deleteRecording,
  listRecordings,
  listRecordingsByPrefix,
  makeRecordingId,
  patchShadowingStat,
  saveRecording,
  type StudioProgress,
  type StudioRecordingRow,
} from "./storage";
import type { useClipAudio } from "./useClipAudio";
import { useRecorder } from "./useRecorder";

type ShadowSubMode = "sentence" | "roleplay";
const SHADOW_AUTOPLAY_KEY = "yz-studio-shadow-autoplay";

function readShadowAutoPlay(): boolean {
  try {
    const v = localStorage.getItem(SHADOW_AUTOPLAY_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

function LevelBars({ level, active }: { level: number; active: boolean }) {
  const weights = [0.45, 0.7, 0.95, 1, 0.85, 0.65, 0.9, 1, 0.75, 0.55, 0.8, 0.6];
  return (
    <div className="flex h-6 items-center gap-1" aria-hidden>
      {weights.map((w, i) => {
        const h = active ? Math.max(20, Math.min(100, Math.round((0.2 + level * w) * 100))) : 20;
        return (
          <span
            key={i}
            className={cn(
              "w-1 rounded-full transition-[height,background-color] duration-75",
              active ? "bg-[var(--red)]" : "bg-[var(--line-control)]",
            )}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

export function ShadowingTab({
  pack,
  seg,
  clip,
  progress,
  onSelectSeg,
}: {
  pack: StudioPack;
  seg: StudioSegment;
  clip: ReturnType<typeof useClipAudio>;
  progress: StudioProgress;
  onSelectSeg: (segId: string) => void;
}) {
  const rec = useRecorder();
  const [subMode, setSubMode] = useState<ShadowSubMode>("sentence");
  const [linePos, setLinePos] = useState(0);
  const [showZh, setShowZh] = useState(true);
  const [autoPlay, setAutoPlay] = useState<boolean>(readShadowAutoPlay);
  const [localPlayKey, setLocalPlayKey] = useState<string | null>(null);
  const [takes, setTakes] = useState<StudioRecordingRow[]>([]);
  const [manualText, setManualText] = useState("");
  const [comparing, setComparing] = useState(false);

  // 角色扮演状态
  const [myRole, setMyRole] = useState<"M" | "W">("M");
  const [roleRunningIdx, setRoleRunningIdx] = useState<number | null>(null);
  const [rolePlayingAll, setRolePlayingAll] = useState(false);
  const [roleTakes, setRoleTakes] = useState<Record<number, StudioRecordingRow>>({});

  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const seqCancelRef = useRef<{ cancelled: boolean } | null>(null);
  const waitResolversRef = useRef<Set<() => void>>(new Set());
  const userInteractedRef = useRef(false);
  const firstMountRef = useRef(false);
  const sideListRef = useRef<HTMLDivElement | null>(null);

  const lines = seg.lines;
  const safePos = Math.min(linePos, Math.max(0, lines.length - 1));
  const curLine = lines[safePos];
  const prevLine = safePos > 0 ? lines[safePos - 1] : undefined;
  const paperId = pack.paper.id;
  const segKey = `${paperId}:${seg.id}`;
  const targetKey = curLine ? `shadow:${segKey}:${curLine.index}` : "";

  const urlOf = useCallback((row: StudioRecordingRow) => {
    let u = blobUrlsRef.current.get(row.id);
    if (!u) {
      u = URL.createObjectURL(row.blob);
      blobUrlsRef.current.set(row.id, u);
    }
    return u;
  }, []);

  const stopAllSeq = useCallback(() => {
    if (seqCancelRef.current) seqCancelRef.current.cancelled = true;
    seqCancelRef.current = null;
    for (const r of waitResolversRef.current) r();
    waitResolversRef.current.clear();
    clip.pause();
    localAudioRef.current?.pause();
    setLocalPlayKey(null);
    setComparing(false);
    setRoleRunningIdx(null);
    setRolePlayingAll(false);
  }, [clip]);

  useEffect(() => {
    return () => {
      if (seqCancelRef.current) seqCancelRef.current.cancelled = true;
      for (const r of waitResolversRef.current) r();
      waitResolversRef.current.clear();
      localAudioRef.current?.pause();
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrlsRef.current.clear();
    };
  }, []);

  // 切换段落时加载该段已有的录音记录（角色扮演合演复用）
  useEffect(() => {
    if (firstMountRef.current) {
      userInteractedRef.current = true;
    } else {
      firstMountRef.current = true;
    }
    stopAllSeq();
    setLinePos(0);
    setManualText("");
    let live = true;
    void listRecordingsByPrefix(`shadow:${segKey}:`).then((rows) => {
      if (!live) return;
      const latestMap: Record<number, StudioRecordingRow> = {};
      for (const r of rows) {
        const idx = Number(r.targetKey.split(":").pop());
        if (!Number.isNaN(idx)) latestMap[idx] = r;
      }
      setRoleTakes(latestMap);
    });
    return () => {
      live = false;
    };
  }, [segKey, stopAllSeq]);

  // 加载当前句历史录音
  useEffect(() => {
    if (!targetKey) {
      setTakes([]);
      return;
    }
    let live = true;
    void listRecordings(targetKey).then((rows) => {
      if (!live) return;
      setTakes(rows);
      setManualText(rows.at(-1)?.transcript ?? "");
    });
    return () => {
      live = false;
    };
  }, [targetKey]);

  // 切句自动播原音（跟读模式且已交互）
  useEffect(() => {
    if (subMode !== "sentence" || !curLine || !autoPlay || !userInteractedRef.current) return;
    if (comparing || rec.recording) return;
    void clip.playRange(curLine.playStart, curLine.playEnd, {
      key: `shadow-orig:${segKey}:${curLine.index}`,
      silentAutoplayBlock: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey, curLine?.index, subMode, autoPlay]);

  // 右侧句子单自动滚动跟随当前句
  useEffect(() => {
    const box = sideListRef.current;
    if (!box || !curLine) return;
    const row = box.querySelector<HTMLElement>(`[data-shadow-line="${curLine.index}"]`);
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: bottom - box.clientHeight + 8, behavior: "smooth" });
    }
  }, [curLine]);

  const toggleAutoPlay = () => {
    userInteractedRef.current = true;
    setAutoPlay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHADOW_AUTOPLAY_KEY, next ? "1" : "0");
      } catch {
        // 忽略存储异常
      }
      return next;
    });
  };

  const goLine = (nextPos: number) => {
    userInteractedRef.current = true;
    stopAllSeq();
    setLinePos(Math.max(0, Math.min(lines.length - 1, nextPos)));
  };

  const playRangeAndWait = useCallback(
    (start: number, end: number, key: string): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          waitResolversRef.current.delete(onCancel);
          resolve(ok);
        };
        const onCancel = () => finish(false);
        waitResolversRef.current.add(onCancel);

        void clip
          .playRange(start, end, {
            key,
            onEnded: () => finish(true),
          })
          .then((started) => {
            if (!started) finish(false);
          });
      }),
    [clip],
  );

  const playBlobUrl = useCallback((url: string, key: string): Promise<void> => {
    return new Promise((resolve) => {
      let a = localAudioRef.current;
      if (!a) {
        a = new Audio();
        localAudioRef.current = a;
      }
      a.pause();
      a.src = url;
      setLocalPlayKey(key);
      const done = () => {
        a?.removeEventListener("ended", done);
        a?.removeEventListener("error", done);
        waitResolversRef.current.delete(done);
        setLocalPlayKey((cur) => (cur === key ? null : cur));
        resolve();
      };
      waitResolversRef.current.add(done);
      a.addEventListener("ended", done, { once: true });
      a.addEventListener("error", done, { once: true });
      a.play().catch(done);
    });
  }, []);

  const persistTake = useCallback(
    async (lineIndex: number, text: string, clipData: { blob: Blob; mime: string; seconds: number; transcript: string }) => {
      const k = `shadow:${segKey}:${lineIndex}`;
      const usedText = clipData.transcript || "";
      const diff = usedText ? diffSpokenWords(text, usedText) : null;
      const score = diff?.score;
      const row: StudioRecordingRow = {
        id: makeRecordingId("shd"),
        targetKey: k,
        blob: clipData.blob,
        mime: clipData.mime,
        seconds: clipData.seconds,
        transcript: usedText,
        score,
        createdAt: Date.now(),
      };
      const updated = await saveRecording(row);
      const nextRoleTakes = { ...roleTakes, [lineIndex]: row };
      setRoleTakes(nextRoleTakes);
      if (lineIndex === curLine?.index) {
        setTakes(updated);
        if (usedText) setManualText(usedText);
      }
      const doneCount = Object.keys(nextRoleTakes).length;
      patchShadowingStat(segKey, doneCount, lines.length, score);
      void bumpDay({ questions: 1, correct: !score || score >= 60 ? 1 : 0 });
      return row;
    },
    [segKey, roleTakes, curLine?.index, lines.length],
  );

  const toggleRecordSentence = async () => {
    if (!curLine) return;
    userInteractedRef.current = true;
    if (rec.recording) {
      const res = await rec.stop();
      if (res) await persistTake(curLine.index, curLine.text, res);
      return;
    }
    stopAllSeq();
    await rec.start({ maxSec: Math.max(20, Math.ceil((curLine.playEnd - curLine.playStart) * 3)) });
  };

  const latestTake = takes.at(-1);

  const runCompare = async () => {
    if (!curLine || !latestTake) return;
    userInteractedRef.current = true;
    if (comparing) {
      stopAllSeq();
      return;
    }
    stopAllSeq();
    const token = { cancelled: false };
    seqCancelRef.current = token;
    setComparing(true);

    const ok = await playRangeAndWait(
      curLine.playStart,
      curLine.playEnd,
      `shadow-orig:${segKey}:${curLine.index}`,
    );
    if (!ok || token.cancelled) {
      if (!token.cancelled) setComparing(false);
      return;
    }
    await new Promise((r) => setTimeout(r, 320));
    if (token.cancelled) return;
    await playBlobUrl(urlOf(latestTake), `mine:${latestTake.id}`);
    if (!token.cancelled) {
      setComparing(false);
      seqCancelRef.current = null;
    }
  };

  // ==================== 双人角色扮演自动推进 ====================
  const advanceRoleTurn = useCallback(
    async (startAt: number) => {
      const token = { cancelled: false };
      seqCancelRef.current = token;

      for (let idx = startAt; idx < lines.length; idx++) {
        if (token.cancelled) break;
        const ln = lines[idx];
        setRoleRunningIdx(idx);
        setLinePos(idx);

        if (ln.speaker !== myRole) {
          const ok = await playRangeAndWait(ln.playStart, ln.playEnd, `role-orig:${segKey}:${ln.index}`);
          if (!ok || token.cancelled) break;
          await new Promise((r) => setTimeout(r, 250));
        } else {
          if (rec.secureOk && rec.supported) {
            const started = await rec.start({ maxSec: 60 });
            if (!started || token.cancelled) break;
            return;
          }
          return;
        }
      }

      if (!token.cancelled) {
        setRoleRunningIdx(null);
        seqCancelRef.current = null;
      }
    },
    [lines, myRole, playRangeAndWait, segKey, rec],
  );

  const handleRoleDoneLine = async () => {
    if (roleRunningIdx === null) return;
    const cur = lines[roleRunningIdx];
    if (rec.recording) {
      const res = await rec.stop();
      if (res && cur) await persistTake(cur.index, cur.text, res);
    }
    const nextIdx = roleRunningIdx + 1;
    if (nextIdx < lines.length) {
      void advanceRoleTurn(nextIdx);
    } else {
      setRoleRunningIdx(null);
    }
  };

  const playWholeDialogue = async () => {
    userInteractedRef.current = true;
    if (rolePlayingAll) {
      stopAllSeq();
      return;
    }
    stopAllSeq();
    const token = { cancelled: false };
    seqCancelRef.current = token;
    setRolePlayingAll(true);

    for (let idx = 0; idx < lines.length; idx++) {
      if (token.cancelled) break;
      const ln = lines[idx];
      setLinePos(idx);
      const userClip = ln.speaker === myRole ? roleTakes[ln.index] : undefined;
      if (userClip) {
        await playBlobUrl(urlOf(userClip), `mix:${ln.index}`);
      } else {
        const ok = await playRangeAndWait(ln.playStart, ln.playEnd, `mix-orig:${segKey}:${ln.index}`);
        if (!ok) break;
      }
      if (token.cancelled) break;
      await new Promise((r) => setTimeout(r, 180));
    }

    if (!token.cancelled) {
      setRolePlayingAll(false);
      seqCancelRef.current = null;
    }
  };

  const activeTextForDiff = rec.recording ? rec.liveTranscript : manualText;
  const diffResult = useMemo(
    () => (curLine && activeTextForDiff.trim() ? diffSpokenWords(curLine.text, activeTextForDiff) : null),
    [curLine, activeTextForDiff],
  );

  const dialogueSegments = useMemo(() => pack.segments.filter((s) => s.hasDialogue), [pack.segments]);
  const doneLinesTotal = Object.keys(roleTakes).length;
  const stat = progress.shadowing[segKey];

  if (!lines.length) {
    return <EmptyState title="当前片段暂无可跟读原文" desc="请从上方切换其他听力片段。" />;
  }

  return (
    <div className="space-y-3.5">
      <Card className="flex flex-wrap items-center justify-between gap-2.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              userInteractedRef.current = true;
              stopAllSeq();
              setSubMode("sentence");
            }}
            className={cn("pill", subMode === "sentence" && "pill-on")}
          >
            <Waveform className="mr-1 inline size-3.5" />
            逐句影子跟读
          </button>
          <button
            type="button"
            onClick={() => {
              userInteractedRef.current = true;
              stopAllSeq();
              setSubMode("roleplay");
            }}
            className={cn("pill", subMode === "roleplay" && "pill-on")}
          >
            <Users className="mr-1 inline size-3.5" />
            双人角色扮演
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] p-0.5">
            {[0.8, 0.9, 1].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => clip.setRate(r)}
                className={cn(
                  "num rounded-[6px] px-2 py-1 text-[12px] font-medium transition",
                  clip.rate === r ? "bg-white text-[var(--blue)] shadow-xs" : "text-[var(--ink-500)]",
                )}
              >
                {r}x
              </button>
            ))}
          </div>

          {subMode === "sentence" && (
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
              title="切换句子后自动播一次真题原音"
            >
              <SpeakerHigh className="size-3.5" />
              切句自动播
            </button>
          )}

          <Badge tone={doneLinesTotal > 0 ? "success" : "neutral"}>
            已录 <span className="num">{doneLinesTotal}</span> / {lines.length} 句
            {stat?.bestScore ? ` · 最高 ${stat.bestScore}%` : ""}
          </Badge>
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
            className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-white px-2.5 text-[12px] font-semibold text-[var(--red)] shadow-xs"
          >
            <ArrowClockwise className="size-3.5" /> 重试播放
          </button>
        </div>
      )}

      {(rec.error || (!rec.secureOk && (subMode === "sentence" || subMode === "roleplay"))) && (
        <div className="rounded-[10px] border border-[var(--mark-ink)]/25 bg-[var(--mark-tint)] px-4 py-2.5 text-[13px] text-[var(--mark-ink)]">
          {rec.error ||
            "当前页面处于非 HTTPS 环境，浏览器禁止开启麦克风；你仍可直接对比原声节奏，或部署在 HTTPS（如 cetpath.com）与 localhost 下使用录音功能。"}
        </div>
      )}

      {/* ==================== 1. 逐句影子跟读 ==================== */}
      {subMode === "sentence" && curLine && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="card-raised p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3.5">
              <div className="flex items-center gap-2">
                <SpeakerTag speaker={curLine.speaker} reliable={seg.speakerReliable} />
                <span className="text-[13px] font-medium text-[var(--ink-500)]">
                  第 <span className="num text-[var(--ink)]">{safePos + 1}</span> / {lines.length} 句
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowZh((v) => !v)}
                  className={cn("pill", showZh && "pill-on")}
                >
                  {showZh ? "隐藏译文" : "显示译文"}
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePos === 0}
                  onClick={() => goLine(safePos - 1)}
                >
                  <CaretLeft className="size-3.5" /> 上一句
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePos >= lines.length - 1}
                  onClick={() => goLine(safePos + 1)}
                >
                  下一句 <CaretRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <ProgressBar value={(safePos + 1) / Math.max(1, lines.length)} className="mt-3" label="跟读进度" />

            <SentenceAudioBar
              clip={clip}
              playKey={`shadow-orig:${segKey}:${curLine.index}`}
              start={curLine.playStart}
              end={curLine.playEnd}
              ctxStart={prevLine?.playStart}
              ctxKey={prevLine ? `shadow-ctx:${segKey}:${curLine.index}` : undefined}
              onBeforePlay={() => {
                userInteractedRef.current = true;
              }}
              className="mt-4"
            />

            {/* 原句与中文 */}
            <div className="mt-4 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] p-5">
              <p className="serif text-[20px] leading-[1.7] text-[var(--ink)]">
                <WordText text={curLine.text} />
              </p>
              {showZh && curLine.zh && (
                <p className="mt-2.5 border-t border-[var(--line-soft)] pt-2.5 text-[14px] leading-[1.6] text-[var(--ink-700)]">
                  {curLine.zh}
                </p>
              )}
            </div>

            {/* 录音与对比动作条 */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button
                variant={rec.recording ? "danger" : "primary"}
                onClick={() => void toggleRecordSentence()}
                disabled={!rec.recording && (!rec.supported || !rec.secureOk)}
              >
                {rec.recording ? (
                  <>
                    <Stop className="size-4" weight="fill" /> 停止录音 ({formatDuration(rec.seconds)})
                  </>
                ) : (
                  <>
                    <Microphone className="size-4" weight="fill" /> 跟读录音
                  </>
                )}
              </Button>

              {latestTake && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (localPlayKey === `mine:${latestTake.id}`) {
                        localAudioRef.current?.pause();
                        setLocalPlayKey(null);
                      } else {
                        void playBlobUrl(urlOf(latestTake), `mine:${latestTake.id}`);
                      }
                    }}
                  >
                    {localPlayKey === `mine:${latestTake.id}` ? (
                      <>
                        <Pause className="size-4" weight="fill" /> 暂停我的录音
                      </>
                    ) : (
                      <>
                        <Play className="size-4" weight="fill" /> 播我的录音
                      </>
                    )}
                  </Button>

                  <Button variant="secondary" onClick={() => void runCompare()}>
                    {comparing ? (
                      <>
                        <Stop className="size-4" weight="fill" /> 停止对比
                      </>
                    ) : (
                      <>
                        <Waveform className="size-4" /> 原音+我的连播对比
                      </>
                    )}
                  </Button>
                </>
              )}

              <div className="ml-auto flex items-center gap-2">
                <LevelBars level={rec.level} active={rec.recording} />
              </div>
            </div>

            {/* 语音识别词级对比 */}
            <div className="mt-4 rounded-[10px] border border-[var(--line-soft)] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--ink-700)]">
                  跟读还原度检测{rec.sttSupported ? "（自动语音识别 / 可手动编辑校对）" : "（当前浏览器无内置语音识别，可手动输入校验）"}
                </span>
                {diffResult && (
                  <Badge tone={diffResult.score >= 80 ? "success" : diffResult.score >= 50 ? "primary" : "danger"}>
                    命中 <span className="num">{diffResult.hitCount}/{diffResult.total}</span> 词 ·{" "}
                    <span className="num">{diffResult.score}%</span>
                  </Badge>
                )}
              </div>

              {diffResult && (
                <div className="serif mt-3 flex flex-wrap gap-1.5 rounded-[8px] bg-[var(--paper-50)] p-3 text-[16px]">
                  {diffResult.items.map((it, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "rounded-[5px] px-1.5 py-0.5",
                        it.hit
                          ? "bg-[var(--green-tint)] text-[var(--green-dark)]"
                          : "bg-[var(--red-tint)] text-[var(--red)] underline decoration-dashed",
                      )}
                    >
                      {it.word}
                    </span>
                  ))}
                </div>
              )}

              <input
                type="text"
                value={rec.recording ? rec.liveTranscript : manualText}
                onChange={(e) => setManualText(e.target.value)}
                disabled={rec.recording}
                placeholder={rec.sttSupported ? "录音时将自动显示识别英文，也可在此手动输入/微调对比…" : "可输入你刚才读出的英文句子检查漏词…"}
                className="mt-2.5 w-full rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--blue)]"
              />
            </div>

            {/* 本句历史录音 */}
            {takes.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-[var(--line-soft)] pt-4">
                <div className="text-[12px] font-medium text-[var(--ink-500)]">
                  本句录音记录（保留最近 {takes.length} 次）
                </div>
                <div className="flex flex-wrap gap-2">
                  {takes.map((r, i) => {
                    const isPlay = localPlayKey === `take:${r.id}`;
                    return (
                      <div
                        key={r.id}
                        className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--paper-50)] px-2.5 py-1.5 text-[12px]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isPlay) {
                              localAudioRef.current?.pause();
                              setLocalPlayKey(null);
                            } else {
                              void playBlobUrl(urlOf(r), `take:${r.id}`);
                            }
                          }}
                          className="inline-flex items-center gap-1 font-medium text-[var(--blue)] hover:underline"
                        >
                          {isPlay ? <Pause className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
                          第 {i + 1} 遍 · {r.seconds}s
                          {r.score !== undefined && <span className="num">({r.score}%)</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteRecording(r.id).then(() =>
                              setTakes((prev) => prev.filter((x) => x.id !== r.id)),
                            );
                          }}
                          className="text-[var(--ink-300)] hover:text-[var(--red)]"
                          title="删除录音"
                        >
                          <Trash className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* 右侧：本段跟读句子单 */}
          <Card className="p-3.5 lg:sticky lg:top-4">
            <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-2.5">
              <span className="text-[13px] font-semibold text-[var(--ink)]">本段跟读清单</span>
              <span className="num text-[12px] text-[var(--ink-500)]">
                {doneLinesTotal} / {lines.length}
              </span>
            </div>

            <div ref={sideListRef} className="max-h-[480px] space-y-1 overflow-y-auto pr-1">
              {lines.map((ln, idx) => {
                const take = roleTakes[ln.index];
                const isCur = idx === safePos;
                const durSec = (ln.playEnd - ln.playStart).toFixed(1);
                return (
                  <button
                    key={ln.index}
                    type="button"
                    data-shadow-line={ln.index}
                    onClick={() => goLine(idx)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left transition",
                      isCur
                        ? "bg-[var(--blue-tint)]/65 shadow-[inset_3px_0_0_var(--blue)]"
                        : "hover:bg-[var(--paper-100)]",
                    )}
                  >
                    <span
                      className={cn(
                        "bubble flex-none",
                        take && "border-[var(--green)] bg-[var(--green)]",
                        !take && isCur && "bubble-on",
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
                    <span className="serif min-w-0 flex-1 truncate text-[13px] text-[var(--ink-700)]">
                      {ln.text}
                    </span>
                    {take?.score !== undefined ? (
                      <span className="num flex-none text-[11px] font-semibold text-[var(--green-dark)]">
                        {take.score}%
                      </span>
                    ) : (
                      <span className="num flex-none text-[11px] text-[var(--ink-300)]">{durSec}s</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ==================== 2. 双人角色扮演 ==================== */}
      {subMode === "roleplay" && (
        <Card className="card-raised p-5 sm:p-6">
          {!seg.hasDialogue ? (
            <EmptyState
              icon={<Users className="size-[22px]" />}
              title={`${seg.label} 为独白短文/讲座`}
              desc="双人角色扮演需要包含两位对话者（M / W）的长对话片段。"
              action={
                dialogueSegments.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {dialogueSegments.map((ds) => (
                      <Button key={ds.id} variant="primary" onClick={() => onSelectSeg(ds.id)}>
                        切换到 {ds.shortLabel} 开始对话扮演
                      </Button>
                    ))}
                  </div>
                )
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--ink-700)]">选择你扮演的角色：</span>
                  {(["M", "W"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={roleRunningIdx !== null}
                      onClick={() => setMyRole(r)}
                      className={cn("pill", myRole === r && "pill-on")}
                    >
                      我演 {r}（{r === "M" ? "男声" : "女声"}）
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {roleRunningIdx === null ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        userInteractedRef.current = true;
                        stopAllSeq();
                        void advanceRoleTurn(0);
                      }}
                    >
                      <Play className="size-4" weight="fill" /> 开始双人合演
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (rec.recording) await rec.stop();
                        stopAllSeq();
                      }}
                    >
                      <Stop className="size-4" weight="fill" /> 结束合演
                    </Button>
                  )}

                  {lines.some((ln) => ln.speaker === myRole && !!roleTakes[ln.index]) && (
                    <Button variant="secondary" onClick={() => void playWholeDialogue()}>
                      {rolePlayingAll ? (
                        <>
                          <Stop className="size-4" weight="fill" /> 停止合演回放
                        </>
                      ) : (
                        <>
                          <Waveform className="size-4" /> 连播整场对话合演
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* 合演实时提示条 */}
              {roleRunningIdx !== null && lines[roleRunningIdx] && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--blue-line)] bg-[var(--blue-tint)]/45 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <SpeakerTag speaker={lines[roleRunningIdx].speaker} reliable={seg.speakerReliable} />
                    <span className="text-[14px] font-semibold text-[var(--ink)]">
                      {lines[roleRunningIdx].speaker === myRole
                        ? rec.recording
                          ? "轮到你了！正在录音，说完点击右侧按钮进入下一句"
                          : "轮到你了（可手动点击单句练习或继续下一句）"
                        : "正在播放对方原声，请准备接话…"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <LevelBars level={rec.level} active={rec.recording} />
                    {lines[roleRunningIdx].speaker === myRole && (
                      <Button variant="primary" size="sm" onClick={() => void handleRoleDoneLine()}>
                        <Check className="size-3.5" weight="bold" /> 说完了，下一句
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 对话剧本列表 */}
              <div className="mt-4 divide-y divide-[var(--line-soft)]">
                {lines.map((ln, idx) => {
                  const isMine = ln.speaker === myRole;
                  const take = roleTakes[ln.index];
                  const rpOrigKey = `rp-orig:${segKey}:${ln.index}`;
                  const isOrigPlaying = clip.activeKey === rpOrigKey && clip.playing;
                  const isOrigLoading = clip.activeKey === rpOrigKey && clip.loading;
                  const isCurrent = roleRunningIdx === idx || (rolePlayingAll && safePos === idx);

                  return (
                    <div
                      key={ln.index}
                      className={cn(
                        "flex flex-col gap-2 py-3.5 transition-colors sm:flex-row sm:items-start sm:gap-3",
                        isCurrent && "rounded-[10px] bg-[var(--blue-tint)]/40 px-3",
                      )}
                    >
                      <div className="flex flex-none items-center gap-2 pt-0.5">
                        <SpeakerTag speaker={ln.speaker} reliable={seg.speakerReliable} />
                        <span
                          className={cn(
                            "rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium",
                            isMine
                              ? "bg-[var(--ink)] text-white"
                              : "bg-[var(--paper-100)] text-[var(--ink-500)]",
                          )}
                        >
                          {isMine ? "我方" : "原声"}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="serif text-[16px] leading-[1.65] text-[var(--ink)]">
                          <WordText text={ln.text} />
                        </p>
                        {showZh && ln.zh && (
                          <p className="mt-1 text-[13px] text-[var(--ink-500)]">{ln.zh}</p>
                        )}
                      </div>

                      <div className="flex flex-none items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            userInteractedRef.current = true;
                            clip.toggleRange(rpOrigKey, ln.playStart, ln.playEnd);
                          }}
                        >
                          {isOrigLoading ? (
                            <Spinner className="size-3.5" />
                          ) : isOrigPlaying ? (
                            <Pause className="size-3.5" weight="fill" />
                          ) : (
                            <Play className="size-3.5" weight="fill" />
                          )}
                          原音
                        </Button>

                        {isMine && (
                          <Button
                            variant={rec.recording && localPlayKey === `rp-rec:${ln.index}` ? "danger" : "secondary"}
                            size="sm"
                            disabled={!rec.recording && (!rec.supported || !rec.secureOk)}
                            onClick={async () => {
                              userInteractedRef.current = true;
                              if (rec.recording && localPlayKey === `rp-rec:${ln.index}`) {
                                const res = await rec.stop();
                                setLocalPlayKey(null);
                                if (res) await persistTake(ln.index, ln.text, res);
                              } else {
                                stopAllSeq();
                                setLocalPlayKey(`rp-rec:${ln.index}`);
                                await rec.start({ maxSec: 60 });
                              }
                            }}
                          >
                            <Microphone className="size-3.5" weight="fill" />
                            {rec.recording && localPlayKey === `rp-rec:${ln.index}` ? "完成" : take ? "重录" : "录音"}
                          </Button>
                        )}

                        {isMine && take && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (localPlayKey === `rp-mine:${ln.index}`) {
                                localAudioRef.current?.pause();
                                setLocalPlayKey(null);
                              } else {
                                void playBlobUrl(urlOf(take), `rp-mine:${ln.index}`);
                              }
                            }}
                          >
                            {localPlayKey === `rp-mine:${ln.index}` ? (
                              <Pause className="size-3.5" weight="fill" />
                            ) : (
                              <Play className="size-3.5" weight="fill" />
                            )}
                            我的
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
