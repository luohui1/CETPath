import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookmarkSimple, BracketsSquare, CaretDown, Check, Plus, Sparkle, SpeakerHigh, Translate, TreeStructure, X } from "@phosphor-icons/react";
import { db } from "@/lib/db";
import { lookup, phonetic, TAG_LABELS, translationLines, type LookupResult } from "@/lib/dict";
import { addToVocab, removeFromVocab } from "@/lib/learning";
import { findPhrases, type PhraseHit } from "@/lib/phrases";
import { speak } from "@/lib/speech";
import { getSettings } from "@/lib/settings";
import { lookupOnline, type OnlineResult } from "@/lib/youdao";
import type { TransLookup } from "@/lib/trans";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import { BriefSenses, DefinitionLines, type LookupSource } from "@/components/WordPopover";
import type { WordClick } from "@/components/WordText";
import { MarkWord } from "./cardParts";

/*
 * 查词小卡片（2026-11-12）：点了词，卡片就弹在这个词旁边（以前是卷面最下面一条，用户"太小了、在最下面，都没看到"）。
 * 卡片上：词、音标、发音；意思（大字）；这个词所在的短语（come up with、make up one's mind…，见 src/lib/phrases.ts）；
 * "加入生词本"；"译整句"一点就在卡片里出整句译文（以前要长按一句，用户"难以启用"）；"更多释义"在卡片里展开全部义项和考纲。
 *
 * 位置（用户第二次反馈"会遮挡原单词，译整句会遮挡原句子"）：卡片绝不压在要看的原文上——
 * 要让开的是这个词；认出短语时是整个短语；开着整句译文时是整句。哪边空得多放哪边；两边都不够，
 * 先把卷面滚一下腾出地方，还不够就把卡片压矮（里面滚动），不往原文上盖。卷面滚动时跟着走，词滚出视野就先藏起来。
 * 点卡片外面、Esc、✕ 收起；点卷面上别的词换成那个词（卷面那边处理）。
 *
 * 第三次反馈（"类似的问题还有很多；短语记不进生词本；in an age of 识别不了"）：
 * - 离线词典查不到（或连字符词整体查不到）就去有道在线查（src/lib/youdao.ts，用户同意）；扫描卷认错的词给"可能是 government"；
 * - 短语每条都能单独加入生词本（释义一起存，生词本、复习都看得到）；
 * - "选短语"：把这句的词摆成一排小块，点词连成短语（in an age of），先查离线短语表，再查有道。
 */

const GAP = 8; // 卡片和要让开的原文之间
const FUNCTION_WORDS = new Set("to on in of as at for with up out off by about from into over down away back through upon than".split(" "));
const EDGE = 8; // 卡片和可见区域边缘之间
const MAX_H = 460;
const MIN_H = 150; // 再矮就看不清了：宁可滚卷面

/** 查词，查到了记一次、按设置自动发音；正在查的词（正文里的词元素）加个高亮 */
function useLookup(word: string, hit: WordClick, onLookedUp: () => void) {
  const [result, setResult] = useState<LookupResult | null | undefined>(undefined);
  const looked = useRef(onLookedUp);
  looked.current = onLookedUp;
  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    hit.el?.classList.add("is-active");
    lookup(word).then(
      async (r) => {
        if (cancelled) return;
        setResult(r);
        if (r) {
          looked.current();
          if ((await getSettings()).autoSpeak) speak(r.entry.w);
        }
      },
      () => !cancelled && setResult(null),
    );
    return () => {
      cancelled = true;
      hit.el?.classList.remove("is-active");
    };
  }, [word, hit]);
  return result;
}

/** 在线兜底：need 为真才查（离线查不到、或者是连字符词）。undefined 还在查，null 没查到 */
function useOnline(word: string, need: boolean) {
  const [r, setR] = useState<OnlineResult | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setR(need ? undefined : null);
    if (need) lookupOnline(word).then((x) => !cancelled && setR(x));
    return () => {
      cancelled = true;
    };
  }, [word, need]);
  return r;
}

/** 一条短语：短语、意思、出处小字，右边"加入生词本"（释义一起存） */
function PhraseRow({ phrase, trans, from, between, sentence, source }: { phrase: string; trans: string; from?: string; between?: string; sentence: string; source?: LookupSource }) {
  // 隔开的动词短语显示成 cut … down to；记进生词本用词典写法 cut down to
  const plain = phrase.replace(/\s*…\s*/g, " ");
  const key = plain.toLowerCase();
  const saved = useLiveQuery(async () => !!(await db.vocab.get(key)), [key]);
  const toggle = async () => {
    if (saved) await removeFromVocab(key);
    else await addToVocab(key, source ? { ...source, sentence } : undefined, { w: plain, t: trans.replace(/；/g, "\n") });
  };
  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 leading-[1.55]">
        <span className="mr-1.5 inline-block rounded-[4px] bg-white px-1 align-[2px] text-[11px] leading-[18px] font-semibold text-[var(--blue)]">短语</span>
        <span className="serif mr-2 text-[17px] font-semibold text-[var(--ink)]">{phrase}</span>
        <span className="text-[16px] text-[var(--ink)]">{shortTrans(trans)}</span>
        {from && <span className="ml-1.5 text-[11px] text-[var(--ink-500)]">{from}</span>}
        {between && <span className="mt-0.5 block text-[12px] text-[var(--ink-500)]">中间隔着 “{between}”</span>}
      </p>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={!!saved}
        aria-label={saved ? `把 ${phrase} 移出生词本` : `把 ${phrase} 加入生词本`}
        className={cn(
          "-my-0.5 inline-flex h-8 flex-none items-center gap-1 rounded-full px-2.5 text-[13px] font-medium transition active:scale-[0.97]",
          saved ? "bg-white text-[var(--blue)]" : "bg-[var(--blue)] text-white",
        )}
      >
        {saved ? <Check className="size-3.5" weight="bold" /> : <Plus className="size-3.5" weight="bold" />}
        {saved ? "已记" : "生词本"}
      </button>
    </div>
  );
}

interface Place {
  left: number;
  top: number;
  maxH: number;
  below: boolean; // 卡片在原文下面（小尖角朝上）
  arrow: number; // 小尖角离卡片左边多远
  hidden: boolean;
}

export interface WordAnchor {
  word: DOMRect; // 点的这个词（尖角指着它；它滚出视野卡片就藏起来）
  avoid: DOMRect; // 卡片不能盖住的范围：词 / 短语 / 整句
}

export function WordCard({
  hit,
  ctx,
  anchor,
  bounds,
  scroller,
  source,
  trans,
  onLookedUp,
  onClose,
  onTransOpen,
  onPhrase,
  onSyntax,
  onAsk,
}: {
  hit: WordClick;
  /** 这句的词序列和点的是第几个（认短语用） */
  ctx: { tokens: string[]; at: number } | null;
  /** 现在的位置（卷面滚动、缩放后要重新量） */
  anchor: () => WordAnchor | null;
  /** 卡片要待在哪个区域里（卷面的可见区域；正文里的词是整个窗口） */
  bounds: () => DOMRect;
  /** 地方不够时滚它腾地方（卷面） */
  scroller?: HTMLElement | null;
  source?: LookupSource;
  trans: TransLookup;
  onLookedUp: () => void;
  onClose: () => void;
  /** 整句译文开没开（卷面上把这句标成淡黄底，卡片让开整句） */
  onTransOpen?: (open: boolean) => void;
  /** 认出的短语里每个词在词序列里的位置（卷面上把短语标出来，卡片让开它们） */
  onPhrase?: (pos: number[] | null) => void;
  /** 这句是有解析的长难句：多一个"长难句"按钮，点了收起卡片、底部放这句的解析 */
  onSyntax?: () => void;
  /** AI 助教开通了：多一个"问 AI"，点了收起卡片、右侧面板里讲这句 */
  onAsk?: () => void;
}) {
  // "可能是 government"：点了就改查那个词
  const [alt, setAlt] = useState<string | null>(null);
  const word = alt ?? hit.word;
  const result = useLookup(word, hit, onLookedUp);
  const online = useOnline(word, result === null || !!result?.parts);
  const [more, setMore] = useState(false);
  const [showTrans, setShowTrans] = useState(false);
  const [phrases, setPhrases] = useState<PhraseHit[]>([]);
  // 选短语：这句词序列里选中的词（升序，可以不挨着：take … into account）；null 是没在选
  const [pick, setPick] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<{ phrase: string; trans: string; from: string } | null | undefined>(undefined);
  useEffect(() => {
    setMore(false);
    setShowTrans(false);
    setAlt(null);
    setPick(null);
  }, [hit]);
  const transOpen = useRef(onTransOpen);
  transOpen.current = onTransOpen;
  useEffect(() => transOpen.current?.(showTrans), [showTrans]);
  const phraseCb = useRef(onPhrase);
  phraseCb.current = onPhrase;
  useEffect(
    () => () => {
      transOpen.current?.(false);
      phraseCb.current?.(null);
    },
    [],
  );

  // 短语：这句里盖住这个词的最长短语（最多两个）
  useEffect(() => {
    let cancelled = false;
    setPhrases([]);
    phraseCb.current?.(null);
    if (!ctx || ctx.tokens.length < 2) return;
    findPhrases(ctx.tokens, ctx.at).then(
      (list) => {
        if (cancelled) return;
        setPhrases(list);
        phraseCb.current?.(list[0] ? list[0].pos : null);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  // 选短语：选了两个词以上就查——先离线短语表（要正好是这一段），再有道
  const clean = (t: string) => t.replace(/[^A-Za-z'’-]/g, "");
  const pickText = pick && ctx && pick.length > 1 ? pick.map((k) => clean(ctx.tokens[k])).filter(Boolean).join(" ") : "";
  // 显示用：中间隔开的地方写成 …（take … into account）
  const pickShow = pick && ctx && pick.length > 1 ? pick.map((k, i) => (i && k > pick[i - 1] + 1 ? "… " : "") + clean(ctx.tokens[k])).join(" ") : "";
  useEffect(() => {
    if (pick?.length) phraseCb.current?.(pick);
    else phraseCb.current?.(phrases[0] ? phrases[0].pos : null);
  }, [pick, phrases]);
  useEffect(() => {
    let cancelled = false;
    setPicked(undefined);
    if (!pickText || !ctx || !pick) return;
    (async () => {
      const local = (await findPhrases(ctx.tokens, pick[0], 12)).find((f) => f.pos.length === pick.length && f.pos.every((p, i) => p === pick[i]));
      if (local) return { phrase: local.phrase, trans: local.trans, from: "词典" };
      const r = await lookupOnline(pickText);
      return r?.entry.t ? { phrase: r.entry.w, trans: r.entry.t.replace(/\n/g, "；"), from: "有道" } : null;
    })().then(
      (x) => !cancelled && setPicked(x),
      () => !cancelled && setPicked(null),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickText]);
  // 点一个词加进来，再点一次去掉；可以跳着选
  const tapToken = (k: number) => setPick((p) => (!p ? [k] : p.includes(k) ? p.filter((x) => x !== k) : [...p, k].sort((a, b) => a - b)));

  // 离线查不到、在线查到的：生词本存在线的释义
  const onlineMain = (!result || !!result.parts) && !!online?.entry.t;
  const vocabKey = result && !result.parts ? result.lemma : onlineMain ? online!.entry.w.toLowerCase() : null;
  const inVocab = useLiveQuery(async () => (vocabKey ? !!(await db.vocab.get(vocabKey)) : false), [vocabKey]);
  const toggleVocab = async () => {
    if (!vocabKey) return;
    if (inVocab) await removeFromVocab(vocabKey);
    else await addToVocab(vocabKey, source ? { ...source, sentence: hit.sentence } : undefined, onlineMain ? online!.entry : undefined);
  };

  // 摆位置。内容的自然高度量里面那层；每次换词、开关译文/释义、认出短语，只自动滚一次卷面
  const self = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    scrolled.current = false;
  }, [hit, showTrans, more, phrases, pick, online]);
  useLayoutEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      const el = self.current;
      const content = body.current;
      const at = anchor();
      if (!el || !content || !at) return;
      const b = bounds();
      const { word, avoid } = at;
      const w = el.offsetWidth;
      const natural = Math.min(content.scrollHeight, MAX_H);
      const hidden = word.bottom < b.top || word.top > b.bottom || word.right < b.left || word.left > b.right;
      const roomBelow = b.bottom - avoid.bottom - GAP - EDGE;
      const roomAbove = avoid.top - b.top - GAP - EDGE;
      let below: boolean;
      if (natural <= roomBelow && natural <= roomAbove) below = word.top + word.height / 2 < b.top + b.height / 2;
      else if (natural <= roomBelow) below = true;
      else if (natural <= roomAbove) below = false;
      else {
        below = roomBelow >= roomAbove;
        // 两边都放不下：把卷面滚一下，让原文往上走、下面腾出地方（原文不滚出可见区域顶上）
        if (scroller && !scrolled.current && !hidden) {
          const need = natural - roomBelow;
          const can = avoid.top - b.top - EDGE - 4;
          const delta = Math.min(need, can);
          if (delta > 8) {
            scrolled.current = true;
            scroller.scrollBy({ top: delta, behavior: "smooth" });
            below = true;
          }
        }
      }
      const room = below ? roomBelow : roomAbove;
      const maxH = Math.max(MIN_H, Math.min(natural, room));
      const h = Math.min(natural, maxH);
      const top = below ? avoid.bottom + GAP : avoid.top - GAP - h;
      const cx = word.left + word.width / 2;
      const left = Math.max(b.left + EDGE, Math.min(cx - w / 2, b.right - EDGE - w));
      const arrow = Math.max(16, Math.min(cx - left, w - 16));
      setPlace((p) =>
        p && p.left === left && p.top === top && p.maxH === maxH && p.below === below && p.arrow === arrow && p.hidden === hidden ? p : { left, top, maxH, below, arrow, hidden },
      );
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    addEventListener("scroll", kick, true);
    addEventListener("resize", kick);
    const ro = new ResizeObserver(kick);
    if (body.current?.firstElementChild) ro.observe(body.current.firstElementChild);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", kick, true);
      removeEventListener("resize", kick);
      ro.disconnect();
    };
  }, [anchor, bounds, scroller]);

  // 点卡片外面收起。卷面上的点按由考场自己处理（点到别的词就换词，点空白处收起），这里不管
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || self.current?.contains(t) || t.closest("[data-stage]")) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target instanceof HTMLElement && e.target.closest("input, textarea"))) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onKey);
    };
  }, []);

  // 连字符复合词整体查不到：头上写整个词（gallery-going），下面各部分分别给意思；不给"加入生词本""更多释义"
  const parts = result?.parts?.length ? result.parts : null;
  const lines = result && !parts ? translationLines(result.entry) : [];
  const tags = result && !parts ? (result.entry.tags ?? []).map((t) => TAG_LABELS[t] ?? t) : [];
  const hasMore = lines.length > 3 || tags.length > 0;
  const title = result && !parts ? result.entry.w : onlineMain ? online!.entry.w : (result?.query ?? word);
  const phone = result && !parts ? phonetic(result.entry) : onlineMain ? online!.entry.p : undefined;
  const tokens = ctx?.tokens ?? [];
  const win: [number, number] | null = ctx && tokens.length > 1 ? [Math.max(0, ctx.at - 8), Math.min(tokens.length - 1, ctx.at + 8)] : null;
  const tr = showTrans && hit.sentence ? trans(hit.sentence) : null;
  // 短语：这个词在这句里所在的短语（卷面上整个短语也标出来）。点的是 on、to、as 这类小词时，要的多半是短语：放在词义前面
  const phraseFirst = phrases.length > 0 && FUNCTION_WORDS.has(hit.word.toLowerCase());
  const phraseBox = phrases.length > 0 && !pick && (
    <div className="mt-2.5 space-y-2 rounded-[10px] bg-[var(--blue-tint)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--blue-line)]">
      {phrases.map((p) => (
        <PhraseRow key={p.phrase} phrase={p.phrase} trans={p.trans} between={p.between} sentence={hit.sentence} source={source} />
      ))}
    </div>
  );

  return (
    <div
      ref={self}
      data-word-card
      role="dialog"
      aria-label={`查词：${hit.word}`}
      className="no-print fixed z-[45] w-[min(360px,calc(100vw-20px))] rounded-[14px] bg-white shadow-[var(--shadow-float),0_0_0_1px_var(--line)]"
      style={{ left: place?.left ?? -9999, top: place?.top ?? 0, visibility: place && !place.hidden ? "visible" : "hidden" }}
    >
      {/* 指着词的小尖角 */}
      {place && (
        <span
          aria-hidden
          className={cn("absolute size-3 rotate-45 bg-white", place.below ? "-top-1.5 shadow-[-1px_-1px_0_0_var(--line)]" : "-bottom-1.5 shadow-[1px_1px_0_0_var(--line)]")}
          style={{ left: place.arrow - 6 }}
        />
      )}
      <div ref={body} className="relative overflow-y-auto overscroll-contain rounded-[14px]" style={{ maxHeight: place?.maxH ?? MAX_H }}>
        <div className="px-4 pt-2.5 pb-3.5">
          {/* 头一行：词、音标、发音、✕ */}
          <div className="flex min-h-11 items-center gap-1.5">
            {result || onlineMain ? (
              <>
                <span className="serif max-w-[80%] shrink-0 truncate text-[22px] leading-8 font-semibold text-[var(--ink)]">{title}</span>
                {/* 地方不够先截音标，词本身要完整 */}
                {phone && <span className="min-w-0 truncate font-[family-name:var(--font-mono)] text-[14px] text-[var(--ink-500)]">{phone}</span>}
                <button type="button" onClick={() => speak(title)} aria-label="发音" className="flex size-10 flex-none items-center justify-center rounded-full text-[var(--ink-700)] transition hover:bg-[var(--fill-quiet)] active:bg-[var(--fill-quiet)]">
                  <SpeakerHigh className="size-5" />
                </button>
              </>
            ) : (
              <span className="serif min-w-0 truncate text-[22px] leading-8 font-semibold text-[var(--ink)]">{word}</span>
            )}
            <button type="button" onClick={onClose} aria-label="关闭" className="-mr-2 ml-auto flex size-10 flex-none items-center justify-center rounded-full text-[var(--ink-500)] transition hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]">
              <X className="size-4" />
            </button>
          </div>

          {phraseFirst && <div className="mb-2">{phraseBox}</div>}

          {/* 意思 */}
          {/* 选短语时收起这个词的意思：卡片别太高，选的结果要看得见 */}
          {!pick && (
            <>
          {/* 离线查不到、连字符词：有道的释义（标"有道"）；扫描卷认错的词给"可能是…" */}
          {(result === null || parts) && (
            <>
              {online === undefined && (
                <p className="flex items-center gap-2 py-1 text-[15px] text-[var(--ink-500)]">
                  <Spinner /> 在线查…
                </p>
              )}
              {onlineMain && (
                <div className={cn(parts && "mb-2.5")}>
                  <BriefSenses lines={translationLines(online!.entry)} max={3} className="flex-col !items-start gap-y-0.5" />
                  <p className="mt-0.5 text-[11px] text-[var(--ink-500)]">有道词典</p>
                </div>
              )}
              {online && !onlineMain && online.typos.length > 0 && (
                <div className="py-1">
                  <p className="mb-1.5 text-[13px] text-[var(--ink-500)]">词典里没有 {word}（扫描卷可能认错了字），是不是：</p>
                  <div className="flex flex-wrap gap-1.5">
                    {online.typos.slice(0, 3).map((t) => (
                      <button
                        key={t.word}
                        type="button"
                        onClick={() => setAlt(t.word)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[15px] text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--fill-quiet)]"
                      >
                        <span className="serif font-semibold">{t.word}</span>
                        {t.trans && <span className="max-w-[9em] truncate text-[13px] text-[var(--ink-500)]">{t.trans}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {result === null && online === null && <p className="py-1 text-[15px] text-[var(--ink-500)]">词典里没有这个词{typeof navigator !== "undefined" && navigator.onLine === false ? "（没网，查不了在线词典）" : ""}</p>}
            </>
          )}
          {result === undefined ? (
            <p className="flex items-center gap-2 py-1 text-[15px] text-[var(--ink-500)]">
              <Spinner /> 正在查…
            </p>
          ) : result === null ? null : (
            <>
              {result.form && !parts && (
                <p className="mb-1 text-[13px] text-[var(--ink-500)]">
                  {result.query} 是 {result.entry.w} 的{result.form}
                </p>
              )}
              {parts ? (
                <div className="space-y-2 pt-0.5">
                  <p className="text-[13px] text-[var(--ink-500)]">{onlineMain ? "分开看：" : "词典里没有整个词，分开看："}</p>
                  {parts.map((pt, i) => (
                    <div key={i} className="flex items-baseline gap-2.5">
                      <span className="serif flex-none text-[17px] font-semibold text-[var(--ink)]">{pt.query}</span>
                      <BriefSenses lines={translationLines(pt.entry)} max={2} n={3} className="min-w-0 flex-col !items-start gap-y-0 text-[16px]" />
                    </div>
                  ))}
                </div>
              ) : more ? (
                <div className="space-y-3 pt-1">
                  <DefinitionLines lines={lines} />
                  {tags.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <li key={t} className="rounded-full px-2.5 text-[13px] leading-7 text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)]">
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <BriefSenses lines={lines} max={3} className="flex-col !items-start gap-y-0.5" />
              )}
            </>
          )}

            </>
          )}

          {!phraseFirst && phraseBox}

          {/* 按钮：加入生词本（主要动作）、译整句、更多释义 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {vocabKey && (
              <button
                type="button"
                onClick={() => void toggleVocab()}
                aria-pressed={!!inVocab}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition active:scale-[0.98]",
                  inVocab ? "bg-[var(--blue-tint)] text-[var(--blue)]" : "bg-[var(--blue)] text-white shadow-[var(--shadow-button)]",
                )}
              >
                <BookmarkSimple className="size-4" weight={inVocab ? "fill" : "bold"} />
                {inVocab ? "已在生词本" : "加入生词本"}
              </button>
            )}
            {hit.sentence && (
              <button
                type="button"
                onClick={() => setShowTrans((v) => !v)}
                aria-pressed={showTrans}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition active:scale-[0.98]",
                  showTrans ? "bg-[var(--blue-tint)] text-[var(--blue)]" : "text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--fill-quiet)]",
                )}
              >
                <Translate className="size-4" />
                {showTrans ? "收起译文" : "译整句"}
              </button>
            )}
            {onSyntax && (
              <button
                type="button"
                onClick={onSyntax}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--blue-tint)] px-4 text-[14px] font-medium text-[var(--blue)] transition hover:bg-[color-mix(in_oklab,var(--blue)_18%,transparent)] active:scale-[0.98]"
              >
                <TreeStructure className="size-4" />
                长难句
              </button>
            )}
            {onAsk && (
              <button
                type="button"
                onClick={onAsk}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)] transition hover:bg-[var(--fill-quiet)] active:scale-[0.98]"
              >
                <Sparkle className="size-4 text-[var(--blue)]" weight="fill" />
                问 AI
              </button>
            )}
            {win && (
              <button
                type="button"
                onClick={() => setPick((p) => (p ? null : [ctx!.at]))}
                aria-pressed={!!pick}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition active:scale-[0.98]",
                  pick ? "bg-[var(--blue-tint)] text-[var(--blue)]" : "text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[var(--fill-quiet)]",
                )}
              >
                <BracketsSquare className="size-4" />
                {pick ? "收起选短语" : "选短语"}
              </button>
            )}
            {result && hasMore && (
              <button type="button" onClick={() => setMore((m) => !m)} className="inline-flex h-10 items-center gap-1 rounded-full px-2 text-[14px] text-[var(--ink-500)] transition hover:text-[var(--ink)]">
                {more ? "收起释义" : "更多释义"}
                <CaretDown className={cn("size-3.5 transition-transform", more && "rotate-180")} weight="bold" />
              </button>
            )}
          </div>

          {/* 选短语：这句的词摆成一排（点的词前后各 8 个），点词连成一段；选中两个词以上就查 */}
          {pick && win && (
            <div className="mt-3 rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <p className="mb-2 text-[13px] text-[var(--ink-500)]">点词组成要查的短语，可以跳着选（比如 take … into account），再点一次取消</p>
              <div className="flex flex-wrap gap-1">
                {win[0] > 0 && <span className="self-end px-0.5 text-[var(--ink-500)]">…</span>}
                {tokens.slice(win[0], win[1] + 1).map((t, i) => {
                  const k = win[0] + i;
                  const on = pick.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => tapToken(k)}
                      className={cn("serif h-9 rounded-[6px] px-2 text-[16px] transition", on ? "bg-[var(--blue)] text-white" : "bg-[var(--paper-100)] text-[var(--ink)] hover:bg-[var(--blue-tint)]")}
                    >
                      {t}
                    </button>
                  );
                })}
                {win[1] < tokens.length - 1 && <span className="self-end px-0.5 text-[var(--ink-500)]">…</span>}
              </div>
              <div className="mt-2.5">
                {!pickText ? (
                  <p className="text-[14px] text-[var(--ink-500)]">再点一个词</p>
                ) : picked === undefined ? (
                  <p className="flex items-center gap-2 text-[14px] text-[var(--ink-500)]">
                    <Spinner /> 查 {pickShow}…
                  </p>
                ) : picked ? (
                  <div className="rounded-[8px] bg-[var(--blue-tint)] px-2.5 py-2">
                    <PhraseRow phrase={picked.phrase} trans={picked.trans} from={picked.from} sentence={hit.sentence} source={source} />
                  </div>
                ) : (
                  <p className="text-[14px] text-[var(--ink-500)]">“{pickShow}” 不是词典里的短语：可以再连几个词，或者看整句译文</p>
                )}
              </div>
            </div>
          )}

          {/* 整句译文：卡片已经让开了卷面上的原句，这里只放中文（大字）；听力原文、解析里查的才补一行英文 */}
          {tr && (
            <div className="mt-3 rounded-[10px] bg-[var(--paper-50)] px-3.5 py-3 shadow-[inset_2px_0_0_var(--blue-line),inset_0_0_0_1px_var(--line-soft)]">
              <p className={cn("leading-[1.7]", tr.text ? "text-[17px] text-[var(--ink)]" : "text-[15px] text-[var(--ink-500)]")}>{!tr.ready ? "正在取译文…" : (tr.text ?? "这句还没有译文")}</p>
              {tr.text && <p className="mt-1 text-right text-[12px] text-[var(--ink-500)]">AI 译文</p>}
              {hit.page == null && (
                <p className="serif mt-2 border-t border-[var(--line-soft)] pt-2 text-[14px] leading-[1.6] text-[var(--ink-500)]">
                  <MarkWord text={hit.sentence} word={hit.word} nth={hit.nth} />
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 短语的意思：只留前四个，别太长 */
function shortTrans(t: string) {
  const parts = t.split(/[，；]/).filter(Boolean);
  return parts.slice(0, 4).join("，") + (parts.length > 4 ? "…" : "");
}
