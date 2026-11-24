import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ArrowsClockwise, SpeakerHigh } from "@phosphor-icons/react";
import type { Grade } from "ts-fsrs";
import { db, type CardRow } from "@/lib/db";
import { getRoots, type RootInfo } from "@/lib/roots";
import { RootLine } from "@/components/RootLine";
import { getEntry, loadBookMeta, phonetic, TAG_LABELS, translationLines, type BookInfo, type DictEntry } from "@/lib/dict";
import { buildQueue, LEVELS, memoryLevel, pendingCounts, previewIntervals, Rating, retrievability, reviewWord, State, type QueueItem } from "@/lib/learning";
import { useMemory } from "@/lib/rootFamilies";
import { phrasesOf } from "@/lib/phrases";
import { passesDone, passNames, todayWords } from "@/lib/passes";
import { LevelMeter, MemoryTree } from "@/components/MemoryTree";
import { getSettings, setSetting, useSettings, type ReviewMode } from "@/lib/settings";
import { speak } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, LoadingBlock, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { DefinitionLines } from "@/components/WordPopover";
import { HighlightSentence } from "@/components/HighlightSentence";
import { Tip } from "@/components/overlay";
import { PixelIcon } from "@/components/PixelIcon";
import { Stamp } from "@/components/paper-ui";
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

function StartScreen({ onStart }: { onStart: () => void }) {
  const settings = useSettings();
  const counts = useCachedLiveQuery("pending", () => pendingCounts(), [settings.dailyNew, settings.activeBook]);
  const vocabCount = useCachedLiveQuery("vocab-count", () => db.vocab.count());
  const cards = useCachedLiveQuery("cards", () => db.cards.toArray());
  const [books, setBooks] = useState<BookInfo[]>([]);
  useEffect(() => {
    loadBookMeta().then(setBooks, () => {});
  }, []);
  if (!counts || !cards) return <LoadingBlock />;

  const total = counts.dueReviews + counts.newLeft;
  const doneToday = counts.today.reviews;
  const noSource = !settings.activeBook && !vocabCount;
  const book = books.find((b) => b.id === settings.activeBook);
  const source = book ? book.name : vocabCount ? "生词本" : "";

  return (
    <div className="space-y-5">
      <WordsTabs />
      <PageHeader
        title="背单词"
        actions={
          <>
            <Link to="/roots">
              <Button variant="ghost">记忆树</Button>
            </Link>
            <Link to="/books">
              <Button variant="ghost">换词书</Button>
            </Link>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card card-raised p-5 lg:p-7">
          <div className="flex items-end gap-2">
            <span className="num text-[56px] leading-[0.9] tracking-[-0.02em]">{total}</span>
            <span className="mb-1 text-[15px] text-[var(--ink-700)]">个词要背</span>
          </div>
          <p className="mt-2 text-[14px] text-[var(--ink-500)]">
            复习 <span className="num text-[var(--ink-700)]">{counts.dueReviews}</span> · 新词 <span className="num text-[var(--ink-700)]">{counts.newLeft}</span>
            {source && ` · ${source}`}
            {doneToday > 0 && (
              <>
                {" "}
                · 今天已背 <span className="num text-[var(--ink-700)]">{doneToday}</span>
              </>
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {noSource ? (
              <Link to="/books">
                <Button variant="primary" size="lg">
                  <PixelIcon name="books" size={20} accent="none" /> 先选一本词书
                </Button>
              </Link>
            ) : (
              <>
                <Tip label={settings.reviewMode === "recognize" ? "快捷键：1 不认识 · 2 模糊 · 3 认识 · 空格 下一个 · V 发音" : "回车核对 · 一次拼对算认识，错过算模糊，看答案算不认识"} side="top">
                  <Button variant="primary" size="lg" onClick={onStart} disabled={total === 0}>
                    {total === 0 ? "今天的任务完成了" : `开始背（${total}）`}
                  </Button>
                </Tip>
                <Segmented label="复习方式" value={settings.reviewMode} options={MODES} onChange={(v) => void setSetting("reviewMode", v)} />
              </>
            )}
          </div>
          <Passes />
        </div>
        <MemoryCard cards={cards} />
      </div>
    </div>
  );
}

/** 记忆：平均还记得多少、快忘的词、五级分布一条，明天要复习几个 */
function MemoryCard({ cards }: { cards: CardRow[] }) {
  const learned = cards.filter((c) => c.state !== State.New);
  const levels = [1, 2, 3, 4, 5].map((lv) => ({ lv, n: learned.filter((c) => memoryLevel(c) === lv).length }));
  const rs = learned.map((c) => retrievability(c));
  const avgR = rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) : 0;
  const fading = rs.filter((r) => r < 0.85).length;
  const start = new Date();
  start.setHours(24, 0, 0, 0);
  const tomorrow = learned.filter((c) => c.due >= start.getTime() && c.due < start.getTime() + 86_400_000).length;
  return (
    <div className="card p-5 lg:p-6">
      <h2 className="t-h2">记忆</h2>
      {learned.length ? (
        <>
          <div className="mt-3 flex items-end gap-6">
            <div>
              <div className="num text-[40px] leading-[44px]">
                {avgR}
                <span className="text-[18px]">%</span>
              </div>
              <div className="text-[13px] text-[var(--ink-500)]">平均还记得</div>
            </div>
            {fading > 0 && (
              <div>
                <div className="num text-[28px] leading-[32px] text-[var(--red)]">{fading}</div>
                <div className="text-[13px] text-[var(--ink-500)]">个快忘了</div>
              </div>
            )}
          </div>
          <div className="mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
            {levels.map(({ lv, n }) => n > 0 && <span key={lv} className="h-full bg-[var(--blue)]" style={{ flexGrow: n, opacity: 0.25 + lv * 0.15 }} />)}
          </div>
          <ul className="mt-2.5 grid grid-cols-5 text-center">
            {levels.map(({ lv, n }) => (
              <li key={lv} title={LEVELS[lv].hint}>
                <div className="num text-[15px]">{n}</div>
                <div className="text-[12px] text-[var(--ink-500)]">{LEVELS[lv].label}</div>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-[var(--line-soft)] pt-3 text-[13px] text-[var(--ink-500)]">
            明天要复习 <span className="num text-[var(--ink-700)]">{tomorrow}</span> 个 · 一共背过 <span className="num text-[var(--ink-700)]">{learned.length}</span> 个
          </p>
        </>
      ) : (
        <p className="well mt-4 py-8 text-center text-[13px] text-[var(--ink-500)]">开始背词后，这里显示记得多牢</p>
      )}
    </div>
  );
}

/** 一天背几轮：第一轮正式复习，之后每轮把今天的词快速过一遍，晚上看一遍速览 */
function Passes() {
  const settings = useSettings();
  const done = useCachedLiveQuery("passes-done", () => passesDone()) ?? 0;
  const count = useCachedLiveQuery("today-words", async () => (await todayWords()).length) ?? 0;
  const names = passNames(settings.dailyPasses);
  return (
    <div className="mt-7 border-t border-[var(--line-soft)] pt-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ol className="flex items-center gap-1.5">
          {names.map((n, i) => (
            <li
              key={i}
              className={cn(
                "flex h-8 min-w-10 items-center justify-center rounded-full px-3 text-[13px]",
                i < done ? "bg-[var(--blue)] text-white" : i === done ? "text-[var(--blue)] shadow-[inset_0_0_0_1.5px_var(--blue)]" : "text-[var(--ink-500)] shadow-[inset_0_0_0_1px_var(--line-control)]",
              )}
            >
              {i < done ? "✓ " : ""}
              {n}
            </li>
          ))}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/review/quick">
            <Button variant={done >= 1 && done < names.length ? "primary" : "secondary"} disabled={!count}>
              快速过一遍
            </Button>
          </Link>
          <Link to="/review/digest">
            <Button disabled={!count}>单词速览</Button>
          </Link>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--ink-500)]">
        每天
        <select value={settings.dailyPasses} onChange={(e) => void setSetting("dailyPasses", Number(e.target.value))} aria-label="每天几轮" className="h-7 rounded-[7px] bg-white px-1.5 text-[13px] text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line-control)]">
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} 轮
            </option>
          ))}
        </select>
        ：第一轮正式复习，之后把今天的 {count} 个词快速过一遍。
      </p>
    </div>
  );
}

/** 正面想不起来时一级级给提示：先给拆法或一个短语，再给每块的意思；不直接给词义 */
function Hint({ roots, phrase, step, onMore }: { roots: RootInfo | null; phrase: string | null; step: number; onMore: () => void }) {
  const parts = roots?.m ?? [];
  const max = parts.length ? 2 : phrase ? 1 : 0;
  if (!max) return null;
  return (
    <div className="mt-4 flex min-h-10 flex-col items-center gap-2">
      {step > 0 &&
        (parts.length ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {parts.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[var(--ink-300)]">+</span>}
                <span className="rounded-[9px] bg-[var(--fill-quiet)] px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="serif block text-[16px] leading-tight font-semibold">{p[0]}</span>
                  {step > 1 && <span className="animate-pop block text-[12px] text-[var(--ink-700)]">{p[1]}</span>}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <span className="serif text-[17px] text-[var(--ink-700)]">{phrase}</span>
        ))}
      {step < max && (
        <button type="button" onClick={onMore} className="h-8 rounded-full px-3 text-[13px] text-[var(--blue)] hover:bg-[var(--blue-tint)]">
          {step === 0 ? (parts.length ? "提示：看看怎么拆" : "提示：看一个短语") : "再提示：每块什么意思"}
        </button>
      )}
    </div>
  );
}

/** 背面一行：现在的记忆等级、FSRS 估计还记得的把握、这次评完多久后再见 */
function MemoryLine({ card, next }: { card: CardRow | undefined; next: number | null }) {
  const lv = memoryLevel(card);
  const r = card && card.state !== State.New ? Math.round(retrievability(card) * 100) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] bg-[var(--fill-quiet)] px-3 py-2 text-[13px] text-[var(--ink-700)]">
      <LevelMeter lv={lv} />
      <span>
        记忆 <b className="font-semibold text-[var(--ink)]">{LEVELS[lv].label}</b>
      </span>
      {r !== null && <span>刚才记得的把握约 {r}%</span>}
      {next && <span className="ml-auto text-[var(--ink-500)]">这次评完，{formatInterval(next - Date.now())}后再见</span>}
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
  const [roots, setRoots] = useState<RootInfo | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  // 提示阶梯：0 没提示；1 给拆法（pre · dict）或一个短语；2 再给每块的意思
  const [hint, setHint] = useState(0);
  const memory = useMemory();
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
    setRoots(null);
    setPhrase(null);
    setHint(0);
    Promise.all([getEntry(item.word), db.cards.get(item.word), getRoots(item.word), phrasesOf(item.word, 1).catch(() => [])]).then(([e, c, r, ph]) => {
      if (cancelled) return;
      setEntry(e ?? null);
      setRoots(r);
      setPhrase(ph[0]?.phrase ?? null);
      setCard(c);
      // 拼写不自动读（读了就等于告诉你怎么拼）；听写由拼写卡自己读
      if (e && settings.autoSpeak && !spelling) speak(e.w);
    });
    const next = queue?.[idx + 1];
    if (next) {
      void getEntry(next.word);
      void getRoots(next.word);
    }
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
      if ((e.key === "h" || e.key === "H") && phase === "front" && !spelling) setHint((h) => Math.min(2, h + 1));
      if (phase === "front" && spelling) return; // 拼写、听写靠拼对拼错评分
      if (phase === "front") {
        if (e.key === "1") rate(Rating.Again);
        if (e.key === "2") rate(Rating.Hard);
        if (e.key === "3") rate(Rating.Good);
        if (e.key === "4") rate(Rating.Easy);
      } else if (e.key === " " || e.key === "Enter") {
        // 焦点在按钮上（比如"词源"）时，空格回车是按那个按钮
        if (e.target instanceof HTMLButtonElement) return;
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
          <div className="card card-raised relative px-6 pt-8 pb-7 text-center [container-type:inline-size]">
            {item.isNew && <span className="tag-paper absolute top-4 left-4">新词</span>}
            {/* 长词按屏宽缩字号，手机上也不在词中间断行 */}
            <h1
              className="serif leading-[1.05] font-semibold tracking-[-0.02em] break-words"
              style={{ fontSize: `clamp(24px, calc(100cqw / ${((entry?.w ?? item.word).length * 0.62).toFixed(2)}), 56px)` }}
            >
              {entry?.w ?? item.word}
            </h1>
            <button type="button" onClick={() => speak(item.word)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[var(--ink-500)] transition hover:bg-[var(--paper-100)] hover:text-[var(--ink)]">
              {entry && phonetic(entry) && <span className="font-[family-name:var(--font-mono)] text-[14px]">{phonetic(entry)}</span>}
              <SpeakerHigh className="size-5" />
            </button>
            {phase === "front" && <Hint roots={roots} phrase={phrase} step={hint} onMore={() => setHint((h) => Math.min(2, h + 1))} />}
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
                <MemoryLine card={card} next={grade !== null && intervals ? intervals[grade] : null} />
                {roots && <RootLine info={roots} />}
                <MemoryTree word={item.word} memory={memory} compact hideFormula />
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
