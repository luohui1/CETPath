import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ARTICLES_ON } from "@/lib/articles";

/* 落地页下半部分：每个模块一段，配自己画的示意图（不用任何真题内容） */
const card = "rounded-[14px] bg-white shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_30px_60px_-24px_rgba(15,31,56,0.35),0_0_0_1px_rgba(15,31,56,0.06)]";
const bar = (w: string, c = "#e6e2d8") => <span className="block h-[7px] rounded-full" style={{ width: w, background: c }} />;

function Tilt({ children, flip }: { children: ReactNode; flip?: boolean }) {
  return (
    <div className="[perspective:1400px]">
      <div className={cn("transition-transform duration-700 [transform-style:preserve-3d] hover:[transform:rotateX(0)_rotateY(0)]", flip ? "[transform:rotateX(10deg)_rotateY(16deg)]" : "[transform:rotateX(10deg)_rotateY(-16deg)]")}>{children}</div>
    </div>
  );
}

function AgentArt() {
  return (
    <div className={cn(card, "w-full max-w-[460px] p-5")}>
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] pb-3 text-[13px]">
        <span className="font-semibold">整卷复盘</span>
        <span className="text-[var(--ink-500)]">得分 71% · 用时 118 分钟</span>
      </div>
      <div className="mt-4 ml-auto w-fit rounded-[12px] bg-[var(--blue-tint,#e8f0fd)] px-3 py-2 text-[13.5px]">第 3 题为什么选 C？</div>
      <div className="mt-4 space-y-2.5">
        {[["定位", "原文第二段：the habit quietly shapes…"], ["对照", "quietly shape ≈ 选项 C 的 gradually influence"], ["排除", "A 偷换主语，B、D 原文没提"]].map(([k, v], i) => (
          <div key={k} className="flex gap-3 text-[13.5px]">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold", i === 2 ? "bg-[var(--blue)] text-white" : "bg-[var(--fill-quiet,#f1f2f4)] text-[var(--ink-700)]")}>{i + 1}</span>
            <p><b>{k}</b>　{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-[10px] bg-[#fff6d8] px-3 py-2 text-[12.5px] text-[#7a5a00]">记住了：同义替换题你常错在"偷换主语"</p>
    </div>
  );
}

function InkArt() {
  return (
    <div className={cn(card, "relative w-full max-w-[460px] p-7")}>
      <div className="space-y-2.5">{["92%", "100%", "84%"].map((w) => <span key={w}>{bar(w)}</span>)}</div>
      <p className="relative mt-4 font-serif text-[18px] leading-[1.7]">
        Habits are the <span className="bg-[#ffe27a]/80 px-0.5">compound interest</span> of{" "}
        <span className="underline decoration-[#1559c4] decoration-2 underline-offset-4">self-improvement</span>.
      </p>
      <span className="absolute top-[92px] right-6 rotate-[-4deg] font-['Kaiti_SC','STKaiti','KaiTi',serif] text-[22px] text-[#d0342c]">复利 ✓</span>
      <div className="mt-4 space-y-2.5">{["100%", "76%"].map((w) => <span key={w}>{bar(w)}</span>)}</div>
      <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 gap-1 rounded-[12px] bg-white p-1.5 text-[12px] shadow-[0_12px_30px_-10px_rgba(15,31,56,0.35),0_0_0_1px_var(--line-soft)] [transform:translateZ(40px)]">
        {["选择", "笔", "高亮", "划线", "便签", "橡皮"].map((t, i) => (
          <span key={t} className={cn("rounded-[8px] px-2.5 py-1.5", i === 1 ? "bg-[var(--blue)] text-white" : "text-[var(--ink-700)]")}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function SyntaxArt() {
  const parts: [string, string, string][] = [["Small habits", "主语", "#2b6de5"], [", repeated daily,", "修饰", "#9aa1ad"], ["quietly shape", "谓语", "#d0342c"], ["who we become", "宾语从句", "#1f9d6b"]];
  return (
    <div className={cn(card, "w-full max-w-[460px] p-6")}>
      <div className="flex flex-wrap gap-x-1.5 gap-y-5 font-serif text-[18px]">
        {parts.map(([t, l, c]) => (
          <span key={t} className="relative rounded-[8px] px-2 py-1" style={{ background: `${c}1a`, boxShadow: `inset 0 -2px 0 ${c}` }}>
            {t}
            <span className="absolute -bottom-5 left-2 font-sans text-[11px] font-semibold" style={{ color: c }}>{l}</span>
          </span>
        ))}
      </div>
      <p className="mt-9 border-t border-[var(--line-soft)] pt-3 text-[13.5px] text-[var(--ink-700)]">每天重复的小习惯，悄悄塑造了我们会成为什么样的人。</p>
    </div>
  );
}

function ArticleArt() {
  return (
    <div className={cn(card, "w-full max-w-[460px] p-6")}>
      <span className="text-[11px] font-semibold tracking-wide text-[var(--blue)]">VOA · 四级难度 · 5 分钟</span>
      <h4 className="mt-1.5 font-serif text-[19px] font-bold">The quiet power of small habits</h4>
      <div className="mt-4 grid grid-cols-[1fr_0.8fr] gap-5">
        <div className="space-y-2.5">{["100%", "94%", "98%", "70%", "100%", "88%"].map((w, i) => <span key={i}>{bar(w)}</span>)}</div>
        <div className="space-y-2.5">{["100%", "90%", "60%", "100%", "84%"].map((w, i) => <span key={i}>{bar(w, "#eef1f6")}</span>)}</div>
      </div>
      <div className="mt-5 flex gap-2 text-[12px]">
        {["查词", "译文", "长难句", "出 5 道题"].map((t) => <span key={t} className="rounded-full px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--line)]">{t}</span>)}
      </div>
    </div>
  );
}

function SyncArt() {
  return (
    <div className="relative h-[280px] w-full max-w-[460px]">
      <div className={cn(card, "absolute top-0 left-0 h-[200px] w-[300px] p-4")}>
        <div className="mb-3 flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-2 rounded-full bg-[#e6e2d8]" />)}</div>
        <div className="space-y-2.5">{["90%", "70%", "84%", "60%"].map((w) => <span key={w}>{bar(w)}</span>)}</div>
      </div>
      <div className={cn(card, "absolute top-14 left-[200px] h-[200px] w-[150px] rounded-[18px] p-3.5 [transform:translateZ(30px)]")}>
        <div className="space-y-2">{["100%", "80%", "92%", "70%", "86%"].map((w) => <span key={w}>{bar(w)}</span>)}</div>
        <span className="mt-4 block w-fit rounded bg-[#ffe27a] px-1.5 text-[11px]">serendipity</span>
      </div>
      <div className={cn(card, "absolute top-28 left-[330px] h-[150px] w-[80px] rounded-[16px] p-2.5 [transform:translateZ(60px)]")}>
        <div className="space-y-2">{["100%", "70%", "90%"].map((w) => <span key={w}>{bar(w)}</span>)}</div>
      </div>
      <span className="absolute top-[150px] left-[150px] rounded-full bg-[var(--ink)] px-3 py-1 text-[12px] font-medium text-white shadow-lg [transform:translateZ(80px)]">已同步 ✓</span>
    </div>
  );
}

const ROWS: { tag: string; title: string; desc: string; art: ReactNode }[] = [
  { tag: "Agent", title: "做完题，找它复盘", desc: "它看得到你每题选了什么、错在哪、用了多久。按定位、对照、排除一步步讲，说人话；还会记住你的薄弱点，下次讲得更对路。", art: <AgentArt /> },
  { tag: "卷面", title: "像在纸上一样写", desc: "笔、高亮、划线、便签、套索、橡皮，平板上手指滑动、笔写字。你写的笔记 Agent 也认得出来。", art: <InkArt /> },
  { tag: "长难句", title: "一句话拆成几块", desc: "主语、谓语、从句、修饰用颜色分开，点一块看它的作用和意思，最后给一句通顺的译文。", art: <SyntaxArt /> },
  { tag: "外刊", title: "每天一篇新外刊", desc: "VOA 和英文维基百科每天更新，按四六级难度分好。点词查词、中英对照、选句子问 Agent，读完还能按真题题型出题。", art: <ArticleArt /> },
  { tag: "同步", title: "电脑、平板、手机都一样", desc: "登录后生词、错题、做题记录、笔记和 Agent 档案自动同步。没网也能用，联网后自动补传。", art: <SyncArt /> },
];

export function WelcomeSections() {
  return (
    <div className="relative border-t border-[var(--line)] bg-[linear-gradient(#fbfaf6,var(--paper,#f6f4ee))]">
      <div className="mx-auto max-w-[1180px] space-y-28 px-6 py-24 sm:px-10 lg:space-y-36 lg:py-32">
        {ROWS.filter((r) => ARTICLES_ON || r.tag !== "外刊").map((r, i) => (
          <section key={r.tag} className={cn("grid items-center gap-12 lg:grid-cols-2 lg:gap-20", i % 2 && "lg:[&>*:first-child]:order-2")}>
            <div>
              <span className="font-serif text-[15px] font-semibold text-[#d0342c]">0{i + 1} · {r.tag}</span>
              <h2 className="mt-3 font-serif text-[40px] leading-[1.15] font-bold tracking-[-0.01em] sm:text-[52px]">{r.title}</h2>
              <p className="mt-5 max-w-[30em] text-[17px] leading-[1.8] text-[var(--ink-700)]">{r.desc}</p>
            </div>
            <div className="flex justify-center">
              <Tilt flip={!!(i % 2)}>{r.art}</Tilt>
            </div>
          </section>
        ))}
        <section className="text-center">
          <h2 className="font-serif text-[44px] font-bold sm:text-[64px]">今天就做一套。</h2>
          <button type="button" onClick={() => scrollTo({ top: 0, behavior: "smooth" })} className="mt-8 h-14 rounded-[10px] bg-[var(--ink)] px-10 text-[17px] font-semibold text-white transition-transform active:scale-[0.98]">
            注册 / 登录
          </button>
        </section>
      </div>
    </div>
  );
}
