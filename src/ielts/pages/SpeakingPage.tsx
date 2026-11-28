import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Microphone, PaperPlaneTilt, Play, Pause, Sparkle, Star, Trash, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { AgentActivate } from "@/components/AgentActivate";
import { Markdown } from "@/components/Markdown";
import { bumpDay, db } from "@/lib/db";
import { agentHeaders, streamChat, useAgentState, type ChatMsg } from "@/lib/agent";
import { useSettings } from "@/lib/settings";
import { WordCard } from "@/exam/WordCard";
import type { TransLookup } from "@/lib/trans";
import type { WordClick } from "@/components/WordText";
import { cn } from "@/lib/utils";
import { Button, Card, EmptyState, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { loadSpeaking } from "../data";
import { detectClickedWord, type ClickedWordHit } from "../exam/highlightDom";
import { makeRunId, patchSpeakingProgress, useIeltsSpeakingRows } from "../store";
import type { IeltsRecordingRow, SpeakingData, SpeakingQuestion, SpeakingTopic } from "../types";

const PREP_SEC = 60;
const P2_MAX_SEC = 120;
const P13_MAX_SEC = 120;

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function pickSupportedMime(): string {
  if (typeof window === "undefined" || !window.MediaRecorder) return "";
  return (
    ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) || ""
  );
}

function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝，请在浏览器地址栏的网站权限设置中允许麦克风访问后重试。";
  }
  if (name === "NotFoundError") return "没有检测到可用的麦克风设备。";
  if (name === "NotReadableError") return "麦克风正被其他应用占用，请关闭后重试。";
  return `无法启动录音：${(e as Error)?.message || "未知错误"}`;
}

export function SpeakingPage() {
  const { topicId, qIdx } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const speakingRows = useIeltsSpeakingRows();
  const [data, setData] = useState<SpeakingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters persisted across sub-navigation
  const [kind, setKind] = useState<"part1" | "part2">("part1");
  const [favOnly, setFavOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [accentPref, setAccentPref] = useState("英音");

  useEffect(() => {
    loadSpeaking().then(
      (d) => {
        for (const t of d.topics) t.questions.sort((a, b) => a.part - b.part);
        setData(d);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const progMap = useMemo(
    () => new Map((speakingRows ?? []).map((r) => [r.id, r])),
    [speakingRows],
  );

  const activeTopic = useMemo(
    () => (topicId && data ? data.topics.find((t) => t.id === decodeURIComponent(topicId)) ?? null : null),
    [topicId, data],
  );

  useEffect(() => {
    if (!data || !topicId) return;
    if (!activeTopic) {
      navigate("/speaking", { replace: true });
      return;
    }
    if (qIdx !== undefined && (!/^\d+$/.test(qIdx) || Number(qIdx) >= activeTopic.questions.length)) {
      navigate(`/speaking/topic/${encodeURIComponent(activeTopic.id)}`, { replace: true });
    }
  }, [data, topicId, qIdx, activeTopic, navigate]);

  if (error) return <EmptyState title="口语题库加载失败" desc={error} />;
  if (!data) return <LoadingBlock text="正在加载雅思口语题库…" />;

  if (activeTopic && qIdx !== undefined && /^\d+$/.test(qIdx)) {
    return (
      <SpeakingPracticeScreen
        topic={activeTopic}
        idx={Number(qIdx)}
        progMap={progMap}
        accentPref={accentPref}
        onAccentChange={setAccentPref}
        allowLookup={settings.ieltsReviewLookup}
        onNavigateIdx={(next) => navigate(`/speaking/topic/${encodeURIComponent(activeTopic.id)}/${next}`, { replace: true })}
        onBackTopic={() => navigate(`/speaking/topic/${encodeURIComponent(activeTopic.id)}`)}
      />
    );
  }

  if (activeTopic) {
    const doneCnt = activeTopic.questions.filter((q) => progMap.get(q.id)?.done).length;
    const firstUndone = activeTopic.questions.findIndex((q) => !progMap.get(q.id)?.done);
    const startIdx = firstUndone < 0 ? 0 : firstUndone;
    return (
      <div>
        <button
          type="button"
          onClick={() => navigate("/speaking")}
          className="mb-4 inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)]"
        >
          <CaretLeft className="size-4" /> 返回话题列表
        </button>
        <PageHeader
          title={activeTopic.name}
          desc={`${activeTopic.kind === "part2" ? "Part 2 题卡 + Part 3 追问" : "Part 1 日常问答"} · 共 ${activeTopic.questions.length} 题，已练 ${doneCnt} 题`}
          actions={
            <Button variant="primary" onClick={() => navigate(`/speaking/topic/${encodeURIComponent(activeTopic.id)}/${startIdx}`)}>
              {doneCnt === 0 ? "开始练习" : doneCnt === activeTopic.questions.length ? "再练一遍" : "继续练习"}
            </Button>
          }
        />
        <Card className="divide-y divide-[var(--line-soft)]">
          {activeTopic.questions.map((q, i) => {
            const p = progMap.get(q.id);
            const titleLine = q.part === 2 ? q.question.split("\n")[0] : q.question;
            return (
              <div key={q.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => navigate(`/speaking/topic/${encodeURIComponent(activeTopic.id)}/${i}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="tag-paper shrink-0">Part {q.part}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{titleLine}</span>
                  {p?.done && <span className="tag-paper shrink-0 bg-[var(--blue-tint)] text-[var(--blue)]">已练 {p.count ?? 1} 次</span>}
                </button>
                <button
                  type="button"
                  aria-label={p?.fav ? "取消收藏" : "收藏"}
                  onClick={() => void patchSpeakingProgress(q.id, (c) => (c.fav ? delete c.fav : (c.fav = true)))}
                  className={cn(
                    "grid size-9 place-items-center rounded-[8px] transition-colors",
                    p?.fav ? "text-[#e09100]" : "text-[var(--ink-300)] hover:text-[var(--ink-700)]",
                  )}
                >
                  <Star className="size-5" weight={p?.fav ? "fill" : "regular"} />
                </button>
              </div>
            );
          })}
        </Card>
      </div>
    );
  }

  // Topic list
  const qNorm = query.trim().toLowerCase();
  const filteredTopics = data.topics.filter((t) => {
    if (t.kind !== kind) return false;
    if (favOnly && !t.questions.some((x) => progMap.get(x.id)?.fav)) return false;
    if (!qNorm) return true;
    return t.name.toLowerCase().includes(qNorm) || t.questions.some((x) => x.question.toLowerCase().includes(qNorm));
  });

  return (
    <div>
      <PageHeader title="雅思口语练习" desc="先听考官提问、自己开口录音作答，再解锁示范答案与地道表达。练习进度与收藏自动跨设备同步，个人录音仅保存在本机。" />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          label="口语部分"
          value={kind}
          onChange={setKind}
          options={[
            { value: "part1", label: `Part 1 (${data.meta.counts.part1})` },
            { value: "part2", label: `Part 2 & 3 (${data.meta.counts.part2 + data.meta.counts.part3})` },
          ]}
        />
        <button
          type="button"
          onClick={() => setFavOnly((v) => !v)}
          className={cn("pill", favOnly && "pill-on")}
        >
          只看收藏
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索话题或英文题目…"
          className="ml-auto h-10 w-full rounded-[9px] bg-white px-3.5 text-[14px] shadow-[var(--elev-1)] outline-none focus:shadow-[0_0_0_2px_var(--blue)] sm:w-64"
        />
      </div>

      {filteredTopics.length === 0 ? (
        <EmptyState title={favOnly ? "还没有收藏的话题" : "没有找到匹配的话题"} desc="换个关键词或切换 Part 试试。" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredTopics.map((t) => {
            const done = t.questions.filter((q) => progMap.get(q.id)?.done).length;
            const total = t.questions.length;
            const favs = t.questions.filter((q) => progMap.get(q.id)?.fav).length;
            return (
              <Card
                key={t.id}
                onClick={() => navigate(`/speaking/topic/${encodeURIComponent(t.id)}`)}
                className="card-press flex cursor-pointer items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[16px] font-semibold">{t.name}</h3>
                  {t.kind === "part2" && (
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ink-500)]">{t.questions[0]?.question.split("\n")[0]}</p>
                  )}
                </div>
                {favs > 0 && <span className="tag-paper text-[#b87400]">收藏 {favs}</span>}
                <span className={cn("tag-paper num", done === total && "bg-[var(--blue-tint)] text-[var(--blue)]")}>
                  {done}/{total} 题
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpeakingPracticeScreen({
  topic,
  idx,
  progMap,
  accentPref,
  onAccentChange,
  allowLookup,
  onNavigateIdx,
  onBackTopic,
}: {
  topic: SpeakingTopic;
  idx: number;
  progMap: Map<string, { fav?: boolean; done?: boolean; count?: number }>;
  accentPref: string;
  onAccentChange: (a: string) => void;
  allowLookup: boolean;
  onNavigateIdx: (i: number) => void;
  onBackTopic: () => void;
}) {
  const q: SpeakingQuestion | undefined = topic.questions[idx];
  const isP2 = q?.part === 2;

  const [stage, setStage] = useState<"card" | "prep" | "answer">(isP2 ? "card" : "answer");
  const [prepLeft, setPrepLeft] = useState(PREP_SEC);
  const [notes, setNotes] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [recs, setRecs] = useState<IeltsRecordingRow[]>([]);
  const [recSec, setRecSec] = useState(0);
  const [recording, setRecording] = useState(false);
  const [micErr, setMicErr] = useState("");
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [wordHit, setWordHit] = useState<ClickedWordHit | null>(null);
  const [sentTransCache, setSentTransCache] = useState<Record<string, string>>({});

  // AI 考官点评状态
  const agentSt = useAgentState();
  const [aiDraft, setAiDraft] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [followInput, setFollowInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const playerRef = useRef<HTMLAudioElement | null>(null);
  const recUrlsRef = useRef<Map<string, string>>(new Map());
  const activeRecRef = useRef<{ mr: MediaRecorder; stream: MediaStream; t0: number; max: number; discard: boolean } | null>(null);

  // Reset per question
  useEffect(() => {
    if (!q) return;
    abortRef.current?.abort();
    setAiBusy(false);
    setAiErr(null);
    setChatMsgs([]);
    setAiDraft("");
    setFollowInput("");
    setStage(q.part === 2 ? "card" : "answer");
    setPrepLeft(PREP_SEC);
    setNotes("");
    setRevealed(false);
    setMicErr("");
    setWordHit(null);
    void db.ieltsRecordings
      .where("qid")
      .equals(q.id)
      .sortBy("createdAt")
      .then(setRecs);
    return () => {
      abortRef.current?.abort();
      playerRef.current?.pause();
      setPlayingKey(null);
      if (activeRecRef.current) {
        activeRecRef.current.discard = true;
        if (activeRecRef.current.mr.state !== "inactive") activeRecRef.current.mr.stop();
        activeRecRef.current.stream.getTracks().forEach((tr) => tr.stop());
        activeRecRef.current = null;
      }
      setRecording(false);
      recUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      recUrlsRef.current.clear();
    };
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prep & recording timer
  useEffect(() => {
    if (stage !== "prep" && !recording) return;
    const t = setInterval(() => {
      if (stage === "prep") {
        setPrepLeft((prev) => {
          if (prev <= 1) {
            setStage("answer");
            return 0;
          }
          return prev - 1;
        });
      }
      if (activeRecRef.current) {
        const elapsed = (Date.now() - activeRecRef.current.t0) / 1000;
        setRecSec(elapsed);
        if (elapsed >= activeRecRef.current.max && activeRecRef.current.mr.state !== "inactive") {
          activeRecRef.current.mr.stop();
        }
      }
    }, 250);
    return () => clearInterval(t);
  }, [stage, recording]);

  const togglePlay = (key: string, src: string) => {
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
  };

  const startRecording = async () => {
    if (!q) return;
    setMicErr("");
    if (!window.isSecureContext) {
      setMicErr("浏览器仅在 HTTPS 或 localhost 下允许麦克风录音。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMicErr("当前浏览器不支持 MediaRecorder 录音。");
      return;
    }
    playerRef.current?.pause();
    setPlayingKey(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setMicErr(micErrorMessage(e));
      return;
    }
    const mime = pickSupportedMime();
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      stream.getTracks().forEach((tr) => tr.stop());
      setMicErr(micErrorMessage(e));
      return;
    }
    const chunks: BlobPart[] = [];
    const max = isP2 ? P2_MAX_SEC : P13_MAX_SEC;
    const session = { mr, stream, t0: Date.now(), max, discard: false };
    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (activeRecRef.current === session) activeRecRef.current = null;
      setRecording(false);
      if (session.discard || !chunks.length) return;
      const seconds = Math.max(1, Math.round((Date.now() - session.t0) / 1000));
      const finalMime = mr.mimeType || mime || "audio/webm";
      const row: IeltsRecordingRow = {
        id: makeRunId("rec"),
        qid: q.id,
        blob: new Blob(chunks, { type: finalMime }),
        mime: finalMime,
        seconds,
        createdAt: Date.now(),
      };
      await db.ieltsRecordings.put(row);
      await patchSpeakingProgress(q.id, (c) => {
        c.done = true;
        c.count = (c.count ?? 0) + 1;
        c.lastAt = Date.now();
      });
      await bumpDay({ questions: 1, correct: 1 });
      setRecs((prev) => [...prev, row]);
    };
    activeRecRef.current = session;
    setRecSec(0);
    setRecording(true);
    mr.start(1000);
  };

  const stopRecording = () => {
    if (activeRecRef.current && activeRecRef.current.mr.state !== "inactive") {
      activeRecRef.current.mr.stop();
    }
  };

  const urlForRec = (r: IeltsRecordingRow): string => {
    if (!recUrlsRef.current.has(r.id)) {
      recUrlsRef.current.set(r.id, URL.createObjectURL(r.blob));
    }
    return recUrlsRef.current.get(r.id)!;
  };

  const lookupTrans: TransLookup = useCallback(
    (sentence: string) => {
      const k = sentence.trim();
      if (sentTransCache[k] !== undefined) return { ready: true, text: sentTransCache[k] || null };
      fetch("/api/agent/sent", {
        method: "POST",
        headers: agentHeaders(true),
        body: JSON.stringify({ sentence: k }),
      })
        .then((r) => (r.ok ? r.json() : { zh: "" }))
        .then((d: { zh?: string }) => setSentTransCache((prev) => ({ ...prev, [k]: d.zh ?? "" })))
        .catch(() => setSentTransCache((prev) => ({ ...prev, [k]: "" })));
      return { ready: false, text: null };
    },
    [sentTransCache],
  );

  const askIeltsExaminer = async (userReply?: string) => {
    if (!q || aiBusy) return;
    const answerText = (userReply ?? (aiDraft.trim() || notes.trim())).trim();
    if (!answerText) {
      setAiErr("请先在下方输入你的英文作答思路或句子，再请 AI 考官按雅思四项标准点评。");
      return;
    }
    setAiErr(null);
    const promptMsg: ChatMsg = userReply
      ? { role: "user", content: userReply }
      : {
          role: "user",
          content: `请以雅思口语考官（IELTS Part ${q.part}）身份点评我的英文作答（中文点评、英文保留原文）：
1. 预估 Band 分档与四维简评（FC / LR / GRA / 切题度）
2. 最关键的 2–3 处用词或语法纠错
3. Band 7.5+ 地道自然改写版
4. 给 1 个考官追问（英文），供我继续对练。

【题目】${q.question}
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
      await streamChat(
        nextHistory,
        {
          paper: `雅思口语 Part ${q.part} · ${topic.name}`,
          sentence: q.question,
          question: q.question,
        },
        (partial) => setChatMsgs([...nextHistory, { role: "assistant", content: partial }]),
        ctrl.signal,
      );
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setAiErr((e as Error)?.message || "AI 考官响应失败，请稍后重试。");
      }
    } finally {
      setAiBusy(false);
    }
  };

  if (!q) return null;

  const isFav = Boolean(progMap.get(q.id)?.fav);
  const curExaminer = q.examiner.find((a) => a.accent === accentPref) ?? q.examiner[0];
  const lines = q.question.split("\n").map((s) => s.trim()).filter(Boolean);
  const sayIdx = lines.findIndex((l) => /^you should say/i.test(l));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={recording}
          onClick={onBackTopic}
          className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--ink-500)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          <CaretLeft className="size-4" /> {topic.name}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[var(--ink-500)]">
            Part {q.part} · 第 {idx + 1} / {topic.questions.length} 题
          </span>
          <button
            type="button"
            onClick={() => void patchSpeakingProgress(q.id, (c) => (c.fav ? delete c.fav : (c.fav = true)))}
            className={cn("grid size-9 place-items-center rounded-[8px]", isFav ? "text-[#e09100]" : "text-[var(--ink-300)] hover:text-[var(--ink-700)]")}
            aria-label={isFav ? "取消收藏" : "收藏"}
          >
            <Star className="size-5" weight={isFav ? "fill" : "regular"} />
          </button>
        </div>
      </div>

      {/* Prompt & Recording Card */}
      <Card className="space-y-4 p-6">
        {isP2 && (
          <div className="text-[13px] font-semibold text-[var(--blue)]">
            {stage === "card" ? "第 1 步 · 阅读题卡" : stage === "prep" ? "第 2 步 · 准备提纲（1 分钟）" : "第 3 步 · 连续陈述（最长 2 分钟）"}
          </div>
        )}

        {isP2 ? (
          <div className="rounded-[10px] bg-[var(--paper-100)] p-4">
            <div className="serif text-[18px] font-semibold">{(sayIdx < 0 ? lines : lines.slice(0, sayIdx)).join(" ")}</div>
            {sayIdx >= 0 && (
              <>
                <div className="mt-2 text-[13px] text-[var(--ink-500)]">You should say:</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
                  {lines.slice(sayIdx + 1).map((pt, k) => (
                    <li key={k}>{pt}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="serif text-[20px] leading-8 font-semibold">{q.question}</div>
        )}

        {curExaminer && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => togglePlay(`ex:${q.id}`, curExaminer.src)}>
              {playingKey === `ex:${q.id}` ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playingKey === `ex:${q.id}` ? "暂停" : isP2 ? "朗读题卡" : "听考官提问"}
            </Button>
            {q.examiner.length > 1 && (
              <Segmented
                label="考官口音"
                value={curExaminer.accent}
                onChange={(v) => {
                  playerRef.current?.pause();
                  setPlayingKey(null);
                  onAccentChange(v);
                }}
                options={q.examiner.map((a) => ({ value: a.accent, label: a.accent }))}
              />
            )}
          </div>
        )}

        {isP2 && stage === "card" ? (
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="primary" onClick={() => { setPrepLeft(PREP_SEC); setStage("prep"); }}>
              开始 1 分钟准备
            </Button>
            <Button onClick={() => setStage("answer")}>跳过准备，直接作答</Button>
          </div>
        ) : (
          <>
            {isP2 && (
              <div className="space-y-2">
                {stage === "prep" && (
                  <div className="flex items-center justify-between rounded-[9px] bg-[var(--fill-quiet)] px-4 py-2.5">
                    <span className="text-[14px] text-[var(--ink-700)]">准备倒计时</span>
                    <span className="num text-[24px] font-semibold">{fmtClock(prepLeft)}</span>
                    <Button size="sm" onClick={() => setStage("answer")}>提前开始回答</Button>
                  </div>
                )}
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="在这里快速记几个英文关键词草稿（仅本次可见）…"
                  className="w-full rounded-[9px] bg-[var(--paper-100)] p-3 text-[14px] outline-none focus:shadow-[0_0_0_2px_var(--blue)]"
                />
              </div>
            )}

            {stage === "answer" && (
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Button
                  variant={recording ? "danger" : "primary"}
                  onClick={recording ? stopRecording : () => void startRecording()}
                >
                  <Microphone className="size-4" weight="fill" />
                  {recording ? "停止录音" : recs.length ? "再录一次" : "开始录音回答"}
                </Button>
                {recording && (
                  <span className="num text-[18px] font-semibold text-[var(--red)]">
                    {isP2 ? `剩余 ${fmtClock(P2_MAX_SEC - recSec)}` : fmtClock(recSec)}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {micErr && <p className="text-[13px] text-[var(--red)]">{micErr}</p>}
      </Card>

      {/* My Recordings */}
      <Card className="p-5">
        <h3 className="text-[16px] font-semibold">我的录音</h3>
        {recs.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--ink-500)]">还没有录音，录完后可在此回放对照。</p>
        ) : (
          <div className="mt-3 divide-y divide-[var(--line-soft)]">
            {recs.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">第 {i + 1} 次录音</div>
                  <div className="text-[12px] text-[var(--ink-500)]">
                    {new Date(r.createdAt).toLocaleString("zh-CN")} · {fmtClock(r.seconds)}
                  </div>
                </div>
                <Button size="sm" onClick={() => togglePlay(`rec:${r.id}`, urlForRec(r))}>
                  {playingKey === `rec:${r.id}` ? "暂停" : "回放"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`确定删除第 ${i + 1} 次录音吗？`)) return;
                    if (playingKey === `rec:${r.id}`) {
                      playerRef.current?.pause();
                      setPlayingKey(null);
                    }
                    await db.ieltsRecordings.delete(r.id);
                    const u = recUrlsRef.current.get(r.id);
                    if (u) URL.revokeObjectURL(u);
                    recUrlsRef.current.delete(r.id);
                    setRecs((prev) => prev.filter((x) => x.id !== r.id));
                  }}
                >
                  <Trash className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sample Answer (with WordCard lookup when unlocked!) */}
      {q.answer && (
        <Card
          className="p-5"
          onClick={(ev) => {
            if (revealed && allowLookup) {
              setWordHit(detectClickedWord(ev.nativeEvent));
            }
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-semibold">示范答案</h3>
            {revealed && (
              <Button size="sm" variant="ghost" onClick={() => { playerRef.current?.pause(); setPlayingKey(null); setRevealed(false); }}>
                收起
              </Button>
            )}
          </div>
          {!revealed ? (
            <div className="mt-2 space-y-3">
              <p className="text-[13px] text-[var(--ink-500)]">
                {recs.length > 0 ? "已录音，现在可以展开示范答案对照表达。" : "建议先自己开口录一遍再看示范答案。"}
              </p>
              <div className="flex items-center gap-3">
                <Button variant={recs.length > 0 ? "primary" : "secondary"} onClick={() => setRevealed(true)}>
                  {recs.length > 0 ? "查看示范答案" : "不录音，直接查看"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {q.model && (
                <Button size="sm" onClick={() => togglePlay(`md:${q.id}`, q.model!)}>
                  {playingKey === `md:${q.id}` ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {playingKey === `md:${q.id}` ? "暂停示范朗读" : "播放示范朗读"}
                </Button>
              )}
              <div className="serif space-y-2.5 text-[16px] leading-7">
                {q.answer.split(/\n+/).map((para, k) => (
                  <p key={k}>{para}</p>
                ))}
              </div>
              {q.hint && (
                <div className="rounded-[9px] bg-[var(--fill-quiet)] px-3.5 py-2.5 text-[13px] text-[var(--ink-700)]">
                  <b>思路提示：</b>{q.hint}
                </div>
              )}
              {allowLookup && <p className="text-[12px] text-[var(--ink-500)]">提示：点击示范答案中的英文生词可直接查词并加入记忆树。</p>}
            </div>
          )}
        </Card>
      )}

      {/* AI Examiner Evaluation Card */}
      {agentSt !== "off" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[16px] font-semibold">
              <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
              AI 考官点评与 Band 7.5+ 改写
            </h3>
            {agentSt === "on" && (
              <Button size="sm" variant="primary" loading={aiBusy} onClick={() => void askIeltsExaminer()}>
                请 AI 考官批改
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
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                placeholder={notes ? "未输入时将使用上方提纲草稿，也可在此补充完整英文作答…" : "在此输入或粘贴你的英文回答，一键获取四维预估 Band 分与地道改写…"}
                className="w-full rounded-[9px] border border-[var(--line)] bg-[var(--paper-50)] px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[var(--blue)]"
              />
              {aiErr && <p className="text-[13px] text-[var(--red)]">{aiErr}</p>}
              {chatMsgs.length > 0 && (
                <div className="space-y-3 rounded-[10px] border border-[var(--line-soft)] bg-[var(--paper-50)] p-4 text-[14px]">
                  {chatMsgs.map((m, idx) =>
                    idx === 0 && m.role === "user" ? null : (
                      <div
                        key={idx}
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
                          if (e.key === "Enter" && followInput.trim()) void askIeltsExaminer(followInput);
                        }}
                        placeholder="用英文接着回答考官的追问…"
                        className="h-9 flex-1 rounded-[8px] border border-[var(--line)] bg-white px-3 text-[13px] outline-none focus:border-[var(--blue)]"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!followInput.trim()}
                        onClick={() => void askIeltsExaminer(followInput)}
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

      {/* Prev / Next Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button disabled={recording || idx === 0} onClick={() => onNavigateIdx(idx - 1)}>
          <CaretLeft className="size-4" /> 上一题
        </Button>
        {idx >= topic.questions.length - 1 ? (
          <Button variant="primary" disabled={recording} onClick={onBackTopic}>
            完成本话题
          </Button>
        ) : (
          <Button variant="primary" disabled={recording} onClick={() => onNavigateIdx(idx + 1)}>
            下一题 <CaretRight className="size-4" />
          </Button>
        )}
      </div>

      {allowLookup && wordHit && (
        <WordCard
          hit={{ word: wordHit.word, sentence: wordHit.sentence, rect: wordHit.rect } satisfies WordClick}
          ctx={{ tokens: wordHit.tokens, at: wordHit.tokenIndex }}
          anchor={() => ({ word: wordHit.rect, avoid: wordHit.rect })}
          bounds={() => new DOMRect(0, 0, window.innerWidth, window.innerHeight)}
          source={{ paperId: `ielts:oral-${topic.id}`, paperTitle: `雅思口语 · ${topic.name}` }}
          trans={lookupTrans}
          onLookedUp={() => void bumpDay({ lookups: 1 })}
          onClose={() => setWordHit(null)}
        />
      )}
    </div>
  );
}
