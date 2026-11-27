import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { Headphones, Microphone, Sparkle, Waveform, X } from "@phosphor-icons/react";
import { EmptyState, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { WordTextProvider, type WordClick } from "@/components/WordText";
import { AgentPanel, type AgentThread } from "@/exam/AgentPanel";
import { WordCard } from "@/exam/WordCard";
import { useAgentEnabled } from "@/lib/agent";
import { bumpDay, dayKey, db } from "@/lib/db";
import { useCachedLiveQuery } from "@/lib/live";
import { usePaperIndex } from "@/lib/insights";
import { findTrans, sentenceKey } from "@/lib/trans";
import { DictationTab } from "@/studio/DictationTab";
import { isOwnAudioPaper, loadStudioPack, useWrongAudioTargets, type StudioPack } from "@/studio/materials";
import { MaterialBar, type MaterialSource, type PaperOption } from "@/studio/MaterialBar";
import { ShadowingTab } from "@/studio/ShadowingTab";
import { SpeakingTab } from "@/studio/SpeakingTab";
import { useStudioProgress } from "@/studio/storage";
import { useClipAudio } from "@/studio/useClipAudio";

type StudioTab = "dictation" | "shadowing" | "speaking";

export function StudioPage() {
  const [params, setParams] = useSearchParams();
  const { index, error: indexErr } = usePaperIndex();
  const wrongTargets = useWrongAudioTargets(index);
  const progress = useStudioProgress();
  const aiOn = useAgentEnabled();
  const [askThread, setAskThread] = useState<AgentThread | null>(null);

  const rawTab = params.get("tab");
  const tab: StudioTab =
    rawTab === "shadowing" || rawTab === "speaking" || rawTab === "dictation"
      ? rawTab
      : "dictation";

  const setTab = (next: StudioTab) => {
    clip.pause();
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  // 素材源与当前卷/段状态
  const [source, setSource] = useState<MaterialSource>("cet6");
  const [sourceInitialized, setSourceInitialized] = useState(false);
  const [paperId, setPaperId] = useState<string>(params.get("paper") ?? "");
  const [segId, setSegId] = useState<string>(params.get("seg") ?? "");
  const [pack, setPack] = useState<StudioPack | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [packErr, setPackErr] = useState<string | null>(null);

  // 今日实训计数（展示在右上角）
  const todayRow = useCachedLiveQuery(
    "studio-today",
    () => db.days.get(dayKey()).then((r) => r ?? null),
    [],
  );

  // 查词弹卡状态
  const [hit, setHit] = useState<WordClick | null>(null);
  const onWord = useCallback((h: WordClick) => {
    if (getSelection()?.isCollapsed === false) return;
    setHit(h);
  }, []);

  // 初次加载有错题联动默认优先推荐，否则默认最新六级
  useEffect(() => {
    if (!index || sourceInitialized) return;
    if (params.get("paper")) {
      const item = index.find((p) => p.id === params.get("paper"));
      if (item && (item.exam === "cet4" || item.exam === "cet6")) {
        setSource(item.exam);
      }
      setSourceInitialized(true);
      return;
    }
    if (wrongTargets.length > 0) {
      setSource("wrong");
    } else {
      setSource("cet6");
    }
    setSourceInitialized(true);
  }, [index, wrongTargets.length, sourceInitialized, params]);

  const ownPapers = useMemo(() => (index ?? []).filter(isOwnAudioPaper), [index]);

  const paperOptions: PaperOption[] = useMemo(() => {
    if (source === "wrong") {
      const wrongMap = new Map(wrongTargets.map((w) => [w.paperId, w]));
      return ownPapers
        .filter((p) => wrongMap.has(p.id))
        .map((p) => ({
          id: p.id,
          title: p.title,
          wrongTarget: wrongMap.get(p.id),
        }));
    }
    return ownPapers
      .filter((p) => p.exam === source)
      .map((p) => ({ id: p.id, title: p.title }));
  }, [ownPapers, source, wrongTargets]);

  useEffect(() => {
    if (source === "wrong" && wrongTargets.length === 0 && sourceInitialized) {
      setSource("cet6");
    }
  }, [source, wrongTargets.length, sourceInitialized]);

  useEffect(() => {
    if (!paperOptions.length) return;
    if (!paperOptions.some((p) => p.id === paperId)) {
      setPaperId(paperOptions[0].id);
      setSegId("");
    }
  }, [paperOptions, paperId]);

  useEffect(() => {
    if (!paperId || tab === "speaking") return;
    let live = true;
    setLoadingPack(true);
    setPackErr(null);
    void loadStudioPack(paperId).then(
      (res) => {
        if (!live) return;
        setPack(res);
        setLoadingPack(false);
        setSegId((cur) => {
          if (cur && res.segments.some((s) => s.id === cur)) return cur;
          // 错题联动优先跳到含错题的第一个片段
          if (source === "wrong") {
            const wt = wrongTargets.find((w) => w.paperId === paperId);
            const qSet = new Set(wt?.qNumbers ?? []);
            const hitSeg = res.segments.find((s) => s.questions.some((q) => qSet.has(q.number)));
            if (hitSeg) return hitSeg.id;
          }
          return res.segments[0]?.id ?? "";
        });
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
  }, [paperId, tab, source, wrongTargets]);

  const audioSrc = tab === "speaking" ? null : (pack?.paper.audio?.src ?? null);
  const clip = useClipAudio(audioSrc);

  const handleRandom = () => {
    if (!paperOptions.length) return;
    const pIdx = Math.floor(Math.random() * paperOptions.length);
    const chosenPaper = paperOptions[pIdx];
    if (chosenPaper.id === paperId && pack?.segments.length) {
      const others = pack.segments.filter((s) => s.id !== segId);
      const pick = others[Math.floor(Math.random() * others.length)] ?? pack.segments[0];
      if (pick) setSegId(pick.id);
      return;
    }
    setPaperId(chosenPaper.id);
    setSegId("");
  };

  const activeSeg = useMemo(
    () => pack?.segments.find((s) => s.id === segId) ?? pack?.segments[0] ?? null,
    [pack, segId],
  );

  const wrongQNumbers = useMemo(
    () => wrongTargets.find((w) => w.paperId === paperId)?.qNumbers ?? [],
    [wrongTargets, paperId],
  );

  // WordCard 所需上下文
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
      ready: !!pack || tab === "speaking",
    }),
    [pack, tab],
  );

  return (
    <WordTextProvider onWord={onWord} marks>
      <div>
        <audio ref={clip.audioRef} src={audioSrc ?? undefined} preload="metadata" hidden />
        <PageHeader
          title="听说实训"
          desc="脱离整卷束缚，用真题原声与全考种题库练透听写、影子跟读与口语输出。"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {todayRow?.questions ? (
                <div className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-[12px] text-[var(--ink-700)]">
                  今日已练 <span className="num font-semibold text-[var(--blue)]">{todayRow.questions}</span> 句/题
                </div>
              ) : null}
              <Segmented
                label="听说实训模式"
                value={tab}
                onChange={setTab}
                options={[
                  {
                    value: "dictation",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Headphones className="size-3.5" /> 精听工坊
                      </span>
                    ),
                  },
                  {
                    value: "shadowing",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Waveform className="size-3.5" /> 影子跟读
                      </span>
                    ),
                  },
                  {
                    value: "speaking",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Microphone className="size-3.5" /> 口语模考
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          }
        />

        {tab === "speaking" ? (
          <SpeakingTab progress={progress} />
        ) : (
          <>
            {indexErr && <EmptyState title="试卷目录加载失败" desc={indexErr} />}
            {!index && !indexErr && <LoadingBlock text="正在准备真题音频素材…" />}
            {index && ownPapers.length === 0 && (
              <EmptyState title="暂无带音频真题" desc="请先导入四六级真题音频数据包。" />
            )}

            {index && ownPapers.length > 0 && (
              <>
                <MaterialBar
                  source={source}
                  onSourceChange={(s) => {
                    clip.pause();
                    setSource(s);
                  }}
                  wrongCount={wrongTargets.length}
                  papers={paperOptions}
                  paperId={paperId}
                  onPaperChange={(id) => {
                    clip.pause();
                    setPaperId(id);
                    setSegId("");
                  }}
                  segments={pack?.segments ?? []}
                  segId={activeSeg?.id ?? ""}
                  onSegChange={(id) => {
                    clip.pause();
                    setSegId(id);
                  }}
                  onRandom={handleRandom}
                  loadingPack={loadingPack}
                  progress={progress}
                  tabMode={tab}
                  wrongQNumbers={wrongQNumbers}
                  cachePct={clip.cachePct}
                />

                {packErr && <EmptyState title="加载听力原文失败" desc={packErr} />}
                {loadingPack && !pack && <LoadingBlock text="正在加载音频时间轴与逐句译文…" />}

                {pack && activeSeg && (
                  tab === "dictation" ? (
                    <DictationTab pack={pack} seg={activeSeg} clip={clip} progress={progress} />
                  ) : (
                    <ShadowingTab
                      pack={pack}
                      seg={activeSeg}
                      clip={clip}
                      progress={progress}
                      onSelectSeg={(id) => {
                        clip.pause();
                        setSegId(id);
                      }}
                    />
                  )
                )}
              </>
            )}
          </>
        )}

        {hit &&
          createPortal(
            <WordCard
              hit={hit}
              ctx={wordCtx}
              anchor={anchor}
              bounds={bounds}
              source={
                pack
                  ? { paperId: pack.paper.id, paperTitle: pack.paper.title }
                  : { paperId: "studio-speaking", paperTitle: "听说实训 · 口语题库" }
              }
              trans={transLookup}
              onLookedUp={() => void bumpDay({ lookups: 1 })}
              onClose={() => setHit(null)}
              onAsk={
                aiOn
                  ? (word) => {
                      const paperLabel = pack ? pack.paper.title : "听说实训 · 口语题库";
                      setAskThread({
                        id: `${sentenceKey(hit.sentence)}:${word ?? ""}`,
                        ctx: {
                          paper: paperLabel,
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
