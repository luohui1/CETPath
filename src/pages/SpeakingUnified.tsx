import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import {
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
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { WordText, WordTextProvider, type WordClick } from "@/components/WordText";
import { WordCard } from "@/exam/WordCard";
import { SpeakingPage } from "@/ielts/pages/SpeakingPage";
import { streamChat, useAgentState, type ChatMsg } from "@/lib/agent";
import { bumpDay } from "@/lib/db";
import { isIeltsExam, type ExamId } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { speak } from "@/lib/speech";
import { getTargetMeta, resolveTargetExam } from "@/lib/targetExam";
import { cn } from "@/lib/utils";
import { BUILTIN_SPEAKING_ITEMS, type SpeakingItem } from "@/studio/speakingBank";
import {
  deleteRecording,
  listRecordings,
  makeRecordingId,
  patchSpeakingStat,
  saveRecording,
  useStudioProgress,
  type StudioRecordingRow,
} from "@/studio/storage";
import { useRecorder } from "@/studio/useRecorder";

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function SpeakingUnifiedPage() {
  const settings = useSettings();
  const targetExam = resolveTargetExam(settings);
  if (isIeltsExam(targetExam)) {
    return <SpeakingPage />;
  }
  return <TargetSpeakingView targetExam={targetExam} />;
}

/** 非雅思目标（四级 CET-SET4 / 六级 CET-SET6 / 考研复试）专属两步口语训练台 */
function TargetSpeakingView({ targetExam }: { targetExam: ExamId }) {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const progress = useStudioProgress();
  const meta = getTargetMeta(targetExam);

  const [favOnly, setFavOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<WordClick | null>(null);
  const onWord = useCallback((h: WordClick) => {
    if (getSelection()?.isCollapsed === false) return;
    setHit(h);
  }, []);

  const items = useMemo(
    () => BUILTIN_SPEAKING_ITEMS.filter((it) => it.category === targetExam),
    [targetExam],
  );

  const decodedId = topicId ? decodeURIComponent(topicId) : null;
  const activeIdx = decodedId ? items.findIndex((x) => x.id === decodedId) : -1;
  const activeItem = activeIdx >= 0 ? items[activeIdx] : null;
  const prevTargetRef = useRef(targetExam);

  useEffect(() => {
    if (prevTargetRef.current !== targetExam) {
      prevTargetRef.current = targetExam;
      setHit(null);
      if (topicId) navigate("/speaking", { replace: true });
      return;
    }
    if (topicId && !activeItem) {
      navigate("/speaking", { replace: true });
    }
  }, [targetExam, topicId, activeItem, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (favOnly && !progress.speaking[it.id]?.fav) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.promptEn.toLowerCase().includes(q) ||
        it.promptZh.toLowerCase().includes(q)
      );
    });
  }, [items, favOnly, query, progress.speaking]);

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

  return (
    <WordTextProvider onWord={onWord} marks>
      {activeItem ? (
        <TargetSpeakingPractice
          item={activeItem}
          idx={activeIdx}
          total={items.length}
          targetName={meta.name}
          stat={progress.speaking[activeItem.id]}
          onBack={() => navigate("/speaking")}
          onGo={(nextIdx) => navigate(`/speaking/topic/${encodeURIComponent(items[nextIdx].id)}`)}
        />
      ) : (
        <div>
          <PageHeader
            title={`${meta.short}口语训练`}
            desc={`当前目标：${meta.name} · 覆盖必考问答、短文朗读与主题陈述，录完可请 AI 考官点评并升级高分表达。`}
          />

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setFavOnly((v) => !v)}
              className={cn("pill", favOnly && "pill-on")}
            >
              只看收藏
            </button>
            <div className="ml-auto flex h-10 w-full items-center gap-2 rounded-[9px] border border-[var(--line)] bg-white px-3 sm:w-64">
              <MagnifyingGlass className="size-4 text-[var(--ink-500)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索口语话题或英文…"
                className="w-full bg-transparent text-[14px] outline-none"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title={favOnly ? "还没有收藏的话题" : "没有找到匹配话题"} desc="换个关键词试试。" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((it) => {
                const st = progress.speaking[it.id];
                return (
                  <Card
                    key={it.id}
                    onClick={() => navigate(`/speaking/topic/${encodeURIComponent(it.id)}`)}
                    className="card-press flex cursor-pointer items-center gap-3 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="tag-paper">{it.partLabel}</span>
                        <span className="num text-[12px] text-[var(--ink-400)]">
                          准备 {it.prepSec}s · 作答 {it.talkSec}s
                        </span>
                      </div>
                      <h3 className="mt-2 truncate text-[16px] font-semibold text-[var(--ink)]">{it.title}</h3>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--ink-500)]">{it.promptZh}</p>
                    </div>

                    <div className="flex flex-none items-center gap-2">
                      {st?.fav && <Star className="size-4 text-[#e09100]" weight="fill" />}
                      {st?.done && (
                        <Badge tone="success">
                          已练 <span className="num">{st.count}</span> 次
                        </Badge>
                      )}
                      <CaretRight className="size-4 text-[var(--ink-400)]" />
                    </div>
                  </Card>
                );
              })}
            </div>
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
            source={{ paperId: `speaking-${targetExam}`, paperTitle: `${meta.short}口语训练` }}
            trans={() => ({ text: null, ready: true })}
            onLookedUp={() => void bumpDay({ lookups: 1 })}
            onClose={() => setHit(null)}
          />,
          document.body,
        )}
    </WordTextProvider>
  );
}

function TargetSpeakingPractice({
  item,
  idx,
  total,
  targetName,
  stat,
  onBack,
  onGo,
}: {
  item: SpeakingItem;
  idx: number;
  total: number;
  targetName: string;
  stat?: { done: boolean; count: number; fav?: boolean; draft?: string; feedback?: string };
  onBack: () => void;
  onGo: (nextIdx: number) => void;
}) {
  const rec = useRecorder();
  const agentSt = useAgentState();

  const [timerOn, setTimerOn] = useState(true);
  const [stage, setStage] = useState<"idle" | "prep" | "talk">("idle");
  const [prepLeft, setPrepLeft] = useState(item.prepSec);
  const [showSample, setShowSample] = useState(false);

  const [recs, setRecs] = useState<StudioRecordingRow[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());

  const [draft, setDraft] = useState(stat?.draft ?? "");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>(
    stat?.feedback ? [{ role: "assistant", content: stat.feedback }] : [],
  );
  const [followInput, setFollowInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setAiBusy(false);
    setAiErr(null);
    setStage("idle");
    setPrepLeft(item.prepSec);
    setShowSample(false);
    playerRef.current?.pause();
    setPlayingId(null);
    setDraft(stat?.draft ?? "");
    setChatMsgs(stat?.feedback ? [{ role: "assistant", content: stat.feedback }] : []);
    setFollowInput("");

    let live = true;
    void listRecordings(`speaking:${item.id}`).then((rows) => {
      if (live) setRecs(rows);
    });
    return () => {
      live = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    return () => {
      playerRef.current?.pause();
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current.clear();
    };
  }, []);

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

  const urlFor = (r: StudioRecordingRow) => {
    let u = urlsRef.current.get(r.id);
    if (!u) {
      u = URL.createObjectURL(r.blob);
      urlsRef.current.set(r.id, u);
    }
    return u;
  };

  const togglePlayRec = (r: StudioRecordingRow) => {
    let a = playerRef.current;
    if (!a) {
      a = new Audio();
      a.addEventListener("ended", () => setPlayingId(null));
      a.addEventListener("error", () => setPlayingId(null));
      playerRef.current = a;
    }
    if (playingId === r.id) {
      a.pause();
      setPlayingId(null);
      return;
    }
    a.pause();
    a.src = urlFor(r);
    setPlayingId(r.id);
    a.play().catch(() => setPlayingId(null));
  };

  const toggleRec = async () => {
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
          targetKey: `speaking:${item.id}`,
          blob: clip.blob,
          mime: clip.mime,
          seconds: clip.seconds,
          transcript: clip.transcript,
          createdAt: Date.now(),
        };
        const updated = await saveRecording(row);
        setRecs(updated);
        patchSpeakingStat(item.id, {
          done: true,
          count: (stat?.count ?? 0) + 1,
          draft: nextDraft,
        });
        void bumpDay({ questions: 1, correct: 1 });
      }
      return;
    }
    playerRef.current?.pause();
    setPlayingId(null);
    setStage("talk");
    await rec.start({ maxSec: timerOn ? item.talkSec : 300 });
  };

  const askExaminer = async (userReply?: string) => {
    if (aiBusy) return;
    const answerText = (userReply ?? draft).trim();
    if (!answerText) {
      setAiErr("请先录音转写或在下方英文稿文本框写下作答要点，再请 AI 考官批改。");
      return;
    }
    setAiErr(null);
    const promptMsg: ChatMsg = userReply
      ? { role: "user", content: userReply }
      : {
          role: "user",
          content: `请以「${targetName}（${item.partLabel}）」考官身份严格点评我的英文作答，按以下 4 点输出（中文讲解，英文保留原文）：
1. 预估分档与整体表现（流利度 / 切题度 / 词汇语法）
2. 最关键的 2–3 处语法或搭配纠错
3. 高分地道改写版（保留原意，升级考场自然表达）
4. 给 1 个考官追问问题（英文），方便我继续练习。

【题目】${item.promptEn}
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
          paper: `${targetName} · ${item.title}`,
          sentence: item.promptEn,
          question: `${item.partLabel}：${item.title}`,
        },
        (partial) => setChatMsgs([...nextHistory, { role: "assistant", content: partial }]),
        ctrl.signal,
      );
      if (!userReply && res?.text) {
        patchSpeakingStat(item.id, { feedback: res.text, draft: answerText });
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setAiErr((e as Error)?.message || "AI 考官响应失败，请稍后重试。");
      }
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={rec.recording}
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          <CaretLeft className="size-4" /> 返回话题列表
        </button>

        <div className="flex items-center gap-2">
          <span className="num text-[13px] text-[var(--ink-500)]">
            {idx + 1} / {total}
          </span>
          <button
            type="button"
            onClick={() => patchSpeakingStat(item.id, { fav: !stat?.fav })}
            className={cn(
              "grid size-9 place-items-center rounded-[8px]",
              stat?.fav ? "text-[#e09100]" : "text-[var(--ink-300)] hover:text-[var(--ink-700)]",
            )}
            aria-label={stat?.fav ? "取消收藏" : "收藏"}
          >
            <Star className="size-5" weight={stat?.fav ? "fill" : "regular"} />
          </button>
        </div>
      </div>

      {/* 主卡片：题目、准备计时、录音 */}
      <Card className="card-raised space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag-paper">{item.partLabel}</span>
            <Badge tone="neutral">
              准备 {item.prepSec}s · 作答 {item.talkSec}s
            </Badge>
          </div>
          <Button size="sm" variant="ghost" onClick={() => speak(item.promptEn)}>
            <SpeakerHigh className="size-4" /> 朗读题目
          </Button>
        </div>

        <h1 className="text-[20px] font-semibold text-[var(--ink)]">{item.title}</h1>

        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--paper-50)] p-4">
          <p className="serif whitespace-pre-line text-[18px] leading-[1.7] text-[var(--ink)]">
            <WordText text={item.promptEn} />
          </p>
          <p className="mt-2 border-t border-[var(--line-soft)] pt-2 text-[14px] text-[var(--ink-700)]">
            {item.promptZh}
          </p>
        </div>

        {rec.error && (
          <div className="rounded-[10px] border border-[var(--mark-ink)]/25 bg-[var(--mark-tint)] px-3.5 py-2 text-[13px] text-[var(--mark-ink)]">
            {rec.error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {stage === "idle" && timerOn && (
            <Button
              variant="secondary"
              onClick={() => {
                setPrepLeft(item.prepSec);
                setStage("prep");
              }}
            >
              <Timer className="size-4" /> 开始 {item.prepSec}s 准备倒计时
            </Button>
          )}

          {stage === "prep" && (
            <div className="flex items-center gap-3 rounded-[9px] bg-[var(--blue-tint)]/60 px-3.5 py-1.5">
              <span className="text-[13px] font-medium text-[var(--ink-700)]">准备中</span>
              <span className="num text-[18px] font-semibold text-[var(--blue)]">{fmtClock(prepLeft)}</span>
            </div>
          )}

          <Button
            variant={rec.recording ? "danger" : "primary"}
            onClick={() => void toggleRec()}
            disabled={!rec.recording && (!rec.supported || !rec.secureOk)}
          >
            {rec.recording ? (
              <>
                <Stop className="size-4" weight="fill" /> 停止录音 ({fmtClock(rec.seconds)})
              </>
            ) : (
              <>
                <Microphone className="size-4" weight="fill" /> {recs.length ? "再录一次" : "开始录音回答"}
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={() => setTimerOn((v) => !v)}
            className={cn("pill ml-auto", timerOn && "pill-on")}
          >
            {timerOn ? "限时倒计时：开" : "自由时长"}
          </button>
        </div>

        {recs.length > 0 && (
          <div className="divide-y divide-[var(--line-soft)] border-t border-[var(--line-soft)] pt-2">
            {recs.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-[14px] font-medium">第 {i + 1} 次录音</span>
                  <span className="num ml-2 text-[12px] text-[var(--ink-500)]">{fmtClock(r.seconds)}</span>
                </div>
                <Button size="sm" onClick={() => togglePlayRec(r)}>
                  {playingId === r.id ? <Pause className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
                  {playingId === r.id ? "暂停" : "回放"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (playingId === r.id) {
                      playerRef.current?.pause();
                      setPlayingId(null);
                    }
                    void deleteRecording(r.id).then(() =>
                      setRecs((prev) => prev.filter((x) => x.id !== r.id)),
                    );
                  }}
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 参考范文与高分短语 */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold">参考范文与核心表达</h3>
          <Button size="sm" variant="ghost" onClick={() => setShowSample((v) => !v)}>
            {showSample ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
            {showSample ? "收起" : "查看范文"}
          </Button>
        </div>
        {showSample && (
          <div className="mt-3 space-y-3 border-t border-[var(--line-soft)] pt-3">
            {item.keyPhrases.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {item.keyPhrases.map((kp) => (
                  <span
                    key={kp.en}
                    className="rounded-full bg-[var(--paper-50)] px-3 py-1 text-[12.5px] shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    <b className="serif text-[var(--blue)]">{kp.en}</b>
                    <span className="ml-1.5 text-[var(--ink-500)]">{kp.zh}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <p className="serif flex-1 text-[16px] leading-[1.7] text-[var(--ink)]">
                <WordText text={item.sampleEn} />
              </p>
              <Button size="sm" variant="ghost" onClick={() => speak(item.sampleEn)}>
                <SpeakerHigh className="size-4" /> 朗读
              </Button>
            </div>
            <p className="text-[13.5px] leading-[1.6] text-[var(--ink-700)]">{item.sampleZh}</p>
            {item.followUps && item.followUps.length > 0 && (
              <div className="rounded-[9px] bg-[var(--paper-50)] px-3.5 py-2.5 text-[13px] text-[var(--ink-700)]">
                <div className="font-semibold text-[var(--ink)]">常见考官追问：</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {item.followUps.map((f, i) => (
                    <li key={i} className="serif">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* AI 考官点评 */}
      {agentSt !== "off" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[16px] font-semibold">
              <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
              AI 考官点评与高分改写
            </h3>
            {agentSt === "on" && (
              <Button size="sm" variant="primary" loading={aiBusy} onClick={() => void askExaminer()}>
                请 AI 考官点评
              </Button>
            )}
          </div>
          {agentSt === "locked" ? (
            <div className="mt-3">
              <AgentActivate />
            </div>
          ) : agentSt === "on" ? (
            <div className="mt-3 space-y-3">
              <textarea
                rows={3}
                value={rec.recording ? rec.liveTranscript : draft}
                disabled={rec.recording}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => patchSpeakingStat(item.id, { draft })}
                placeholder="录音时将自动填入语音识别文本，也可在此写下你的英文思路要点…"
                className="w-full rounded-[9px] border border-[var(--line)] bg-[var(--paper-50)] px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[var(--blue)]"
              />
              {aiErr && <p className="text-[13px] text-[var(--red)]">{aiErr}</p>}
              {chatMsgs.length > 0 && (
                <div className="space-y-3 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper-50)] p-4 text-[14px]">
                  {chatMsgs.map((m, i) =>
                    i === 0 && m.role === "user" ? null : (
                      <div
                        key={i}
                        className={cn(
                          "rounded-[9px] px-3 py-2",
                          m.role === "user" ? "ml-auto max-w-[88%] bg-[var(--blue)] text-white" : "bg-white text-[var(--ink)] shadow-xs",
                        )}
                      >
                        {m.role === "assistant" ? <Markdown text={m.content || "考官正在打分并撰写改写建议…"} /> : m.content}
                      </div>
                    ),
                  )}
                  {!aiBusy && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={followInput}
                        onChange={(e) => setFollowInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && followInput.trim()) void askExaminer(followInput);
                        }}
                        placeholder="用英文接着回答考官的追问…"
                        className="h-9 flex-1 rounded-[8px] border border-[var(--line)] bg-white px-3 text-[13px] outline-none focus:border-[var(--blue)]"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!followInput.trim()}
                        onClick={() => void askExaminer(followInput)}
                      >
                        <PaperPlaneTilt className="size-3.5" weight="fill" /> 发送
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </Card>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button disabled={rec.recording || idx <= 0} onClick={() => onGo(idx - 1)}>
          <CaretLeft className="size-4" /> 上一题
        </Button>
        {idx >= total - 1 ? (
          <Button variant="primary" disabled={rec.recording} onClick={onBack}>
            完成本考种列表
          </Button>
        ) : (
          <Button variant="primary" disabled={rec.recording} onClick={() => onGo(idx + 1)}>
            下一题 <CaretRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
