import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { db } from "@/lib/db";
import { focusBand, freqBands, State } from "@/lib/learning";
import { loadBook, loadBookMeta, phonetic, shortTranslation, type BookInfo, type DictEntry } from "@/lib/dict";
import { setSetting, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useCachedLiveQuery } from "@/lib/live";
import { WordsTabs } from "@/components/WordsTabs";
import { Button, Card, LoadingBlock, PageHeader, Segmented } from "@/components/ui";
import { PixelIcon } from "@/components/PixelIcon";
import { Bubbles } from "@/components/paper-ui";

const DAILY_OPTIONS = [10, 20, 30, 50, 80];
const PAGE = 50;

const BOOK_DESC: Record<string, string> = {
  ielts: "雅思核心高频词汇，按真题与语料库词频排序",
  cet4: "四级大纲词汇，按词频排序，常用词先学",
  cet6: "六级大纲词汇（含四级词），按词频排序",
  ky: "考研英语大纲词汇，按词频排序",
};

/**
 * 按词频分段：每段学了多少；可以把一段设为"本周重点"，7 天里每日新词先从这段出。
 * 设了重点的那一段标题下一道荧光笔（这一屏唯一的文具装饰）
 */
function BandCard({ bookId, entries, learned }: { bookId: string; entries: DictEntry[]; learned: Set<string> }) {
  const settings = useSettings();
  const bands = freqBands(entries.length);
  const current = focusBand({ ...settings, activeBook: bookId === settings.activeBook ? bookId : null }, entries.length);
  const focusIdx = current ? bands.findIndex((b) => b.from === current[0]) : -1;
  return (
    <Card className="mt-6 p-5">
      <h2 className="text-[16px] font-semibold">按词频</h2>
      <ul className="mt-2 divide-y divide-[var(--line-soft)]">
        {bands.map((b, i) => {
          const size = b.to - b.from;
          let done = 0;
          for (let k = b.from; k < b.to; k++) if (learned.has(entries[k].w.toLowerCase())) done++;
          const focus = i === focusIdx;
          return (
            <li key={b.from} className="group flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className={cn("w-28 text-[14px]", focus && "font-semibold")}>{focus ? <span className="hl">{b.label}</span> : b.label}</span>
              <span className="num w-24 text-[14px] text-[var(--ink-500)]">
                <span className="text-[var(--ink)]">{done}</span> / {size}
              </span>
              <span className="min-w-0 flex-1">{done > 0 && done < size && <Bubbles total={size} done={done} max={16} />}</span>
              {focus ? (
                <Button variant="ghost" size="sm" onClick={() => void setSetting("focusBand", null)}>
                  本周重点 · 取消
                </Button>
              ) : (
                done < size && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 touch-show group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      if (settings.activeBook !== bookId) void setSetting("activeBook", bookId);
                      void setSetting("focusBand", { bookId, band: i, since: Date.now() });
                    }}
                  >
                    设为本周重点
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function BooksPage() {
  const settings = useSettings();
  const [books, setBooks] = useState<BookInfo[] | null>(null);
  const [preview, setPreview] = useState<DictEntry[] | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  // 只算真正复习过的词；生词本里还没开始学的不算
  const learnedWords = useCachedLiveQuery("learned-words", () => db.cards.where("state").notEqual(State.New).primaryKeys());
  const learned = useMemo(() => new Set(learnedWords ?? []), [learnedWords]);
  const [bookSets, setBookSets] = useState<Record<string, Set<string>>>({});
  const vocabCount = useCachedLiveQuery("vocab-count", () => db.vocab.count());
  const vocabLearned = useCachedLiveQuery("vocab-learned", async () => (await db.cards.bulkGet(await db.vocab.toCollection().primaryKeys())).filter((c) => c && c.state !== State.New).length);

  useEffect(() => {
    loadBookMeta().then(setBooks, () => setBooks([]));
  }, []);

  // 每本书已经学过几个词（含从生词本学过的）
  useEffect(() => {
    if (!books) return;
    for (const b of books) {
      loadBook(b.id).then((list) => setBookSets((s) => ({ ...s, [b.id]: new Set(list.map((e) => e.w.toLowerCase())) })));
    }
  }, [books]);

  const viewing = settings.activeBook ?? books?.[0]?.id ?? null;
  useEffect(() => {
    if (!viewing) return;
    setPreview(null);
    setPage(0);
    loadBook(viewing).then(setPreview);
  }, [viewing]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (preview ?? []).filter((e) => !q || e.w.toLowerCase().includes(q) || e.t.includes(q));
  }, [preview, query]);

  if (!books) return <LoadingBlock />;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div>
      <WordsTabs />
      <PageHeader title="词书" desc="生词本里的词总是先背；再选一本词书，生词背完了就从词书里补新词。学过的词按遗忘曲线自动安排复习。" />

      <div className="grid gap-3 md:grid-cols-3">
        <Card className={cn("relative flex flex-col overflow-hidden p-5", !settings.activeBook && "card-raised before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--blue)]")}>
          <div className="flex items-start justify-between gap-2">
            <PixelIcon name="books" size={36} />
            {!settings.activeBook && (
              <span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">
                <Check className="size-3.5" weight="bold" /> 正在学
              </span>
            )}
          </div>
          <h3 className="mt-3 text-[18px] leading-6 font-semibold">只背生词本</h3>
          <p className="mt-1 flex-1 text-[13px] text-[var(--ink-500)]">做题时自己加的词。后面的卷子里又出现的，卷面上会划蓝线，也会先背。</p>
          <div className="mt-4 text-[13px] text-[var(--ink-500)]">
            已学 <span className="num text-[22px] text-[var(--ink)]">{vocabLearned ?? 0}</span> <span className="num">/ {vocabCount ?? 0}</span>
          </div>
          {settings.activeBook && (
            <Button className="mt-4" onClick={() => setSetting("activeBook", null)}>
              只背生词本
            </Button>
          )}
        </Card>
        {books.map((b) => {
          const set = bookSets[b.id];
          const done = set ? [...set].filter((w) => learned.has(w)).length : 0;
          const active = settings.activeBook === b.id;
          return (
            <Card key={b.id} className={cn("relative flex flex-col overflow-hidden p-5", active && "card-raised before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--blue)]")}>
              <div className="flex items-start justify-between gap-2">
                <PixelIcon name="books" size={36} />
                {active && (
                  <span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">
                    <Check className="size-3.5" weight="bold" /> 正在学
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-[18px] leading-6 font-semibold">{b.name}</h3>
              <p className="mt-1 flex-1 text-[13px] text-[var(--ink-500)]">{BOOK_DESC[b.id] ?? ""}</p>
              <div className="mt-4 text-[13px] text-[var(--ink-500)]">
                已学 <span className="num text-[22px] text-[var(--ink)]">{done}</span> <span className="num">/ {b.count}</span>
              </div>
              {/* 答题卡式进度：只给学了一部分的书画泡 */}
              {done > 0 && done < b.count && <Bubbles total={b.count} done={done} max={20} className="mt-2" />}
              {!active && (
                <Button className="mt-4" onClick={() => setSetting("activeBook", b.id)}>
                  生词背完补这本
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="text-[16px] font-semibold">每天新词数</div>
          <div className="text-[13px] text-[var(--ink-500)]">
            {settings.activeBook ? (
              <>
                按这个速度，{books.find((b) => b.id === settings.activeBook)?.name ?? "词书"}大约需要 {Math.ceil((books.find((b) => b.id === settings.activeBook)?.count ?? 0) / settings.dailyNew)} 天学完一遍
              </>
            ) : (
              "生词本里还没背的词，每天最多拿这么多个出来背"
            )}
          </div>
        </div>
        <Segmented value={settings.dailyNew} onChange={(v) => setSetting("dailyNew", v)} options={DAILY_OPTIONS.map((n) => ({ value: n, label: `${n}` }))} />
      </Card>

      {preview && viewing && <BandCard bookId={viewing} entries={preview} learned={learned} />}

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-h2">词表 · {books.find((b) => b.id === viewing)?.name}</h2>
        <label className="flex h-10 items-center gap-2 rounded-[9px] bg-white px-3 shadow-[var(--elev-1)] focus-within:shadow-[0_0_0_2px_var(--blue)]">
          <MagnifyingGlass className="size-[18px] text-[var(--ink-500)]" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="搜索单词或释义"
            className="w-40 bg-transparent text-[14px] outline-none"
          />
        </label>
      </div>
      {!preview ? (
        <LoadingBlock />
      ) : (
        <>
          <Card className="divide-y divide-[var(--line-soft)]">
            {filtered.slice(page * PAGE, (page + 1) * PAGE).map((e) => (
              <div key={e.w} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                <div className="w-36 shrink-0 sm:w-48">
                  <div className="serif text-[16px] font-semibold">{e.w}</div>
                  {phonetic(e) && <div className="font-[family-name:var(--font-mono)] text-[13px] text-[var(--ink-500)]">{phonetic(e)}</div>}
                </div>
                <div className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-700)]">{shortTranslation(e)}</div>
                {learned.has(e.w.toLowerCase()) && <span className="tag-paper">已学</span>}
              </div>
            ))}
          </Card>
          <div className="mt-3 flex items-center justify-center gap-3 text-[14px] text-[var(--ink-500)]">
            <Button size="icon" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="上一页">
              <CaretLeft className="size-[18px]" />
            </Button>
            <span className="num">
              {page + 1} / {pages}
            </span>
            <Button size="icon" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="下一页">
              <CaretRight className="size-[18px]" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
