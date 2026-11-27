import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  Eye,
  EyeSlash,
  MagnifyingGlass,
  Microphone,
  PaperPlaneTilt,
  Pause,
  Play,
  Sparkle,
  SpeakerHigh,
  Star,
  Stop,
  Timer,
  Trash,
} from "@phosphor-icons/react";
import { AgentActivate } from "@/components/AgentActivate";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, Segmented } from "@/components/ui";
import { WordText } from "@/components/WordText";
import { streamChat, useAgentState, type ChatMsg } from "@/lib/agent";
import { bumpDay } from "@/lib/db";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";
import {
  BUILTIN_SPEAKING_ITEMS,
  loadOptionalIeltsSpeaking,
  SPEAKING_CATEGORIES,
  type SpeakingCategory,
  type SpeakingItem,
} from "./speakingBank";
import {
  deleteRecording,
  listRecordings,
  makeRecordingId,
  patchSpeakingStat,
  saveRecording,
  type StudioProgress,
  type StudioRecordingRow,
} from "./storage";
import { useRecorder } from "./useRecorder";

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function SpeakingTab({ progress }: { progress: StudioProgress }) {
  const rec = useRecorder();
  const agentSt = useAgentState();

  const [extraIelts, setExtraIelts] = useState<SpeakingItem[]>([]);
  const [category, setCategory] = useState<SpeakingCategory>("cet46");
  const [favOnly, setFavOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_SPEAKING_ITEMS[0].id);

  // 倒计时与展示状态
  const [timerOn, setTimerOn] = useState(true);
  const [stage, setStage] = useState<"idle" | "prep" | "talk">("idle");
  const [prepLeft, setPrepLeft] = useState(0);
  const [showSample, setShowSample] = useState(false);

  // 录音历史与播放
  const [recs, setRecs] = useState<StudioRecordingRow[]>([]);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());

  // 口语草稿与 AI 考官对练
  const [draft, setDraft] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [followInput, setFollowInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadOptionalIeltsSpeaking().then((items) => {
      if (items.length) setExtraIelts(items);
    });
    return () => {
      abortRef.current?.abort();
      playerRef.current?.pause();
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current.clear();
    };
  }, []);

  const allItems = useMemo(() => [...BUILTIN_SPEAKING_ITEMS, ...extraIelts], [extraIelts]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((it) => {
      if (it.category !== category) return false;
      if (favOnly && !progress.speaking[it.id]?.fav) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.promptEn.toLowerCase().includes(q) ||
        it.promptZh.toLowerCase().includes(q)
      );
    });
  }, [allItems, category, favOnly, query, progress.speaking]);

  const activeItem = useMemo(() => {
    const hit = filteredItems.find((x) => x.id === selectedId);
    return hit ?? filteredItems[0] ?? allItems.find((x) => x.category === category) ?? allItems[0];
  }, [filteredItems, selectedId, allItems, category]);

  useEffect(() => {
    if (activeItem && activeItem.id !== selectedId && filteredItems.length > 0) {
      setSelectedId(activeItem.id);
    }
  }, [activeItem, selectedId, filteredItems.length]);

  // 切换题目时重置状态并加载该题录音、草稿、上次点评
  useEffect(() => {
    if (!activeItem) return;
    abortRef.current?.abort();
    setAiBusy(false);
    setAiError(null);
    setStage("idle");
    setPrepLeft(activeItem.prepSec);
    setShowSample(false);
    playerRef.current?.pause();
    setPlayingKey(null);

    const saved = progress.speaking[activeItem.id];
    setDraft(saved?.draft ?? "");
    setChatMsgs(saved?.feedback ? [{ role: "assistant", content: saved.feedback }] : []);

    let live = true;
    void listRecordings(`speaking:${activeItem.id}`).then((rows) => {
      if (live) setRecs(rows);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id]);

  // 准备阶段倒计时结束自动提示可开始录音
  useEffect(() => {
    if (stage !== "prep") return;
    const t = window.setInterval(() => {
      setPrepLeft((p) => {
        if (p <= 1) {
          setStage("talk");
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stage]);

  const togglePlayUrl = useCallback(
    (key: string, src: string) => {
      let a = playerRef.current;
      if (!a) {
        a = new Audio();
        a.addEventListener("ended", () => setPlayingKey(null));
        a.addEventListener("error", () => setPlayingKey(null));
        playerRef.current = a;
      }
      if (playingKey === key) {
        a.pause();
        setPlayingKey(null);
        return;
      }
      a.pause();
      a.src = src;
      setPlayingKey(key);
      a.play().catch(() => setPlayingKey(null));
    },
    [playingKey],
  );

  const urlForRec = (r: StudioRecordingRow) => {
    let u = urlsRef.current.get(r.id);
    if (!u) {
      u = URL.createObjectURL(r.blob);
      urlsRef.current.set(r.id, u);
    }
    return u;
  };

  const handleToggleRec = async () => {
    if (!activeItem) return;
    if (rec.recording) {
      const clip = await rec.stop();
      setStage("idle");
      if (clip) {
        const nextDraft = clip.transcript
          ? draft.trim()
            ? `${draft.trim()}\n${clip.transcript}`
            : clip.transcript
          : draft;
        if (clip.transcript) setDraft(nextDraft);

        const row: StudioRecordingRow = {
          id: makeRecordingId("spk"),
          targetKey: `speaking:${activeItem.id}`,
          blob: clip.blob,
          mime: clip.mime,
          seconds: clip.seconds,
          transcript: clip.transcript,
          createdAt: Date.now(),
        };
        const updated = await saveRecording(row);
        setRecs(updated);
        const curStat = progress.speaking[activeItem.id];
        patchSpeakingStat(activeItem.id, {
          done: true,
          count: (curStat?.count ?? 0) + 1,
          draft: nextDraft,
        });
        void bumpDay({ questions: 1, correct: 1 });
      }
      return;
    }

    playerRef.current?.pause();
    setPlayingKey(null);
    setStage("talk");
    await rec.start({ maxSec: timerOn ? activeItem.talkSec : 300 });
  };

  const askExaminer = async (userReply?: string) => {
    if (!activeItem || aiBusy) return;
    const answerText = (userReply ?? draft).trim();
    if (!answerText) {
      setAiError("请先录音转写或在下方口语稿区域写下你的作答要点，再呼叫 AI 考官点评。");
      return;
    }

    setAiError(null);
    const examTitle = SPEAKING_CATEGORIES.find((c) => c.id === activeItem.category)?.name ?? "英语口语";
    const promptMsg: ChatMsg = userReply
      ? { role: "user", content: userReply }
      : {
          role: "user",
          content: `请以「${examTitle}（${activeItem.partLabel}）」考官身份严格点评我的英文作答，按以下 4 点输出（中文讲解，英文保留原文）：
1. 预估分档与整体表现（如流利度/切题度/词汇语法）
2. 语法或用词纠错（最多挑最关键的 3 处）
3. 高分地道改写版（保留我的原意，升级成自然考场表达）
4. 给 1 个考官追问问题（用英文提问），方便我继续练习。

【题目】${activeItem.promptEn}
【我的作答】${answerText}`,
        };

    const nextHistory = userReply ? [...chatMsgs, promptMsg] : [promptMsg];
    setChatMsgs([...nextHistory, { role: "assistant", content: "" }]);
    if (userReply) setFollowInput("");
    setAiBusy(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await streamChat(
        nextHistory,
        {
          paper: `${examTitle}口语实训 · ${activeItem.title}`,
          sentence: activeItem.promptEn,
          question: `${activeItem.partLabel}：${activeItem.title}`,
        },
        (partial) => {
          setChatMsgs([...nextHistory, { role: "assistant", content: partial }]);
        },
        ctrl.signal,
      );
      setChatMsgs([...nextHistory, { role: "assistant", content: res.text }]);
      if (!userReply) {
        patchSpeakingStat(activeItem.id, {
          done: true,
          draft: answerText,
          feedback: res.text,
        });
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setAiError(e instanceof Error ? e.message : "AI 考官响应失败，请稍后重试");
        setChatMsgs(nextHistory.slice(0, -1));
      }
    } finally {
      setAiBusy(false);
    }
  };

  const curIdx = filteredItems.findIndex((x) => x.id === activeItem?.id);
  const stat = activeItem ? progress.speaking[activeItem.id] : undefined;

  return (
    <div className="space-y-4">
      {/* 顶部考种切换、搜索与筛选 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="口语考种"
            value={category}
            onChange={(v) => {
              setCategory(v);
              setFavOnly(false);
            }}
            options={SPEAKING_CATEGORIES.map((c) => {
              const cnt = allItems.filter((x) => x.category === c.id).length;
              return { value: c.id, label: `${c.name} ${cnt}` };
            })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFavOnly((v) => !v)}
              className={cn("pill inline-flex items-center gap-1", favOnly && "pill-on")}
            >
              <Star className="size-3.5 text-[var(--mark-ink)]" weight={favOnly ? "fill" : "regular"} />
              收藏
            </button>
            <div className="relative">
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[var(--ink-300)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜话题…"
                className="h-8 w-36 rounded-full border border-[var(--line)] bg-[var(--paper-50)] pr-3 pl-8 text-[12px] outline-none focus:border-[var(--blue)] sm:w-44"
              />
            </div>
          </div>
        </div>

        {/* 话题列表快选 */}
        {filteredItems.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--line-soft)] pt-3">
            {filteredItems.map((it) => {
              const st = progress.speaking[it.id];
              const isCur = it.id === activeItem?.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelectedId(it.id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition",
                    isCur
                      ? "bg-[var(--blue)] text-white"
                      : "border border-[var(--line)] bg-white text-[var(--ink-700)] hover:border-[var(--blue-line)]",
                  )}
                >
                  {st?.fav && (
                    <Star
                      className={cn("size-3", isCur ? "text-[#ffe66d]" : "text-[var(--mark-ink)]")}
                      weight="fill"
                    />
                  )}
                  <span className="max-w-[160px] truncate">{it.title}</span>
                  {st?.done && (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        isCur ? "bg-white" : "bg-[var(--green)]",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {!activeItem ? (
        <Card className="p-10 text-center text-[14px] text-[var(--ink-500)]">
          没有找到匹配的口语题目，试试清空搜索词或取消收藏筛选。
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          {/* 左列：题卡 + 计时录音 + 草稿 */}
          <Card className="flex flex-col p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] pb-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{activeItem.partLabel}</Badge>
                {stat?.count ? (
                  <Badge tone="success">
                    已练 <span className="num">{stat.count}</span> 次
                  </Badge>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    patchSpeakingStat(activeItem.id, { fav: !stat?.fav })
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[var(--line)] bg-white px-2.5 text-[12px] text-[var(--ink-700)] hover:bg-[var(--paper-50)]"
                >
                  <Star
                    className={cn("size-3.5", stat?.fav ? "text-[var(--mark-ink)]" : "text-[var(--ink-300)]")}
                    weight={stat?.fav ? "fill" : "regular"}
                  />
                  {stat?.fav ? "已收藏" : "收藏"}
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={curIdx <= 0}
                  onClick={() => setSelectedId(filteredItems[curIdx - 1].id)}
                >
                  <CaretLeft className="size-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={curIdx < 0 || curIdx >= filteredItems.length - 1}
                  onClick={() => setSelectedId(filteredItems[curIdx + 1].id)}
                >
                  <CaretRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <h2 className="mt-4 text-[18px] font-semibold text-[var(--ink)]">{activeItem.title}</h2>

            {/* 题目展示 + 朗读 */}
            <div className="mt-3 rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] p-4">
              <div className="serif whitespace-pre-line text-[17px] leading-[1.7] text-[var(--ink)]">
                <WordText text={activeItem.promptEn} />
              </div>
              {activeItem.promptZh && (
                <p className="mt-2.5 border-t border-[var(--line-soft)] pt-2.5 text-[13px] leading-[1.6] text-[var(--ink-500)]">
                  {activeItem.promptZh}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void speak(activeItem.promptEn.replace(/\n+/g, " "))}
                >
                  <SpeakerHigh className="size-3.5" /> 朗读题目
                </Button>
                <span className="num text-[12px] text-[var(--ink-500)]">
                  考场参考：准备 {activeItem.prepSec}s · 作答 {activeItem.talkSec}s
                </span>
              </div>
            </div>

            {activeItem.followUps && activeItem.followUps.length > 0 && (
              <div className="mt-3 rounded-[10px] border border-[var(--line-soft)] bg-white px-3.5 py-2.5 text-[13px]">
                <div className="font-medium text-[var(--ink-500)]">延伸追问：</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--ink-700)]">
                  {activeItem.followUps.map((f, i) => (
                    <li key={i} className="serif">
                      <WordText text={f} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 计时与录音控制 */}
            <div className="mt-4 rounded-[12px] border border-[var(--line)] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTimerOn((v) => !v)}
                    className={cn("pill inline-flex items-center gap-1", timerOn && "pill-on")}
                  >
                    <Timer className="size-3.5" />
                    {timerOn ? "考场计时" : "自由练习"}
                  </button>

                  {timerOn && stage === "prep" && (
                    <span className="num rounded-full bg-[var(--mark-tint)] px-3 py-1 text-[13px] font-semibold text-[var(--mark-ink)]">
                      准备倒计时 {fmtClock(prepLeft)}
                    </span>
                  )}
                  {(rec.recording || stage === "talk") && (
                    <span
                      className={cn(
                        "num rounded-full px-3 py-1 text-[13px] font-semibold",
                        rec.recording
                          ? "bg-[var(--red-tint)] text-[var(--red)]"
                          : "bg-[var(--blue-tint)] text-[var(--blue)]",
                      )}
                    >
                      {rec.recording ? `录音中 ${fmtClock(rec.seconds)} / ${fmtClock(activeItem.talkSec)}` : "可开始作答"}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {timerOn && stage === "idle" && !rec.recording && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPrepLeft(activeItem.prepSec);
                        setStage("prep");
                      }}
                    >
                      先准备 {activeItem.prepSec}s
                    </Button>
                  )}
                  <Button
                    variant={rec.recording ? "danger" : "primary"}
                    onClick={() => void handleToggleRec()}
                    disabled={!rec.recording && (!rec.supported || !rec.secureOk)}
                  >
                    {rec.recording ? (
                      <>
                        <Stop className="size-4" weight="fill" /> 结束录音
                      </>
                    ) : (
                      <>
                        <Microphone className="size-4" weight="fill" /> 开始口语作答录音
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {(rec.error || !rec.secureOk) && (
                <p className="mt-2.5 text-[12px] text-[var(--mark-ink)]">
                  {rec.error || "提示：非 HTTPS 下无法开麦录音，但可以直接在下方写出/粘贴口语作答内容，并呼叫 AI 考官点评改写。"}
                </p>
              )}

              {recs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line-soft)] pt-3">
                  {recs.map((r, i) => {
                    const isPlay = playingKey === r.id;
                    return (
                      <div
                        key={r.id}
                        className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] px-2.5 py-1 text-[12px]"
                      >
                        <button
                          type="button"
                          onClick={() => togglePlayUrl(r.id, urlForRec(r))}
                          className="inline-flex items-center gap-1 font-medium text-[var(--blue)]"
                        >
                          {isPlay ? <Pause className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
                          录音 {i + 1} · {fmtClock(r.seconds)}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void deleteRecording(r.id).then(() =>
                              setRecs((prev) => prev.filter((x) => x.id !== r.id)),
                            )
                          }
                          className="text-[var(--ink-300)] hover:text-[var(--red)]"
                          title="删除"
                        >
                          <Trash className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 口语稿编辑区 */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-[var(--ink-500)]">
                <span>口语转写 / 作答草稿（自动保存，供 AI 考官批改）</span>
                {rec.recording && rec.liveTranscript && (
                  <span className="text-[var(--blue)]">正在实时识别英文…</span>
                )}
              </div>
              <textarea
                rows={4}
                value={rec.recording && rec.liveTranscript ? `${draft ? draft + "\n" : ""}${rec.liveTranscript}` : draft}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft(v);
                  patchSpeakingStat(activeItem.id, { draft: v });
                }}
                placeholder="录音时会自动填入语音转写英文；你也可以直接用英文写出或口述转写自己的回答思路…"
                className="serif w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper-50)] p-3 text-[15px] leading-[1.6] text-[var(--ink)] outline-none focus:border-[var(--blue)]"
              />
            </div>
          </Card>

          {/* 右列：亮点词伙范文 + AI 考官点评 */}
          <div className="space-y-4">
            {/* 关键词伙与高分范文 */}
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-[var(--ink)]">亮点词伙与高分参考</h3>
                <div className="flex items-center gap-2">
                  {activeItem.sampleEn && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowSample((v) => !v)}
                    >
                      {showSample ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showSample ? "收起范文" : "看高分范文"}
                    </Button>
                  )}
                </div>
              </div>

              {activeItem.keyPhrases.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeItem.keyPhrases.map((kp, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void speak(kp.en)}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--line)] bg-[var(--paper-50)] px-2.5 py-1 text-left text-[12px] hover:border-[var(--blue)]"
                      title="点击发音"
                    >
                      <SpeakerHigh className="size-3 text-[var(--blue)]" />
                      <span className="serif font-medium text-[var(--ink)]">{kp.en}</span>
                      <span className="text-[var(--ink-500)]">{kp.zh}</span>
                    </button>
                  ))}
                </div>
              )}

              {showSample && activeItem.sampleEn && (
                <div className="mt-3.5 space-y-2.5 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper-50)] p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (activeItem.audioUrl) {
                          togglePlayUrl(`sample:${activeItem.id}`, activeItem.audioUrl);
                        } else {
                          void speak(activeItem.sampleEn);
                        }
                      }}
                    >
                      <SpeakerHigh className="size-3.5" />
                      {playingKey === `sample:${activeItem.id}` ? "暂停示范音" : "朗读参考范文"}
                    </Button>
                  </div>
                  <p className="serif text-[15px] leading-[1.7] text-[var(--ink)]">
                    <WordText text={activeItem.sampleEn} />
                  </p>
                  {activeItem.sampleZh && (
                    <p className="border-t border-[var(--line-soft)] pt-2 text-[13px] leading-[1.6] text-[var(--ink-500)]">
                      {activeItem.sampleZh}
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* AI 考官点评与追问对练 */}
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
                  <h3 className="text-[15px] font-semibold text-[var(--ink)]">AI 考官批改与追问</h3>
                </div>
                {agentSt === "on" && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={aiBusy}
                    onClick={() => void askExaminer()}
                  >
                    {chatMsgs.length > 0 ? "重新批改当前作答" : "请考官点评并追问"}
                  </Button>
                )}
              </div>

              {agentSt === "locked" && (
                <div className="mt-3">
                  <AgentActivate />
                </div>
              )}

              {agentSt === "off" && (
                <div className="mt-3 rounded-[10px] bg-[var(--paper-50)] p-4 text-[13px] text-[var(--ink-500)]">
                  AI 助教尚未开启或未配置自定义模型。你可以前往
                  <Link to="/settings" className="mx-1 font-medium text-[var(--blue)] hover:underline">
                    设置页 <ArrowRight className="inline size-3" />
                  </Link>
                  配置后使用智能口语打分、纠错与追问对练。
                </div>
              )}

              {aiError && (
                <p className="mt-3 rounded-[8px] bg-[var(--red-tint)] px-3 py-2 text-[13px] text-[var(--red)]">
                  {aiError}
                </p>
              )}

              {agentSt === "on" && chatMsgs.length === 0 && !aiError && (
                <p className="mt-3 text-[13px] leading-[1.6] text-[var(--ink-500)]">
                  录完音或在左侧填写英文回答思路后，点击「请考官点评并追问」，AI 将按对应考试评分标准给出预估分数、语法用词修改与高分升级表达，并发起考官追问。
                </p>
              )}

              {chatMsgs.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-[var(--line-soft)] pt-3">
                  {chatMsgs
                    .filter((m, idx) => !(idx === 0 && m.role === "user"))
                    .map((m, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "rounded-[10px] p-3.5",
                          m.role === "user"
                            ? "ml-6 bg-[var(--blue-tint)] text-[14px] text-[var(--ink)]"
                            : "bg-[var(--paper-50)]",
                        )}
                      >
                        {m.role === "user" ? (
                          <p className="serif whitespace-pre-wrap">{m.content}</p>
                        ) : m.content ? (
                          <Markdown text={m.content} />
                        ) : (
                          <p className="text-[13px] text-[var(--ink-500)]">考官正在逐句评估并生成建议…</p>
                        )}
                      </div>
                    ))}

                  {agentSt === "on" && (
                    <form
                      className="flex gap-2 pt-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (followInput.trim() && !aiBusy) void askExaminer(followInput.trim());
                      }}
                    >
                      <input
                        type="text"
                        value={followInput}
                        onChange={(e) => setFollowInput(e.target.value)}
                        placeholder="继续回答考官追问或用英文跟练一句话…"
                        className="min-w-0 flex-1 rounded-[9px] border border-[var(--line)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--blue)]"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={aiBusy || !followInput.trim()}
                      >
                        <PaperPlaneTilt className="size-3.5" weight="fill" /> 发送
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
