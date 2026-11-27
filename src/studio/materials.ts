import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ieltsPaperLabel, loadIeltsExplain, loadIeltsPaper, useIeltsIndex } from "@/ielts/data";
import type { IeltsIndexEntry, IeltsMasteryRow } from "@/ielts/types";
import { db, type MasteryRow } from "@/lib/db";
import { touchAudio } from "@/lib/audioCache";
import { usePaperIndex } from "@/lib/insights";
import {
  findAudioLine,
  isIeltsExam,
  loadPaper,
  type AudioLine,
  type ExamId,
  type Paper,
  type PaperIndexItem,
  type Question,
} from "@/lib/papers";
import { normalizeTargetExam } from "@/lib/targetExam";
import { findTrans, loadTrans, type TransFile } from "@/lib/trans";

type RawAudioLine = AudioLine & { kind?: string };
type SharedPaper = Paper & { shared?: { section: string; from: string }[] };

const QUESTION_RE = /^Question\s*\d+\b/i;
const CUE_RE = /^Questions?\s*\d+\s*(?:and|to|-)\s*\d+\s*(?:are\s*)?based\s*on/i;
const SPEAKER_PREFIX_RE = /^\s*(?:M|W|Man|Woman)\s*[:：]\s*/;
const STAGE_NAME_RE = /^[A-Z]{2,15}[.!]?$/;

export function lineKind(l: RawAudioLine): "directions" | "cue" | "question" | "lead" | undefined {
  if (l.kind === "directions" || l.kind === "cue" || l.kind === "question" || l.kind === "lead") {
    return l.kind;
  }
  if (QUESTION_RE.test(l.text)) return "question";
  if (CUE_RE.test(l.text)) return "cue";
  return undefined;
}

const NUMS: Record<string, string> = { One: "1", Two: "2", Three: "3", Four: "4", Five: "5" };

export function shortSegmentLabel(label: string): string {
  return label
    .replace("News Report", "News")
    .replace("Conversation", "Conv")
    .replace("Passage", "Pass")
    .replace("Recording", "Rec")
    .replace(/ (One|Two|Three|Four|Five)$/, (_, n: string) => ` ${NUMS[n]}`);
}

export interface StudioLine {
  index: number;
  text: string;
  start: number;
  end: number;
  /** 加过呼吸垫片与前后邻句防串音约束的播放起止时间 */
  playStart: number;
  playEnd: number;
  speaker?: string;
  zh: string | null;
  qNumbers: number[];
}

export interface StudioSignalItem {
  q: Question;
  number: number;
  segId: string;
  lineIndex: number;
  targetLine: StudioLine;
  prevLine?: StudioLine;
  groupTitle?: string;
}

export interface StudioSegment {
  id: string;
  label: string;
  shortLabel: string;
  audioSrc: string;
  start: number;
  end: number;
  lines: StudioLine[];
  hasDialogue: boolean;
  speakers: string[];
  speakerReliable: boolean;
  questions: Question[];
  signalItems: StudioSignalItem[];
}

export interface StudioPack {
  paper: Paper;
  trans: TransFile | null;
  segments: StudioSegment[];
  allSignalItems: StudioSignalItem[];
}

export interface WrongAudioTarget {
  paperId: string;
  qids: string[];
  qNumbers: number[];
  unretiredCount: number;
  partNumbers?: number[];
}

export interface ListeningCatalogItem {
  id: string;
  title: string;
  groupLabel: string;
  subLabel?: string;
  segments: { id: string; label: string }[];
  paper?: PaperIndexItem;
  ieltsEntry?: IeltsIndexEntry;
}

/** 目录里自身带独立录音、非第3套拼装听力的试卷 */
export function isOwnAudioPaper(item: PaperIndexItem): boolean {
  if (!item.hasAudio) return false;
  return item.sections.some((s) => s.kind === "listening" && !s.from);
}

/** 如果某套卷的听力是从同场另一套共享过来的，映射到原音频卷 id */
export function canonicalAudioPaperId(paperId: string, index: PaperIndexItem[]): string {
  const item = index.find((p) => p.id === paperId);
  const listening = item?.sections.find((s) => s.kind === "listening");
  return listening?.from ?? paperId;
}

/** 聚合错题本中当前唯一备考目标下的听力错题（未掌握优先） */
export function useWrongAudioTargets(
  index: PaperIndexItem[] | null,
  targetExam: ExamId,
): WrongAudioTarget[] {
  const ieltsMode = isIeltsExam(targetExam);
  const cetRows = useLiveQuery<MasteryRow[]>(
    () =>
      ieltsMode
        ? Promise.resolve<MasteryRow[]>([])
        : db.mastery.where("kind").equals("listening").toArray().catch(() => []),
    [ieltsMode],
  );
  const ieltsRows = useLiveQuery<IeltsMasteryRow[]>(
    () =>
      ieltsMode
        ? db.ieltsMastery.where("skill").equals("listening").toArray().catch(() => [])
        : Promise.resolve<IeltsMasteryRow[]>([]),
    [ieltsMode],
  );

  return useMemo(() => {
    if (ieltsMode) {
      if (!ieltsRows?.length) return [];
      const map = new Map<
        string,
        { qids: Set<string>; qNums: Set<number>; parts: Set<number>; unretired: number; latest: number }
      >();
      for (const r of ieltsRows) {
        if (r.exam !== targetExam) continue;
        let cur = map.get(r.paperId);
        if (!cur) {
          cur = { qids: new Set(), qNums: new Set(), parts: new Set(), unretired: 0, latest: 0 };
          map.set(r.paperId, cur);
        }
        cur.qids.add(r.unitKey);
        cur.qNums.add(r.first);
        cur.parts.add(r.part);
        if (!r.retiredAt) cur.unretired++;
        if (r.updatedAt > cur.latest) cur.latest = r.updatedAt;
      }
      return [...map.entries()]
        .map(([paperId, info]) => ({
          paperId,
          qids: [...info.qids],
          qNumbers: [...info.qNums].sort((a, b) => a - b),
          partNumbers: [...info.parts].sort((a, b) => a - b),
          unretiredCount: info.unretired,
          latest: info.latest,
        }))
        .sort((a, b) => (b.unretiredCount > 0 ? 1 : 0) - (a.unretiredCount > 0 ? 1 : 0) || b.latest - a.latest)
        .map(({ paperId, qids, qNumbers, partNumbers, unretiredCount }) => ({
          paperId,
          qids,
          qNumbers,
          partNumbers,
          unretiredCount,
        }));
    }

    if (!index || !cetRows?.length) return [];
    const ownMap = new Map(
      index.filter((p) => isOwnAudioPaper(p) && normalizeTargetExam(p.exam) === targetExam).map((p) => [p.id, p]),
    );
    const map = new Map<string, { qids: Set<string>; qNums: Set<number>; unretired: number; latest: number }>();

    for (const row of cetRows) {
      const targetPaperId = canonicalAudioPaperId(row.paperId, index);
      if (!ownMap.has(targetPaperId)) continue;
      let cur = map.get(targetPaperId);
      if (!cur) {
        cur = { qids: new Set(), qNums: new Set(), unretired: 0, latest: 0 };
        map.set(targetPaperId, cur);
      }
      cur.qids.add(row.questionId);
      const qnMatch = row.questionId.match(/^q(\d+)$/i);
      if (qnMatch) cur.qNums.add(Number(qnMatch[1]));
      if (!row.retiredAt) cur.unretired++;
      const lastAt = row.history.at(-1)?.at ?? row.firstWrongAt;
      if (lastAt > cur.latest) cur.latest = lastAt;
    }

    return [...map.entries()]
      .map(([paperId, info]) => ({
        paperId,
        qids: [...info.qids],
        qNumbers: [...info.qNums].sort((a, b) => a - b),
        unretiredCount: info.unretired,
        latest: info.latest,
      }))
      .sort((a, b) => (b.unretiredCount > 0 ? 1 : 0) - (a.unretiredCount > 0 ? 1 : 0) || b.latest - a.latest)
      .map(({ paperId, qids, qNumbers, unretiredCount }) => ({
        paperId,
        qids,
        qNumbers,
        unretiredCount,
      }));
  }, [ieltsMode, ieltsRows, cetRows, index, targetExam]);
}

export function useListeningCatalog(targetExam: ExamId) {
  const ieltsMode = isIeltsExam(targetExam);
  const { index: paperIndex, error: paperErr } = usePaperIndex();
  const { index: ieltsIndex, error: ieltsErr } = useIeltsIndex();

  const catalog = useMemo<ListeningCatalogItem[]>(() => {
    if (ieltsMode) {
      return (ieltsIndex?.papers ?? [])
        .filter((p) => p.exam === targetExam && p.skills.includes("listening"))
        .map((e) => ({
          id: e.id,
          title: ieltsPaperLabel(e),
          groupLabel:
            e.family === "cam" && e.book
              ? `剑桥雅思真题 ${e.book}（A类）`
              : e.family === "gt" && e.book
                ? `剑桥雅思真题 ${e.book}（G类）`
                : e.family === "jj"
                  ? e.group || "机经 Pro 套题"
                  : "雅思红皮密卷",
          subLabel: `${e.q.listening ?? 40} 题 · 4 个听力 Part`,
          segments: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, label: `Part ${n}` })),
          ieltsEntry: e,
        }));
    }

    return (paperIndex ?? [])
      .filter((p) => isOwnAudioPaper(p) && normalizeTargetExam(p.exam) === targetExam)
      .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0) || (a.set ?? 0) - (b.set ?? 0))
      .map((p) => ({
        id: p.id,
        title: p.title,
        groupLabel: `${p.year} 年`,
        subLabel: p.month ? `${p.month}月${p.set ? ` 第${p.set}套` : ""}` : undefined,
        segments: [],
        paper: p,
      }));
  }, [ieltsMode, ieltsIndex, paperIndex, targetExam]);

  const loading = ieltsMode ? !ieltsIndex && !ieltsErr : !paperIndex && !paperErr;
  const error = ieltsMode ? ieltsErr : paperErr;
  return { catalog, loading, error, paperIndex, ieltsIndex };
}

const packCache = new Map<string, Promise<StudioPack>>();

export function loadStudioPack(paperId: string): Promise<StudioPack> {
  const cacheKey = `cet:${paperId}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const p = (async (): Promise<StudioPack> => {
    const [paperRaw, trans] = await Promise.all([loadPaper(paperId), loadTrans(paperId)]);
    const sharedFrom = (paperRaw as SharedPaper).shared?.find((x) => x.section === "listening")?.from;
    const paper = sharedFrom && sharedFrom !== paperId ? await loadPaper(sharedFrom) : paperRaw;
    const audioSrc = paper.audio?.src ?? "";

    if (audioSrc) {
      touchAudio(audioSrc);
    }

    const listeningSections = paper.sections.filter((s) => s.kind === "listening");
    const groups = listeningSections.flatMap((s) => s.groups);
    const audioSegs = paper.audio?.segments ?? [];

    const lineQMap = new Map<string, number[]>();
    const allSignalRaw: {
      q: Question;
      segId: string;
      lineIndex: number;
      groupTitle?: string;
    }[] = [];

    for (const g of groups) {
      for (const q of g.questions) {
        if (!q.options?.length) continue;
        let loc = q.explain?.locate?.line;
        if (!loc && q.explain?.locate?.quote && paper.audio) {
          loc = findAudioLine(paper.audio, q.explain.locate.quote, g.audioSegment) ?? undefined;
        }
        if (loc) {
          const k = `${loc.segment}:${loc.index}`;
          lineQMap.set(k, [...(lineQMap.get(k) ?? []), q.number]);
          allSignalRaw.push({
            q,
            segId: loc.segment,
            lineIndex: loc.index,
            groupTitle: g.title,
          });
        }
      }
    }

    const segments: StudioSegment[] = audioSegs.map((seg) => {
      const segGroups = groups.filter((g) => g.audioSegment === seg.id);
      const segQuestions = segGroups.flatMap((g) => g.questions.filter((q) => q.options?.length));

      const rawLines: {
        index: number;
        text: string;
        start: number;
        end: number;
        speaker?: string;
        zh: string | null;
        qNumbers: number[];
      }[] = [];
      (seg.lines as RawAudioLine[]).forEach((ln, idx) => {
        if (lineKind(ln)) return;
        const rawText = ln.text.trim();
        const text = ln.speaker ? rawText.replace(SPEAKER_PREFIX_RE, "").trim() : rawText;
        if (!text) return;
        const compact = text.replace(/["'“”‘’(),;:?\s]/g, "");
        if (STAGE_NAME_RE.test(compact) && ln.end - ln.start <= 0.25) return;
        const qNumbers = lineQMap.get(`${seg.id}:${idx}`) ?? [];
        rawLines.push({
          index: idx,
          text,
          start: ln.start,
          end: ln.end,
          speaker: ln.speaker,
          zh: findTrans(trans, rawText) ?? findTrans(trans, text),
          qNumbers,
        });
      });

      const lines: StudioLine[] = rawLines.map((cur, pos) => {
        const prevEnd = pos > 0 ? Math.min(cur.start, rawLines[pos - 1].end) : Math.max(0, seg.start);
        const nextStart =
          pos < rawLines.length - 1 ? Math.max(cur.end, rawLines[pos + 1].start) : seg.end;
        const playStart = Math.max(0, Math.max(prevEnd, cur.start - 0.08));
        const playEnd = Math.max(
          playStart + 0.55,
          Math.min(nextStart, Math.max(cur.end + 0.2, cur.start + 0.65)),
        );
        return {
          ...cur,
          playStart,
          playEnd,
        };
      });

      const lineByIdx = new Map(lines.map((l, pos) => [l.index, { l, pos }]));
      const signalItems: StudioSignalItem[] = [];
      for (const item of allSignalRaw) {
        if (item.segId !== seg.id) continue;
        const hit = lineByIdx.get(item.lineIndex);
        if (!hit) continue;
        signalItems.push({
          q: item.q,
          number: item.q.number,
          segId: seg.id,
          lineIndex: item.lineIndex,
          targetLine: hit.l,
          prevLine: hit.pos > 0 ? lines[hit.pos - 1] : undefined,
          groupTitle: item.groupTitle,
        });
      }
      signalItems.sort((a, b) => a.number - b.number);

      const speakers = [...new Set(lines.map((l) => l.speaker).filter((x): x is string => !!x))];
      const hasDialogue = speakers.includes("M") && speakers.includes("W");
      const contentStart = lines[0]?.playStart ?? lines[0]?.start ?? seg.start;
      const contentEnd = lines.at(-1)?.playEnd ?? lines.at(-1)?.end ?? seg.end;

      return {
        id: seg.id,
        label: seg.label,
        shortLabel: shortSegmentLabel(seg.label),
        audioSrc,
        start: contentStart,
        end: contentEnd,
        lines,
        hasDialogue,
        speakers,
        speakerReliable: seg.speakerSource !== "pitch",
        questions: segQuestions,
        signalItems,
      };
    });

    const allSignalItems = segments.flatMap((s) => s.signalItems).sort((a, b) => a.number - b.number);
    return { paper, trans, segments, allSignalItems };
  })();

  p.catch(() => packCache.delete(cacheKey));
  packCache.set(cacheKey, p);
  return p;
}

export function loadIeltsStudioPack(paperId: string, exam: ExamId): Promise<StudioPack> {
  const cacheKey = `ielts:${paperId}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const p = (async (): Promise<StudioPack> => {
    const [ieltsPaper, explain] = await Promise.all([loadIeltsPaper(paperId), loadIeltsExplain(paperId)]);
    const parts = ieltsPaper.listening ?? [];

    const segments: StudioSegment[] = [];
    for (const lp of parts) {
      const exPart = explain.listening?.find((x) => x.part === lp.part);
      const transcript = exPart?.transcript ?? [];
      if (!transcript.length || !lp.audioUrl) continue;

      const partEndFallback = lp.seconds && lp.seconds > 0 ? lp.seconds : transcript[transcript.length - 1].s / 1000 + 8;

      // 从 source 提取答案对应句（轻量精确子串匹配）
      const qByLineIdx = new Map<number, number[]>();
      const sourceEntries = Object.entries(exPart?.source ?? {});
      if (sourceEntries.length) {
        const lowerLines = transcript.map((tr) => tr.t.toLowerCase());
        for (const [qStr, quotes] of sourceEntries) {
          const qn = Number(qStr);
          if (!Number.isFinite(qn)) continue;
          for (const qText of quotes) {
            const norm = qText.trim().replace(/\s+/g, " ").toLowerCase();
            if (norm.length < 12) continue;
            const snippet = norm.slice(0, Math.min(36, norm.length));
            const idx = lowerLines.findIndex((lt) => lt.includes(snippet));
            if (idx >= 0) {
              const arr = qByLineIdx.get(idx) ?? [];
              if (!arr.includes(qn)) arr.push(qn);
              qByLineIdx.set(idx, arr);
            }
          }
        }
      }

      const lines: StudioLine[] = [];
      for (let i = 0; i < transcript.length; i++) {
        const tr = transcript[i];
        const text = tr.t.trim().replace(/\s+/g, " ");
        if (!text) continue;
        const start = Math.max(0, tr.s / 1000);
        const words = Math.max(1, text.split(/\s+/).length);
        const maxSpeech = Math.max(2.6, Math.min(18, words * 0.48 + 1.2));
        const nextStart = i < transcript.length - 1 ? Math.max(start + 0.6, transcript[i + 1].s / 1000) : partEndFallback;
        const end = Math.min(nextStart, start + maxSpeech);
        const playStart = Math.max(0, start - 0.08);
        const playEnd = Math.max(playStart + 0.8, Math.min(nextStart, end + 0.15));

        lines.push({
          index: i,
          text,
          start,
          end,
          playStart,
          playEnd,
          zh: null,
          qNumbers: qByLineIdx.get(i) ?? [],
        });
      }

      const questions: Question[] = [];
      for (const grp of lp.groups) {
        for (let n = grp.first; n <= grp.last; n++) {
          questions.push({ id: `q${n}`, number: n });
        }
      }

      segments.push({
        id: `p${lp.part}`,
        label: `Listening Part ${lp.part}`,
        shortLabel: `Part ${lp.part}`,
        audioSrc: lp.audioUrl,
        start: lines[0]?.playStart ?? 0,
        end: lines.at(-1)?.playEnd ?? partEndFallback,
        lines,
        hasDialogue: false,
        speakers: [],
        speakerReliable: false,
        questions,
        signalItems: [],
      });
    }

    const syntheticPaper: Paper = {
      id: ieltsPaper.id,
      exam,
      year: 0,
      title: ieltsPaper.title,
      pdf: { src: "", words: "" },
      sections: [],
    };

    return {
      paper: syntheticPaper,
      trans: null,
      segments,
      allSignalItems: [],
    };
  })();

  p.catch(() => packCache.delete(cacheKey));
  packCache.set(cacheKey, p);
  return p;
}

export function loadListeningPack(exam: ExamId, paperId: string): Promise<StudioPack> {
  return isIeltsExam(exam) ? loadIeltsStudioPack(paperId, exam) : loadStudioPack(paperId);
}
