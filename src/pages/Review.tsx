import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ArrowsClockwise, SpeakerHigh } from "@phosphor-icons/react";
import type { Grade } from "ts-fsrs";
import { db, type CardRow } from "@/lib/db";
import { getEntry, loadBookMeta, phonetic, TAG_LABELS, translationLines, type BookInfo, type DictEntry } from "@/lib/dict";
import { buildQueue, isMastered, pendingCounts, previewIntervals, Rating, reviewWord, State, type QueueItem } from "@/lib/learning";
import { getSettings, setSetting, useSettings, type ReviewMode } from "@/lib/settings";
import { speak } from "@/lib/speech";
import { cn, timeAgo } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, LoadingBlock, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { DefinitionLines } from "@/components/WordPopover";
import { HighlightSentence } from "@/components/HighlightSentence";
import { Tip } from "@/components/overlay";
import { PixelIcon } from "@/components/PixelIcon";
import { Bubbles, Stamp } from "@/components/paper-ui";
import { DayColumns, MemoryStrip } from "@/components/viz";
import { SpellCard } from "@/review/SpellCard";
import { WordContext } from "@/review/WordContext";

const MODES: { value: ReviewMode; label: string }[] = [
  { value: "recognize", label: "认读" },
  { value: "spell", label: "拼写" },
  { value: "dictation", label: "听写" },
];

function formatInterval(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}分钟`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}小时`;
  const d = Math.round(hr / 24);
  if (d < 31) return `${d}天`;
  return `${Math.round(d / 30)}个月`;
}

// 三个按钮都是白纸；"不认识"用红笔，"模糊"下面一道荧光笔
const GRADES: { grade: Grade; label: string; key: string; tone: string }[] = [
  { grade: Rating.Again, label: "不认识", key: "1", tone: "text-[var(--red)]" },
  { grade: Rating.Hard, label: "模糊", key: "2", tone: "text-[var(--ink)] [&>b]:shadow-[inset_0_-0.4em_0_var(--mark)]" },
  { grade: Rating.Good, label: "认识", key: "3", tone: "text-[var(--ink)]" },
];

const FORM_NAMES: Record<string, string> = { p: "过去式", d: "过去分词", i: "现在分词", "3": "三单", r: "比较级", t: "最高级", s: "复数" };

function Forms({ entry }: { entry: DictEntry }) {
  if (!entry.x) return null;
  const forms = entry.x
    .split("/")
    .map((p) => p.split(":"))
    .filter(([k, v]) => v && FORM_NAMES[k]);
  if (!forms.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[var(--ink-500)]">
      {forms.map(([k, v]) => (
        <span key={k}>
          {FORM_NAMES[k]} <span className="serif text-[14px] text-[var(--ink)]">{v}</span>
        </span>
      ))}
    </div>
  );
}

interface SessionStats {
  done: number;
  fresh: number;
  again: number;
}

const RATING_NAMES: Record<number, { label: string; tone: string }> = {
  1: { label: "不认识", tone: "font-semibold text-[var(--ink)]" },
  2: { label: "模糊", tone: "text-[var(--ink-700)]" },
  3: { label: "认识", tone: "text-[var(--ink-500)]" },
  4: { label: "简单", tone: "text-[var(--ink-500)]" },
};
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 开始页：今天的任务做成一张答题卡（三行小泡），旁边是记忆状态；下面是未来 7 天的复习量和最近复习的词 */
function StartScreen({ onStart }: { onStart: () => void }) {
  const settings = useSettings();
  const counts = useCachedLiveQuery("pending", () => pendingCounts(), [settings.dailyNew, settings.activeBook]);
  const vocabCount = useCachedLiveQuery("vocab-count", () => db.vocab.count());
  const cards = useCachedLiveQuery("cards", () => db.cards.toArray());
  const recent = useCachedLiveQuery("recent-logs", () => db.logs.orderBy("reviewedAt").reverse().limit(8).toArray());
  const [books, setBooks] = useState<BookInfo[]>([]);
  useEffect(() => {
    loadBookMeta().then(setBooks, () => {});
  }, []);
  if (!counts || !cards) return <LoadingBlock />;

  const total = counts.dueReviews + counts.newLeft;
  const doneToday = counts.today.reviews;
  const noSource = !settings.activeBook && !vocabCount;
  const book = books.find((b) => b.id === settings.activeBook);

  // 未来 7 天每天到期的词（过期的算今天）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return { label: i === 0 ? "今天" : `周${WEEKDAYS[d.getDay()]}`, value: 0 };
  });
  for (const c of cards) {
    if (c.state === State.New) continue;
    const i = Math.max(0, Math.floor((c.due - today.getTime()) / 86_400_000));
    if (i < 7) forecast[i].value++;
  }
  const memory = [
    { label: "已掌握", value: cards.filter(isMastered).length },
    { label: "复习中", value: cards.filter((c) => c.state === State.Review && !isMastered(c)).length },
    { label: "学习中", value: cards.filter((c) => c.state === State.Learning || c.state === State.Relearning).length },
    { label: "未学", value: cards.filter((c) => c.state === State.New).length },
  ].filter((m) => m.value);


  return (
    <div className="space-y-5">
      <WordsTabs />
      <PageHeader title="背单词" desc="按遗忘曲线（FSRS 算法）安排复习：快忘的时候再出现，记得牢的间隔越来越长。" />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 今天的任务：一张答题卡 */}
        <div className="card card-raised flex flex-col px-5 pt-3 pb-5 lg:col-span-2 lg:px-7 lg:pb-6">
          <h2 className="t-h2 mt-2">今天的任务</h2>
          <div className="mt-3 flex items-end gap-2">
            <span className="num text-[56px] leading-[0.9] tracking-[-0.02em]">{total}</span>
            <span className="mb-1 text-[15px] text-[var(--ink-700)]">个词要背</span>
          </div>
          {/* 进行中的才画泡：今天已经复习的涂黑 */}
          {doneToday > 0 && total > 0 && <Bubbles total={doneToday + total} done={doneToday} max={24} className="mt-4" />}
          <p className="mt-3 text-[14px] text-[var(--ink-500)]">
            到期复习 <span className="num text-[var(--ink-700)]">{counts.dueReviews}</span> · 新词 <span className="num text-[var(--ink-700)]">{counts.newLeft}</span>
            {book ? `（${book.name}）` : ""} · 今天已复习 <span className="num text-[var(--ink-700)]">{doneToday}</span>
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-6">
            {noSource ? (
              <Link to="/books">
                <Button variant="primary" size="lg">
                  <PixelIcon name="books" size={20} accent="none" /> 先选一本词书
                </Button>
              </Link>
            ) : (
              <Tip label={settings.reviewMode === "recognize" ? "快捷键：1 不认识 · 2 模糊 · 3 认识 · 空格 下一个 · V 发音" : "回车核对 · 一次拼对算认识，错过算模糊，看答案算不认识"} side="top">
                <Button variant="primary" size="lg" onClick={onStart} disabled={total === 0}>
                  {total === 0 ? "今天的任务完成了" : `开始（${total} 个）`}
                </Button>
              </Tip>
            )}
            {/* 怎么考：认读看英文自评，拼写看中文拼英文，听写听发音拼英文 */}
            {!noSource && <Segmented label="复习方式" value={settings.reviewMode} options={MODES} onChange={(v) => void setSetting("reviewMode", v)} />}
            <Link to="/books" className="ml-auto">
              <Button variant="ghost">换词书</Button>
            </Link>
          </div>
        </div>

        <div className="card p-5 lg:p-6">
          <h2 className="t-h2" title="已掌握：记得牢、间隔超过 3 周">
            记忆状态
          </h2>
          <div className="num mt-4 text-[40px] leading-[44px]">
            {cards.length}
            <span className="ml-1 font-[family-name:var(--font-sans)] text-[13px] font-normal text-[var(--ink-500)]">个单词</span>
          </div>
          <div className="mt-4">{memory.length ? <MemoryStrip memory={memory} total={cards.length} /> : <p className="well py-8 text-center text-[13px] text-[var(--ink-500)]">开始背词后，这里显示记忆状态</p>}</div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2 lg:p-6">
          <h2 className="t-h2 mb-5" title="已经过期没复习的算在今天">
            未来 7 天复习
          </h2>
          <DayColumns data={forecast} unit=" 个" />
        </div>
        <div className="card p-5 lg:p-6">
          <h2 className="t-h2 mb-2">最近复习</h2>
          {!recent?.length ? (
            <p className="well py-10 text-center text-[13px] text-[var(--ink-500)]">还没有复习记录</p>
          ) : (
            <ul className="divide-y divide-dashed divide-[var(--line-control)]">
              {recent.slice(0, 5).map((l) => (
                <li key={l.id} className="flex min-h-10 items-center gap-2 py-1.5 text-[13px]">
                  <button type="button" onClick={() => speak(l.word)} className="serif truncate text-[16px] hover:text-[var(--blue)]" title="发音">
                    {l.word}
                  </button>
                  <span className={cn("ml-auto flex-none", RATING_NAMES[l.rating]?.tone)}>{RATING_NAMES[l.rating]?.label}</span>
                  <span className="w-16 flex-none text-right text-[13px] text-[var(--ink-500)]">{timeAgo(l.reviewedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** 一轮背完：盖一枚"本轮完成"，下面三个衬线数字 */
function DoneScreen({ stats, onMore }: { stats: SessionStats; onMore: () => void }) {
  const accuracy = stats.done ? Math.round(((stats.done - stats.again) / stats.done) * 100) : 0;
  return (
    <div className="card card-raised board mx-auto mt-6 max-w-lg p-8 pt-10 text-center">
      <Stamp size="lg" double animate id="round-done">
        本轮完成
      </Stamp>
      <h2 className="t-h2 mt-5">这一轮背完了</h2>
      <dl className="mt-6 grid grid-cols-3 divide-x divide-[var(--line)]">
        {[
          ["复习次数", `${stats.done}`, ""],
          ["新词", `${stats.fresh}`, ""],
          ["认识率", `${accuracy}`, "%"],
        ].map(([label, v, unit]) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="t-label mt-1">{label}</dt>
            <dd className="num text-[36px] leading-10">
              {v}
              <span className="text-[16px]">{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={onMore}>
          <ArrowsClockwise className="size-4" /> 再学 10 个新词
        </Button>
        <Link to="/" className="flex-1">
          <Button variant="primary" className="w-full">
            回到首页
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function ReviewPage() {
  const settings = useSettings();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"front" | "back">("front");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [entry, setEntry] = useState<DictEntry | null | undefined>(undefined);
  const [card, setCard] = useState<CardRow | undefined>(undefined);
  const [stats, setStats] = useState<SessionStats>({ done: 0, fresh: 0, again: 0 });
  const [extra, setExtra] = useState(0);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  // 这一轮怎么考：开始时定下来，中途改设置不影响
  const [mode, setMode] = useState<ReviewMode>("recognize");
  const spelling = mode !== "recognize";

  const item = queue?.[idx];
  const sources = useLiveQuery(async () => (item ? ((await db.vocab.get(item.word))?.sources ?? []) : []), [item?.word]);

  const start = useCallback(async (extraNew = 0) => {
    setStarted(true);
    setMode((await getSettings()).reviewMode);
    setQueue(null);
    const q = await buildQueue(extraNew);
    setQueue(q);
    setIdx(0);
    setPhase("front");
    setGrade(null);
  }, []);

  // 载入当前词的释义和卡片，并预取下一个词
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setEntry(undefined);
    Promise.all([getEntry(item.word), db.cards.get(item.word)]).then(([e, c]) => {
      if (cancelled) return;
      setEntry(e ?? null);
      setCard(c);
      // 拼写不自动读（读了就等于告诉你怎么拼）；听写由拼写卡自己读
      if (e && settings.autoSpeak && !spelling) speak(e.w);
    });
    const next = queue?.[idx + 1];
    if (next) void getEntry(next.word);
    return () => {
      cancelled = true;
    };
  }, [item, idx, queue, settings.autoSpeak, spelling]);

  const intervals = useMemo(() => (item ? previewIntervals(card) : null), [item, card]);

  const rate = (g: Grade) => {
    if (phase !== "front") return;
    setGrade(g);
    setPhase("back");
  };

  const next = useCallback(async () => {
    if (!item || grade === null || busy || !queue) return;
    setBusy(true);
    const updated = await reviewWord(item, grade);
    setStats((s) => ({ done: s.done + 1, fresh: s.fresh + (item.isNew ? 1 : 0), again: s.again + (grade === Rating.Again ? 1 : 0) }));
    // 短期内还要再看的词（学习步骤），插回本轮队列稍后的位置
    let q = queue;
    if (updated.due - Date.now() < 20 * 60_000) {
      q = [...queue];
      const again: QueueItem = { ...item, isNew: false };
      q.splice(Math.min(q.length, idx + 5), 0, again);
      setQueue(q);
    }
    setIdx(idx + 1);
    setPhase("front");
    setGrade(null);
    setBusy(false);
  }, [item, grade, busy, queue, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "v" || e.key === "V") speak(item.word);
      if (phase === "front" && spelling) return; // 拼写、听写靠拼对拼错评分
      if (phase === "front") {
        if (e.key === "1") rate(Rating.Again);
        if (e.key === "2") rate(Rating.Hard);
        if (e.key === "3") rate(Rating.Good);
        if (e.key === "4") rate(Rating.Easy);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void next();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!started) return <StartScreen onStart={() => start(extra)} />;
  if (!queue) return <LoadingBlock text="正在准备单词…" />;
  if (!item) {
    return (
      <DoneScreen
        stats={stats}
        onMore={() => {
          const more = extra + 10;
          setExtra(more);
          void start(more);
        }}
      />
    );
  }

  const progress = idx / queue.length;
  const gradeInfo = GRADES.find((g) => g.grade === grade) ?? (grade === Rating.Easy ? { label: "太简单" } : null);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl flex-col">
      <div className="flex items-center gap-3">
        <Link to="/" aria-label="退出">
          <Button size="icon" variant="ghost">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <ProgressBar value={progress} className="flex-1" />
        <span className="num text-[14px] text-[var(--ink-500)]">
          {idx}/{queue.length}
        </span>
      </div>

      {/* 拼写、听写的输入框放在上半屏，平板弹出键盘也不会被挡住 */}
      <div className={cn("flex flex-1 flex-col py-8", spelling && phase === "front" ? "justify-start pt-[min(10vh,72px)]" : "justify-center")}>
        {spelling && phase === "front" ? (
          <SpellCard
            word={item.word}
            entry={entry}
            mode={mode as "spell" | "dictation"}
            onResult={(g) => {
              setGrade(g);
              setPhase("back");
            }}
          />
        ) : (
          /* 单词卡：一张抬起的白纸，大字衬线英文 + 音标 + 发音 */
          <div className="card card-raised relative px-6 pt-8 pb-7 text-center">
            {item.isNew && <span className="tag-paper absolute top-4 left-4">新词</span>}
            <h1 className="serif text-[56px] leading-[1.05] font-semibold tracking-[-0.02em] break-words">{entry?.w ?? item.word}</h1>
            <button type="button" onClick={() => speak(item.word)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[var(--ink-500)] transition hover:bg-[var(--paper-100)] hover:text-[var(--ink)]">
              {entry && phonetic(entry) && <span className="font-[family-name:var(--font-mono)] text-[14px]">{phonetic(entry)}</span>}
              <SpeakerHigh className="size-5" />
            </button>
          </div>
        )}

        {/* 真题原句：认读的正面也显示，用语境帮助回忆；翻到背面后和其余原句一起列出 */}
        {!spelling && phase === "front" && sources && sources.length > 0 && (
          <div className="well mt-4 px-4 py-3">
            <HighlightSentence sentence={sources[0].sentence} word={item.word} className="serif text-[15px] leading-relaxed" />
            <div className="mt-1 text-[13px] text-[var(--ink-500)]">—— {sources[0].paperTitle}</div>
          </div>
        )}

        {phase === "back" && (
          <div className="card animate-pop mt-4 p-5">
            {entry === null && <p className="text-[14px] text-[var(--ink-500)]">词典里没有这个词的释义。</p>}
            {entry && (
              <div className="space-y-3">
                {entry.tags && (
                  <div className="flex flex-wrap gap-1">
                    {entry.tags.map((t) => (
                      <span key={t} className="tag-paper">
                        {TAG_LABELS[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                <DefinitionLines lines={translationLines(entry)} />
                <Forms entry={entry} />
              </div>
            )}
            <WordContext word={item.word} sources={sources ?? []} />
          </div>
        )}
      </div>

      <div className={cn("sticky bottom-0 bg-[var(--paper)] pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]", spelling && phase === "front" && "hidden")}>
        {phase === "front" ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {GRADES.map((g) => (
                <button key={g.grade} type="button" onClick={() => rate(g.grade)} className={cn("card card-press py-3.5 text-[15px] font-semibold", g.tone)}>
                  <b className="font-semibold">{g.label}</b>
                  {intervals && <div className="mt-0.5 text-[13px] font-normal text-[var(--ink-500)]">{formatInterval(intervals[g.grade] - Date.now())}后</div>}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => rate(Rating.Easy)} className="mt-2 h-10 w-full text-[14px] text-[var(--ink-500)] hover:text-[var(--ink)]">
              太简单，以后少出现{intervals && `（${formatInterval(intervals[Rating.Easy] - Date.now())}后）`}
            </button>
          </>
        ) : (
          <div className="flex gap-2">
            {!spelling && (grade === Rating.Good || grade === Rating.Easy) && (
              <button type="button" className="btn btn-lg btn-redpen flex-1" onClick={() => setGrade(Rating.Again)}>
                记错了
              </button>
            )}
            <Button size="lg" variant="primary" className="flex-[2]" onClick={() => void next()} loading={busy}>
              下一个
              {gradeInfo && <span className="ml-1 rounded-[5px] bg-white/20 px-1.5 py-0.5 text-[12px]">{gradeInfo.label}</span>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
