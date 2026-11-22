import Dexie, { type EntityTable } from "dexie";
import { IDBKeyRange as fakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import type { State } from "ts-fsrs";
import type { DictEntry } from "./dict";
import type { SectionKind } from "./papers";
import type { SyntaxEntry } from "./syntax";

/** 生词本里一个词的出处：哪套试卷、哪句话 */
export interface VocabSource {
  paperId: string;
  paperTitle: string;
  sentence: string;
  addedAt: number;
}

export interface VocabItem {
  word: string; // 小写原形
  addedAt: number;
  sources: VocabSource[];
  note?: string;
  /** 离线词典里没有的（短语 focus on、有道在线查到的词）：加入时把释义一起存下，生词本、复习都用它（2026-11-12） */
  gloss?: DictEntry;
  /** 学习者或 Agent 改的常用释义（词典给的不是高频义时）：显示在词典释义最前面，背词也先背它 */
  meaning?: string;
  /** 加入以后又在哪些卷子里出现过（不含加入时的出处）：出现得多的先背 */
  seen?: string[];
}

/** FSRS 记忆卡片，日期都存成时间戳 */
export interface CardRow {
  word: string;
  origin: "vocab" | "book";
  bookId?: string;
  createdAt: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: number;
}

export interface ReviewLogRow {
  id?: number;
  word: string;
  rating: number;
  state: State; // 复习前的状态
  reviewedAt: number;
  day: string;
}

/** 做题方式：全真模拟（总倒计时）、普通做题、练习（选完即判）、重做错题。旧记录没有，当作 exam */
export type AttemptMode = "exam" | "free" | "practice" | "retry";

export interface AttemptRow {
  paperId: string;
  answers: Record<string, string>; // 题目 id -> 选项
  texts: Record<string, string>; // 题目 id -> 主观题作答
  startedAt: number;
  updatedAt: number;
  submittedAt?: number;
  score?: number;
  total?: number;
  lookups: number;
  spentSec?: number; // 累计做题时长
  flags?: string[]; // 标记待检查的题目 id
  struck?: Record<string, string[]>; // 题目 id -> 划掉（排除）的选项
  mode?: AttemptMode;
  sectionSec?: Record<string, number>; // 部分 id -> 秒（按当前滚动到的部分累计）
  questionSec?: Record<string, number>; // 题目 id -> 秒（单题秒表，累加）
  retryIds?: string[]; // 重做错题：这次重做的题
  masteryAt?: number; // 这次交卷已经记进错题本（等于 submittedAt），补录旧记录时跳过
}

/** 错题本：一题一行，记下每次作答的对错；连续做对两次自动移出 */
export interface MasteryRow {
  id: string; // `${paperId}#${questionId}`
  paperId: string;
  questionId: string;
  kind: SectionKind;
  firstWrongAt: number;
  history: { at: number; right: boolean; mode: AttemptMode; chosen?: string }[]; // 每次作答，含最初那次
  retiredAt?: number; // 连续做对两次后移出的时间；手动恢复就删掉
  note?: string;
}

/** 每天的学习数据，用来打卡和统计 */
export interface DayRow {
  day: string; // YYYY-MM-DD（本地时间）
  reviews: number;
  newWords: number;
  lookups: number;
  questions: number;
  correct: number;
}

/** 卷面笔记：手写笔迹、高亮、下划线、便签。坐标都是 PDF 点，原点在页面左上角 */
export interface MarkRow {
  id: string;
  paperId: string;
  page: number; // 从 1 开始
  kind: "pen" | "highlight" | "underline" | "note";
  color: string; // 见 lib/marks.ts 的 COLORS
  points?: [number, number, number][]; // 手写、荧光笔笔迹：[x, y, 压力]
  size?: number; // 手写笔粗细；荧光笔笔迹是色带宽度
  shape?: "line"; // 按住拉直的直线（两个点）
  pressure?: boolean; // 手写：是否带真实压感（手写笔），否则模拟
  rects?: [number, number, number, number][]; // 高亮、下划线：每行一个框
  text?: string; // 高亮、下划线：选中的原文
  at?: [number, number]; // 便签位置
  note?: string; // 便签内容，或高亮上的批注
  ai?: boolean; // Agent 加的（右上角带 AI 角标）
  createdAt: number;
  updatedAt: number;
}

/** AI 助教的长期记忆：每条是一个要点，聊完由模型整理（加、改、删），设置里能看能改 */
export interface MemoryRow {
  id?: number;
  kind: "weak" | "pref" | "fact" | "profile"; // profile：学习者档案（现在只用这一行）；前三种是旧版的一条条记忆，读档案时会合并进去
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** AI 助教的一段对话：问的哪句（可带点的词）和来回的消息；AI 助教页列出历史 */
/** 解题思路库：从解析的"信号"、Agent 的回答里收进来的，或者自己写的做题方法（2026-11-22） */
export interface MethodRow {
  id: string;
  text: string;
  kind?: string; // 题型：细节、推理、主旨、听力……没有就算"通用"
  from: "explain" | "agent" | "mine";
  source?: { paperId: string; paperTitle: string; questionId?: string; number?: number };
  createdAt: number;
  updatedAt: number;
}

/** Agent 在卷面上标的长难句：和长难句解析层一样的结构，卷面上这句划蓝虚线，点开底部条看解析 */
export interface AiSyntaxRow {
  id: string; // paperId:句子键
  paperId: string;
  key: string; // 句子键（同 lib/trans.ts 的 sentenceKey）
  entry: SyntaxEntry;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRow {
  id: string; // 句子键 + 词
  ctx: { paper?: string; sentence: string; question?: string; word?: string; syntax?: unknown; review?: string; reviewReady?: boolean };
  messages: import("./agent").ChatMsg[];
  updatedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

const session = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * 内存库：有些手机自带、内嵌的浏览器里 IndexedDB 打开了不回调，页面就一直"正在加载"。
 * main.tsx 的看门狗 5 秒等不到就在本次会话记个 yz-memory-db 再刷新，这时改用内存里的数据库：照样能做题，记录不保存
 */
export const memoryDb = session("yz-memory-db") === "1";
if (memoryDb && typeof structuredClone === "undefined") {
  // 内存库要用 structuredClone，老浏览器没有；存的都是普通数据，JSON 复制就够
  (globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}

export const db = new Dexie("yingyu-zhidao", memoryDb ? { indexedDB: fakeIndexedDB, IDBKeyRange: fakeIDBKeyRange } : undefined) as Dexie & {
  vocab: EntityTable<VocabItem, "word">;
  cards: EntityTable<CardRow, "word">;
  logs: EntityTable<ReviewLogRow, "id">;
  attempts: EntityTable<AttemptRow, "paperId">;
  days: EntityTable<DayRow, "day">;
  settings: EntityTable<SettingRow, "key">;
  marks: EntityTable<MarkRow, "id">;
  mastery: EntityTable<MasteryRow, "id">;
  memory: EntityTable<MemoryRow, "id">;
  chats: EntityTable<ChatRow, "id">;
  methods: EntityTable<MethodRow, "id">;
  aiSyntax: EntityTable<AiSyntaxRow, "id">;
};

db.version(1).stores({
  vocab: "word, addedAt",
  cards: "word, due, state, origin, bookId",
  logs: "++id, word, day, reviewedAt",
  attempts: "paperId, updatedAt",
  days: "day",
  settings: "key",
});

db.version(2).stores({
  marks: "id, paperId, [paperId+page]",
});

db.version(3).stores({
  mastery: "id, paperId, kind, firstWrongAt, retiredAt",
});

db.version(4).stores({
  memory: "++id, kind, updatedAt",
});

db.version(5).stores({
  chats: "id, updatedAt",
});

db.version(6).stores({
  methods: "id, updatedAt, kind",
});

db.version(7).stores({
  aiSyntax: "id, paperId",
});

// Safari（iPhone/iPad）的老毛病：新开的页面里第一次打开 IndexedDB 可能一直不响应，页面就卡在"加载中"。
// 反复调 databases() 能把它唤醒（safari-14-idb-fix 的做法），响应了就停
if (!memoryDb && typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent) && typeof indexedDB !== "undefined" && indexedDB.databases) {
  const stop = () => clearInterval(timer);
  const poke = () => indexedDB.databases().then(stop, () => {});
  const timer = setInterval(poke, 100);
  void poke();
  setTimeout(stop, 10_000);
}

export function dayKey(d: Date | number = new Date()): string {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${dd}`;
}

/** 累加今天的某项学习数据 */
export async function bumpDay(patch: Partial<Omit<DayRow, "day">>, when: Date | number = new Date()) {
  const day = dayKey(when);
  await db.transaction("rw", db.days, async () => {
    const row = (await db.days.get(day)) ?? { day, reviews: 0, newWords: 0, lookups: 0, questions: 0, correct: 0 };
    for (const [k, v] of Object.entries(patch) as [keyof Omit<DayRow, "day">, number][]) row[k] += v;
    await db.days.put(row);
  });
}
