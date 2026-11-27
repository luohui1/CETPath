import type { ExamId } from "./papers";
import { setSetting, type Settings } from "./settings";

export interface TargetExamMeta {
  id: ExamId;
  name: string;
  short: string;
  badge: string;
  desc: string;
  bookId: string;
  hasListening: boolean;
}

export const TARGET_EXAMS: TargetExamMeta[] = [
  {
    id: "cet4",
    name: "大学英语四级",
    short: "四级",
    badge: "CET-4",
    desc: "68 套历年原卷 · 47 套听力原声 · 3848 大纲词 · 四级口语",
    bookId: "cet4",
    hasListening: true,
  },
  {
    id: "cet6",
    name: "大学英语六级",
    short: "六级",
    badge: "CET-6",
    desc: "68 套历年原卷 · 47 套听力原声 · 5406 大纲词 · 六级口语",
    bookId: "cet6",
    hasListening: true,
  },
  {
    id: "ielts-a",
    name: "雅思（A类学术）",
    short: "雅思 A",
    badge: "IELTS A",
    desc: "88 套全真机考 · 242 道写作机经 · 100 个当季口语话题",
    bookId: "ielts",
    hasListening: true,
  },
  {
    id: "ielts-gt",
    name: "雅思（G类培训）",
    short: "雅思 G",
    badge: "IELTS G",
    desc: "56 套全真机考 · 5034 雅思核心词 · 100 个当季口语话题",
    bookId: "ielts",
    hasListening: true,
  },
  {
    id: "kaoyan1",
    name: "考研英语",
    short: "考研",
    badge: "考研英语",
    desc: "历年阅读与新题型精研 · 4800 大纲词 · 复试听说问答",
    bookId: "ky",
    hasListening: false,
  },
];

export const TARGET_EXAM_MAP: Record<string, TargetExamMeta> = Object.fromEntries(
  TARGET_EXAMS.map((t) => [t.id, t]),
);

export function normalizeTargetExam(raw?: string | null): ExamId {
  if (raw === "kaoyan2") return "kaoyan1";
  if (raw && raw in TARGET_EXAM_MAP) return raw as ExamId;
  return "cet6";
}

export function inferExamFromName(examName?: string | null): ExamId | null {
  const s = (examName ?? "").trim();
  if (!s) return null;
  if (/六级|cet-?6/i.test(s)) return "cet6";
  if (/四级|cet-?4/i.test(s)) return "cet4";
  if (/G类|培训类|ielts-?gt/i.test(s)) return "ielts-gt";
  if (/雅思|A类|ielts/i.test(s)) return "ielts-a";
  if (/考研|英语[一二12]|kaoyan/i.test(s)) return "kaoyan1";
  return null;
}

export function resolveTargetExam(
  settings: Pick<Settings, "targetExam" | "examName" | "lastExam">,
): ExamId {
  if (settings.targetExam) return normalizeTargetExam(settings.targetExam);
  const fromName = inferExamFromName(settings.examName);
  if (fromName) return fromName;
  if (settings.lastExam) return normalizeTargetExam(settings.lastExam);
  return "cet6";
}

export function getTargetMeta(exam?: string | null): TargetExamMeta {
  return TARGET_EXAM_MAP[normalizeTargetExam(exam)] ?? TARGET_EXAMS[1];
}

export async function applyTargetExam(
  exam: ExamId,
  opts?: { examDate?: string | null; syncBook?: boolean },
): Promise<void> {
  const norm = normalizeTargetExam(exam);
  const meta = getTargetMeta(norm);
  const ops: Promise<unknown>[] = [
    setSetting("targetExam", norm),
    setSetting("lastExam", norm),
    setSetting("examName", meta.name),
  ];
  if (opts?.examDate !== undefined) {
    ops.push(setSetting("examDate", opts.examDate));
  }
  if (opts?.syncBook !== false) {
    ops.push(setSetting("activeBook", meta.bookId));
  }
  await Promise.all(ops);
}
