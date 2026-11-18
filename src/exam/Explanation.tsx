import { createContext, useContext, useState, type ReactNode } from "react";
import { CaretDown, Check, Crosshair, Play, Plus, X } from "@phosphor-icons/react";
import type { ExplainFields, ExplainSource, Question } from "@/lib/papers";
import { addToVocab } from "@/lib/learning";
import { setSetting, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { CardSection, QuoteAction, QuoteBlock } from "./cardParts";

/** 把"【定位】……\n【详解】……"拆成一段一段，小标题单独拿出来 */
function segments(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^【([^】]{1,8})】\s*/);
      return m ? { label: m[1], body: line.slice(m[0].length) } : { label: null, body: line };
    });
}

function AiTag({ short }: { short?: boolean }) {
  return (
    <span title="官方解析里没有这道题，由 AI 按原文和答案补写，仅供参考" className="tag-paper bg-[var(--blue-tint)] text-[var(--blue)]">
      {short ? "AI" : "AI 解析"}
    </span>
  );
}

/** 一题的解析（文本）：小标题行内加粗，AI 补写的标出来 */
export function Explanation({ text, by, className }: { text: string; by?: ExplainSource; className?: string }) {
  return (
    <div className={cn("space-y-1.5 text-[14px] leading-[1.75] text-[var(--ink-700)]", className)}>
      {by === "ai" && <AiTag />}
      {segments(text).map((s, i) => (
        <p key={i}>
          {s.label && <b className="mr-1.5 font-semibold text-[var(--ink)]">{s.label}</b>}
          {s.body}
        </p>
      ))}
    </div>
  );
}

/** 考场给解析的动作：在卷面上标出定位句、播放听力定位句。不在考场里（错题本页）就没有 */
export interface ExplainActions {
  paperId: string;
  paperTitle: string;
  flashWords?: (page: number, range: [number, number]) => void;
  /** 这道题能不能"听这一句"（听力题，且找得到那一行） */
  canListen?: (q: Question, locate: NonNullable<ExplainFields["locate"]>) => boolean;
  listen?: (q: Question, locate: NonNullable<ExplainFields["locate"]>) => void;
}

export const ExplainContext = createContext<ExplainActions | null>(null);

/* ---------- 一句话结论 ---------- */

const BRIEF_MAX = 64; // 一句话结论最多几个字（平板竖屏两行）
// 开头套话：整句去掉（"根据题干……定位到……。"、"题干问……。"），或去掉开头几个字（"本题考查……，"、"【详解】"、"解析："）
const LEAD_SENTENCES = [/^(根据|由|通过|从)(题干|题目)[^。；！]*?(定位|锁定|找到|对应)[^。；！]*[。；！]/, /^(本|此|该)?题(干|目)?(问|询问|问的是|要求|考查的是)[^。；！]{0,30}[。；！]/];
const LEAD_WORDS = [
  /^【[^】]{1,8}】\s*/,
  /^[[【]?(答案)?(解析|详解|分析)[\]】:：]?\s*/,
  /^(本|此|该)题(主要)?(考查|考察|测试)[^，。；！]*[，。；！]\s*/,
  /^(由此|因此|所以|故)可知[，,]?\s*/,
  /^(答案为)?[A-O]\s?[)）]?\s*[。.，,]\s*/, // 【答案精析】后面先写答案字母："A。第 2 段……"
];

/** 扫描版解析开头抄了题干和选项（"……？ A)…。 B)…。 C)…。 D)…。解……"）：去掉，连同识别出的"解""金"这类图标残字 */
function dropStem(text: string) {
  // 只认开头就是"题干？ A)…"的抄写：A) 前面 80 字以内、有问号；正文里分析选项时写的 A)…D) 不动
  const m = text.match(/^[\s\S]{0,240}?D[)）][^。！!]*[。！!]\s*/);
  const a = m?.[0].search(/A[)）]/) ?? -1;
  if (!m || a < 0 || a > 80 || !/[？?]/.test(m[0].slice(0, a + 1))) return text;
  return text.slice(m[0].length).replace(/^[！!]?[解金答]?(?=根据|由|文章|讲话|说话|对话|选项|该|题干|新闻|在|从|本)/, "");
}

/** 去掉开头套话后的第一句（在第一个。；！处截断） */
function firstSentence(text?: string) {
  if (!text) return "";
  let t = dropStem(text.trim());
  for (let k = 0; k < 4; k++) {
    const before = t;
    for (const re of LEAD_SENTENCES) t = t.replace(re, "").trim();
    for (const re of LEAD_WORDS) t = t.replace(re, "").trim();
    if (t === before) break;
  }
  // 第一句：在第一个不在引号里的。；！处截断（"作答“我真的是热爱我所做的事。能有……”"里的句号不算）
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "“") depth++;
    else if (c === "”") depth = Math.max(0, depth - 1);
    else if (depth === 0 && "。；！!".includes(c)) return t.slice(0, i).trim();
  }
  return t.trim();
}

/** 超过 n 字：在 n 以内最后一个逗号、冒号处截断；fromEnd 时反过来留后半（"……，应填名词"的结论在后头） */
function clip(s: string, n: number, fromEnd = false) {
  if (s.length <= n) return s;
  // 按逗号、冒号切开，每段带着自己的标点（不用后行断言：老 Safari 不认）
  const parts = (s.match(/[^，,：:]*[，,：:]?/g) ?? []).filter(Boolean);
  if (fromEnd) {
    let out = "";
    for (let i = parts.length - 1; i >= 0 && (parts[i] + out).length <= n; i--) out = parts[i] + out;
    return out || s.slice(-n);
  }
  let out = "";
  for (const p of parts) {
    if ((out + p).length > n) break;
    out += p;
  }
  return (out.length >= 24 ? out.replace(/[，,：:]$/, "") : hardCut(s, n - 1)) + "…";
}

/** 硬截到 n 个字以内，但不把英文单词从中间切开 */
function hardCut(s: string, n: number) {
  const cut = s.slice(0, n);
  if (!/[A-Za-z]/.test(s[n] ?? "") || !/[A-Za-z]$/.test(cut)) return cut;
  const back = cut.replace(/[A-Za-z'’-]+$/, "").trimEnd();
  return back.length >= n * 0.6 ? back : cut;
}

/** 一句话结论：brief → 思路第一句（选词、完形是"语法…；语义…"）→ 文本解析【详解】段的第一句 */
export function briefOf(q: Question) {
  const f = q.explain;
  if (f?.brief) return clip(f.brief, BRIEF_MAX);
  if (f?.grammar || f?.meaning) return grammarMeaning(f.grammar, f.meaning);
  if (f?.reasoning) return clip(firstSentence(f.reasoning), BRIEF_MAX);
  if (q.explanation) {
    const segs = segments(q.explanation);
    const g = segs.find((s) => s.label?.includes("语法"));
    const m = segs.find((s) => s.label?.includes("语义"));
    if (g || m) return grammarMeaning(g?.body, m?.body);
    // 结论在【详解】【答案精析】【解析】里；【设题要点】【定位】【考点】这类是铺垫，不拿来当结论
    const MAIN = ["详解", "答案精析", "精析", "解析", "答案"];
    const LEAD = ["定位", "设题要点", "考点", "做题提示", "听前预测", "解题思路", "思路点拨", "命题思路"];
    const main = segs.find((s) => s.label && MAIN.includes(s.label)) ?? segs.find((s) => !s.label) ?? segs.find((s) => !LEAD.includes(s.label ?? "")) ?? segs[0];
    return main ? clip(firstSentence(main.body), BRIEF_MAX) : "";
  }
  return "";
}

/** 选词、完形："语法…；语义…"。语法那句的结论在后头（"……，应填名词"），取最后一小句 */
function grammarMeaning(grammar?: string, meaning?: string) {
  const g = firstSentence(grammar);
  const m = firstSentence(meaning);
  if (!g || !m) return clip(g || m, BRIEF_MAX);
  const tail = (g.match(/[^，,：:]*$/)?.[0] ?? g).trim();
  const gs = tail.length >= 4 && tail.length <= 24 ? tail : hardCut(tail.length < 4 ? g : tail, 23) + "…";
  return clip(`语法：${gs}；语义：${m}`, BRIEF_MAX);
}

/* ---------- 展开后的细节：一个个小节，小标题在上 ---------- */

/** "解析有问题"（记到本地，以后汇总重写） */
function Report({ q }: { q: Question }) {
  const ctx = useContext(ExplainContext);
  const settings = useSettings();
  if (!ctx) return null;
  const id = `${ctx.paperId}#${q.id}`;
  const bad = settings.badExplanations.includes(id);
  return (
    <button
      type="button"
      onClick={() => setSetting("badExplanations", bad ? settings.badExplanations.filter((x) => x !== id) : [...settings.badExplanations, id])}
      className={cn("h-8 rounded-full px-2.5 text-[13px] transition-colors", bad ? "bg-[var(--paper-200)] text-[var(--ink)]" : "text-[var(--ink-500)] hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]")}
      aria-pressed={bad}
    >
      {bad ? "已记下，点了撤销" : "解析有问题"}
    </button>
  );
}

/** 生词：一个个词条小块（词衬线、释义灰），右上角一键加进生词本 */
function VocabSection({ list, sentence }: { list: { w: string; zh: string }[]; sentence?: string }) {
  const ctx = useContext(ExplainContext);
  const [added, setAdded] = useState(false);
  return (
    <CardSection
      label="生词"
      action={
        ctx && (
          <button
            type="button"
            disabled={added}
            onClick={async () => {
              for (const v of list) await addToVocab(v.w.toLowerCase(), { paperId: ctx.paperId, paperTitle: ctx.paperTitle, sentence: sentence ?? "" });
              setAdded(true);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-[var(--blue)] transition-colors hover:bg-[var(--blue-tint)] disabled:text-[var(--ink-500)] disabled:hover:bg-transparent"
          >
            {added ? (
              <>
                <Check className="size-3.5" weight="bold" /> 已加入生词本
              </>
            ) : (
              <>
                <Plus className="size-3.5" weight="bold" /> 全部加入生词本
              </>
            )}
          </button>
        )
      }
    >
      <ul className="flex flex-wrap gap-1.5">
        {list.map((v) => (
          <li key={v.w} className="inline-flex items-baseline gap-1.5 rounded-[8px] bg-white px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--line)]">
            <span className="serif text-[16px] text-[var(--ink)]">{v.w}</span>
            <span className="text-[15px] text-[var(--ink-700)]">{v.zh}</span>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}

/** 思路里去掉已经当结论说过的那一句；剩下太短就不再单列 */
function restAfterBrief(text: string, brief: string) {
  // 结论是截断的（结尾"…"），那一句的后半截只在思路里有：整段保留
  if (!brief || brief.endsWith("…")) return text;
  const head = brief.slice(0, 16);
  const at = text.indexOf(head);
  if (at < 0) return text;
  const end = text.slice(at).search(/[。；！!]/);
  const rest = (text.slice(0, at) + (end < 0 ? "" : text.slice(at + end + 1))).replace(/^[，。；\s]+/, "").trim();
  // 去掉之后开头如果只剩"题干问……。"这类套话，也一起不要
  const cleaned = rest.replace(/^(本|此|该)?题(干|目)?(问|询问|问的是|要求)[^。；！]{0,30}[。；！]\s*/, "");
  return cleaned.length >= 8 ? cleaned : "";
}

/**
 * 结构化解析的全部细节。有官方解析时官方原文是正文（小标题照原文），AI 整理的只补官方没有的：
 * 其他选项为什么不对、题干和原文对照、生词；没有官方解析时才用 AI 写的语法 / 语义 / 思路。写作翻译是要点和亮点
 */
function FieldDetails({ q, f, brief, official }: { q: Question; f: ExplainFields; brief: string; official?: string }) {
  const options = Object.entries(f.options ?? {}).filter(([k]) => k !== q.answer);
  const reasoning = !official && !f.grammar && !f.meaning && f.reasoning ? restAfterBrief(f.reasoning, brief) : "";
  const aiParts = options.length > 0 || !!f.mapping?.length || !!f.vocab?.length;
  return (
    <>
      {official && <OfficialText text={official} />}
      {!official && f.grammar && <CardSection label="语法">{f.grammar}</CardSection>}
      {!official && f.meaning && <CardSection label="语义">{f.meaning}</CardSection>}
      {reasoning && <CardSection label="思路">{reasoning}</CardSection>}
      {options.length > 0 && (
        <CardSection label="其他选项为什么不对">
          <ul className="space-y-1.5">
            {options.map(([k, v]) => (
              <li key={k} className="flex gap-2.5">
                <span className="num mt-[3px] grid size-[22px] flex-none place-items-center rounded-full bg-[var(--paper-200)] text-[12px] font-semibold text-[var(--ink-700)]">{k}</span>
                <span className="min-w-0">{v}</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
      {!!f.mapping?.length && (
        <CardSection label="题干和原文对照">
          <table className="w-full text-[14px] leading-[1.5]">
            <thead>
              <tr className="text-left text-[13px] text-[var(--ink-500)]">
                <th className="w-1/2 pr-3 pb-1 font-normal">题干</th>
                <th className="pb-1 font-normal">原文</th>
              </tr>
            </thead>
            <tbody>
              {f.mapping.map((m, i) => (
                <tr key={i} className="border-t border-[var(--line-soft)]">
                  <td className="serif py-1.5 pr-3 align-top text-[var(--ink-700)]">{m.stem}</td>
                  <td className="serif py-1.5 align-top text-[var(--ink)]">{m.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardSection>
      )}
      {!!f.points?.length && (
        <CardSection label="要点">
          <ol className="list-decimal space-y-1 pl-5 marker:text-[var(--ink-500)]">
            {f.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </CardSection>
      )}
      {!!f.phrases?.length && (
        <CardSection label="亮点表达">
          <ul className="space-y-1">
            {f.phrases.map((p, i) => (
              <li key={i}>
                <span className="serif text-[15px] text-[var(--ink)]">{p.en}</span> <span className="text-[var(--ink-700)]">{p.zh}</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
      {!!f.vocab?.length && <VocabSection list={f.vocab} sentence={f.locate?.quote} />}
      {official && aiParts && <p className="text-[12px] leading-5 text-[var(--ink-500)]">上面的一句话结论、逐项分析、对照和生词由 AI 按官方解析整理，仅供参考。</p>}
    </>
  );
}

/** 官方解析原文：一个小节，原文里的【定位】【详解】这类小标题行内加粗 */
function OfficialText({ text }: { text: string }) {
  return (
    <CardSection label="官方解析">
      <div className="space-y-1.5">
        {/* 抄进来的题目选项在数据里已经去掉了（scripts/explain_clean.py），这里不再按 A)…D) 去删：正文分析选项时也会写 A)、D) */}
        {segments(text).map((s, i) => (
          <p key={i}>
            {s.label && <b className="mr-1.5 font-semibold text-[var(--ink)]">{s.label}</b>}
            {s.body}
          </p>
        ))}
      </div>
    </CardSection>
  );
}

/** 文本解析：【小标题】做成小节标题，其余是段落 */
function TextDetails({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.label ? (
          <CardSection key={i} label={s.label}>
            {s.body}
          </CardSection>
        ) : (
          <p key={i}>{s.body}</p>
        ),
      )}
    </>
  );
}

/** 正确答案：灰字"答案" + 一枚字母章 */
function AnswerMark({ letter }: { letter: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[13px] text-[var(--ink-500)]">答案</span>
      <span className="num grid size-8 place-items-center rounded-full bg-[var(--blue-tint)] text-[16px] font-semibold text-[var(--blue)]">{letter}</span>
    </span>
  );
}

/**
 * 一题的解析，先给结论，层次是：
 * 头（题号 · 答案章 · 对错 · AI 章 · 动作）→ 一句话结论（主角）→ 原文块（出处、在卷面上标出 / 听这一句、原句；展开后跟译文）
 * → 展开：语法 / 语义 / 思路、其他选项为什么不对、题干和原文对照、生词、要点、亮点表达，一个小节一个小标题。
 * 答题条抽屉、答题卡面板、交卷单、错题本共用。
 * mine：要不要对答案（交卷后、练习模式选过）：undefined 不显示，null 是没答；answer=false 时不写答案（外面已经写了）；
 * title、action：放进头一行的题号和按钮（答题卡面板里用）
 */
export function ExplanationCard({ q, mine, answer = true, title, action, className }: { q: Question; mine?: string | null; answer?: boolean; title?: ReactNode; action?: ReactNode; className?: string }) {
  const ctx = useContext(ExplainContext);
  const [open, setOpen] = useState(false);
  const f = q.explain;
  if (!f && !q.explanation) {
    return (
      <div className={cn("text-[14px] text-[var(--ink-500)]", className)}>
        {(title || action) && (
          <div className="mb-1 flex items-center gap-3">
            {title}
            <span className="ml-auto">{action}</span>
          </div>
        )}
        这道题暂时没有解析。
      </div>
    );
  }
  // 有官方解析原文就以官方为准（AI 整理的只是补充），只有官方缺的题才标"AI 解析"
  const official = q.explanation && q.explanationBy !== "ai" ? q.explanation : undefined;
  const by = official ? "official" : f ? q.explainBy : q.explanationBy;
  const choice = !!q.options?.length && !!q.answer;
  const brief = briefOf(q);
  const loc = f?.locate;
  const canFlash = !!(ctx?.flashWords && loc?.page && loc.words);
  const canListen = !!(ctx?.listen && loc && ctx.canListen?.(q, loc));
  const showLoc = !!loc?.quote;
  const details = f ? <FieldDetails q={q} f={f} brief={brief} official={official} /> : <TextDetails text={q.explanation!} />;
  // 没有结论也没有原文（写作翻译常见）：细节直接摊开，不用再点
  const summary = !!brief || showLoc;
  const right = mine != null && mine === q.answer;
  // 展开按钮后面写里面有什么
  const inside = f
    ? [
        official ? "官方解析" : f.grammar || f.meaning ? "语法语义" : f.reasoning && restAfterBrief(f.reasoning, brief) ? "思路" : "",
        Object.keys(f.options ?? {}).some((k) => k !== q.answer) && "逐项",
        f.mapping?.length && "对照",
        f.translation && showLoc && "译文",
        f.vocab?.length && `生词 ${f.vocab.length}`,
        f.points?.length && "要点",
      ]
        .filter(Boolean)
        .join(" · ")
    : "完整解析";
  const head = !!(title || action || (choice && answer) || mine !== undefined || by === "ai");
  // 带题号的（答题卡面板，宽 360）：头要挤在一行里，AI 章只写"AI"
  const narrow = !!title;

  return (
    <article className={cn("text-[14px] leading-[1.7] text-[var(--ink-700)]", className)}>
      {head && (
        <header className={cn("flex min-h-8 flex-wrap items-center gap-y-1", narrow ? "gap-x-2" : "gap-x-3")}>
          {title}
          {choice && answer && <AnswerMark letter={q.answer!} />}
          {mine !== undefined && choice && (
            <span className={cn("inline-flex items-center gap-1 text-[14px] font-medium", right ? "text-[var(--blue)]" : mine ? "text-[var(--red)]" : "text-[var(--ink-500)]")}>
              {right ? <Check className="size-4" weight="bold" /> : mine ? <X className="size-4" weight="bold" /> : null}
              {right ? "答对了" : mine ? `你选了 ${mine}` : "没有作答"}
            </span>
          )}
          {(by === "ai" || action) && (
            <span className="ml-auto flex items-center gap-2">
              {by === "ai" && <AiTag short={narrow} />}
              {action}
            </span>
          )}
        </header>
      )}
      {brief && <p className={cn("text-[15px] leading-[1.65] font-medium text-[var(--ink)]", head && "mt-2")}>{brief}</p>}
      {showLoc && (
        <QuoteBlock
          className="mt-3"
          caption={loc!.where ? `原文 · ${loc!.where}` : "原文"}
          actions={
            <>
              {canFlash && (
                <QuoteAction onClick={() => ctx!.flashWords!(loc!.page!, loc!.words!)} icon={<Crosshair className="size-3.5" />}>
                  在卷面上标出
                </QuoteAction>
              )}
              {canListen && (
                <QuoteAction onClick={() => ctx!.listen!(q, loc!)} icon={<Play className="size-3.5" weight="fill" />}>
                  听这一句
                </QuoteAction>
              )}
            </>
          }
          sub={open && f?.translation ? f.translation : undefined}
        >
          {loc!.quote}
        </QuoteBlock>
      )}
      {summary ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-[8px] text-left text-[14px] font-medium text-[var(--ink-700)] hover:text-[var(--ink)]"
          >
            <CaretDown className={cn("size-4 flex-none text-[var(--ink-500)] transition-transform duration-150", open && "rotate-180")} />
            {open ? "收起" : "展开"}
            {!open && inside && <span className="min-w-0 truncate font-normal text-[var(--ink-500)]">{inside}</span>}
          </button>
          {open && (
            <div className="space-y-4 border-t border-[var(--line-soft)] pt-3">
              {details}
              <div className="flex justify-end">
                <Report q={q} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={cn("space-y-4", head && "mt-2")}>
          {details}
          <div className="flex justify-end">
            <Report q={q} />
          </div>
        </div>
      )}
    </article>
  );
}
