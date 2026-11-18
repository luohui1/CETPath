import { db } from "./db";
import { useCachedLiveQuery } from "./live";

export interface Settings {
  activeBook: string | null; // 当前词书 id
  dailyNew: number; // 每天新词数
  autoSpeak: boolean; // 查词和背词时自动发音
  voiceURI: string | null; // 发音人（没有真人录音时用的系统语音）
  accent: "us" | "uk"; // 单词真人发音：美音 / 英音
  showVocabMarks: boolean; // 试卷里标出生词本里的词
  readerFontSize: number; // 试卷正文字号（px）
  examName: string; // 目标考试
  examDate: string | null; // 考试日期 YYYY-MM-DD
  examMode: "exam" | "free"; // 整套卷默认的做题方式：全真模拟 / 普通做题
  practiceMode: "exam" | "practice"; // 专项训练默认：考试（交卷才判） / 练习（选完即判）
  masteryBackfilled: boolean; // 旧的交卷记录已经补录进错题本
  badExplanations: string[]; // 用户标了"解析有问题"的题：`${paperId}#${questionId}`
  penPresets: PenPreset[]; // 手写笔的 3 个预设槽（长按保存）
  twoUpPages: boolean; // 做题页双页视图（横屏、页面够窄时才生效）
  reviewMode: ReviewMode; // 背单词怎么考：认读 / 拼写 / 听写
  focusBand: FocusBand | null; // 本周重点：词书里的一个词频段，每日新词先从这里出
}

export interface PenPreset {
  color: string;
  size: number;
}

export type ReviewMode = "recognize" | "spell" | "dictation";

export interface FocusBand {
  bookId: string;
  band: number; // FREQ_BANDS 里的序号
  since: number; // 设定的时间，7 天后失效
}

export const DEFAULT_SETTINGS: Settings = {
  activeBook: null,
  dailyNew: 20,
  autoSpeak: true,
  voiceURI: null,
  accent: "us",
  showVocabMarks: true,
  readerFontSize: 18,
  examName: "",
  examDate: null,
  examMode: "free",
  practiceMode: "exam",
  masteryBackfilled: false,
  badExplanations: [],
  penPresets: [
    { color: "red", size: 1.1 },
    { color: "blue", size: 1.8 },
    { color: "ink", size: 1.8 },
  ],
  twoUpPages: false,
  reviewMode: "recognize",
  focusBand: null,
};

export const settingsRows = () => db.settings.toArray();

export function useSettings(): Settings {
  const rows = useCachedLiveQuery("settings", settingsRows);
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows ?? []) (s as Record<string, unknown>)[r.key] = r.value;
  return s;
}

export async function getSettings(): Promise<Settings> {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of await db.settings.toArray()) (s as Record<string, unknown>)[r.key] = r.value;
  return s;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  return db.settings.put({ key, value });
}
