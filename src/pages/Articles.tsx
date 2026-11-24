import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { loadArticleIndex, SOURCE_NAMES, type ArticleMeta } from "@/lib/articles";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";

const LEVELS = ["全部", "四级", "六级", "考研"] as const;
const SOURCES = [
  ["all", "全部来源"],
  ["voa", "VOA"],
  ["wiki", "维基百科"],
] as const;
const READ_KEY = "yz-articles-read";

export function ArticlesPage() {
  const [list, setList] = useState<ArticleMeta[] | null>(null);
  const [error, setError] = useState(false);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("全部");
  const [source, setSource] = useState<(typeof SOURCES)[number][0]>("all");
  const read = useMemo(() => new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]")), []);
  const vocabN = useLiveQuery(() => db.vocab.count(), []);
  useEffect(() => {
    loadArticleIndex().then(setList, () => setError(true));
  }, []);
  const shown = (list ?? []).filter((a) => (level === "全部" || a.level === level) && (source === "all" || a.source === source));
  const chip = (on: boolean) =>
    cn("h-8 rounded-full px-3 text-[13px] font-medium transition", on ? "bg-[var(--ink)] text-white" : "bg-[var(--paper-100)] text-[var(--ink-700)] hover:bg-[var(--fill-quiet)]");
  return (
    <div className="mx-auto max-w-[920px] px-5 py-6">
      <PageHeader title="外刊阅读" desc={`每天更新 VOA Learning English 和英文维基百科的文章，话题贴近考研阅读。点词查词，生词加进生词本${vocabN ? `（现在 ${vocabN} 个）` : ""}，右边 Agent 帮你读。`} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <button key={l} type="button" className={chip(level === l)} onClick={() => setLevel(l)}>
            {l === "全部" ? "全部难度" : `${l}难度`}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[var(--line)]" />
        {SOURCES.map(([v, l]) => (
          <button key={v} type="button" className={chip(source === v)} onClick={() => setSource(v)}>
            {l}
          </button>
        ))}
      </div>
      {!list && !error && (
        <div className="grid place-items-center py-20">
          <Spinner />
        </div>
      )}
      {error && <EmptyState title="文章还没准备好" desc="外刊每天早上 6 点更新，稍后再来看看。" />}
      {list && !shown.length && <EmptyState title="没有符合条件的文章" desc="换个难度或来源试试。" />}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {shown.map((a) => (
          <li key={a.id}>
            <Link to={`/articles/${a.id}`} className="group flex h-full gap-3 rounded-[14px] bg-white p-3 ring-1 ring-[var(--line)] transition hover:ring-[var(--blue-line,#bcd3f5)]">
              {a.image && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-[84px] flex-none rounded-[10px] object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
              <div className="min-w-0 flex-1">
                <p className={cn("line-clamp-2 font-serif text-[16px] leading-[1.35] font-semibold group-hover:text-[var(--blue)]", read.has(a.id) && "text-[var(--ink-500)]")}>{a.title}</p>
                <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-[var(--ink-500)]">{a.summary}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--ink-500)]">
                  <span className="rounded-full bg-[var(--blue-tint)] px-1.5 text-[var(--blue)]">{a.level}</span>
                  <span>{SOURCE_NAMES[a.source]}</span>
                  <span>{a.words} 词 · {a.minutes} 分钟</span>
                  {a.audio && <span>可听</span>}
                  <span>{a.published.slice(0, 10)}</span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
