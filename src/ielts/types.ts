export type IeltsSkill = "listening" | "reading" | "writing";
export type IeltsFamily = "cam" | "gt" | "jj" | "rb" | "wj";
export type IeltsExamId = "ielts-a" | "ielts-gt";
export type IeltsMatchView = "table" | "headings" | "drag";
export type IeltsRunScope = "full" | IeltsSkill;
export type IeltsRunMode = "mock" | "practice";

export interface IeltsHitInfo {
  date?: string;
  label?: string;
  place?: string;
}

export interface IeltsIndexEntry {
  id: string;
  family: Exclude<IeltsFamily, "wj">;
  exam: IeltsExamId;
  title: string;
  book?: number;
  name?: string | number;
  group?: string;
  hit?: IeltsHitInfo;
  listeningRef?: string;
  skills: IeltsSkill[];
  fullMock: boolean;
  q: Partial<Record<IeltsSkill, number>>;
}

export interface IeltsIndex {
  version: number;
  papers: IeltsIndexEntry[];
  writingJj: number;
  speakingTopics: number;
}

// ---------- Paper (pure exam payload — NO answers / transcripts / explanations) ----------
interface IeltsGroupBase {
  first: number;
  last: number;
  instr: string;
  questionsImg?: string;
  optionsImg?: string;
}

export interface IeltsFillGroup extends IeltsGroupBase {
  type: "fill";
  body: string;
  blanks: Record<string, number>;
}

export interface IeltsChoiceItem {
  n: number;
  text: string;
  options: string[];
}

export interface IeltsSingleGroup extends IeltsGroupBase {
  type: "single" | "tfng";
  items: IeltsChoiceItem[];
}

export interface IeltsMultiItem {
  n: number;
  count: number;
  text: string;
  options: string[];
}

export interface IeltsMultiGroup extends IeltsGroupBase {
  type: "multi";
  items: IeltsMultiItem[];
}

export interface IeltsMatchOption {
  k: string;
  t: string;
}

export interface IeltsMatchRow {
  n: number;
  para?: string;
  text: string;
}

export interface IeltsMatchGroup extends IeltsGroupBase {
  type: "match";
  view: IeltsMatchView;
  reuse: boolean;
  options: IeltsMatchOption[];
  optionsTitle?: string;
  rows?: IeltsMatchRow[];
  body: string;
}

export type IeltsPaperGroup = IeltsFillGroup | IeltsSingleGroup | IeltsMultiGroup | IeltsMatchGroup;

export interface IeltsListeningPart {
  part: number;
  title: string;
  audioUrl: string;
  seconds?: number;
  groups: IeltsPaperGroup[];
}

export interface IeltsReadingPart {
  part: number;
  title: string;
  html: string;
  groups: IeltsPaperGroup[];
}

export interface IeltsWritingPart {
  part: number;
  title: string;
  html: string;
}

export interface IeltsPaper {
  id: string;
  family: IeltsFamily;
  exam: IeltsExamId;
  title: string;
  hit?: IeltsHitInfo;
  listeningRef?: string;
  listening?: IeltsListeningPart[];
  reading?: IeltsReadingPart[];
  writing?: IeltsWritingPart[];
}

// ---------- Key (lightweight offline grading keys) ----------
export type FillAnswerRule =
  | { k: number; mode: "per"; per: string[][] }
  | { k: number; mode: "tuple"; tuples: string[][] };

export type IeltsKeyAnswer =
  | FillAnswerRule
  | { i: number }
  | { set: number[]; first: number; count: number };

export interface IeltsKeyGroup {
  type: "fill" | "single" | "multi" | "tfng" | "match";
  first: number;
  last: number;
  answers: Record<string, IeltsKeyAnswer>;
}

export interface IeltsKey {
  id: string;
  version: number;
  listeningRef?: string;
  listening?: { part: number; groups: IeltsKeyGroup[] }[];
  reading?: { part: number; groups: IeltsKeyGroup[] }[];
}

// ---------- Explain (post-submit review pack) ----------
export interface IeltsTranscriptLine {
  s: number; // milliseconds
  t: string;
}

export interface IeltsExplain {
  id: string;
  listeningRef?: string;
  listening?: {
    part: number;
    transcript: IeltsTranscriptLine[];
    explain: Record<string, string>;
    source: Record<string, string[]>;
  }[];
  reading?: {
    part: number;
    explain: Record<string, string>;
    source: Record<string, string[]>;
  }[];
  writing?: {
    part: number;
    sample: string;
  }[];
}

// ---------- Writing JJ & Speaking ----------
export interface WritingJjItem {
  id: string;
  title: string;
  part: 1 | 2;
  topic: string;
  html: string;
  hitCount: number;
  lastHit?: string | null;
  inPaper?: string | null;
}

export interface SpeakingAudioRef {
  accent: string;
  src: string;
}

export interface SpeakingQuestion {
  id: string;
  part: 1 | 2 | 3;
  question: string;
  hint?: string;
  answer?: string;
  examiner: SpeakingAudioRef[];
  model?: string;
}

export interface SpeakingTopic {
  id: string;
  name: string;
  kind: "part1" | "part2";
  period?: string;
  category?: string;
  questions: SpeakingQuestion[];
}

export interface SpeakingData {
  meta: {
    counts: { part1: number; part2: number; part3: number };
    topics: number;
  };
  topics: SpeakingTopic[];
}

// ---------- Dexie Stored Rows ----------
export type IeltsAnswerValue = string | string[] | number | number[];

export interface IeltsHighlight {
  id: string;
  s: number;
  e: number;
  text: string;
  note?: string;
}

export interface IeltsSectionResult {
  raw?: number;
  total?: number;
  band?: number | null;
  words?: Record<string, number>;
  reason: "manual" | "timeup";
  elapsed: number;
}

export interface IeltsSkillState {
  status: "pending" | "intro" | "soundcheck" | "active" | "submitted";
  answers: Record<string, IeltsAnswerValue>;
  essays: Record<string, string>;
  flags: Record<string, boolean>;
  highlights: Record<string, IeltsHighlight[]>;
  elapsed: number;
  limit: number | null;
  deadlineAt?: number | null;
  listenDone?: boolean;
  audioPart?: number; // 0-based track index
  audioSec?: number;  // seconds into track
  viewPart?: number;  // 0-based part candidate is viewing
  curQ?: number;      // active question number
  submittedAt?: number;
  result?: IeltsSectionResult;
}

export interface IeltsAssistSnapshot {
  practiceLookup: boolean;
  practiceVocabMarks: boolean;
}

export interface IeltsAttemptRow {
  id: string; // runId
  paperId: string;
  paperTitle: string;
  family: IeltsFamily;
  exam: IeltsExamId;
  scope: IeltsRunScope;
  mode: IeltsRunMode;
  assisted: boolean; // true if practice lookup/marks were enabled -> excluded from pure mock stats
  assistSnapshot: IeltsAssistSnapshot;
  skills: IeltsSkill[];
  currentSkill: IeltsSkill;
  sections: Partial<Record<IeltsSkill, IeltsSkillState>>;
  candidateName?: string;
  startedAt: number;
  updatedAt: number;
  submittedAt?: number; // set only when ALL skills in `skills` are submitted
  overallBand?: number | null;
}

export type IeltsQuestionKind =
  | "fill"
  | "single"
  | "multi"
  | "tfng"
  | "match-table"
  | "match-headings"
  | "match-drag";

export interface IeltsMasteryHistory {
  at: number;
  earned: number;
  max: number;
  right: boolean;
  userText: string;
  mode: IeltsRunMode;
}

export interface IeltsMasteryRow {
  id: string; // `${paperId}:${skill}:${unitKey}`
  paperId: string;
  paperTitle: string;
  exam: IeltsExamId;
  skill: Exclude<IeltsSkill, "writing">;
  part: number;
  unitKey: string; // e.g. "15" or "21-22"
  label: string;   // e.g. "15" or "21–22"
  first: number;
  count: number;
  qtype: IeltsQuestionKind;
  correctText: string;
  firstWrongAt: number;
  updatedAt: number;
  retiredAt?: number;
  history: IeltsMasteryHistory[];
}

export interface IeltsSpeakingRow {
  id: string; // question id
  done?: boolean;
  fav?: boolean;
  count?: number;
  lastAt?: number;
  updatedAt: number;
}

export interface IeltsRecordingRow {
  id: string;
  qid: string;
  blob: Blob;
  mime: string;
  seconds: number;
  createdAt: number;
}
