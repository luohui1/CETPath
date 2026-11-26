import type { ReactNode } from "react";
import * as G from "@/grasso";
import { db, dayKey } from "@/lib/db";
import { isMastered, State } from "@/lib/learning";
import { isIeltsExam, KIND_NAMES } from "@/lib/papers";
import { useSettings } from "@/lib/settings";
import { currentStreak, isActive, longestStreak } from "@/lib/stats";
import { lastDays, MIN_ANSWERS, pct, useAttemptItems, useCetScores, useKindStats, usePaperIndex, type ScoreRow } from "@/lib/insights";
import { CET_PART_MAX } from "@/lib/report";
import { useCachedLiveQuery } from "@/lib/live";
import { cn } from "@/lib/utils";
import { LoadingBlock, PageHeader } from "@/components/ui";
import { Heatmap } from "@/components/Heatmap";
import { KIND_PIXELS, PixelIcon } from "@/components/PixelIcon";
import { DayColumns, MemoryStrip, Sparkline } from "@/components/viz";
import { IeltsStatsPanel } from "@/ielts/components/IeltsStatsPanel";
import { useIeltsAttempts } from "@/ielts/store";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 未来 7 天每天到期要复习的词（已经过期的算在今天） */
function useForecast() {
  return useCachedLiveQuery("forecast", async () => {
    const cards = await db.cards.where("state").notEqual(State.New).toArray();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return { label: i === 0 ? "今天" : `周${WEEKDAYS[d.getDay()]}`, 复习: 0 };
    });
    for (const c of cards) {
      const i = Math.max(0, Math.floor((c.due - today.getTime()) / 86_400_000));
      if (i < 7) buckets[i].复习++;
    }
    return buckets;
  });
}

/** 做题时长拆成数字和单位：不到 1 小时说分钟，否则说小时（一位小数） */
function spentParts(sec: number): [string, string] {
  const m = Math.round(sec / 60);
  return m < 60 ? [`${m}`, "分钟"] : [`${Math.round(m / 6) / 10}`, "小时"];
}

const fmt = (x: number) => (Number.isInteger(x) ? `${x}` : x.toFixed(1));
const shortDate = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 真题成绩：按四六级计分规则折算的听力、阅读分，最近一次 + 走势 + 最近几次的明细 */
function ScoresPanel({ rows }: { rows: ScoreRow[] | null }) {
  if (!rows) return <p className="well py-10 text-center text-[14px] text-[var(--ink-500)]">正在算……</p>;
  if (!rows.length)
    return <p className="well px-4 py-10 text-center text-[14px] leading-6 text-[var(--ink-500)]">交过一套四六级整卷后，这里按官方计分规则折算听力、阅读分（满分各 248.5），看得出每次进步了多少。</p>;
  const last = rows[rows.length - 1];
  const best = rows.reduce((b, r) => (r.listening + r.reading > b.listening + b.reading ? r : b), rows[0]);
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const delta = prev ? Math.round((last.listening + last.reading - prev.listening - prev.reading) * 10) / 10 : null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "听力", value: last.listening, max: CET_PART_MAX },
          { label: "阅读", value: last.reading, max: CET_PART_MAX },
          { label: "合计", value: Math.round((last.listening + last.reading) * 10) / 10, max: CET_PART_MAX * 2 },
        ].map((x) => (
          <div key={x.label} className="well px-4 py-3">
            <div className="t-label">最近一次 · {x.label}</div>
            <div className="num mt-1 text-[30px] leading-9">
              {fmt(x.value)}
              <span className="ml-1 font-[family-name:var(--font-sans)] text-[13px] font-normal text-[var(--ink-500)]">/ {fmt(x.max)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[13px] leading-5 text-[var(--ink-500)]">
        {last.title} · {shortDate(last.at)} 交卷
        {delta !== null && `；比上一次${delta >= 0 ? `多 ${fmt(delta)}` : `少 ${fmt(-delta)}`} 分`}
        {rows.length > 1 && (best === last ? "，是目前最好的一次" : `；最好的一次 ${fmt(Math.round((best.listening + best.reading) * 10) / 10)} 分（${best.title}）`)}。写作、翻译要人工判，没算在里面。
      </p>
      {rows.length > 1 && (
        <G.LineChart
          data={rows.slice(-12).map((r) => ({ label: shortDate(r.at), 听力: r.listening, 阅读: r.reading }))}
          series={[
            { key: "听力", label: "听力" },
            { key: "阅读", label: "阅读" },
          ]}
          height={200}
          ariaLabel="历次整卷的听力、阅读折算分"
          xLabel="交卷日期"
        />
      )}
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[13px] text-[var(--ink-500)]">
            <th className="pb-2 font-normal">日期</th>
            <th className="pb-2 font-normal">试卷</th>
            <th className="pb-2 text-right font-normal">听力</th>
            <th className="pb-2 text-right font-normal">阅读</th>
            <th className="pb-2 text-right font-normal">合计</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice(-8)
            .reverse()
            .map((r) => (
              <tr key={`${r.key}${r.at}`} className="border-t border-[var(--line-soft)]">
                <td className="num py-2 pr-3 whitespace-nowrap text-[var(--ink-500)]">{shortDate(r.at)}</td>
                <td className="py-2 pr-3">{r.title}</td>
                <td className="num py-2 text-right">{fmt(r.listening)}</td>
                <td className="num py-2 text-right">{fmt(r.reading)}</td>
                <td className="num py-2 text-right font-semibold">{fmt(Math.round((r.listening + r.reading) * 10) / 10)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** 概况的一格：标签、衬线大数字、说明，下面两周走势（全是 0 就不画，免得一条平线像坏了） */
function Tile({ label, value, unit, note, trend }: { label: string; value: string; unit?: string; note: ReactNode; trend?: number[] }) {
  if (trend && !trend.some((x) => x > 0)) trend = undefined;
  return (
    <div className="card flex flex-col p-4 lg:p-5">
      <div className="t-label">{label}</div>
      <div className="num mt-1.5 text-[36px] leading-10">
        {value}
        {unit && <span className="ml-0.5 font-[family-name:var(--font-sans)] text-[13px] font-normal text-[var(--ink-500)]">{unit}</span>}
      </div>
      <div className="mt-1 text-[13px] leading-5 text-[var(--ink-500)]">{note}</div>
      {trend && <Sparkline data={trend} color="var(--ink-700)" height={28} className="mt-auto h-7 pt-2" />}
    </div>
  );
}

/** 一块统计：标题 + 图；说明放在标题的悬停提示里 */
function Panel({ title, desc, className, children }: { title: string; desc?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("card p-6", className)}>
      <h2 className="t-h2" title={desc}>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** 学习统计：打卡、做题和背词的长期数据 */
export function StatsPage() {
  const settings = useSettings();
  const days = useCachedLiveQuery("days", () => db.days.toArray());
  const cards = useCachedLiveQuery("cards", () => db.cards.toArray());
  const vocabCount = useCachedLiveQuery("vocab-count", () => db.vocab.count());
  const logs = useCachedLiveQuery("logs-30d", () => db.logs.where("reviewedAt").above(Date.now() - 30 * 86_400_000).toArray());
  const forecast = useForecast();
  const { index } = usePaperIndex();
  const items = useAttemptItems(index);
  const kinds = useKindStats(index, items);
  const scores = useCetScores(items);
  const ieltsAttempts = useIeltsAttempts();

  if (!days || !cards || !logs || !forecast) return <LoadingBlock />;

  const month = lastDays(days, 30);
  const totalQuestions = days.reduce((s, d) => s + d.questions, 0);
  const totalCorrect = days.reduce((s, d) => s + d.correct, 0);
  const mastered = cards.filter(isMastered).length;
  const recall = logs.length ? pct(logs.filter((l) => l.rating > 1).length, logs.length) : null;
  const submitted = (items ?? []).filter((it) => it.attempt.submittedAt);
  const ieltsSubmitted = (ieltsAttempts ?? []).filter((a) => a.submittedAt);
  const ieltsSpent = (ieltsAttempts ?? []).reduce(
    (sum, a) => sum + Object.values(a.sections).reduce((s, sec) => s + (sec?.elapsed ?? 0), 0),
    0,
  );
  const spent = (items ?? []).reduce((s, it) => s + (it.attempt.spentSec ?? 0), 0) + ieltsSpent;
  const ieltsFirst = isIeltsExam(settings.lastExam) || (ieltsSubmitted.length > 0 && !(scores?.length ?? 0));

  const memory = [
    { label: "已掌握", value: mastered },
    { label: "复习中", value: cards.filter((c) => c.state === State.Review && !isMastered(c)).length },
    { label: "学习中", value: cards.filter((c) => c.state === State.Learning || c.state === State.Relearning).length },
    { label: "未学", value: cards.filter((c) => c.state === State.New).length },
  ].filter((m) => m.value);

  // 各题型正确率和所有题型的平均比
  // 答题不足 5 题看不出水平，不列
  const kindRows = (kinds ?? []).filter((k) => k.answered >= MIN_ANSWERS);
  const weakest = [...kindRows].sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
  const kindCorrect = kindRows.reduce((n, k) => n + k.correct, 0);
  const kindTotal = kindRows.reduce((n, k) => n + k.total, 0);
  const avg = pct(kindCorrect, kindTotal);

  return (
    <div className="space-y-5">
      <PageHeader title="学习统计" desc="每天复习过单词或做过题，就算打卡一天。" />

      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        <Tile label="连续打卡" value={`${currentStreak(days)}`} unit="天" note={`最长 ${longestStreak(days)} 天，累计 ${days.filter(isActive).length} 天`} trend={month.slice(-14).map((d) => (isActive(d) ? 1 : 0))} />
        <Tile
          label="做题正确率"
          value={totalQuestions ? `${pct(totalCorrect, totalQuestions)}` : "—"}
          unit={totalQuestions ? "%" : ""}
          note={`共 ${totalQuestions} 道客观题`}
          trend={month.slice(-14).map((d) => (d.questions ? pct(d.correct, d.questions) : 0))}
        />
        <Tile label="做题时长" value={spentParts(spent)[0]} unit={spentParts(spent)[1]} note={`交卷 ${submitted.length + ieltsSubmitted.length} 次`} />
        <Tile label="已掌握单词" value={`${mastered}`} unit="个" note={`生词本 ${vocabCount ?? 0} 个${recall === null ? "" : ` · 近 30 天认识率 ${recall}%`}`} trend={month.slice(-14).map((d) => d.reviews)} />
      </div>

      {ieltsFirst && (
        <Panel title="雅思机考成绩" desc="仅统计未开启辅助查词的纯净模考（mode === mock）听力、阅读与估算均分走势">
          <IeltsStatsPanel />
        </Panel>
      )}

      <Panel title="真题成绩" desc="整套四六级交卷后，按官方计分规则折算听力、阅读分；写作翻译不算">
        <ScoresPanel rows={scores} />
      </Panel>

      {!ieltsFirst && (
        <Panel title="雅思机考成绩" desc="仅统计未开启辅助查词的纯净模考（mode === mock）听力、阅读与估算均分走势">
          <IeltsStatsPanel />
        </Panel>
      )}

      <Panel title="近 30 天" desc="每天做的客观题和复习的单词">
        <G.AreaChart
          data={month.map((d) => ({ label: d.label, 做题: d.questions, 背词: d.reviews }))}
          series={[
            { key: "做题", label: "做题" },
            { key: "背词", label: "背词" },
          ]}
          height={220}
          ariaLabel="近 30 天学习量"
          xLabel="日期"
        />
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        <Panel title={kindTotal ? `各题型正确率 · 平均 ${avg}%` : "各题型正确率"} desc="整套和专项都算；蓝色竖线是平均" className="lg:col-span-2">
          {kindRows.length ? (
            <div className="space-y-1">
              {kindRows.map((k) => {
                const v = pct(k.correct, k.total);
                const diff = v - avg;
                return (
                  <div key={k.kind} className="grid h-11 grid-cols-[22px_5em_minmax(0,1fr)_3.5em_3.5em] items-center gap-3" title={`答对 ${k.correct} / ${k.total} 题`}>
                    <PixelIcon name={KIND_PIXELS[k.kind]} size={20} />
                    <span className="text-[14px]">{KIND_NAMES[k.kind]}</span>
                    <div className="relative h-2.5 rounded-full bg-[var(--paper-200)]">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: k === weakest && kindRows.length > 1 ? "var(--red)" : "var(--ink)" }} />
                      {/* 平均线 */}
                      <span className="absolute -top-1.5 -bottom-1.5 w-[2px] rounded-full bg-[var(--blue)]" style={{ left: `calc(${avg}% - 1px)` }} aria-hidden />
                    </div>
                    <span className="num text-right text-[17px]">{v}%</span>
                    <span className="num text-right text-[13px] text-[var(--ink-500)]">
                      {diff > 0 ? "+" : ""}
                      {diff}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="well py-10 text-center text-[14px] text-[var(--ink-500)]">每种题型答够 5 题后，这里按题型统计</p>
          )}
        </Panel>
        <Panel title="单词记忆" desc="按复习状态">
          <div className="num mb-4 text-[40px] leading-[44px]">
            {cards.length}
            <span className="ml-1 font-[family-name:var(--font-sans)] text-[13px] font-normal text-[var(--ink-500)]">个单词</span>
          </div>
          {memory.length ? <MemoryStrip memory={memory} total={cards.length} /> : <p className="well py-8 text-center text-[13px] text-[var(--ink-500)]">选一本词书开始背词</p>}
        </Panel>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        <Panel title="未来 7 天复习" desc="已经过期没复习的算在今天">
          <DayColumns data={forecast.map((f) => ({ label: f.label, value: f.复习 }))} unit=" 个" />
        </Panel>
        <Panel title={`打卡记录 · 今天${isActive(days.find((d) => d.day === dayKey())) ? "已打卡" : "还没打卡"}`} className="lg:col-span-2">
          <Heatmap days={days} weeks={30} />
        </Panel>
      </div>
    </div>
  );
}
