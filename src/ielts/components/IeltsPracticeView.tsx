import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Shuffle, ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button, Card, EmptyState, LoadingBlock, Segmented } from "@/components/ui";
import { PixelIcon } from "@/components/PixelIcon";
import { ieltsPaperLabel, loadWritingJj, useIeltsIndex } from "../data";
import { useIeltsAttempts } from "../store";
import { DeleteRunButton } from "./DeleteRunButton";
import type { IeltsAttemptRow, IeltsExamId, IeltsRunMode, IeltsSkill, WritingJjItem } from "../types";

type PracticeTab = "listening" | "reading" | "writing" | "speaking";

export function IeltsPracticeView({ exam }: { exam: IeltsExamId }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { index, error } = useIeltsIndex();
  const attempts = useIeltsAttempts();
  const [mode, setMode] = useState<IeltsRunMode>("practice");
  const [wjBank, setWjBank] = useState<WritingJjItem[] | null>(null);
  const [wjSource, setWjSource] = useState<"jj" | "cam">("jj");
  const [wjPart, setWjPart] = useState<0 | 1 | 2>(0);
  const [wjTopic, setWjTopic] = useState("");
  const [wjSort, setWjSort] = useState<"hit" | "recent">("hit");

  const rawKind = params.get("kind");
  const tab: PracticeTab =
    rawKind === "reading" || rawKind === "writing" || rawKind === "speaking" ? rawKind : "listening";

  useEffect(() => {
    if (tab === "writing" && !wjBank) {
      void loadWritingJj().then(setWjBank, () => setWjBank([]));
    }
  }, [tab, wjBank]);

  const papers = useMemo(
    () => (index?.papers ?? []).filter((p) => p.exam === exam && p.skills.includes(tab === "speaking" ? "listening" : tab)),
    [index, exam, tab],
  );

  const latestRunMap = useMemo(() => {
    const m = new Map<string, IeltsAttemptRow>();
    for (const a of attempts ?? []) {
      for (const sk of a.skills) {
        const key = `${a.paperId}:${sk}`;
        if (!m.has(key)) m.set(key, a);
      }
    }
    return m;
  }, [attempts]);

  const doneSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of attempts ?? []) {
      if (a.submittedAt) {
        for (const sk of a.skills) s.add(`${a.paperId}:${sk}`);
      }
    }
    return s;
  }, [attempts]);

  if (error) return <EmptyState title="加载雅思专项失败" desc={error} />;
  if (!index) return <LoadingBlock text="正在准备雅思专项训练…" />;

  const cards: { id: PracticeTab; label: string; icon: "headphones" | "book" | "pen" | "notebook"; sub: string }[] = [
    {
      id: "listening",
      label: "听力单项",
      icon: "headphones",
      sub: `${(index.papers ?? []).filter((p) => p.exam === exam && p.skills.includes("listening")).length} 套音频精练`,
    },
    {
      id: "reading",
      label: "阅读单项",
      icon: "book",
      sub: `${(index.papers ?? []).filter((p) => p.exam === exam && p.skills.includes("reading")).length} 套阅读拆练`,
    },
    {
      id: "writing",
      label: "写作与机经",
      icon: "pen",
      sub: `${index.writingJj} 道机经题 + 剑雅大小作文`,
    },
    {
      id: "speaking",
      label: "口语跟练",
      icon: "notebook",
      sub: `${index.speakingTopics} 个当季话题 · 录音回放`,
    },
  ];

  const pickRandomPaper = (sk: IeltsSkill) => {
    const pool = (index.papers ?? []).filter((p) => p.exam === exam && p.skills.includes(sk));
    const fresh = pool.filter((p) => !doneSet.has(`${p.id}:${sk}`));
    const chosen = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    if (chosen) navigate(`/ielts/start/${encodeURIComponent(chosen.id)}?scope=${sk}&mode=${mode}`);
  };

  const wjTopics = useMemo(() => [...new Set((wjBank ?? []).map((x) => x.topic))], [wjBank]);
  const shownWj = useMemo(() => {
    let list = (wjBank ?? []).filter((b) => (!wjPart || b.part === wjPart) && (!wjTopic || b.topic === wjTopic));
    list = [...list].sort((a, b) =>
      wjSort === "hit" ? (b.hitCount || 0) - (a.hitCount || 0) : String(b.lastHit || "").localeCompare(String(a.lastHit || "")),
    );
    return list;
  }, [wjBank, wjPart, wjTopic, wjSort]);

  return (
    <div>
      {/* 4 Skill Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const active = tab === c.id;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (c.id === "speaking") navigate("/speaking");
                else setParams({ exam, kind: c.id }, { replace: true });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  if (c.id === "speaking") navigate("/speaking");
                  else setParams({ exam, kind: c.id }, { replace: true });
                }
              }}
              className={cn(
                "card card-press relative flex items-center gap-3.5 overflow-hidden p-5",
                active && "card-raised before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--blue)]",
              )}
            >
              <PixelIcon name={c.icon} size={34} />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold">{c.label}</div>
                <div className="mt-0.5 truncate text-[12.5px] text-[var(--ink-500)]">{c.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mode Switch Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {tab === "writing" ? (
            <Segmented
              label="写作题源"
              value={wjSource}
              onChange={setWjSource}
              options={[
                { value: "jj", label: `机经 Pro 题库 (${index.writingJj})` },
                { value: "cam", label: "剑雅真题写作" },
              ]}
            />
          ) : (
            <Button size="sm" onClick={() => pickRandomPaper(tab as IeltsSkill)}>
              <Shuffle className="size-4" /> 随机来一套
            </Button>
          )}
        </div>

        <Segmented
          label="作答模式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "practice", label: "自由练习（不限时）" },
            { value: "mock", label: "限时机考" },
          ]}
        />
      </div>

      {/* Writing JJ Bank View */}
      {tab === "writing" && wjSource === "jj" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Task"
              value={wjPart}
              onChange={(v) => { setWjPart(v); setWjTopic(""); }}
              options={[
                { value: 0, label: "全部" },
                { value: 1, label: "Task 1 小作文" },
                { value: 2, label: "Task 2 大作文" },
              ]}
            />
            <Segmented
              label="排序"
              value={wjSort}
              onChange={setWjSort}
              options={[
                { value: "hit", label: "按命中次数" },
                { value: "recent", label: "按最近命中" },
              ]}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {["", ...wjTopics].map((t) => (
              <button
                key={t || "all"}
                type="button"
                onClick={() => setWjTopic(t)}
                className={cn("pill", wjTopic === t && "pill-on")}
              >
                {t || "全部话题"}
              </button>
            ))}
          </div>

          {!wjBank ? (
            <LoadingBlock text="正在加载 242 道机经写作题…" />
          ) : (
            <Card className="divide-y divide-[var(--line-soft)]">
              {shownWj.slice(0, 120).map((b) => {
                const latest = latestRunMap.get(`wj:${b.id}:writing`);
                const done = doneSet.has(`wj:${b.id}:writing`);
                return (
                  <div key={b.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{b.title}</div>
                      <div className="text-[12.5px] text-[var(--ink-500)]">
                        Task {b.part} · {b.topic}
                        {b.hitCount ? ` · 命中 ${b.hitCount} 次` : ""}
                        {b.lastHit && b.lastHit !== "None" ? ` · 最近 ${b.lastHit}` : ""}
                      </div>
                    </div>
                    {latest && !latest.submittedAt ? (
                      <span className="tag-paper text-[#b87400]">进行中</span>
                    ) : (
                      done && <span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">已写</span>
                    )}
                    {latest && <DeleteRunButton run={latest} iconOnly />}
                    <Link
                      to={
                        latest && !latest.submittedAt
                          ? `/ielts/exam/${latest.id}`
                          : `/ielts/start/${encodeURIComponent(`wj:${b.id}`)}?scope=writing&mode=${mode}`
                      }
                    >
                      <Button size="sm">
                        {latest && !latest.submittedAt ? "继续写" : "开始写"} <ArrowRight className="size-3.5" />
                      </Button>
                    </Link>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      ) : (
        /* Paper Section List for Listening / Reading / Cam Writing */
        <Card className="divide-y divide-[var(--line-soft)]">
          {papers.map((p) => {
            const sk = tab as IeltsSkill;
            const latest = latestRunMap.get(`${p.id}:${sk}`);
            const done = doneSet.has(`${p.id}:${sk}`);
            return (
              <div key={p.id} className="flex min-h-[54px] items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{ieltsPaperLabel(p)}</div>
                  <div className="text-[12.5px] text-[var(--ink-500)]">
                    {p.q[sk] ? `${p.q[sk]} ${sk === "writing" ? "篇" : "题"}` : ""}
                    {p.hit?.date ? ` · 最近命中 ${p.hit.date}` : ""}
                  </div>
                </div>
                {latest && !latest.submittedAt ? (
                  <span className="tag-paper text-[#b87400]">进行中</span>
                ) : (
                  done && <span className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">已练</span>
                )}
                {latest && <DeleteRunButton run={latest} iconOnly />}
                <Link
                  to={
                    latest && !latest.submittedAt && latest.scope === sk
                      ? `/ielts/exam/${latest.id}`
                      : `/ielts/start/${encodeURIComponent(p.id)}?scope=${sk}&mode=${mode}`
                  }
                >
                  <Button size="sm">
                    {latest && !latest.submittedAt && latest.scope === sk ? "继续" : "开始"} <ArrowRight className="size-3.5" />
                  </Button>
                </Link>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
