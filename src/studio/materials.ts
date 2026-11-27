import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { touchAudio } from "@/lib/audioCache";
import {
  findAudioLine,
  loadPaper,
  type AudioLine,
  type Paper,
  type PaperIndexItem,
  type Question,
} from "@/lib/papers";
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

/** 聚合错题本中所有做错过的听力题所属试卷（未掌握优先） */
export function useWrongAudioTargets(index: PaperIndexItem[] | null): WrongAudioTarget[] {
  const rows = useLiveQuery(
    () => db.mastery.where("kind").equals("listening").toArray().catch(() => []),
    [],
  );

  return useMemo(() => {
    if (!index || !rows?.length) return [];
    const ownIds = new Set(index.filter(isOwnAudioPaper).map((p) => p.id));
    const map = new Map<string, { qids: Set<string>; qNums: Set<number>; unretired: number; latest: number }>();

    for (const row of rows) {
      const targetPaperId = canonicalAudioPaperId(row.paperId, index);
      if (!ownIds.has(targetPaperId)) continue;
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
  }, [index, rows]);
}

const packCache = new Map<string, Promise<StudioPack>>();

export function loadStudioPack(paperId: string): Promise<StudioPack> {
  const cached = packCache.get(paperId);
  if (cached) return cached;

  const p = (async (): Promise<StudioPack> => {
    const [paperRaw, trans] = await Promise.all([loadPaper(paperId), loadTrans(paperId)]);
    const sharedFrom = (paperRaw as SharedPaper).shared?.find((x) => x.section === "listening")?.from;
    const paper = sharedFrom && sharedFrom !== paperId ? await loadPaper(sharedFrom) : paperRaw;

    if (paper.audio?.src) {
      touchAudio(paper.audio.src);
    }

    const listeningSections = paper.sections.filter((s) => s.kind === "listening");
    const groups = listeningSections.flatMap((s) => s.groups);
    const audioSegs = paper.audio?.segments ?? [];

    // 记录每段包含的题目和考点句指向
    const lineQMap = new Map<string, number[]>(); // `${segId}:${lineIndex}` -> [qNumbers]
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

  p.catch(() => packCache.delete(paperId));
  packCache.set(paperId, p);
  return p;
}
