import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import { bumpDay, db, dayKey, type CardRow, type VocabSource } from "./db";
import { loadBook, getEntry, type DictEntry } from "./dict";
import { getSettings, type Settings } from "./settings";

export { Rating, State };

/** 词书按词频排好的，分成这几段：前 1000、1000–3000、3000–5000、5000 以后 */
const BAND_EDGES = [0, 1000, 3000, 5000];
export const WEEK_MS = 7 * 86_400_000;

export function freqBands(count: number): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = [];
  for (let i = 0; i < BAND_EDGES.length && BAND_EDGES[i] < count; i++) {
    const from = BAND_EDGES[i];
    const to = Math.min(BAND_EDGES[i + 1] ?? Infinity, count);
    out.push({ from, to, label: from === 0 ? `前 ${to}` : to === count && i === BAND_EDGES.length - 1 ? `${from} 以后` : `${from}–${to}` });
  }
  return out;
}

/** 正在生效的本周重点（只认当前词书、7 天内设的），返回词书里的 [起, 止) */
export function focusBand(settings: Pick<Settings, "focusBand" | "activeBook">, count: number): [number, number] | null {
  const f = settings.focusBand;
  if (!f || f.bookId !== settings.activeBook || Date.now() - f.since > WEEK_MS) return null;
  const b = freqBands(count)[f.band];
  return b ? [b.from, b.to] : null;
}

/** 拼写、听写的成绩折成 FSRS 评分：一次拼对 = 认识，错过（看了逐字母核对或首字母提示）= 模糊，看答案 = 不认识 */
export function spellGrade(wrong: number, revealed: boolean): Grade {
  if (revealed) return Rating.Again;
  return wrong === 0 ? Rating.Good : Rating.Hard;
}

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true });

function toCard(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

function fromCard(card: Card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.getTime(),
  };
}

function newCardRow(word: string, origin: CardRow["origin"], bookId?: string, now = Date.now()): CardRow {
  return { word, origin, bookId, createdAt: now, ...fromCard(createEmptyCard(new Date(now))) };
}

/** 加入生词本；同一句话不重复记出处。词同时进入记忆卡片 */
export async function addToVocab(word: string, source?: Omit<VocabSource, "addedAt">, gloss?: DictEntry) {
  const now = Date.now();
  await db.transaction("rw", db.vocab, db.cards, async () => {
    const item = (await db.vocab.get(word)) ?? { word, addedAt: now, sources: [] };
    if (gloss) item.gloss = gloss;
    if (source && !item.sources.some((s) => s.paperId === source.paperId && s.sentence === source.sentence)) {
      item.sources.push({ ...source, addedAt: now });
    }
    await db.vocab.put(item);
    const card = await db.cards.get(word);
    if (!card) await db.cards.put(newCardRow(word, "vocab", undefined, now));
    else if (card.origin === "book") await db.cards.update(word, { origin: "vocab" });
  });
}

/** 卷面上又碰到生词本里的词：记下这套卷子 */
export async function markSeen(paperId: string, words: string[]) {
  if (!words.length) return;
  await db.transaction("rw", db.vocab, async () => {
    for (const it of await db.vocab.bulkGet(words)) {
      if (!it || it.sources.some((s) => s.paperId === paperId) || it.seen?.includes(paperId)) continue;
      await db.vocab.update(it.word, { seen: [...(it.seen ?? []), paperId] });
    }
  });
}

/** 移出生词本；还没开始学的卡片一起删掉，学过的保留复习记录 */
/** 改生词的常用释义；空串就恢复词典释义。词不在生词本里返回 false */
export async function setVocabMeaning(word: string, meaning: string) {
  const m = meaning.trim().slice(0, 300);
  return (await db.vocab.update(word, { meaning: m || undefined })) > 0;
}

export async function removeFromVocab(word: string) {
  await db.transaction("rw", db.vocab, db.cards, async () => {
    await db.vocab.delete(word);
    const card = await db.cards.get(word);
    if (card?.origin === "vocab" && card.state === State.New) await db.cards.delete(word);
  });
}

/** 各个评分对应的下次复习时间，用来显示在按钮上 */
export function previewIntervals(row: CardRow | undefined, now = new Date()): Record<Grade, number> {
  const card = row ? toCard(row) : createEmptyCard(now);
  const log = scheduler.repeat(card, now);
  return {
    [Rating.Again]: log[Rating.Again].card.due.getTime(),
    [Rating.Hard]: log[Rating.Hard].card.due.getTime(),
    [Rating.Good]: log[Rating.Good].card.due.getTime(),
    [Rating.Easy]: log[Rating.Easy].card.due.getTime(),
  } as Record<Grade, number>;
}

export interface QueueItem {
  word: string;
  origin: CardRow["origin"];
  bookId?: string;
  isNew: boolean;
}

/** 记一次复习，返回新的卡片 */
export async function reviewWord(item: QueueItem, grade: Grade): Promise<CardRow> {
  const now = new Date();
  const existing = await db.cards.get(item.word);
  const row = existing ?? newCardRow(item.word, item.origin, item.bookId, now.getTime());
  const result = scheduler.next(toCard(row), now, grade);
  const next: CardRow = { ...row, ...fromCard(result.card) };
  await db.transaction("rw", db.cards, db.logs, db.days, async () => {
    await db.cards.put(next);
    await db.logs.add({ word: item.word, rating: grade, state: row.state, reviewedAt: now.getTime(), day: dayKey(now) });
    await bumpDay({ reviews: 1, newWords: row.state === State.New ? 1 : 0 }, now);
  });
  return next;
}

export async function todayStats() {
  return (await db.days.get(dayKey())) ?? { day: dayKey(), reviews: 0, newWords: 0, lookups: 0, questions: 0, correct: 0 };
}

/**
 * 组一轮背词队列：到期复习词在前，然后是新词（先生词本，再词书），
 * 新词数受每日目标限制，extraNew 用于"再来一组"。
 */
export async function buildQueue(extraNew = 0): Promise<QueueItem[]> {
  const now = Date.now();
  const settings = await getSettings();
  const due = await db.cards.where("due").belowOrEqual(now).toArray();
  const reviews = due
    .filter((c) => c.state !== State.New)
    .sort((a, b) => a.due - b.due)
    .map((c) => ({ word: c.word, origin: c.origin, bookId: c.bookId, isNew: false }));

  const today = await todayStats();
  let quota = Math.max(0, settings.dailyNew + extraNew - today.newWords);
  const fresh: QueueItem[] = [];
  if (quota > 0) {
    const vocabCards = (await db.cards.where("state").equals(State.New).toArray()).filter((c) => c.origin === "vocab");
    // 生词本里在后来的卷子上反复出现的词先背
    const seen = new Map((await db.vocab.bulkGet(vocabCards.map((c) => c.word))).map((v, i) => [vocabCards[i].word, v?.seen?.length ?? 0]));
    const vocabNew = vocabCards.sort((a, b) => (seen.get(b.word) ?? 0) - (seen.get(a.word) ?? 0) || a.createdAt - b.createdAt).slice(0, quota);
    fresh.push(...vocabNew.map((c) => ({ word: c.word, origin: c.origin, isNew: true })));
    quota -= vocabNew.length;
  }
  if (quota > 0 && settings.activeBook) {
    const book = await loadBook(settings.activeBook);
    const known = new Set(await db.cards.toCollection().primaryKeys());
    // 本周重点：先从这个词频段里出，学完了再按原来的顺序
    const band = focusBand(settings, book.length);
    const order = band ? [...book.slice(band[0], band[1]), ...book.slice(0, band[0]), ...book.slice(band[1])] : book;
    for (const e of order) {
      if (quota <= 0) break;
      const w = e.w.toLowerCase();
      if (known.has(w)) continue;
      fresh.push({ word: w, origin: "book", bookId: settings.activeBook, isNew: true });
      quota--;
    }
  }
  // 新词穿插在复习词之间，避免一口气全是生词
  const queue: QueueItem[] = [];
  let r = 0;
  let n = 0;
  while (r < reviews.length || n < fresh.length) {
    for (let k = 0; k < 3 && r < reviews.length; k++) queue.push(reviews[r++]);
    if (n < fresh.length) queue.push(fresh[n++]);
  }
  return queue;
}

/** 今天还有多少词要背 */
export async function pendingCounts() {
  const now = Date.now();
  const settings = await getSettings();
  const dueReviews = await db.cards
    .where("due")
    .belowOrEqual(now)
    .filter((c) => c.state !== State.New)
    .count();
  const today = await todayStats();
  const newLeft = Math.max(0, settings.dailyNew - today.newWords);
  const vocabNew = await db.cards
    .where("state")
    .equals(State.New)
    .filter((c) => c.origin === "vocab")
    .count();
  const hasNewSource = vocabNew > 0 || !!settings.activeBook;
  return { dueReviews, newLeft: hasNewSource ? newLeft : 0, today };
}

export async function entryFor(word: string): Promise<DictEntry | undefined> {
  return getEntry(word);
}

export const STATE_LABELS: Record<State, string> = {
  [State.New]: "未学",
  [State.Learning]: "学习中",
  [State.Review]: "复习中",
  [State.Relearning]: "重学中",
};

/** 稳定度超过 21 天视为已掌握 */
export function isMastered(row: CardRow) {
  return row.state === State.Review && row.stability >= 21;
}
