import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Check,
  Eye,
  Headphones,
  Microphone,
  Pause,
  Play,
  RepeatOnce,
  Shuffle,
  Sparkle,
  SpeakerHigh,
  Stop,
  Trash,
  WarningCircle,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { StickyTab } from "@/components/paper-ui";
import { Badge, Button, Card, EmptyState, LoadingBlock, PageHeader } from "@/components/ui";
import { WordText, WordTextProvider, type WordClick } from "@/components/WordText";
import { AgentPanel, type AgentThread } from "@/exam/AgentPanel";
import { WordCard } from "@/exam/WordCard";
import { useAgentEnabled } from "@/lib/agent";
import { bumpDay } from "@/lib/db";
import { addToVocab } from "@/lib/learning";
import { isIeltsExam } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { getTargetMeta, resolveTargetExam } from "@/lib/targetExam";
import { findTrans, sentenceKey } from "@/lib/trans";
import { cn, formatDuration } from "@/lib/utils";
import { buildClozeTokens, diffSpokenWords, isAnswerMatch } from "@/studio/cloze";
import {
  loadListeningPack,
  useListeningCatalog,
  useWrongAudioTargets,
  type ListeningCatalogItem,
  type StudioPack,
} from "@/studio/materials";
import { SentenceAudioBar, SpeakerTag } from "@/studio/SentenceAudioBar";
import {
  deleteRecording,
  listRecordings,
  listRecordingsByPrefix,
  makeRecordingId,
  patchDictationStat,
  patchShadowingStat,
  saveRecording,
  useStudioProgress,
  type StudioRecordingRow,
} from "@/studio/storage";
import { useClipAudio } from "@/studio/useClipAudio";
import { useRecorder } from "@/studio/useRecorder";

type ViewMode = "cloze" | "blind" | "text";

const RATES = [0.8, 1, 1.2];
const AUTOPLAY_KEY = "yz-listening-autoplay";

function readAutoPlay(): boolean {
  try {
    const v = localStorage.getItem(AUTOPLAY_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

function LevelBars({ level, active }: { level: number; active: boolean }) {
  const weights = [0.45, 0.75, 1, 0.85, 0.65, 0.95, 0.8, 0.55];
  return (
    <div className="flex h-5 items-center gap-1" aria-hidden>
      {weights.map((w, i) => {
        const h = active ? Math.max(22, Math.min(100, Math.round((0.22 + level * w) * 100))) : 22;
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

export function ListeningDrillPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const targetExam = resolveTargetExam(settings);
  const targetMeta = getTargetMeta(targetExam);
  const ieltsMode = isIeltsExam(targetExam);

  const paperParam = params.get("paper");
  const segParam = params.get("seg") ?? "";
  const fromWrong = params.get("from") === "wrong";
  const wantRandom = params.get("rand") === "1";

  const { catalog, loading: catalogLoading, error: catalogError, paperIndex } = useListeningCatalog(targetExam);
  const wrongTargets = useWrongAudioTargets(paperIndex, targetExam);
  const progress = useStudioProgress();
  const aiOn = useAgentEnabled();
  const [askThread, setAskThread] = useState<AgentThread | null>(null);

  const [pack, setPack] = useState<StudioPack | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [packErr, setPackErr] = useState<string | null>(null);

  // 加载选定试卷的音频时间轴与译文层
  useEffect(() => {
    if (!paperParam) {
      setPack(null);
      setPackErr(null);
      setLoadingPack(false);
      return;
    }
    let live = true;
    setLoadingPack(true);
    setPackErr(null);
    void loadListeningPack(targetExam, paperParam).then(
      (res) => {
        if (!live) return;
        setPack(res);
        setLoadingPack(false);
        const targetSeg =
          (segParam && res.segments.find((s) => s.id === segParam)) ??
          (fromWrong
            ? (() => {
                const wt = wrongTargets.find((w) => w.paperId === paperParam);
                const qSet = new Set(wt?.qNumbers ?? []);
                return res.segments.find((s) => s.questions.some((q) => qSet.has(q.number)));
              })()
            : wantRandom && res.segments.length > 0
              ? res.segments[Math.floor(Math.random() * res.segments.length)]
              : undefined) ??
          res.segments[0];
        if (targetSeg && targetSeg.id !== segParam) {
          const next = new URLSearchParams(params);
          next.set("paper", paperParam);
          next.set("seg", targetSeg.id);
          next.delete("rand");
          next.delete("from");
          setParams(next, { replace: true });
        }
      },
      (e: Error) => {
        if (!live) return;
        setPackErr(e.message);
        setLoadingPack(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperParam, targetExam]);

  const activeSeg = useMemo(
    () => (pack ? (pack.segments.find((s) => s.id === segParam) ?? pack.segments[0] ?? null) : null),
    [pack, segParam],
  );

  const audioSrc = paperParam && activeSeg?.audioSrc ? activeSeg.audioSrc : null;
  const clip = useClipAudio(audioSrc);

  // 查词弹卡状态
  const [hit, setHit] = useState<WordClick | null>(null);
  const onWord = useCallback((h: WordClick) => {
    if (getSelection()?.isCollapsed === false) return;
    setHit(h);
  }, []);

  const wordCtx = useMemo(() => {
    if (!hit) return null;
    const tokens = hit.sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
    const at = tokens.findIndex((t) => t.toLowerCase() === hit.word.toLowerCase());
    return { tokens, at: Math.max(0, at) };
  }, [hit]);

  const anchor = useCallback(() => {
    if (!hit) return null;
    const w = hit.el?.isConnected ? hit.el.getBoundingClientRect() : hit.rect;
    return { word: w, avoid: w };
  }, [hit]);

  const bounds = useCallback(() => new DOMRect(0, 0, innerWidth, innerHeight), []);

  const transLookup = useCallback(
    (s: string) => ({
      text: findTrans(pack?.trans, s),
      ready: !!pack,
    }),
    [pack],
  );

  const openSeg = (pid: string, sid?: string, extra?: Record<string, string>) => {
    clip.pause();
    const next = new URLSearchParams();
    next.set("paper", pid);
    if (sid) next.set("seg", sid);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) next.set(k, v);
    }
    setParams(next);
  };

  const backToCatalog = () => {
    clip.pause();
    setParams({});
  };

  // 查找当前备考目标下最近精练的记录
  const recentItem = useMemo(() => {
    const idSet = new Set(catalog.map((c) => c.id));
    const entries: { paperId: string; segId: string; updatedAt: number }[] = [];
    for (const [k, v] of Object.entries(progress.dictation)) {
      const idx = k.lastIndexOf(":");
      if (idx > 0) entries.push({ paperId: k.slice(0, idx), segId: k.slice(idx + 1), updatedAt: v.updatedAt });
    }
    for (const [k, v] of Object.entries(progress.shadowing)) {
      const idx = k.lastIndexOf(":");
      if (idx > 0) entries.push({ paperId: k.slice(0, idx), segId: k.slice(idx + 1), updatedAt: v.updatedAt });
    }
    const hitEntry = entries
      .filter((e) => idSet.has(e.paperId))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!hitEntry) return null;
    const cat = catalog.find((c) => c.id === hitEntry.paperId);
    return cat ? { ...hitEntry, title: cat.title } : null;
  }, [catalog, progress.dictation, progress.shadowing]);

  // 按分组聚类目录
  const groupedCatalog = useMemo(() => {
    const map = new Map<string, ListeningCatalogItem[]>();
    for (const c of catalog) {
      let arr = map.get(c.groupLabel);
      if (!arr) {
        arr = [];
        map.set(c.groupLabel, arr);
      }
      arr.push(c);
    }
    return [...map.entries()];
  }, [catalog]);

  return (
    <WordTextProvider onWord={onWord} marks>
      <div>
        <audio ref={clip.audioRef} src={audioSrc ?? undefined} preload="metadata" hidden />

        {!targetMeta.hasListening ? (
          <>
            <PageHeader title="听力精练" desc={`当前目标：${targetMeta.name}`} />
            <EmptyState
              icon={<Headphones className="size-[22px]" />}
              title={`${targetMeta.name}不设听力科目`}
              desc="当前备考目标无需听力精听训练；你可以前往「专项训练」练阅读/翻译/写作，或在左侧边栏底部切换备考目标。"
            />
          </>
        ) : !paperParam ? (
          /* ==================== 视图 1：选篇目录态 ==================== */
          <div>
            <PageHeader
              title="听力精练"
              desc={`当前目标：${targetMeta.name} · 选定真题后进入纯净单句卡片，听原声、关键词填空、跟读连播对比一屏完成。`}
              actions={
                catalog.length > 0 ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      const pick = catalog[Math.floor(Math.random() * catalog.length)];
                      if (pick) {
                        const randSeg =
                          pick.segments.length > 0
                            ? pick.segments[Math.floor(Math.random() * pick.segments.length)].id
                            : undefined;
                        openSeg(pick.id, randSeg, randSeg ? undefined : { rand: "1" });
                      }
                    }}
                  >
                    <Shuffle className="size-4" /> 随机挑一段精练
                  </Button>
                ) : undefined
              }
            />

            {catalogError && <EmptyState title="听力题库加载失败" desc={catalogError} />}
            {catalogLoading && <LoadingBlock text={`正在准备${targetMeta.name}听力素材…`} />}

            {!catalogLoading && !catalogError && catalog.length === 0 && (
              <EmptyState title="暂无可精练听力真题" desc="请先确认当前备考目标的数据包已完整加载。" />
            )}

            {!catalogLoading && catalog.length > 0 && (
              <div className="space-y-6">
                {/* 顶部快捷卡片：继续上次 / 错题原声急救 */}
                {(recentItem || wrongTargets.length > 0) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {recentItem && (
                      <Card className="card-raised flex items-center justify-between gap-4 p-5">
                        <div className="min-w-0">
                          <div className="t-label">继续上次精练</div>
                          <h2 className="mt-1 truncate text-[17px] font-semibold text-[var(--ink)]">{recentItem.title}</h2>
                          <p className="mt-0.5 text-[13px] text-[var(--ink-500)]">
                            片段 {recentItem.segId.replace(/^p(\d+)$/i, "Part $1")}
                          </p>
                        </div>
                        <Button variant="primary" onClick={() => openSeg(recentItem.paperId, recentItem.segId)}>
                          继续 <CaretRight className="size-4" />
                        </Button>
                      </Card>
                    )}

                    {wrongTargets.length > 0 && (
                      <Card className="p-5">
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--red)]">
                          <WarningCircle className="size-4" weight="fill" />
                          错题原声急救（优先攻克）
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {wrongTargets.slice(0, 4).map((w) => {
                            const cat = catalog.find((c) => c.id === w.paperId);
                            if (!cat) return null;
                            const firstPartSeg = w.partNumbers?.[0] ? `p${w.partNumbers[0]}` : undefined;
                            return (
                              <button
                                key={w.paperId}
                                type="button"
                                onClick={() =>
                                  openSeg(w.paperId, firstPartSeg, firstPartSeg ? undefined : { from: "wrong" })
                                }
                                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--danger-soft-line)] bg-[var(--red-tint)]/55 px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink)] transition hover:bg-[var(--red-tint)]"
                              >
                                <span className="max-w-[160px] truncate">{cat.title}</span>
                                <span className="num text-[11px] font-semibold text-[var(--red)]">
                                  Q{w.qNumbers.slice(0, 3).join(",")}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </Card>
                    )}
                  </div>
                )}

                {/* 按年 / 按册折叠档案架 */}
                <div className="space-y-6">
                  {groupedCatalog.map(([groupLabel, items]) => (
                    <section key={groupLabel} className="grid grid-cols-[36px_minmax(0,1fr)]">
                      <StickyTab vertical className="sticky top-6 mt-3 self-start">
                        <span className="num text-[13px] tracking-[0.02em] whitespace-nowrap">
                          {groupLabel.replace("剑桥雅思真题 ", "C").replace(/（.*?）/, "")}
                        </span>
                      </StickyTab>
                      <div className="rounded-[14px] rounded-tl-[4px] bg-[var(--paper-200)]/60 p-4 shadow-[inset_0_1px_2px_rgba(28,35,48,0.06)]">
                        <h3 className="mb-3 px-1 text-[14px] font-semibold text-[var(--ink-700)]">{groupLabel}</h3>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {items.map((item) => {
                            const wrongHit = wrongTargets.find((w) => w.paperId === item.id);
                            if (ieltsMode && item.segments.length > 0) {
                              return (
                                <Card key={item.id} className="flex flex-col gap-3 p-4">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <h4 className="truncate text-[15px] font-semibold text-[var(--ink)]">{item.title}</h4>
                                      {item.subLabel && (
                                        <p className="mt-0.5 text-[12.5px] text-[var(--ink-500)]">{item.subLabel}</p>
                                      )}
                                    </div>
                                    {wrongHit && (
                                      <span className="num rounded-full bg-[var(--red-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--red)]">
                                        {wrongHit.qNumbers.length} 错题
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-auto grid grid-cols-4 gap-1.5">
                                    {item.segments.map((s) => {
                                      const k = `${item.id}:${s.id}`;
                                      const done = !!progress.dictation[k] || !!progress.shadowing[k]?.doneLines;
                                      return (
                                        <button
                                          key={s.id}
                                          type="button"
                                          onClick={() => openSeg(item.id, s.id)}
                                          className={cn(
                                            "inline-flex h-8 items-center justify-center gap-1 rounded-[8px] border text-[12px] font-medium transition",
                                            done
                                              ? "border-[var(--green)]/40 bg-[var(--green-tint)] text-[var(--green-dark)]"
                                              : "border-[var(--line)] bg-[var(--paper-50)] text-[var(--ink-700)] hover:border-[var(--blue-line)] hover:bg-white hover:text-[var(--blue)]",
                                          )}
                                        >
                                          {s.label}
                                          {done && <Check className="size-3" weight="bold" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </Card>
                              );
                            }

                            const practicedCount = Object.keys(progress.dictation).filter((k) =>
                              k.startsWith(`${item.id}:`),
                            ).length;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => openSeg(item.id)}
                                className="card card-press flex items-center justify-between gap-3 p-4 text-left"
                              >
                                <div className="min-w-0 flex-1">
                                  <h4 className="truncate text-[15px] font-semibold text-[var(--ink)]">{item.title}</h4>
                                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink-500)]">
                                    {item.subLabel && <span>{item.subLabel}</span>}
                                    {practicedCount > 0 && (
                                      <span className="font-medium text-[var(--green-dark)]">已练 {practicedCount} 段</span>
                                    )}
                                    {wrongHit && (
                                      <span className="font-medium text-[var(--red)]">
                                        错题 Q{wrongHit.qNumbers.slice(0, 3).join(",")}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <CaretRight className="size-4 flex-none text-[var(--ink-400)]" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ==================== 视图 2：单句纯净训练台 ==================== */
          <div>
            {packErr && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={backToCatalog}
                  className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)]"
                >
                  <CaretLeft className="size-4" /> 返回选篇目录
                </button>
                <EmptyState title="加载听力原文失败" desc={packErr} />
              </div>
            )}
            {loadingPack && !pack && <LoadingBlock text="正在准备听力时间轴与逐句文本…" />}
            {pack && !activeSeg && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={backToCatalog}
                  className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)]"
                >
                  <CaretLeft className="size-4" /> 返回选篇目录
                </button>
                <EmptyState title="该套真题暂无可切分听力片段" desc="请返回选篇目录挑选另一套真题。" />
              </div>
            )}
            {pack && activeSeg && (
              <SingleLineWorkbench
                pack={pack}
                seg={activeSeg}
                clip={clip}
                progress={progress}
                onBack={backToCatalog}
                onChangeSeg={(sid) => openSeg(pack.paper.id, sid)}
              />
            )}
          </div>
        )}

        {hit &&
          createPortal(
            <WordCard
              hit={hit}
              ctx={wordCtx}
              anchor={anchor}
              bounds={bounds}
              source={{
                paperId: pack?.paper.id ?? "listening-drill",
                paperTitle: pack?.paper.title ?? `${targetMeta.short}听力精练`,
              }}
              trans={transLookup}
              onLookedUp={() => void bumpDay({ lookups: 1 })}
              onClose={() => setHit(null)}
              onAsk={
                aiOn
                  ? (word) => {
                      setAskThread({
                        id: `${sentenceKey(hit.sentence)}:${word ?? ""}`,
                        ctx: {
                          paper: pack?.paper.title ?? `${targetMeta.short}听力精练`,
                          sentence: hit.sentence,
                          ...(word ? { word } : {}),
                        },
                      });
                      setHit(null);
                    }
                  : undefined
              }
            />,
            document.body,
          )}

        {askThread &&
          createPortal(
            <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[1px]">
              <div
                className="flex h-full w-full max-w-[440px] flex-col border-l border-[var(--line)] bg-white shadow-[var(--elev-3)]"
                role="dialog"
                aria-label="AI 助教讲解"
              >
                <header className="flex h-12 flex-none items-center justify-between border-b border-[var(--line-soft)] px-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
                    <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
                    AI 助教精讲
                  </div>
                  <button
                    type="button"
                    onClick={() => setAskThread(null)}
                    className="grid size-8 place-items-center rounded-[8px] text-[var(--ink-500)] hover:bg-[var(--paper-100)] hover:text-[var(--ink)]"
                    aria-label="关闭助教"
                  >
                    <X className="size-4" />
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <AgentPanel thread={askThread} />
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </WordTextProvider>
  );
}

/* ==================== 视图 2 核心实现：单句纯净训练台 ==================== */
function SingleLineWorkbench({
  pack,
  seg,
  clip,
  progress,
  onBack,
  onChangeSeg,
}: {
  pack: StudioPack;
  seg: StudioPack["segments"][number];
  clip: ReturnType<typeof useClipAudio>;
  progress: ReturnType<typeof useStudioProgress>;
  onBack: () => void;
  onChangeSeg: (segId: string) => void;
}) {
  const rec = useRecorder();
  const [linePos, setLinePos] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("cloze");
  const [showZh, setShowZh] = useState(false);
  const [loop, setLoop] = useState(false);
  const [autoPlay, setAutoPlay] = useState<boolean>(readAutoPlay);

  // 听写填空状态
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [peekedBlanks, setPeekedBlanks] = useState<Record<number, boolean>>({});
  const [focusedBlank, setFocusedBlank] = useState<number | null>(null);
  const [checkedLineKey, setCheckedLineKey] = useState<string | null>(null);
  const [doneLineKeys, setDoneLineKeys] = useState<Record<string, boolean>>({});
  const [addedVocab, setAddedVocab] = useState<Record<string, boolean>>({});

  // 跟读与连播对比状态
  const [takes, setTakes] = useState<StudioRecordingRow[]>([]);
  const [shadowDoneLines, setShadowDoneLines] = useState<Record<number, StudioRecordingRow>>({});
  const [localPlayKey, setLocalPlayKey] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const sideListRef = useRef<HTMLDivElement | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const seqCancelRef = useRef<{ cancelled: boolean } | null>(null);
  const waitResolversRef = useRef<Set<() => void>>(new Set());
  const userInteractedRef = useRef(false);
  const firstMountRef = useRef(false);

  const lines = seg.lines;
  const safePos = Math.min(linePos, Math.max(0, lines.length - 1));
  const curLine = lines[safePos];
  const prevLine = safePos > 0 ? lines[safePos - 1] : undefined;
  const segKey = `${pack.paper.id}:${seg.id}`;
  const lineKey = curLine ? `${segKey}:${curLine.index}` : "";
  const shadowTargetKey = curLine ? `shadow:${segKey}:${curLine.index}` : "";

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

  // 切段初始化
  useEffect(() => {
    if (firstMountRef.current) {
      userInteractedRef.current = true;
    } else {
      firstMountRef.current = true;
    }
    stopAllSeq();
    setLinePos(0);
    setInputs({});
    setPeekedBlanks({});
    setFocusedBlank(null);
    setCheckedLineKey(null);

    let live = true;
    void listRecordingsByPrefix(`shadow:${segKey}:`).then((rows) => {
      if (!live) return;
      const latestMap: Record<number, StudioRecordingRow> = {};
      for (const r of rows) {
        const idx = Number(r.targetKey.split(":").pop());
        if (!Number.isNaN(idx)) latestMap[idx] = r;
      }
      setShadowDoneLines(latestMap);
    });
    return () => {
      live = false;
    };
  }, [segKey, stopAllSeq]);

  // 切句加载本句历史录音
  useEffect(() => {
    setInputs({});
    setPeekedBlanks({});
    setFocusedBlank(null);
    setCheckedLineKey(null);
    if (!shadowTargetKey) {
      setTakes([]);
      return;
    }
    let live = true;
    void listRecordings(shadowTargetKey).then((rows) => {
      if (live) setTakes(rows);
    });
    return () => {
      live = false;
    };
  }, [shadowTargetKey]);

  // 切句自动播一次原声
  useEffect(() => {
    if (!curLine || !autoPlay || !userInteractedRef.current) return;
    if (comparing || rec.recording) return;
    void clip.playRange(curLine.playStart, curLine.playEnd, {
      key: `drill:${lineKey}`,
      loop,
      silentAutoplayBlock: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey, curLine?.index, autoPlay]);

  useEffect(() => {
    clip.setActiveLoop(loop);
  }, [loop, clip]);

  // 右侧句子单自动滚动跟随
  useEffect(() => {
    const box = sideListRef.current;
    if (!box || !curLine) return;
    const row = box.querySelector<HTMLElement>(`[data-drill-line="${curLine.index}"]`);
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: bottom - box.clientHeight + 8, behavior: "smooth" });
    }
  }, [curLine]);

  const clozeTokens = useMemo(
    () => (curLine ? buildClozeTokens(curLine.text, lineKey, "light") : []),
    [curLine, lineKey],
  );
  const blankTokens = useMemo(() => clozeTokens.filter((t) => t.blank && t.word), [clozeTokens]);
  const isChecked = checkedLineKey === lineKey;

  // 进入填空态且切句后自动聚焦第一个空格
  useEffect(() => {
    if (viewMode !== "cloze" || !blankTokens.length) return;
    const t = window.setTimeout(() => {
      const firstIdx = blankTokens[0].index;
      inputRefs.current[firstIdx]?.focus();
      setFocusedBlank(firstIdx);
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, lineKey]);

  const goLine = useCallback(
    (nextPos: number) => {
      userInteractedRef.current = true;
      stopAllSeq();
      const clamped = Math.max(0, Math.min(lines.length - 1, nextPos));
      setLinePos(clamped);
    },
    [lines.length, stopAllSeq],
  );

  const checkClozeLine = useCallback(() => {
    userInteractedRef.current = true;
    setCheckedLineKey(lineKey);
    if (!curLine || !blankTokens.length) return;
    let rightCount = 0;
    for (const tok of blankTokens) {
      if (isAnswerMatch(inputs[tok.index] ?? "", tok.word ?? "")) rightCount++;
    }
    const acc = Math.round((rightCount / blankTokens.length) * 100);
    if (acc >= 60 || rightCount === blankTokens.length) {
      setDoneLineKeys((prev) => ({ ...prev, [lineKey]: true }));
    }
    patchDictationStat(segKey, acc, "cloze");
    void bumpDay({ questions: 1, correct: acc >= 80 ? 1 : 0 });
  }, [blankTokens, curLine, inputs, lineKey, segKey]);

  // 判分后按 Enter 直接切下一句
  useEffect(() => {
    if (viewMode !== "cloze" || !isChecked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
      e.preventDefault();
      if (safePos < lines.length - 1) goLine(safePos + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, isChecked, safePos, lines.length, goLine]);

  const toggleAutoPlay = () => {
    userInteractedRef.current = true;
    setAutoPlay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, next ? "1" : "0");
      } catch {
        // 忽略
      }
      return next;
    });
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

  const toggleRecordSentence = async () => {
    if (!curLine) return;
    userInteractedRef.current = true;
    if (rec.recording) {
      const res = await rec.stop();
      if (res) {
        const diff = res.transcript ? diffSpokenWords(curLine.text, res.transcript) : null;
        const row: StudioRecordingRow = {
          id: makeRecordingId("shd"),
          targetKey: shadowTargetKey,
          blob: res.blob,
          mime: res.mime,
          seconds: res.seconds,
          transcript: res.transcript || "",
          score: diff?.score,
          createdAt: Date.now(),
        };
        const updated = await saveRecording(row);
        setTakes(updated);
        const nextMap = { ...shadowDoneLines, [curLine.index]: row };
        setShadowDoneLines(nextMap);
        patchShadowingStat(segKey, Object.keys(nextMap).length, lines.length, diff?.score);
        void bumpDay({ questions: 1, correct: !diff?.score || diff.score >= 60 ? 1 : 0 });
      }
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

    const ok = await playRangeAndWait(curLine.playStart, curLine.playEnd, `drill:${lineKey}`);
    if (!ok || token.cancelled) {
      if (!token.cancelled) setComparing(false);
      return;
    }
    await new Promise((r) => setTimeout(r, 280));
    if (token.cancelled) return;
    await playBlobUrl(urlOf(latestTake), `mine:${latestTake.id}`);
    if (!token.cancelled) {
      setComparing(false);
      seqCancelRef.current = null;
    }
  };

  const wrongBlanks = useMemo(() => {
    if (!isChecked) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tok of blankTokens) {
      const w = tok.word ?? "";
      if (w && !isAnswerMatch(inputs[tok.index] ?? "", w) && !seen.has(w.toLowerCase())) {
        seen.add(w.toLowerCase());
        out.push(w);
      }
    }
    return out;
  }, [isChecked, blankTokens, inputs]);

  if (!lines.length || !curLine) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)]"
        >
          <CaretLeft className="size-4" /> 返回选篇目录
        </button>
        <EmptyState title="该片段暂无逐句时间轴" desc="请切换同卷其他片段试试。" />
      </div>
    );
  }

  const statDict = progress.dictation[segKey];

  return (
    <div className="space-y-4">
      {/* 极简一行顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 items-center gap-1 rounded-[9px] border border-[var(--line)] bg-white px-3 text-[13px] font-medium text-[var(--ink-700)] hover:bg-[var(--paper-50)] hover:text-[var(--ink)]"
          >
            <CaretLeft className="size-3.5" /> 返回选篇
          </button>

          <div className="min-w-0 text-[14px] font-semibold text-[var(--ink)]">
            {pack.paper.title}
          </div>

          {pack.segments.length > 1 && (
            <select
              aria-label="切换片段"
              value={seg.id}
              onChange={(e) => {
                userInteractedRef.current = true;
                stopAllSeq();
                onChangeSeg(e.target.value);
              }}
              className="h-9 rounded-[9px] border border-[var(--line)] bg-white px-2.5 text-[13px] font-medium text-[var(--ink)] outline-none focus:border-[var(--blue)]"
            >
              {pack.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortLabel}（{s.lines.length} 句）
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {clip.cachePct === 1 && (
            <span className="hidden items-center gap-1 rounded-full bg-[var(--green-tint)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--green-dark)] sm:inline-flex">
              <span className="size-1.5 rounded-full bg-[var(--green)]" />
              原声已缓存
            </span>
          )}

          <div className="flex items-center rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] p-0.5">
            {RATES.map((r) => (
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

          <button
            type="button"
            onClick={() => {
              userInteractedRef.current = true;
              setLoop((v) => !v);
            }}
            aria-pressed={loop}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium transition",
              loop
                ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--paper-50)]",
            )}
          >
            <RepeatOnce className="size-3.5" /> 循环
          </button>

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
          >
            <SpeakerHigh className="size-3.5" /> 切句自播
          </button>
        </div>
      </div>

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

      {/* 主体两栏：左主卡（听音 -> 精听 -> 跟读对比） + 右句子清单 */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_268px]">
        <Card className="card-raised p-5 sm:p-6">
          {/* 句头 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <SpeakerTag speaker={curLine.speaker} reliable={seg.speakerReliable} />
              <span className="text-[13px] font-medium text-[var(--ink-500)]">
                第 <span className="num font-semibold text-[var(--ink)]">{safePos + 1}</span> / {lines.length} 句
              </span>
              {curLine.qNumbers.length > 0 && (
                <Badge tone="primary">第 {curLine.qNumbers.join(", ")} 题答案句</Badge>
              )}
              {statDict && (
                <span className="num text-[12px] text-[var(--ink-400)]">最高正确率 {statDict.bestAcc}%</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["cloze", "关键词填空"],
                  ["blind", "盲听遮挡"],
                  ["text", "显示全文"],
                ] as const
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    userInteractedRef.current = true;
                    setViewMode(m);
                  }}
                  className={cn("pill", viewMode === m && "pill-on")}
                >
                  {lbl}
                </button>
              ))}

              {curLine.zh && (
                <button
                  type="button"
                  onClick={() => setShowZh((v) => !v)}
                  className={cn("pill", showZh && "pill-on")}
                >
                  译文
                </button>
              )}
            </div>
          </div>

          {/* 1. 听音区 */}
          <SentenceAudioBar
            clip={clip}
            playKey={`drill:${lineKey}`}
            start={curLine.playStart}
            end={curLine.playEnd}
            loop={loop}
            ctxStart={prevLine?.playStart}
            ctxKey={prevLine ? `drill-ctx:${lineKey}` : undefined}
            onBeforePlay={() => {
              userInteractedRef.current = true;
            }}
            className="mt-4"
          />

          {/* 2. 精听区（关键词填空 / 盲听遮挡 / 显示全文） */}
          <div className="mt-4 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] p-5">
            {viewMode === "cloze" && (
              <>
                <div className="serif flex flex-wrap items-baseline gap-y-2.5 text-[19px] leading-[1.9] text-[var(--ink)]">
                  {clozeTokens.map((tok) => {
                    if (!tok.blank || !tok.word) {
                      return (
                        <span key={tok.index} className="whitespace-pre-wrap">
                          {tok.text}
                        </span>
                      );
                    }
                    const expected = tok.word;
                    const val = inputs[tok.index] ?? "";
                    const peeked = !!peekedBlanks[tok.index];
                    const ok = isChecked && isAnswerMatch(val, expected);
                    const bad = isChecked && !ok;
                    const widthCh = Math.max(4, Math.min(18, expected.length + 2));
                    const isActiveBlank = focusedBlank === tok.index;

                    return (
                      <span key={tok.index} className="mx-0.5 inline-flex items-baseline gap-1">
                        {peeked ? (
                          <span className="rounded-[5px] bg-[var(--mark-tint)] px-1.5 py-0.5 font-medium text-[var(--mark-ink)]">
                            {expected}
                          </span>
                        ) : (
                          <>
                            <input
                              ref={(el) => {
                                inputRefs.current[tok.index] = el;
                              }}
                              type="text"
                              autoComplete="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              value={val}
                              onFocus={() => setFocusedBlank(tok.index)}
                              onDoubleClick={() =>
                                setPeekedBlanks((prev) => ({ ...prev, [tok.index]: true }))
                              }
                              onChange={(e) => {
                                setInputs((prev) => ({ ...prev, [tok.index]: e.target.value }));
                                if (isChecked) setCheckedLineKey(null);
                              }}
                              onKeyDown={(e) => {
                                const blankPos = blankTokens.findIndex((b) => b.index === tok.index);
                                if (e.key === " ") {
                                  e.preventDefault();
                                  const next = blankTokens[blankPos + 1];
                                  if (next) inputRefs.current[next.index]?.focus();
                                  return;
                                }
                                if (e.key === "Backspace" && !val) {
                                  e.preventDefault();
                                  const prev = blankTokens[blankPos - 1];
                                  if (prev) inputRefs.current[prev.index]?.focus();
                                  return;
                                }
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  if (!isChecked) {
                                    checkClozeLine();
                                    inputRefs.current[tok.index]?.blur();
                                  } else if (safePos < lines.length - 1) {
                                    goLine(safePos + 1);
                                  }
                                }
                              }}
                              style={{ width: `${widthCh}ch` }}
                              className={cn(
                                "h-8 border-b-2 bg-white px-1.5 text-center text-[17px] font-medium outline-none transition",
                                ok && "border-[var(--green)] bg-[var(--green-tint)] text-[var(--green-dark)]",
                                bad && "border-[var(--red)] bg-[var(--red-tint)] text-[var(--red)]",
                                !isChecked && "border-[var(--ink-300)] focus:border-[var(--blue)]",
                              )}
                              title="双击显示该词"
                            />
                            {bad && (
                              <span className="text-[14px] font-semibold text-[var(--blue)]">{expected}</span>
                            )}
                            {!isChecked && isActiveBlank && (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setPeekedBlanks((prev) => ({ ...prev, [tok.index]: true }));
                                }}
                                className="inline-flex size-6 items-center justify-center rounded-full text-[var(--ink-400)] hover:bg-[var(--paper-100)] hover:text-[var(--blue)]"
                                title="偷看这个词"
                                aria-label="偷看这个词"
                              >
                                <Eye className="size-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink-500)]">
                    {!isChecked ? (
                      <span>空格跳下一空 · 回车核对 · 双击空位偷看该词</span>
                    ) : wrongBlanks.length === 0 ? (
                      <span className="font-semibold text-[var(--green-dark)]">
                        ✓ 本句关键实词全部写对！再按回车进下一句
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[var(--ink-700)]">点选加入生词本：</span>
                        {wrongBlanks.map((w) => {
                          const saved = addedVocab[w.toLowerCase()];
                          return (
                            <button
                              key={w}
                              type="button"
                              disabled={saved}
                              onClick={() => {
                                void addToVocab(w, {
                                  paperId: pack.paper.id,
                                  paperTitle: pack.paper.title,
                                  sentence: curLine.text,
                                });
                                setAddedVocab((prev) => ({ ...prev, [w.toLowerCase()]: true }));
                              }}
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition",
                                saved
                                  ? "bg-[var(--green-tint)] text-[var(--green-dark)]"
                                  : "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--blue)] hover:text-[var(--blue)]",
                              )}
                            >
                              {saved ? `✓ ${w}` : `+ ${w}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" onClick={checkClozeLine}>
                      {isChecked ? "已核对" : "核对本句"}
                    </Button>
                  </div>
                </div>
              </>
            )}

            {viewMode === "blind" && (
              <div className="py-3 text-center">
                <p className="text-[14px] text-[var(--ink-500)]">
                  纯靠耳朵捕捉意群、转折信号与数字细节；拿不准时点击下方切回原文。
                </p>
                <div className="mx-auto mt-3 flex max-w-md flex-col items-center gap-2">
                  <span className="block h-3 w-4/5 rounded-full bg-[var(--paper-200)]" />
                  <span className="block h-3 w-3/5 rounded-full bg-[var(--paper-200)]" />
                </div>
                <Button size="sm" className="mt-4" onClick={() => setViewMode("text")}>
                  <Eye className="size-3.5" /> 揭开英文原文
                </Button>
              </div>
            )}

            {viewMode === "text" && (
              <div>
                <p className="serif text-[19px] leading-[1.75] text-[var(--ink)]">
                  <WordText text={curLine.text} />
                </p>
                <p className="mt-2 text-[12px] text-[var(--ink-400)]">点击任意英文单词可实时查词、记入生词本或问 AI 助教</p>
              </div>
            )}

            {showZh && curLine.zh && (
              <p className="mt-3 border-t border-[var(--line-soft)] pt-3 text-[14px] leading-[1.65] text-[var(--ink-700)]">
                {curLine.zh}
              </p>
            )}
          </div>

          {/* 3. 跟读与对比栏（同句打通） */}
          <div className="mt-4 rounded-[12px] border border-[var(--line-soft)] bg-white p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant={rec.recording ? "danger" : "secondary"}
                size="sm"
                onClick={() => void toggleRecordSentence()}
                disabled={!rec.recording && (!rec.supported || !rec.secureOk)}
              >
                {rec.recording ? (
                  <>
                    <Stop className="size-4" weight="fill" /> 停止录音 ({formatDuration(rec.seconds)})
                  </>
                ) : (
                  <>
                    <Microphone className="size-4" weight="fill" /> {takes.length ? "重录跟读" : "跟读录音"}
                  </>
                )}
              </Button>

              {latestTake && (
                <>
                  <Button
                    size="sm"
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
                        <Pause className="size-3.5" weight="fill" /> 暂停我的
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5" weight="fill" /> 播我的录音
                      </>
                    )}
                  </Button>

                  <Button size="sm" variant="primary" onClick={() => void runCompare()}>
                    {comparing ? (
                      <>
                        <Stop className="size-3.5" weight="fill" /> 停止连播
                      </>
                    ) : (
                      <>
                        <Waveform className="size-3.5" /> 原音+我的连播对比
                      </>
                    )}
                  </Button>
                </>
              )}

              {latestTake?.score !== undefined && (
                <Badge tone={latestTake.score >= 80 ? "success" : "primary"}>
                  还原度 <span className="num">{latestTake.score}%</span>
                </Badge>
              )}

              <div className="ml-auto flex items-center gap-2">
                <LevelBars level={rec.level} active={rec.recording} />
                <Button size="sm" variant="secondary" disabled={safePos === 0} onClick={() => goLine(safePos - 1)}>
                  <CaretLeft className="size-3.5" /> 上一句
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={safePos >= lines.length - 1}
                  onClick={() => goLine(safePos + 1)}
                >
                  下一句 <CaretRight className="size-3.5" />
                </Button>
              </div>
            </div>

            {rec.error && (
              <p className="mt-2 text-[12.5px] text-[var(--mark-ink)]">{rec.error}</p>
            )}

            {takes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] pt-2.5 text-[12px]">
                <span className="text-[var(--ink-500)]">历史录音：</span>
                {takes.slice(-3).map((r, i) => {
                  const isPlay = localPlayKey === `take:${r.id}`;
                  return (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1.5 rounded-[7px] border border-[var(--line)] bg-[var(--paper-50)] px-2 py-1"
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
                        {isPlay ? <Pause className="size-3" weight="fill" /> : <Play className="size-3" weight="fill" />}
                        第 {i + 1} 遍 · {r.seconds}s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteRecording(r.id).then(() =>
                            setTakes((prev) => prev.filter((x) => x.id !== r.id)),
                          )
                        }
                        className="text-[var(--ink-300)] hover:text-[var(--red)]"
                        title="删除"
                      >
                        <Trash className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* 右侧本段句子单 */}
        <Card className="p-3.5 lg:sticky lg:top-4">
          <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-2.5">
            <span className="text-[13px] font-semibold text-[var(--ink)]">本段句子单</span>
            <span className="num text-[12px] text-[var(--ink-500)]">{lines.length} 句</span>
          </div>

          <div ref={sideListRef} className="max-h-[480px] space-y-1 overflow-y-auto pr-1">
            {lines.map((ln, idx) => {
              const lk = `${segKey}:${ln.index}`;
              const isCur = idx === safePos;
              const isDone = !!doneLineKeys[lk];
              const isShadowDone = !!shadowDoneLines[ln.index];
              const revealed = viewMode === "text" || isDone;
              const durSec = (ln.playEnd - ln.playStart).toFixed(1);

              return (
                <button
                  key={ln.index}
                  type="button"
                  data-drill-line={ln.index}
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
                      (isDone || isShadowDone) && "border-[var(--green)] bg-[var(--green)]",
                      !(isDone || isShadowDone) && isCur && "bubble-on",
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
                  {revealed ? (
                    <span className="serif min-w-0 flex-1 truncate text-[13px] text-[var(--ink-700)]">
                      {ln.text}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-1" title="完成本句听写或切至显示全文后揭示">
                      <span
                        className="block h-2 rounded-full bg-[var(--ink-300)]/45"
                        style={{ width: `${Math.min(88, Math.max(32, Math.round(ln.text.length * 1.15)))}%` }}
                      />
                    </span>
                  )}
                  {ln.qNumbers.length > 0 && (
                    <span className="num flex-none rounded bg-[var(--mark-tint)] px-1 text-[10px] font-semibold text-[var(--mark-ink)]">
                      Q{ln.qNumbers[0]}
                    </span>
                  )}
                  <span className="num flex-none text-[11px] text-[var(--ink-300)]">{durSec}s</span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
