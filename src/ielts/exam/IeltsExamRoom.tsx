import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bumpDay } from "@/lib/db";
import { agentHeaders, useAgentEnabled } from "@/lib/agent";
import { useSettings, setSetting } from "@/lib/settings";
import { AgentSplit } from "@/exam/AgentSplit";
import { WordCard } from "@/exam/WordCard";
import type { TransLookup } from "@/lib/trans";
import type { WordClick } from "@/components/WordText";
import { IELTS_SKILLS_EN, IELTS_SKILLS_ZH } from "../data";
import { gradeSection, isAnswered, wordCount, type GradedPerQ } from "../grade";
import { LISTENING_CHECK_SEC } from "../store";
import type {
  IeltsAnswerValue,
  IeltsAttemptRow,
  IeltsExplain,
  IeltsHighlight,
  IeltsKey,
  IeltsMatchGroup,
  IeltsPaper,
  IeltsSkill,
  IeltsSkillState,
} from "../types";
import {
  applyZoneHighlights,
  detectClickedWord,
  extractSelectionInZones,
  findMarksOnTarget,
  flashPassageQuotes,
  mergeHighlightRange,
  subtractHighlightRange,
  type ClickedWordHit,
  type SelectionInfo,
} from "./highlightDom";
import { QuestionGroupView, RawHtml, type GroupViewCtx } from "./QuestionGroupView";
import "./inspera.css";

type ContrastTheme = "bw" | "wb" | "yb";
type TextSize = "0" | "1" | "2";
type ClockMode = "minutes" | "exact" | "hidden";

const THEMES: [ContrastTheme, string][] = [
  ["bw", "Black on white"],
  ["wb", "White on black"],
  ["yb", "Yellow on black"],
];
const SIZES: [TextSize, string][] = [
  ["0", "Standard"],
  ["1", "Large"],
  ["2", "Extra large"],
];

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Synthesize a pleasant official-style headphone check chord sequence via Web Audio API */
function playSampleTone(volume: number): () => void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const notes = [440, 554.37, 659.25, 880, 659.25, 554.37, 440];
  const gainMaster = ctx.createGain();
  gainMaster.gain.value = Math.max(0.05, Math.min(1, volume)) * 0.25;
  gainMaster.connect(ctx.destination);
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + idx * 0.32;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(1, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.29);
    osc.connect(g);
    g.connect(gainMaster);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  });
  const timer = window.setTimeout(() => void ctx.close().catch(() => {}), 2600);
  return () => {
    clearTimeout(timer);
    void ctx.close().catch(() => {});
  };
}

export interface IeltsExamRoomProps {
  run: IeltsAttemptRow;
  paper: IeltsPaper;
  skill: IeltsSkill;
  review: boolean;
  keyDoc: IeltsKey | null;
  explainDoc: IeltsExplain | null;
  onSwitchReviewSkill?: (s: IeltsSkill) => void;
  onPatchSkill: (mutator: (st: IeltsSkillState, r: IeltsAttemptRow) => void) => void;
  onSubmitSkill: (reason: "manual" | "timeup") => Promise<void>;
  onExit: () => void;
}

export function IeltsExamRoom({
  run,
  paper,
  skill,
  review,
  keyDoc,
  explainDoc,
  onSwitchReviewSkill,
  onPatchSkill,
  onSubmitSkill,
  onExit,
}: IeltsExamRoomProps) {
  const settings = useSettings();
  const agentEnabled = useAgentEnabled();
  const st = run.sections[skill]!;

  // UI display preferences (Inspera contrast, text size, split ratio)
  const [theme, setTheme] = useState<ContrastTheme>(() => (localStorage.getItem("ielts-cbt-theme") as ContrastTheme) || "bw");
  const [size, setSize] = useState<TextSize>(() => (localStorage.getItem("ielts-cbt-size") as TextSize) || "0");
  const [splitPct, setSplitPct] = useState<number>(() => Number(localStorage.getItem("ielts-cbt-split")) || 50);
  const [clockMode, setClockMode] = useState<ClockMode>("minutes");
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 900);
  const [mobileTab, setMobileTab] = useState<"left" | "right">(skill === "writing" ? "right" : "left");

  // Overlays & panels
  const [confirmedDetails, setConfirmedDetails] = useState(() => run.skills.indexOf(skill) > 0 || st.elapsed > 0);
  const [soundTested, setSoundTested] = useState(() => skill !== "listening" || st.elapsed > 0);
  const [audioPreflight, setAudioPreflight] = useState<"checking" | "ok" | "err">("checking");
  const [volume, setVolume] = useState(0.85);
  const [overlayPage, setOverlayPage] = useState<"none" | "options" | "submit" | "help" | "hide">("none");
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [pickedMatchOpt, setPickedMatchOpt] = useState<{ groupFirst: number; optIdx: number } | null>(null);
  const [floatBar, setFloatBar] = useState<{
    x: number;
    y: number;
    above: boolean;
    actions: { label: string; kind?: "hl" | "note" | "danger"; onClick: () => void }[];
  } | null>(null);
  const noteInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Anti-pollution gated study tools (ONLY active when unlocked!)
  const allowLookup = review ? settings.ieltsReviewLookup : run.mode === "practice" && run.assistSnapshot.practiceLookup;
  const canShowAgentBtn = review && settings.ieltsReviewAgent;
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentWidth, setAgentWidth] = useState(420);
  const [wordHit, setWordHit] = useState<ClickedWordHit | null>(null);
  const [sentTransCache, setSentTransCache] = useState<Record<string, string>>({});
  const sentPending = useRef<Set<string>>(new Set());

  // Refs for highlight zones & audio
  const hostRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const leftZoneRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const examAudioRef = useRef<HTMLAudioElement | null>(null);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [practiceCurSec, setPracticeCurSec] = useState(0);
  const [practiceDurSec, setPracticeDurSec] = useState(0);
  const [practiceSpeed, setPracticeSpeed] = useState(1);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Parts & flattened question directory
  const parts = useMemo(() => {
    if (skill === "listening") return paper.listening ?? [];
    if (skill === "reading") return paper.reading ?? [];
    return paper.writing ?? [];
  }, [paper, skill]);

  const flatQuestions = useMemo(() => {
    const out: { n: number; label: string; count: number; partIdx: number; group: any }[] = [];
    if (skill === "writing") {
      parts.forEach((p: any, i: number) => out.push({ n: p.part, label: `Task ${p.part}`, count: 1, partIdx: i, group: null }));
    } else {
      parts.forEach((p: any, i: number) => {
        (p.groups ?? []).forEach((g: any) => {
          if (g.type === "multi") {
            for (const it of g.items) {
              out.push({
                n: it.n,
                label: it.count > 1 ? `${it.n}–${it.n + it.count - 1}` : String(it.n),
                count: it.count,
                partIdx: i,
                group: g,
              });
            }
          } else {
            for (let n = g.first; n <= g.last; n++) {
              out.push({ n, label: String(n), count: 1, partIdx: i, group: g });
            }
          }
        });
      });
    }
    return out;
  }, [parts, skill]);

  const viewPart = Math.min(Math.max(0, st.viewPart ?? 0), Math.max(0, parts.length - 1));
  const curQ = st.curQ ?? flatQuestions[0]?.n ?? 1;
  const activePart: any = parts[viewPart];

  // Graded map in Review Mode
  const reviewGrade = useMemo(() => {
    if (!review || !keyDoc || skill === "writing") return null;
    const perQ: Record<number, GradedPerQ> = {};
    const pParts = (paper[skill] ?? []) as any[];
    const kParts = keyDoc[skill] ?? [];
    for (const pp of pParts) {
      const kp = kParts.find((x) => x.part === pp.part);
      if (!kp) continue;
      const g = gradeSection(pp.groups, kp.groups, st.answers);
      Object.assign(perQ, g.perQ);
    }
    return perQ;
  }, [review, keyDoc, paper, skill, st.answers]);

  const activePartExplain = useMemo((): {
    explain: Record<string, string>;
    source: Record<string, string[]>;
    transcript: { s: number; t: string }[];
    sample: string;
  } => {
    if (!review || !explainDoc || !activePart) return { explain: {}, source: {}, transcript: [], sample: "" };
    if (skill === "writing") {
      const w = explainDoc.writing?.find((x) => x.part === activePart.part);
      return { explain: {}, source: {}, transcript: [], sample: w?.sample ?? "" };
    }
    const sec = explainDoc[skill]?.find((x) => x.part === activePart.part);
    return {
      explain: sec?.explain ?? {},
      source: sec?.source ?? {},
      transcript: (sec && "transcript" in sec ? (sec as { transcript?: { s: number; t: string }[] }).transcript : undefined) ?? [],
      sample: "",
    };
  }, [review, explainDoc, activePart, skill]);

  // ---------- Preflight first listening audio during Sound Check ----------
  const runAudioPreflight = useCallback(() => {
    if (skill !== "listening" || !paper.listening?.length) {
      setAudioPreflight("ok");
      return;
    }
    setAudioPreflight("checking");
    const probe = new Audio();
    probe.preload = "metadata";
    probe.setAttribute("referrerpolicy", "no-referrer");
    let settled = false;
    const cleanup = () => {
      probe.removeEventListener("loadedmetadata", ok);
      probe.removeEventListener("canplay", ok);
      probe.removeEventListener("error", bad);
      probe.pause();
      probe.removeAttribute("src");
      probe.load();
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      cleanup();
      setAudioPreflight("ok");
    };
    const bad = () => {
      if (settled) return;
      settled = true;
      cleanup();
      setAudioPreflight("err");
    };
    probe.addEventListener("loadedmetadata", ok);
    probe.addEventListener("canplay", ok);
    probe.addEventListener("error", bad);
    probe.src = paper.listening[0].audioUrl;
    return () => {
      settled = true;
      cleanup();
    };
  }, [skill, paper.listening]);

  useEffect(() => {
    if (!review && run.mode === "mock" && skill === "listening" && st.status === "intro") {
      return runAudioPreflight();
    }
  }, [review, run.mode, skill, st.status, runAudioPreflight]);

  // ---------- Wall-clock Exam Timer ----------
  const submittingRef = useRef(false);
  useEffect(() => {
    if (review || st.status !== "active") return;
    const tick = setInterval(() => {
      let timeUp = false;
      onPatchSkill((draft) => {
        draft.elapsed = (draft.elapsed ?? 0) + 1;
        if (draft.limit != null) {
          if (!draft.deadlineAt) {
            draft.deadlineAt = Date.now() + Math.max(0, draft.limit - draft.elapsed) * 1000;
          }
          const left = Math.ceil((draft.deadlineAt - Date.now()) / 1000);
          draft.elapsed = Math.max(draft.elapsed, draft.limit - Math.max(0, left));
          if (left <= 0) timeUp = true;
        }
      });
      if (timeUp && !submittingRef.current) {
        submittingRef.current = true;
        void onSubmitSkill("timeup").finally(() => {
          submittingRef.current = false;
        });
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [review, st.status, onPatchSkill, onSubmitSkill]);

  // ---------- Decoupled Exam Mode Listening Audio Engine ----------
  const startOrResumeExamAudio = useCallback(
    (partIndex: number, seekSec = 0) => {
      if (review || skill !== "listening" || run.mode !== "mock" || st.listenDone) return;
      const list = paper.listening ?? [];
      if (partIndex >= list.length) {
        onPatchSkill((d) => {
          if (!d.listenDone) {
            d.listenDone = true;
            d.limit = d.elapsed + LISTENING_CHECK_SEC;
            d.deadlineAt = Date.now() + LISTENING_CHECK_SEC * 1000;
          }
        });
        return;
      }
      let audio = examAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.setAttribute("referrerpolicy", "no-referrer");
        examAudioRef.current = audio;
      }
      setAudioError(null);
      audio.volume = volume;
      const targetUrl = list[partIndex].audioUrl;
      if (audio.src !== targetUrl) {
        audio.src = targetUrl;
      }
      const playFrom = () => {
        if (seekSec > 1 && audio && Number.isFinite(audio.duration) && seekSec < audio.duration - 1) {
          audio.currentTime = seekSec;
        }
        audio?.play().then(
          () => setAudioPlaying(true),
          () => {
            setAudioPlaying(false);
            setAudioError("浏览器暂停了自动播放，请点击右侧按钮继续播放当前录音。");
          },
        );
      };
      if (seekSec > 1 && audio.readyState < 1) {
        audio.addEventListener("loadedmetadata", playFrom, { once: true });
      } else {
        playFrom();
      }
    },
    [review, skill, run.mode, st.listenDone, paper.listening, volume, onPatchSkill],
  );

  useEffect(() => {
    if (review || skill !== "listening" || run.mode !== "mock" || st.status !== "active" || st.listenDone) return;
    const audio = examAudioRef.current ?? new Audio();
    examAudioRef.current = audio;

    let lastSavedSec = st.audioSec ?? 0;
    const onTimeUpdate = () => {
      if (Math.abs(audio.currentTime - lastSavedSec) >= 3) {
        lastSavedSec = audio.currentTime;
        onPatchSkill((d) => {
          d.audioSec = Math.floor(audio.currentTime);
        });
      }
    };
    const onEnded = () => {
      setAudioPlaying(false);
      const nextPart = (st.audioPart ?? 0) + 1;
      const list = paper.listening ?? [];
      if (nextPart < list.length) {
        // NEVER hijack active typing focus if candidate is finishing typing in an input!
        const typingInInput =
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement;
        onPatchSkill((d) => {
          d.audioPart = nextPart;
          d.audioSec = 0;
          if (!typingInInput) {
            d.viewPart = nextPart;
            const firstInNext = list[nextPart]?.groups?.[0]?.first;
            if (firstInNext) d.curQ = firstInNext;
          }
        });
        startOrResumeExamAudio(nextPart, 0);
      } else {
        onPatchSkill((d) => {
          d.audioPart = list.length;
          d.audioSec = 0;
          if (!d.listenDone) {
            d.listenDone = true;
            d.limit = d.elapsed + LISTENING_CHECK_SEC;
            d.deadlineAt = Date.now() + LISTENING_CHECK_SEC * 1000;
          }
        });
      }
    };
    const onError = () => {
      setAudioPlaying(false);
      setAudioError("听力音频加载中断（网络波动），录音已暂停在当前位置，绝不会跳过本段。请点击重试继续。");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    if (!audio.src) {
      startOrResumeExamAudio(st.audioPart ?? 0, st.audioSec ?? 0);
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, skill, run.mode, st.status, st.listenDone, st.audioPart]);

  useEffect(() => {
    return () => {
      if (examAudioRef.current) {
        examAudioRef.current.pause();
        examAudioRef.current.removeAttribute("src");
      }
      if (reviewAudioRef.current) {
        reviewAudioRef.current.pause();
        reviewAudioRef.current.removeAttribute("src");
      }
    };
  }, []);

  useEffect(() => {
    if (examAudioRef.current) examAudioRef.current.volume = volume;
  }, [volume]);

  // Practice / Review controllable audio player
  useEffect(() => {
    if (skill !== "listening") return;
    if (!review && run.mode === "mock") return;
    const url = activePart?.audioUrl;
    if (!url) return;
    let audio = reviewAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      audio.setAttribute("referrerpolicy", "no-referrer");
      reviewAudioRef.current = audio;
    }
    audio.pause();
    setAudioPlaying(false);
    setPracticeCurSec(0);
    setPracticeDurSec(0);
    audio.src = url;
    audio.playbackRate = practiceSpeed;
    const onMeta = () => setPracticeDurSec(audio!.duration || 0);
    const onTime = () => setPracticeCurSec(audio!.currentTime || 0);
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio?.removeEventListener("loadedmetadata", onMeta);
      audio?.removeEventListener("timeupdate", onTime);
      audio?.removeEventListener("play", onPlay);
      audio?.removeEventListener("pause", onPause);
      audio?.removeEventListener("ended", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, review, run.mode, activePart?.audioUrl]);

  // ---------- Question Focus & Answers ----------
  const goQuestion = useCallback(
    (n: number) => {
      const item = flatQuestions.find((q) => n >= q.n && n < q.n + q.count);
      if (!item) return;
      if (review) {
        // In review mode we don't mutate submitted run except local view if needed; store in local state
      }
      onPatchSkill((d) => {
        d.curQ = item.n;
        d.viewPart = item.partIdx;
      });
      setWordHit(null);
      requestAnimationFrame(() => {
        const el =
          rightZoneRef.current?.querySelector<HTMLElement>(`input[data-q="${item.n}"], button[data-q="${item.n}"], [data-q="${item.n}"]`) ??
          leftZoneRef.current?.querySelector<HTMLElement>(`[data-q="${item.n}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        if (el instanceof HTMLInputElement && !review) el.focus({ preventScroll: true });
      });
    },
    [flatQuestions, onPatchSkill, review],
  );

  // Local view state for review mode navigation (since submitted run is immutable in `patchSkillState`)
  const [reviewViewPart, setReviewViewPart] = useState(0);
  const [reviewCurQ, setReviewCurQ] = useState<number>(flatQuestions[0]?.n ?? 1);
  useEffect(() => {
    setReviewViewPart(0);
    setReviewCurQ(flatQuestions[0]?.n ?? 1);
  }, [skill, flatQuestions]);

  const effectiveViewPart = review ? Math.min(reviewViewPart, Math.max(0, parts.length - 1)) : viewPart;
  const effectiveCurQ = review ? reviewCurQ : curQ;
  const effectivePart: any = parts[effectiveViewPart];

  const focusQ = useCallback(
    (n: number) => {
      const item = flatQuestions.find((q) => n >= q.n && n < q.n + q.count) ?? flatQuestions.find((q) => q.n === n);
      const targetN = item?.n ?? n;
      const targetPart = item?.partIdx ?? effectiveViewPart;
      if (review) {
        setReviewCurQ(targetN);
        setReviewViewPart(targetPart);
      } else {
        onPatchSkill((d) => {
          d.curQ = targetN;
          d.viewPart = targetPart;
        });
      }
    },
    [flatQuestions, effectiveViewPart, review, onPatchSkill],
  );

  const stepQuestion = (delta: -1 | 1) => {
    const idx = flatQuestions.findIndex((q) => effectiveCurQ >= q.n && effectiveCurQ < q.n + q.count);
    const next = flatQuestions[(idx < 0 ? 0 : idx) + delta];
    if (!next) return;
    focusQ(next.n);
    requestAnimationFrame(() => {
      const el =
        rightZoneRef.current?.querySelector<HTMLElement>(`input[data-q="${next.n}"], button[data-q="${next.n}"], [data-q="${next.n}"]`) ??
        leftZoneRef.current?.querySelector<HTMLElement>(`[data-q="${next.n}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el instanceof HTMLInputElement && !review) el.focus({ preventScroll: true });
    });
  };

  const getAnswer = useCallback(
    (n: number): IeltsAnswerValue | undefined => st.answers[String(n)],
    [st.answers],
  );

  const setAnswer = useCallback(
    (n: number, val: IeltsAnswerValue | undefined) => {
      if (review) return;
      onPatchSkill((d) => {
        if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
          delete d.answers[String(n)];
        } else {
          d.answers[String(n)] = val;
        }
      });
    },
    [review, onPatchSkill],
  );

  const isUnitAnswered = useCallback(
    (q: { n: number; group: any }): boolean => {
      if (skill === "writing") return (st.essays[String(q.n)] ?? "").trim().length > 0;
      if (!q.group) return false;
      return isAnswered(q.group, st.answers, q.n);
    },
    [skill, st.essays, st.answers],
  );

  // Optimistic local highlight map (0ms immediate UI response + synced with Dexie `st.highlights`)
  const [localHighlights, setLocalHighlights] = useState<Record<string, IeltsHighlight[]>>(() => st.highlights ?? {});
  const dbHighlightsSig = JSON.stringify(st.highlights ?? {});
  useEffect(() => {
    setLocalHighlights(st.highlights ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbHighlightsSig]);

  // ---------- Reading Passage Hydration (In-Passage Heading Drop Zones + Highlights) ----------
  const leftZoneKey = `${skill}:${effectiveViewPart}:left`;
  const rightZoneKey = `${skill}:${effectiveViewPart}:right`;

  const headingsGroup: IeltsMatchGroup | undefined = useMemo(() => {
    if (skill !== "reading" || !effectivePart?.groups) return undefined;
    return effectivePart.groups.find((g: any) => g.type === "match" && g.view === "headings");
  }, [skill, effectivePart]);

  useEffect(() => {
    if (skill !== "reading" || !leftZoneRef.current || !effectivePart) return;
    const container = leftZoneRef.current;
    container.innerHTML = effectivePart.html || "";

    // Upgrade injected <span class="heading-slot" data-q="14" data-para="A"></span> into interactive Inspera drop banners
    if (headingsGroup) {
      container.querySelectorAll("span.heading-slot").forEach((sp) => {
        const el = sp as HTMLElement;
        const n = Number(el.dataset.q);
        const para = el.dataset.para || "";
        const box = document.createElement("div");
        box.className = "heading-slot-box";
        box.dataset.q = String(n);
        box.dataset.para = para;
        el.replaceWith(box);
      });
    }
    applyZoneHighlights(container, localHighlights[leftZoneKey] ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, effectiveViewPart, effectivePart?.html, headingsGroup?.first]);

  const headingsAnswersSig = useMemo(() => {
    if (!headingsGroup) return "";
    const slice: unknown[] = [];
    for (let q = headingsGroup.first; q <= headingsGroup.last; q++) {
      slice.push(st.answers[String(q)] ?? null);
    }
    return JSON.stringify(slice);
  }, [headingsGroup, st.answers]);

  // Repaint in-passage heading drop zones ONLY when heading answers / pick / curQ / review actually change
  useEffect(() => {
    if (skill !== "reading" || !leftZoneRef.current || !headingsGroup) return;
    const container = leftZoneRef.current;
    const readyPick = pickedMatchOpt?.groupFirst === headingsGroup.first;

    const assignHeading = (targetQ: number, optIdx: number | undefined) => {
      if (review) return;
      onPatchSkill((d) => {
        if (optIdx !== undefined && !headingsGroup.reuse) {
          for (let q = headingsGroup.first; q <= headingsGroup.last; q++) {
            if (q !== targetQ && d.answers[String(q)] === optIdx) {
              delete d.answers[String(q)];
            }
          }
        }
        d.curQ = targetQ;
        if (optIdx === undefined) delete d.answers[String(targetQ)];
        else d.answers[String(targetQ)] = optIdx;
      });
      setPickedMatchOpt(null);
    };

    container.querySelectorAll<HTMLDivElement>("div.heading-slot-box").forEach((box) => {
      const n = Number(box.dataset.q);
      const para = box.dataset.para || "";
      const v = st.answers[String(n)];
      const opt = typeof v === "number" ? headingsGroup.options[v] : undefined;
      const plainOpt = opt ? opt.t.replace(/<[^>]+>/g, "").trim() : "";

      box.className = "heading-slot-box";
      if (opt) box.classList.add("filled");
      if (effectiveCurQ === n) box.classList.add("cur");
      if (readyPick && !review) box.classList.add("ready-pick");
      if (review && reviewGrade?.[n]) {
        box.classList.add(reviewGrade[n].ok ? "ok" : "bad");
      }

      box.replaceChildren();
      const badge = document.createElement("span");
      badge.className = "heading-slot-num";
      badge.textContent = String(n);
      const textSpan = document.createElement("span");
      textSpan.textContent = opt
        ? `${opt.k}. ${plainOpt}`
        : readyPick
          ? `点击将所选标题放入 Paragraph ${para}`
          : `Paragraph ${para} — 拖入标题或先在右侧点选标题`;
      box.append(badge, textSpan);

      if (!review && opt) {
        const clr = document.createElement("button");
        clr.type = "button";
        clr.className = "heading-slot-clear";
        clr.textContent = "✕";
        clr.title = "Clear heading";
        clr.onclick = (e) => {
          e.stopPropagation();
          assignHeading(n, undefined);
        };
        box.append(clr);
      }

      box.onclick = () => {
        if (review) {
          focusQ(n);
          return;
        }
        if (pickedMatchOpt?.groupFirst === headingsGroup.first) {
          assignHeading(n, pickedMatchOpt.optIdx);
        } else {
          focusQ(n);
        }
      };
      box.ondragover = (e) => {
        if (review) return;
        e.preventDefault();
        box.classList.add("drag-over");
      };
      box.ondragleave = () => box.classList.remove("drag-over");
      box.ondrop = (e) => {
        box.classList.remove("drag-over");
        if (review) return;
        e.preventDefault();
        const raw = e.dataTransfer?.getData("application/x-ielts-opt") || e.dataTransfer?.getData("text/plain") || "";
        const [gf, oi] = raw.split(":").map(Number);
        if (gf === headingsGroup.first && !Number.isNaN(oi)) {
          assignHeading(n, oi);
        }
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, effectiveViewPart, headingsGroup?.first, headingsAnswersSig, effectiveCurQ, pickedMatchOpt, review, reviewGrade]);

  // Serialize per-zone highlight lists so 1s timer ticks (`useLiveQuery` new object refs) NEVER touch DOM text nodes or collapse browser selection!
  const leftHlSig = JSON.stringify(localHighlights[leftZoneKey] ?? []);
  const rightHlSig = JSON.stringify(localHighlights[rightZoneKey] ?? []);

  useEffect(() => {
    if ((skill === "reading" || skill === "writing") && leftZoneRef.current) {
      applyZoneHighlights(leftZoneRef.current, localHighlights[leftZoneKey] ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, effectiveViewPart, leftZoneKey, leftHlSig]);

  useEffect(() => {
    if (skill !== "writing" && rightZoneRef.current) {
      applyZoneHighlights(rightZoneRef.current, localHighlights[rightZoneKey] ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, effectiveViewPart, rightZoneKey, rightHlSig]);

  // Dismiss floating highlight bar on scroll or Escape
  useEffect(() => {
    if (!floatBar) return;
    const hide = () => setFloatBar(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const host = hostRef.current;
    host?.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      host?.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [floatBar]);

  // Auto-focus note textarea when newly created or clicked
  useEffect(() => {
    if (!notesOpen || !focusNoteId) return;
    const raf = requestAnimationFrame(() => {
      const ta = noteInputRefs.current[focusNoteId];
      if (ta) {
        ta.scrollIntoView({ block: "nearest" });
        ta.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [notesOpen, focusNoteId]);

  // ---------- Inspera Floating Highlight / Note Bar & Controlled Word Lookup ----------
  const getZones = useCallback(() => {
    const out: { key: string; el: HTMLElement }[] = [];
    if ((skill === "reading" || skill === "writing") && leftZoneRef.current) {
      out.push({ key: leftZoneKey, el: leftZoneRef.current });
    }
    if (skill !== "writing" && rightZoneRef.current) {
      out.push({ key: rightZoneKey, el: rightZoneRef.current });
    }
    return out;
  }, [leftZoneKey, rightZoneKey, skill]);

  const setZoneHighlights = useCallback(
    (zKey: string, list: IeltsHighlight[], immediateZoneEl?: HTMLElement) => {
      if (review) return;
      // 1. Synchronous DOM paint so `<mark class="cbt-hl">` turns yellow in 0ms on click!
      const targetEl = immediateZoneEl ?? getZones().find((z) => z.key === zKey)?.el;
      if (targetEl) {
        applyZoneHighlights(targetEl, list);
      }
      // 2. Optimistic React state update
      setLocalHighlights((prev) => {
        const next = { ...prev };
        if (list.length === 0) delete next[zKey];
        else next[zKey] = list;
        return next;
      });
      // 3. Durable IndexedDB persistence
      onPatchSkill((d) => {
        if (list.length === 0) delete d.highlights[zKey];
        else d.highlights[zKey] = list;
      });
    },
    [review, getZones, onPatchSkill],
  );

  const closeNotesDrawer = useCallback(() => {
    // Prune completely empty anchored notes when closing drawer, just like closing an empty sticky note
    if (!review) {
      setLocalHighlights((prev) => {
        const out: Record<string, IeltsHighlight[]> = {};
        for (const [zk, list] of Object.entries(prev)) {
          const next = list.filter((it) => it.id === "__scratch__" || it.note == null || it.note.trim().length > 0);
          if (next.length > 0) out[zk] = next;
          if (next.length !== list.length) {
            const zEl = getZones().find((z) => z.key === zk)?.el;
            if (zEl) applyZoneHighlights(zEl, next);
          }
        }
        return out;
      });
      onPatchSkill((d) => {
        for (const [zk, list] of Object.entries(d.highlights)) {
          const next = list.filter((it) => it.id === "__scratch__" || it.note == null || it.note.trim().length > 0);
          if (next.length === 0) delete d.highlights[zk];
          else if (next.length !== list.length) d.highlights[zk] = next;
        }
      });
    }
    setNotesOpen(false);
    setFocusNoteId(null);
  }, [review, getZones, onPatchSkill]);

  const makeHlId = () => `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const showFloatingAtRect = (
    rect: DOMRect,
    actions: { label: string; kind?: "hl" | "note" | "danger"; onClick: () => void }[],
  ) => {
    const cx = Math.min(window.innerWidth - 16, Math.max(16, rect.left + rect.width / 2));
    const above = rect.top >= 104;
    const y = above ? rect.top - 8 : rect.bottom + 8;
    setFloatBar({ x: cx, y, above, actions });
  };

  const openSelectionToolbar = (sel: SelectionInfo) => {
    const existing = localHighlights[sel.zoneKey] ?? [];
    const overlapsPlain = existing.some((x) => x.id !== "__scratch__" && x.note == null && x.e > sel.s && x.s < sel.e);
    const totalMarks = existing.filter((x) => x.id !== "__scratch__").length;

    const actions: { label: string; kind?: "hl" | "note" | "danger"; onClick: () => void }[] = [
      {
        label: "Highlight",
        kind: "hl",
        onClick: () => {
          const next = mergeHighlightRange(existing, sel.s, sel.e, sel.fullText, makeHlId);
          window.getSelection()?.removeAllRanges();
          setZoneHighlights(sel.zoneKey, next, sel.zoneEl);
        },
      },
      {
        label: "Note",
        kind: "note",
        onClick: () => {
          const id = makeHlId();
          const item: IeltsHighlight = {
            id,
            s: sel.s,
            e: sel.e,
            text: sel.text.trim().slice(0, 200),
            note: "",
          };
          window.getSelection()?.removeAllRanges();
          setZoneHighlights(sel.zoneKey, [...existing, item], sel.zoneEl);
          setFocusNoteId(id);
          setNotesOpen(true);
        },
      },
    ];

    if (overlapsPlain) {
      actions.push({
        label: "Clear",
        kind: "danger",
        onClick: () => {
          const next = subtractHighlightRange(existing, sel.s, sel.e, sel.fullText, makeHlId);
          window.getSelection()?.removeAllRanges();
          setZoneHighlights(sel.zoneKey, next, sel.zoneEl);
        },
      });
    }
    if (totalMarks > 1) {
      actions.push({
        label: "Clear all",
        kind: "danger",
        onClick: () => {
          window.getSelection()?.removeAllRanges();
          setZoneHighlights(sel.zoneKey, [], sel.zoneEl);
        },
      });
    }
    showFloatingAtRect(sel.rect, actions);
  };

  const openMarkToolbar = (hit: { zoneKey: string; zoneEl: HTMLElement; ids: string[]; rect: DOMRect }) => {
    const existing = localHighlights[hit.zoneKey] ?? [];
    const totalMarks = existing.filter((x) => x.id !== "__scratch__").length;
    const noteItem = existing.find((x) => hit.ids.includes(x.id) && x.note != null);
    const actions: { label: string; kind?: "hl" | "note" | "danger"; onClick: () => void }[] = [];

    if (noteItem) {
      actions.push({
        label: "Note",
        kind: "note",
        onClick: () => {
          setFocusNoteId(noteItem.id);
          setNotesOpen(true);
        },
      });
      actions.push({
        label: "Delete note",
        kind: "danger",
        onClick: () => setZoneHighlights(hit.zoneKey, existing.filter((x) => x.id !== noteItem.id), hit.zoneEl),
      });
    } else {
      const firstId = hit.ids[0];
      actions.push({
        label: "Clear",
        kind: "danger",
        onClick: () => setZoneHighlights(hit.zoneKey, existing.filter((x) => !hit.ids.includes(x.id)), hit.zoneEl),
      });
      if (firstId) {
        actions.push({
          label: "Add note",
          kind: "note",
          onClick: () => {
            const next = existing.map((x) => (x.id === firstId ? { ...x, note: x.note ?? "" } : x));
            setZoneHighlights(hit.zoneKey, next, hit.zoneEl);
            setFocusNoteId(firstId);
            setNotesOpen(true);
          },
        });
      }
    }

    if (totalMarks > 1) {
      actions.push({
        label: "Clear all",
        kind: "danger",
        onClick: () => setZoneHighlights(hit.zoneKey, [], hit.zoneEl),
      });
    }
    showFloatingAtRect(hit.rect, actions);
  };

  const handleZoneSelectionEnd = () => {
    if (review) return;
    window.setTimeout(() => {
      const sel = extractSelectionInZones(getZones());
      if (sel) openSelectionToolbar(sel);
    }, 15);
  };

  const handleContextMenu = (ev: React.MouseEvent) => {
    if (review) return;
    const zones = getZones();
    const sel = extractSelectionInZones(zones);
    if (sel) {
      ev.preventDefault();
      openSelectionToolbar(sel);
      return;
    }

    const target = ev.target as HTMLElement | null;
    const hit = findMarksOnTarget(target, zones);
    if (hit) {
      ev.preventDefault();
      openMarkToolbar(hit);
      return;
    }

    if (zones.some((z) => target && z.el.contains(target))) {
      ev.preventDefault();
      setFloatBar(null);
    }
  };

  const handleWorkspaceClick = (ev: React.MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target || target.closest(".cbt-floatbar")) return;

    // Image click-to-zoom inside passage/task
    if (target.tagName === "IMG" && target.closest(".cbt-passage, .cbt-task")) {
      const src = (target as HTMLImageElement).src;
      if (src) setZoomSrc(src);
      return;
    }

    // If user just finished dragging a non-empty text selection, keep the newly opened selection toolbar!
    const winSel = window.getSelection();
    if (winSel && !winSel.isCollapsed) return;

    if (floatBar) setFloatBar(null);

    if (!review) {
      const hit = findMarksOnTarget(target, getZones());
      if (hit) {
        const existing = localHighlights[hit.zoneKey] ?? [];
        const noteItem = existing.find((x) => hit.ids.includes(x.id) && x.note != null);
        if (noteItem) {
          setFocusNoteId(noteItem.id);
          setNotesOpen(true);
        }
        openMarkToolbar(hit);
        return;
      }
    }

    // Controlled Word Lookup (strictly gated by `allowLookup`!)
    if (allowLookup) {
      const hit = detectClickedWord(ev.nativeEvent);
      setWordHit(hit);
    }
  };

  // On-demand sentence translation for WordCard via CETPath's `/api/agent/sent`
  const lookupTrans: TransLookup = useCallback(
    (sentence: string) => {
      const key = sentence.trim();
      if (sentTransCache[key] !== undefined) return { ready: true, text: sentTransCache[key] || null };
      if (!sentPending.current.has(key)) {
        sentPending.current.add(key);
        fetch("/api/agent/sent", {
          method: "POST",
          headers: agentHeaders(true),
          body: JSON.stringify({ sentence: key }),
        })
          .then((r) => (r.ok ? r.json() : { zh: "" }))
          .then((d: { zh?: string }) => {
            setSentTransCache((prev) => ({ ...prev, [key]: d.zh ?? "" }));
          })
          .catch(() => {
            setSentTransCache((prev) => ({ ...prev, [key]: "" }));
          })
          .finally(() => sentPending.current.delete(key));
      }
      return { ready: false, text: null };
    },
    [sentTransCache],
  );

  // ---------- Divider Drag ----------
  const startSplitDrag = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!mainRef.current) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const rect = mainRef.current.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const pct = Math.min(75, Math.max(25, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
      setSplitPct(pct);
      localStorage.setItem("ielts-cbt-split", String(pct));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---------- Clock / Status Text ----------
  const remainingSec = st.limit != null ? Math.max(0, st.limit - st.elapsed) : null;
  const clockDisplay = useMemo(() => {
    if (review) return "Review mode";
    if (skill === "listening" && run.mode === "mock" && !st.listenDone) {
      const pNum = Math.min((st.audioPart ?? 0) + 1, (paper.listening?.length ?? 4));
      return audioPlaying ? `Audio is playing · Part ${pNum}` : "Listening";
    }
    if (remainingSec != null) {
      if (clockMode === "hidden") return "Timer hidden (click to show)";
      if (clockMode === "exact" || remainingSec <= 60) {
        return remainingSec <= 60 ? `${remainingSec} seconds left` : `${fmtClock(remainingSec)} left`;
      }
      const mins = Math.ceil(remainingSec / 60);
      return `${mins} minute${mins === 1 ? "" : "s"} left`;
    }
    return `Practice · ${fmtClock(st.elapsed)}`;
  }, [review, skill, run.mode, st.listenDone, st.audioPart, paper.listening?.length, audioPlaying, remainingSec, clockMode, st.elapsed]);

  const isWarnTime = !review && remainingSec != null && remainingSec <= 600;

  // ---------- Notes & Scratchpad ----------
  const scratchZoneKey = `${skill}:scratch`;
  const scratchpadText = useMemo(
    () => (localHighlights[scratchZoneKey] ?? []).find((x) => x.id === "__scratch__")?.note ?? "",
    [localHighlights, scratchZoneKey],
  );

  const allNotes = useMemo(() => {
    const out: { zKey: string; partIdx: number; side: string; item: IeltsHighlight }[] = [];
    for (const [zKey, list] of Object.entries(localHighlights)) {
      if (zKey === scratchZoneKey) continue;
      const partsKey = zKey.split(":");
      if (partsKey[0] !== skill) continue;
      const pIdx = Number(partsKey[1]) || 0;
      const side = partsKey[2] || "left";
      for (const it of list) {
        if (it.id !== "__scratch__" && it.note != null) {
          out.push({ zKey, partIdx: pIdx, side, item: it });
        }
      }
    }
    return out.sort(
      (a, b) =>
        (a.partIdx === effectiveViewPart ? -1 : 0) - (b.partIdx === effectiveViewPart ? -1 : 0) ||
        a.partIdx - b.partIdx ||
        a.item.s - b.item.s,
    );
  }, [localHighlights, skill, scratchZoneKey, effectiveViewPart]);

  const notesBadgeCount = allNotes.length + (scratchpadText.trim() ? 1 : 0);

  const jumpToNoteInText = (partIdx: number, side: string, noteId: string) => {
    setFocusNoteId(noteId);
    if (isMobile) setMobileTab(side === "right" ? "right" : "left");
    const reveal = () => {
      const mk = hostRef.current?.querySelector<HTMLElement>(`mark[data-id="${noteId}"]`);
      if (!mk) return;
      mk.scrollIntoView({ block: "center", behavior: "smooth" });
      mk.classList.add("cbt-flash");
      window.setTimeout(() => mk.classList.remove("cbt-flash"), 1200);
    };
    if (partIdx !== effectiveViewPart) {
      onPatchSkill((d) => {
        d.viewPart = partIdx;
      });
      window.setTimeout(reveal, 80);
    } else {
      reveal();
    }
    if (isMobile) setNotesOpen(false);
  };

  // ---------- GroupView Context ----------
  const activeReviewExplain = useMemo(() => {
    if (!review) return null;
    return {
      perQ: reviewGrade ?? {},
      explain: activePartExplain.explain,
      source: activePartExplain.source,
      onLocateSource:
        skill === "reading"
          ? (quotes: string[]) => {
              if (isMobile) setMobileTab("left");
              requestAnimationFrame(() => {
                if (leftZoneRef.current) flashPassageQuotes(leftZoneRef.current, quotes);
              });
            }
          : undefined,
    };
  }, [review, reviewGrade, activePartExplain, skill, isMobile]);

  const groupCtx: GroupViewCtx = {
    curQ: effectiveCurQ,
    getAnswer,
    setAnswer,
    focusQ,
    pickedMatchOpt,
    setPickedMatchOpt,
    onZoomImg: setZoomSrc,
    review: activeReviewExplain,
  };

  // ---------- Agent Thread Context (Review Mode ONLY) ----------
  const agentThread = useMemo(() => {
    const plainPassage = (effectivePart?.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const transcriptStr = activePartExplain.transcript.map((l) => l.t).join(" ");
    const summaryLines: string[] = [];
    if (reviewGrade) {
      for (const [qn, r] of Object.entries(reviewGrade)) {
        if (!r.ok) {
          summaryLines.push(`第 ${qn} 题：考生答 "${r.userText || "未作答"}"，正确答案 "${r.correct}"`);
        }
      }
    }
    return {
      id: `paper:ielts:${run.id}:${skill}`,
      ctx: {
        paper: `${run.paperTitle}（雅思 ${IELTS_SKILLS_ZH[skill]}）`,
        sentence: "",
        paperText: (plainPassage || transcriptStr).slice(0, 28000),
        review: summaryLines.join("\n").slice(0, 6000),
        reviewReady: true,
        view: `Part ${effectivePart?.part ?? 1}，当前看第 ${effectiveCurQ} 题`,
      },
    };
  }, [effectivePart, activePartExplain.transcript, reviewGrade, run.id, run.paperTitle, skill, effectiveCurQ]);

  const nextMockSkill = useMemo(() => {
    if (review || run.scope !== "full") return null;
    const idx = run.skills.indexOf(skill);
    return idx >= 0 && idx + 1 < run.skills.length ? run.skills[idx + 1] : null;
  }, [review, run.scope, run.skills, skill]);

  const bannerSubtitle = () => {
    if (!effectivePart) return "";
    if (skill === "writing") {
      const t1 = effectivePart.part === 1;
      return `You should spend about ${t1 ? 20 : 40} minutes on this task. Write at least ${t1 ? 150 : 250} words.`;
    }
    const qs = flatQuestions.filter((q) => q.partIdx === effectiveViewPart);
    if (!qs.length) return "";
    const firstN = qs[0].n;
    const lastItem = qs[qs.length - 1];
    const lastN = lastItem.n + lastItem.count - 1;
    return skill === "reading"
      ? `Read the text and answer questions ${firstN}–${lastN}.`
      : `Listen and answer questions ${firstN}–${lastN}.`;
  };

  return (
    <div
      ref={hostRef}
      className={`ielts-cbt theme-${theme} cbt-sz-${size}${allowLookup ? " lookup-enabled" : ""}`}
      style={{ ["--left" as string]: `${splitPct}%` }}
      onContextMenu={handleContextMenu}
      onClick={handleWorkspaceClick}
    >
      {/* ---------- 56px Official Inspera Header ---------- */}
      <header className="cbt-head">
        <div className="cbt-logo">IELTS</div>
        <div className="cbt-who">
          <div className="cbt-tt">{run.candidateName || settings.ieltsCandidateName || "Test taker ID"}</div>
          <button
            type="button"
            className={`cbt-clock${isWarnTime ? " warn" : ""}`}
            title={remainingSec != null && !review ? "点击切换剩余分钟 / 精确秒数 / 隐藏计时" : undefined}
            onClick={() => {
              if (!review && remainingSec != null) {
                setClockMode((m) => (m === "minutes" ? "exact" : m === "exact" ? "hidden" : "minutes"));
              }
            }}
          >
            {clockDisplay}
          </button>
        </div>

        <div className="cbt-hright">
          {skill === "listening" && !review && run.mode === "mock" && !st.listenDone && !isMobile && (
            <div className="cbt-vol" title="Volume">
              <span aria-hidden>🔊</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                aria-label="Volume"
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
              />
            </div>
          )}

          {/* Review Mode Only: Study Tools Switches (strictly omitted during exam!) */}
          {review && (
            <>
              <button
                type="button"
                className={`cbt-hbtn${allowLookup ? " on" : ""}`}
                onClick={() => void setSetting("ieltsReviewLookup", !settings.ieltsReviewLookup)}
                title="开启后点击任意英文单词即可查词并加入记忆树"
              >
                点词查词 {allowLookup ? "ON" : "OFF"}
              </button>
              {canShowAgentBtn && (
                <button
                  type="button"
                  className={`cbt-hbtn${agentOpen ? " on" : ""}`}
                  onClick={() => setAgentOpen((v) => !v)}
                >
                  AI 助教
                </button>
              )}
            </>
          )}

          {!review && (
            <>
              <button
                type="button"
                className="cbt-hbtn"
                title="Help"
                onClick={() => setOverlayPage(overlayPage === "help" ? "none" : "help")}
              >
                Help
              </button>
              {!isMobile && (
                <button type="button" className="cbt-hbtn" title="Hide screen" onClick={() => setOverlayPage("hide")}>
                  Hide
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className="cbt-hbtn"
            aria-label="Options"
            title="Options (Contrast & Text size)"
            onClick={() => setOverlayPage(overlayPage === "options" ? "none" : "options")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Options
          </button>

          {!review && (
            <button
              type="button"
              aria-label="Notes"
              title="Notes & Scratchpad"
              className={`cbt-hbtn${notesOpen ? " on" : ""}`}
              onClick={() => (notesOpen ? closeNotesDrawer() : setNotesOpen(true))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                <path d="M18.5 2.5l3 3L12 15l-4 1 1-4z" />
              </svg>
              Notes
              {notesBadgeCount > 0 && <span className="badge-dot">{notesBadgeCount}</span>}
            </button>
          )}

          {review && (
            <button type="button" className="cbt-hbtn" onClick={onExit}>
              退出复盘
            </button>
          )}
        </div>
      </header>

      {/* ---------- Review Summary & Multi-Skill Switcher ---------- */}
      {review && (
        <div className="cbt-review-bar">
          {run.skills.length > 1 && onSwitchReviewSkill && (
            <div className="cbt-skill-tabs">
              {run.skills.map((s) => {
                const sr = run.sections[s]?.result;
                const bTxt = sr?.band != null ? ` ${sr.band.toFixed(1)}` : "";
                return (
                  <button
                    key={s}
                    type="button"
                    className={`cbt-skill-tab${s === skill ? " on" : ""}`}
                    onClick={() => onSwitchReviewSkill(s)}
                  >
                    {IELTS_SKILLS_ZH[s]}
                    {bTxt}
                  </button>
                );
              })}
            </div>
          )}
          {st.result?.total != null ? (
            <b>
              得分：{st.result.raw} / {st.result.total}
              {st.result.band != null ? ` · Band ≈ ${st.result.band.toFixed(1)}（估算）` : ""}
            </b>
          ) : (
            <b>
              字数：
              {Object.entries(st.result?.words ?? {})
                .map(([k, v]) => `Task ${k}: ${v} words`)
                .join("  ·  ") || "未作答"}
            </b>
          )}
          {run.overallBand != null && run.skills.length > 1 && (
            <span>听读均分：<b>Band ≈ {run.overallBand.toFixed(1)}</b></span>
          )}
          <span style={{ color: "var(--muted)" }}>用时 {fmtClock(st.result?.elapsed ?? st.elapsed)}</span>
        </div>
      )}

      {/* ---------- Recoverable Audio Error Alert ---------- */}
      {!review && audioError && (
        <div className="cbt-audio-err" role="alert">
          <span>{audioError}</span>
          <button
            type="button"
            className="cbt-btn primary"
            onClick={() => startOrResumeExamAudio(st.audioPart ?? 0, st.audioSec ?? 0)}
          >
            重试播放当前录音
          </button>
        </div>
      )}

      {/* ---------- Part Banner ---------- */}
      {effectivePart && (
        <section className="cbt-banner">
          <h2>{skill === "writing" ? `Writing Task ${effectivePart.part}` : `Part ${effectivePart.part}`}</h2>
          <p>{bannerSubtitle()}</p>
        </section>
      )}

      {/* ---------- Main Split Workspace (+ Optional Notes Drawer / Review AgentSplit) ---------- */}
      <div className="cbt-body-wrap">
        <main
          ref={mainRef}
          className="cbt-xmain"
          onMouseUp={handleZoneSelectionEnd}
          onTouchEnd={handleZoneSelectionEnd}
          onKeyUp={handleZoneSelectionEnd}
        >
          {skill === "reading" && effectivePart && (
            <>
              {isMobile && (
                <div className="cbt-mtabs" role="tablist">
                  <button type="button" className={mobileTab === "left" ? "on" : ""} onClick={() => setMobileTab("left")}>
                    阅读原文
                  </button>
                  <button type="button" className={mobileTab === "right" ? "on" : ""} onClick={() => setMobileTab("right")}>
                    题目作答
                  </button>
                </div>
              )}
              <div
                className="cbt-pane left"
                style={isMobile && mobileTab !== "left" ? { display: "none" } : undefined}
              >
                <div ref={leftZoneRef} className="cbt-passage" />
              </div>
              {!isMobile && (
                <div className="cbt-divider" role="separator" aria-orientation="vertical" onPointerDown={startSplitDrag}>
                  <span className="cbt-grip" aria-hidden>⇄</span>
                </div>
              )}
              <div
                ref={rightZoneRef}
                className="cbt-pane right"
                style={isMobile && mobileTab !== "right" ? { display: "none" } : undefined}
              >
                {effectivePart.groups.map((g: any) => (
                  <QuestionGroupView key={g.first} g={g} ctx={groupCtx} />
                ))}
              </div>
            </>
          )}

          {skill === "writing" && effectivePart && (
            <>
              {isMobile && (
                <div className="cbt-mtabs" role="tablist">
                  <button type="button" className={mobileTab === "left" ? "on" : ""} onClick={() => setMobileTab("left")}>
                    写作题目
                  </button>
                  <button type="button" className={mobileTab === "right" ? "on" : ""} onClick={() => setMobileTab("right")}>
                    作答区
                  </button>
                </div>
              )}
              <div
                className="cbt-pane left"
                style={isMobile && mobileTab !== "left" ? { display: "none" } : undefined}
              >
                <RawHtml tag="div" innerRef={leftZoneRef} className="cbt-task" html={effectivePart.html} />
              </div>
              {!isMobile && (
                <div className="cbt-divider" role="separator" aria-orientation="vertical" onPointerDown={startSplitDrag}>
                  <span className="cbt-grip" aria-hidden>⇄</span>
                </div>
              )}
              <div
                className="cbt-pane right writing"
                style={isMobile && mobileTab !== "right" ? { display: "none" } : undefined}
              >
                <textarea
                  className="cbt-essay"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  data-gramm="false"
                  disabled={review}
                  aria-label={`Writing Task ${effectivePart.part} essay`}
                  placeholder="Write your response here..."
                  value={st.essays[String(effectivePart.part)] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    onPatchSkill((d) => {
                      d.essays[String(effectivePart.part)] = val;
                    });
                  }}
                />
                <div className="cbt-wc">Words: {wordCount(st.essays[String(effectivePart.part)] ?? "")}</div>
                {review && activePartExplain.sample && (
                  <details open style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                    <summary style={{ fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>参考范文 Model Answer</summary>
                    <RawHtml tag="div" className="cbt-sample" html={activePartExplain.sample} />
                  </details>
                )}
              </div>
            </>
          )}

          {skill === "listening" && effectivePart && (
            <>
              {review ? (
                <>
                  {isMobile && (
                    <div className="cbt-mtabs" role="tablist">
                      <button type="button" className={mobileTab === "left" ? "on" : ""} onClick={() => setMobileTab("left")}>
                        听力原文
                      </button>
                      <button type="button" className={mobileTab === "right" ? "on" : ""} onClick={() => setMobileTab("right")}>
                        题目与解析
                      </button>
                    </div>
                  )}
                  <div
                    ref={leftZoneRef}
                    className="cbt-pane left"
                    style={isMobile && mobileTab !== "left" ? { display: "none" } : undefined}
                  >
                    <div className="cbt-playerbar">
                      <button
                        type="button"
                        className="cbt-btn primary"
                        style={{ height: 32, padding: "0 14px", fontSize: 13 }}
                        onClick={() => {
                          const a = reviewAudioRef.current;
                          if (!a) return;
                          if (a.paused) void a.play();
                          else a.pause();
                        }}
                      >
                        {audioPlaying ? "Pause" : "Play"}
                      </button>
                      <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtClock(practiceCurSec)}</span>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(1, Math.floor(practiceDurSec))}
                        value={Math.floor(practiceCurSec)}
                        style={{ flex: 1 }}
                        onChange={(e) => {
                          if (reviewAudioRef.current) reviewAudioRef.current.currentTime = Number(e.target.value);
                        }}
                      />
                      <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtClock(practiceDurSec)}</span>
                      <select
                        value={practiceSpeed}
                        onChange={(e) => {
                          const spd = Number(e.target.value);
                          setPracticeSpeed(spd);
                          if (reviewAudioRef.current) reviewAudioRef.current.playbackRate = spd;
                        }}
                        style={{ padding: "2px 4px", fontSize: 13 }}
                      >
                        {[0.75, 1, 1.25, 1.5].map((s) => (
                          <option key={s} value={s}>{s}×</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Transcript（点击任意句子跳转播放）</div>
                    {activePartExplain.transcript.length === 0 ? (
                      <p style={{ color: "var(--muted)" }}>本段暂无时间轴原文。</p>
                    ) : (
                      activePartExplain.transcript.map((line, idx) => {
                        const nextLine = activePartExplain.transcript[idx + 1];
                        const curMs = practiceCurSec * 1000;
                        const isNow = curMs >= line.s && (!nextLine || curMs < nextLine.s);
                        return (
                          <div
                            key={idx}
                            className={`cbt-sent${isNow ? " now" : ""}`}
                            onClick={() => {
                              const a = reviewAudioRef.current;
                              if (a) {
                                a.currentTime = line.s / 1000;
                                void a.play();
                              }
                            }}
                          >
                            <time>{fmtClock(line.s / 1000)}</time>
                            <span className="cbt-sent-text">{line.t}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {!isMobile && (
                    <div className="cbt-divider" role="separator" aria-orientation="vertical" onPointerDown={startSplitDrag}>
                      <span className="cbt-grip" aria-hidden>⇄</span>
                    </div>
                  )}
                  <div
                    ref={rightZoneRef}
                    className="cbt-pane right"
                    style={isMobile && mobileTab !== "right" ? { display: "none" } : undefined}
                  >
                    {effectivePart.groups.map((g: any) => (
                      <QuestionGroupView key={g.first} g={g} ctx={groupCtx} />
                    ))}
                  </div>
                </>
              ) : (
                <div ref={rightZoneRef} className="cbt-pane single">
                  {run.mode === "practice" && (
                    <div className="cbt-playerbar" style={{ maxWidth: 680 }}>
                      <button
                        type="button"
                        className="cbt-btn primary"
                        style={{ height: 32, padding: "0 14px", fontSize: 13 }}
                        onClick={() => {
                          const a = reviewAudioRef.current;
                          if (!a) return;
                          if (a.paused) void a.play();
                          else a.pause();
                        }}
                      >
                        {audioPlaying ? "Pause" : "Play"}
                      </button>
                      <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtClock(practiceCurSec)}</span>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(1, Math.floor(practiceDurSec))}
                        value={Math.floor(practiceCurSec)}
                        style={{ flex: 1 }}
                        onChange={(e) => {
                          if (reviewAudioRef.current) reviewAudioRef.current.currentTime = Number(e.target.value);
                        }}
                      />
                      <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtClock(practiceDurSec)}</span>
                      <select
                        value={practiceSpeed}
                        onChange={(e) => {
                          const spd = Number(e.target.value);
                          setPracticeSpeed(spd);
                          if (reviewAudioRef.current) reviewAudioRef.current.playbackRate = spd;
                        }}
                        style={{ padding: "2px 4px", fontSize: 13 }}
                      >
                        {[0.75, 1, 1.25, 1.5].map((s) => (
                          <option key={s} value={s}>{s}×</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {effectivePart.groups.map((g: any) => (
                    <QuestionGroupView key={g.first} g={g} ctx={groupCtx} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>

        {/* Official Inspera Right-Hand Notes & Scratchpad Panel */}
        {!review && notesOpen && (
          <aside className="cbt-notes-drawer" aria-label="Notes">
            <div className="cbt-notes-head">
              <span>Notes</span>
              <button
                type="button"
                aria-label="Close notes"
                style={{ border: 0, background: "none", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
                onClick={closeNotesDrawer}
              >
                ✕
              </button>
            </div>
            <div className="cbt-notes-body">
              {/* Persistent Scratchpad (for Writing outlines / Listening rough notes without needing text selection) */}
              <div className="cbt-scratch-card">
                <div className="cbt-scratch-title">
                  <span>Scratchpad · 草稿区</span>
                  {scratchpadText.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setZoneHighlights(scratchZoneKey, [])}
                      style={{ border: 0, background: "none", fontSize: 11.5, color: "var(--cur)", textDecoration: "underline" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  className="cbt-note-ta"
                  value={scratchpadText}
                  placeholder="Jot down keywords, Listening rough notes, or Writing essay outline here..."
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) setZoneHighlights(scratchZoneKey, []);
                    else setZoneHighlights(scratchZoneKey, [{ id: "__scratch__", s: 0, e: 0, text: "", note: val }]);
                  }}
                />
              </div>

              {/* Text-Anchored Sticky Note Cards */}
              {allNotes.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: "19px", margin: "4px 2px" }}>
                  Select any text in the passage or questions and click <b>Note</b> to pin a contextual note here.
                </p>
              ) : (
                allNotes.map(({ zKey, partIdx, side, item }) => (
                  <div
                    key={item.id}
                    className={`cbt-note-card${item.id === focusNoteId ? " active" : ""}`}
                  >
                    <div className="cbt-note-card-head">
                      <button
                        type="button"
                        className="cbt-note-quote"
                        title="Click to locate in text"
                        onClick={() => jumpToNoteInText(partIdx, side, item.id)}
                      >
                        <b>{skill === "writing" ? `Task ${partIdx + 1}` : `P${partIdx + 1}`}</b> · “{item.text || "…"}”
                      </button>
                      <button
                        type="button"
                        className="cbt-note-del"
                        title="Delete note"
                        onClick={() =>
                          setZoneHighlights(
                            zKey,
                            (localHighlights[zKey] ?? []).filter((x) => x.id !== item.id),
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                    <textarea
                      ref={(el) => {
                        noteInputRefs.current[item.id] = el;
                      }}
                      rows={3}
                      className="cbt-note-ta"
                      value={item.note ?? ""}
                      placeholder="Type your note..."
                      onFocus={() => setFocusNoteId(item.id)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocalHighlights((prev) => {
                          const list = prev[zKey] ?? [];
                          return {
                            ...prev,
                            [zKey]: list.map((x) => (x.id === item.id ? { ...x, note: val } : x)),
                          };
                        });
                        onPatchSkill((d) => {
                          const list = d.highlights[zKey] ?? [];
                          const target = list.find((x) => x.id === item.id);
                          if (target) target.note = val;
                        });
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Review-Only Optional AI Tutor Split (NEVER rendered during exam!) */}
        {review && canShowAgentBtn && agentOpen && (
          <AgentSplit
            side={!isMobile}
            width={agentWidth}
            inset={0}
            onWidth={setAgentWidth}
            enabled={Boolean(agentEnabled)}
            paperThread={agentThread}
            sentence={null}
            onClearSentence={() => {}}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </div>

      {/* ---------- Floating Prev/Next Step Arrows ---------- */}
      <div className="cbt-arrows" style={!review && notesOpen && !isMobile ? { right: 364 } : undefined}>
        <button
          type="button"
          className="cbt-arrow"
          aria-label="Previous question"
          disabled={flatQuestions[0]?.n === effectiveCurQ}
          onClick={() => stepQuestion(-1)}
        >
          ←
        </button>
        <button
          type="button"
          className="cbt-arrow"
          aria-label="Next question"
          disabled={flatQuestions[flatQuestions.length - 1]?.n === effectiveCurQ}
          onClick={() => stepQuestion(1)}
        >
          →
        </button>
      </div>

      {/* ---------- 56px Official Inspera Bottom Navigation Bar ---------- */}
      <nav className="cbt-nav" aria-label="Question navigation">
        {!review && skill !== "writing" && (
          <label className="cbt-review-chk" title="Flag current question for review">
            <input
              type="checkbox"
              checked={Boolean(st.flags[String(effectiveCurQ)])}
              onChange={() => {
                onPatchSkill((d) => {
                  const k = String(effectiveCurQ);
                  if (d.flags[k]) delete d.flags[k];
                  else d.flags[k] = true;
                });
              }}
            />
            {!isMobile && <span>Review</span>}
          </label>
        )}

        {parts.map((p: any, pIdx: number) => {
          const qs = flatQuestions.filter((q) => q.partIdx === pIdx);
          const isCurPart = pIdx === effectiveViewPart;
          const partTitle = skill === "writing" ? `Task ${p.part}` : isMobile ? `P${p.part}` : `Part ${p.part}`;
          if (isCurPart) {
            return (
              <div key={p.part} className="cbt-npart cur">
                <span className="plabel">{partTitle}</span>
                {skill !== "writing" && (
                  <div className="cbt-nums">
                    {qs.map((q) => {
                      const done = isUnitAnswered(q);
                      const isCur = effectiveCurQ >= q.n && effectiveCurQ < q.n + q.count;
                      const isFlagged = Boolean(st.flags[String(q.n)]);
                      const rq = review ? reviewGrade?.[q.n] : undefined;
                      const cls = [
                        "cbt-nb",
                        isCur ? "cur" : "",
                        isFlagged ? "flagged" : "",
                        review && rq ? (rq.ok ? "ok" : rq.partial ? "part" : "bad") : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <button
                          key={q.n}
                          type="button"
                          className={cls}
                          onClick={() => goQuestion(q.n)}
                          aria-label={`Question ${q.label}`}
                        >
                          <i className={`seg${done ? " done" : ""}`} />
                          {q.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const doneCnt = qs.filter((q) => (review ? reviewGrade?.[q.n]?.ok : isUnitAnswered(q))).length;
          return (
            <button
              key={p.part}
              type="button"
              className="cbt-npart"
              onClick={() => {
                if (qs[0]) goQuestion(qs[0].n);
                else focusQ(p.part);
              }}
            >
              <span className="plabel">{partTitle}</span>
              {skill !== "writing" && <span className="cnt">{doneCnt} of {qs.length}</span>}
            </button>
          );
        })}

        <button
          type="button"
          className="cbt-submitbtn"
          aria-label={review ? "Exit review" : "Review and submit"}
          title={review ? "退出复盘" : "检查作答并交卷"}
          onClick={() => (review ? onExit() : setOverlayPage("submit"))}
        >
          {review ? "✕" : "✓"}
        </button>
      </nav>

      {/* ---------- Official Inspera Floating Selection / Highlight Bar ---------- */}
      {floatBar && (
        <div
          className="cbt-floatbar"
          role="toolbar"
          aria-label="Highlight and note actions"
          style={{
            left: floatBar.x,
            top: floatBar.y,
            transform: floatBar.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {floatBar.actions.map((act, idx) => (
            <span key={act.label} style={{ display: "inline-flex", alignItems: "center" }}>
              {idx > 0 && <span className="sep" aria-hidden="true" />}
              <button
                type="button"
                className={act.kind === "danger" ? "danger" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  setFloatBar(null);
                  act.onClick();
                }}
              >
                {act.kind === "hl" && <span className="cbt-hl-swatch" aria-hidden="true" />}
                {act.kind === "note" && <span aria-hidden="true">✎</span>}
                {act.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ---------- Controlled CETPath WordCard (ONLY when allowLookup is true) ---------- */}
      {allowLookup && wordHit && (
        <WordCard
          hit={{ word: wordHit.word, sentence: wordHit.sentence, rect: wordHit.rect } satisfies WordClick}
          ctx={{ tokens: wordHit.tokens, at: wordHit.tokenIndex }}
          anchor={() => ({ word: wordHit.rect, avoid: wordHit.rect })}
          bounds={() => new DOMRect(0, 56, window.innerWidth, window.innerHeight - 112)}
          source={{ paperId: `ielts:${run.paperId}`, paperTitle: run.paperTitle }}
          trans={lookupTrans}
          onLookedUp={() => void bumpDay({ lookups: 1 })}
          onClose={() => setWordHit(null)}
        />
      )}

      {/* ---------- Image Zoom Lightbox ---------- */}
      {zoomSrc && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}
          onClick={() => setZoomSrc(null)}
        >
          <img src={zoomSrc} alt="Zoomed diagram" referrerPolicy="no-referrer" style={{ maxWidth: "95vw", maxHeight: "92vh", background: "#fff", padding: 8, borderRadius: 4 }} />
        </div>
      )}

      {/* ---------- Pre-Test Official Ritual Screens (Mock Mode) ---------- */}
      {!review && run.mode === "mock" && st.status === "intro" && (
        <div className="cbt-overlay">
          {!confirmedDetails ? (
            <div className="cbt-card-modal">
              <h1>Confirm your details</h1>
              <div style={{ border: "1px solid var(--line)", padding: "18px 22px", borderRadius: 4, margin: "16px 0 22px", background: "var(--surface)" }}>
                <p style={{ margin: "0 0 10px" }}><b>Name:</b> {run.candidateName || settings.ieltsCandidateName || "Test Taker"}</p>
                <p style={{ margin: "0 0 10px" }}><b>Candidate number:</b> 008419</p>
                <p style={{ margin: 0 }}><b>Test module:</b> {run.exam === "ielts-gt" ? "General Training" : "Academic"}</p>
              </div>
              <p style={{ color: "var(--muted)", marginBottom: 24 }}>
                If your details are not correct, you can customize your display name in Settings later.
              </p>
              <button type="button" className="cbt-btn primary" onClick={() => setConfirmedDetails(true)}>
                My details are correct
              </button>
            </div>
          ) : skill === "listening" && !soundTested ? (
            <div className="cbt-card-modal">
              <h1>Test sound</h1>
              <p>Put on your headphones and click on the <b>Play sound</b> button to play a sample sound.</p>
              <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "20px 0" }}>
                <button type="button" className="cbt-btn" onClick={() => playSampleTone(volume)}>
                  ▶ Play sound
                </button>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  Volume
                  <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
                </label>
              </div>
              <div style={{ padding: "10px 14px", borderRadius: 4, border: "1px solid var(--line)", background: "var(--surface)", marginBottom: 22, fontSize: 14 }}>
                {audioPreflight === "checking" && <span>正在预检本套听力音频连通性…</span>}
                {audioPreflight === "ok" && <span style={{ color: "var(--ok)", fontWeight: 700 }}>✓ 本套听力录音预检通过，可随时开考</span>}
                {audioPreflight === "err" && (
                  <span style={{ color: "var(--bad)", fontWeight: 700 }}>
                    ✗ 暂未连通音频源，请检查网络后{" "}
                    <button type="button" onClick={runAudioPreflight} style={{ textDecoration: "underline", border: 0, background: "none", fontWeight: 700 }}>
                      重新预检
                    </button>
                  </span>
                )}
              </div>
              <p style={{ color: "var(--muted)", marginBottom: 24 }}>
                If you can hear the sample sound clearly, click <b>Continue</b>.
              </p>
              <button type="button" className="cbt-btn primary" onClick={() => setSoundTested(true)}>
                Continue
              </button>
            </div>
          ) : (
            <div className="cbt-card-modal">
              <h1>IELTS {IELTS_SKILLS_EN[skill]}</h1>
              <p style={{ fontWeight: 700, marginBottom: 20 }}>
                Time: {skill === "listening" ? "Approximately 30 minutes (+ 2 minutes check time)" : st.limit ? `${Math.round(st.limit / 60)} minutes` : "1 hour"}
              </p>
              <h2>Instructions to candidates</h2>
              <ul style={{ paddingLeft: 20, margin: "0 0 18px" }}>
                <li>Answer all the questions.</li>
                <li>You can change your answers at any time during the test.</li>
                {skill === "listening" && <li>Each part of the test will be heard ONCE only. You will not be permitted to pause or rewind.</li>}
                {skill !== "listening" && <li>The test ends automatically when the time is up.</li>}
              </ul>
              <h2>Information for candidates</h2>
              <ul style={{ paddingLeft: 20, margin: "0 0 24px" }}>
                {skill !== "writing" ? (
                  <>
                    <li>There are {flatQuestions.reduce((s, q) => s + q.count, 0)} questions in this test.</li>
                    <li>Each question carries one mark.</li>
                    <li>Select text and right-click to highlight or add private notes.</li>
                  </>
                ) : (
                  <>
                    <li>There {parts.length > 1 ? "are two parts" : "is one task"} in this test.</li>
                    {parts.length > 1 && <li>Task 2 contributes twice as much as Task 1 to the Writing score.</li>}
                  </>
                )}
              </ul>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  className="cbt-btn primary"
                  onClick={() => {
                    onPatchSkill((d) => {
                      d.status = "active";
                      if (d.limit != null) d.deadlineAt = Date.now() + (d.limit - d.elapsed) * 1000;
                    });
                    if (skill === "listening") {
                      startOrResumeExamAudio(st.audioPart ?? 0, st.audioSec ?? 0);
                    }
                  }}
                >
                  Start test
                </button>
                <button type="button" className="cbt-btn" onClick={onExit}>
                  Save and exit
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Overlays: Options / Help / Hide / Submission ---------- */}
      {overlayPage !== "none" && (
        <div className="cbt-overlay">
          {overlayPage === "hide" && (
            <div className="cbt-card-modal" style={{ textAlign: "center", paddingTop: 60 }}>
              <h1>Your screen is hidden</h1>
              <p style={{ color: "var(--muted)", marginBottom: 24 }}>Your answers are safely stored. Note that in timed mode the test clock continues to run.</p>
              <button type="button" className="cbt-btn primary" onClick={() => setOverlayPage("none")}>
                Resume test
              </button>
            </div>
          )}

          {overlayPage === "help" && (
            <div className="cbt-card-modal">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h1 style={{ margin: 0 }}>Help</h1>
                <button type="button" className="cbt-btn" onClick={() => setOverlayPage("none")}>Close</button>
              </div>
              <h2>Test controls</h2>
              <ul style={{ paddingLeft: 20 }}>
                <li><b>Highlight / Note:</b> Drag to select any words in the passage or questions — a floating bar pops up automatically to <b>Highlight</b> or add a <b>Note</b> (right-click also works).</li>
                <li><b>Clear highlight:</b> Simply click (or right-click) any highlighted text and choose <b>Clear</b>, or select a portion of highlighted text and click <b>Clear</b> to erase just that span.</li>
                <li><b>Scratchpad:</b> Open <b>Notes</b> in the top-right corner anytime to jot down Listening rough notes or a Writing outline.</li>
                <li><b>Review checkbox:</b> Tick <b>Review</b> at the bottom-left to turn a question number circular as a reminder to check it before submitting.</li>
                <li><b>Resize panes:</b> Drag the central vertical divider left or right.</li>
                <li><b>Contrast & Text size:</b> Open <b>Options</b> in the top-right corner to switch high-contrast themes or enlarge text.</li>
              </ul>
            </div>
          )}

          {overlayPage === "options" && (
            <div className="cbt-card-modal">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <h1 style={{ margin: 0 }}>Options</h1>
                <button type="button" className="cbt-btn" onClick={() => setOverlayPage("none")}>Close</button>
              </div>
              {!review && (
                <div style={{ marginBottom: 20 }}>
                  <button type="button" className="cbt-btn primary" style={{ width: "100%" }} onClick={() => setOverlayPage("submit")}>
                    Go to submission page ›
                  </button>
                </div>
              )}
              <h2>Contrast</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                {THEMES.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`cbt-btn${theme === k ? " primary" : ""}`}
                    onClick={() => {
                      setTheme(k);
                      localStorage.setItem("ielts-cbt-theme", k);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <h2>Text size</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
                {SIZES.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`cbt-btn${size === k ? " primary" : ""}`}
                    onClick={() => {
                      setSize(k);
                      localStorage.setItem("ielts-cbt-size", k);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="cbt-btn" onClick={onExit}>
                {review ? "Exit review" : "Save and exit"}
              </button>
            </div>
          )}

          {overlayPage === "submit" && !review && (
            <div className="cbt-card-modal">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h1 style={{ margin: 0 }}>Review and Submit</h1>
                <button type="button" className="cbt-btn" onClick={() => setOverlayPage("none")}>Back to test</button>
              </div>
              <p style={{ fontSize: 17, marginBottom: 18 }}>
                {skill === "writing"
                  ? `You have written ${flatQuestions.filter(isUnitAnswered).length} of ${flatQuestions.length} tasks.`
                  : `You have answered ${flatQuestions.filter(isUnitAnswered).reduce((s, q) => s + q.count, 0)} of ${flatQuestions.reduce((s, q) => s + q.count, 0)} questions.`}
              </p>
              {skill !== "writing" &&
                parts.map((p: any, pIdx: number) => {
                  const qs = flatQuestions.filter((q) => q.partIdx === pIdx);
                  return (
                    <div key={p.part} style={{ marginBottom: 14 }}>
                      <b>Part {p.part}</b>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {qs.map((q) => {
                          const done = isUnitAnswered(q);
                          const flagged = Boolean(st.flags[String(q.n)]);
                          return (
                            <button
                              key={q.n}
                              type="button"
                              onClick={() => {
                                setOverlayPage("none");
                                goQuestion(q.n);
                              }}
                              style={{
                                minWidth: 36,
                                height: 34,
                                padding: "0 8px",
                                border: "1.5px solid var(--line)",
                                borderRadius: flagged ? 999 : 3,
                                background: done ? "var(--done)" : "transparent",
                                color: done ? "#fff" : "var(--fg)",
                                fontWeight: 700,
                              }}
                            >
                              {q.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
                <button type="button" className="cbt-btn" onClick={() => setOverlayPage("none")}>
                  Back to test
                </button>
                <button type="button" className="cbt-btn primary" onClick={() => setConfirmSubmitOpen(true)}>
                  {nextMockSkill ? `Submit & continue to ${IELTS_SKILLS_EN[nextMockSkill]}` : "Submit test"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Confirm Submit Dialog ---------- */}
      {confirmSubmitOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--line)", maxWidth: 440, width: "100%", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", padding: 24, borderRadius: 4 }}>
            <p style={{ marginTop: 0, marginBottom: 18, fontWeight: 700 }}>
              Are you sure you want to submit your {IELTS_SKILLS_EN[skill]} answers? You will not be able to change them.
              {nextMockSkill ? ` The ${IELTS_SKILLS_EN[nextMockSkill]} test will begin immediately.` : ""}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button type="button" className="cbt-btn" onClick={() => setConfirmSubmitOpen(false)}>No</button>
              <button
                type="button"
                className="cbt-btn primary"
                onClick={() => {
                  setConfirmSubmitOpen(false);
                  setOverlayPage("none");
                  if (examAudioRef.current) examAudioRef.current.pause();
                  void onSubmitSkill("manual");
                }}
              >
                Yes, submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
