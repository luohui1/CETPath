import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { marksSummary, paperText, progressSummary, reviewSummary, useAgentEnabled } from "@/lib/agent";
import { inkNotes } from "@/lib/ink";
import type { AgentThread } from "./AgentPanel";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Sparkle,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowUUpLeft,
  ArrowUUpRight,
  CaretDown,
  Check,
  Cursor,
  DotsThreeVertical,
  Timer,
  Eraser,
  Exam,
  Headphones,
  Highlighter,
  Lasso,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  NoteBlank,
  Pen,
  SidebarSimple,
  TextUnderline,
  type Icon,
} from "@phosphor-icons/react";
import * as G from "@/grasso";
import { db, memoryDb, type AttemptMode, type AttemptRow } from "@/lib/db";
import { retryPath } from "@/lib/attempts";
import { allQuestions, findAudioLine, kindName, KIND_NAMES, type ExplainFields, type Paper, type PdfWordsPage, type Question, type Section, type SectionKind, type SectionRange } from "@/lib/papers";
import { suggestMap } from "@/lib/report";
import { colorValue, COLORS, colorTool, markBounds, PEN_SIZES, useMarkHistory, wordAt, type ColorTool, type MarkRow, type Tool } from "@/lib/marks";
import { setSetting, useSettings, type PenPreset } from "@/lib/settings";
import { shortTitle, type AnswerSheet } from "@/lib/exportPdf";
import { cn, formatDuration } from "@/lib/utils";
import { useVocabMarks, WordTextProvider, type WordClick } from "@/components/WordText";
import { ConfirmDialog, PaperDialog, Tip } from "@/components/overlay";
import { Button, EmptyState } from "@/components/ui";
import { prefetchAudio, touchAudio } from "@/lib/audioCache";
import { findTrans, loadTrans, sentenceKey, type TransFile, type TransLookup } from "@/lib/trans";
import { loadSyntax, type SyntaxFile } from "@/lib/syntax";
import { ExamPage, questionCue, wordNth, wordRect, type Answers, type PageItems, type Timing } from "./PaperPages";
import { AnswerBar, barLabel, type BarContent } from "./AnswerBar";
import { WordCard } from "./WordCard";
import { ListeningBar, type AnswerLine, type JudgedQs, type ListeningBarHandle } from "./ListeningBar";
import { Dock, DOCK_WIDTH, DRAWER_SNAPS, type DockSyntax, type DockTab, type DockView } from "./SidePanel";
import type { InkState } from "./InkLayer";
import { ExamTimer } from "./ExamTimer";
import { Stopwatch, useQuestionTimer } from "./Stopwatch";
import { ExplainContext, type ExplainActions } from "./Explanation";
import { ReportSheet } from "./ReportSheet";
import { ThumbRail } from "./ThumbRail";
import { AgentSplit } from "./AgentSplit";
import { PaperLinkCtx, type PaperLink } from "./paperLink";
import { findText } from "@/lib/agentTools";
import { FindBar, findInPages, pageTexts, type FindHit } from "./FindBar";
import { ExportDialog } from "./ExportDialog";
import { endPinch, gesture, startPinch } from "./gesture";

/**
 * 按分段把原卷喂给 pdf.js：先取开头 64KB（顺便从 Content-Range 知道文件多大），之后 pdf.js 要哪段取哪段。原卷都已线性化
 * （scripts/linearize_pdfs.py），第一页的数据在文件开头，慢网下一两秒就有卷面。
 * 不让 pdf.js 用 url 自己取：它开头会发一次整份文件的请求探服务器支不支持分段，探完取消，但经过 Service Worker 转发时取消传不过去，
 * 大的扫描卷（6–9MB）会在后台整个下完，慢网下第一页从 2 秒拖到 20 秒（2026-11-08 线上量过）。
 * 分段请求经 Service Worker：这份原卷已经整份缓存过就从缓存切（离线也能开），没缓存就直接走网络、不存
 */
class RangeLoader extends pdfjs.PDFDataRangeTransport {
  constructor(
    private url: string,
    length: number,
    initial: Uint8Array,
    private signal: AbortSignal,
  ) {
    super(length, initial);
  }
  requestDataRange(begin: number, end: number) {
    const get = async (tries: number): Promise<void> => {
      try {
        const r = await fetch(this.url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: this.signal });
        if (r.status !== 206 && r.status !== 200) throw new Error(String(r.status));
        const buf = new Uint8Array(await r.arrayBuffer());
        // 200：给了整份（不支持分段的缓存），从里面切
        this.onDataRange(begin, r.status === 200 ? buf.subarray(begin, end) : buf);
      } catch (e) {
        if (this.signal.aborted || tries <= 1) return;
        await new Promise((ok) => setTimeout(ok, 1500));
        return get(tries - 1);
      }
    };
    void get(3);
  }
}

/**
 * 原卷里没嵌进去的字体：中文（页眉页脚"第 1 页 共 11 页"、卷名"2020年7月大学英语六级考试真题"）要 CMap 才画得出来，
 * 没有就整段空白（2026-11-12 全目录逐页比对查出来的，有十几套）；没嵌的 Times / Helvetica 用 pdf.js 自带的标准字体。
 * 两样都放在 public/pdfjs/（从 pdfjs-dist 原样拷来，版本要和 pdfjs-dist 一致），用到哪个才取哪个小文件
 */
const PDF_ASSETS = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" };

async function loadPdf(url: string, signal: AbortSignal) {
  const head = await fetch(url, { headers: { Range: "bytes=0-65535" }, signal });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  const buf = new Uint8Array(await head.arrayBuffer());
  const total = Number(head.headers.get("content-range")?.split("/")[1]);
  // 服务器不支持分段、给了整份：直接用
  if (head.status === 200 || !total) return { task: pdfjs.getDocument({ data: buf, ...PDF_ASSETS }), total: 0 };
  return { task: pdfjs.getDocument({ range: new RangeLoader(url, total, buf, signal), rangeChunkSize: 512 * 1024, disableAutoFetch: true, ...PDF_ASSETS }), total };
}

/**
 * 把整份原卷存进离线缓存（Service Worker 的 "content" 缓存，存好以后分段请求都从这里切，离线也能开）。
 * 页面自己按 1MB 一段取、拼好再存，不发整份请求：整份请求经 Service Worker 转发后中止不了，换到下一套卷时还在占带宽
 * （2026-11-08 线上量过：下一套卷第一页因此从 3 秒拖到 12 秒）；分段取的话，离开这套卷就停在当前这一段
 */
async function cacheWhole(url: string, total: number, signal: AbortSignal) {
  if (!total || typeof caches === "undefined") return;
  const cache = await caches.open("content");
  if (await cache.match(url)) return;
  const CHUNK = 1024 * 1024;
  const parts: Uint8Array[] = [];
  for (let at = 0; at < total; at += CHUNK) {
    if (signal.aborted) return;
    const r = await fetch(url, { headers: { Range: `bytes=${at}-${Math.min(total, at + CHUNK) - 1}` }, signal, priority: "low" } as RequestInit);
    if (r.status !== 206) return;
    parts.push(new Uint8Array(await r.arrayBuffer()));
  }
  if (signal.aborted) return;
  await cache.put(url, new Response(new Blob(parts as BlobPart[], { type: "application/pdf" }), { headers: { "Content-Type": "application/pdf", "Content-Length": String(total) } }));
}

// 带个查询串：2026-11-08 线上 nginx 曾把 .mjs 当 octet-stream 发出去，各设备的 Service Worker 把这个错误响应缓存了；
// 换个 URL 就不走预缓存，直接取服务器上现在正确的那份
pdfjs.GlobalWorkerOptions.workerSrc = `${workerUrl}?mime=js`;

const PAGE_WIDTH = 860; // 100% 时卷面宽度（px）
const MIN_WIDTH = 760; // 平板竖屏 768 起
const LONG_PRESS_MS = 500; // 手指按住一句不动这么久：出这句的译文
const HINT_KEY = "yz.examHintSeen"; // 底部"怎么选答案、查词"的提示只在第一次做题时出
const DOCK_KEY = "yz.dockTab"; // 停靠区上次开的标签（只是记住个习惯，存在浏览器里，取不到就算了）
const DOCK_TABS: DockTab[] = ["sheet", "listen", "explain", "write", "notes", "vocab", "syntax", "ask"];
function lastDockTab(): DockTab | null {
  try {
    const t = localStorage.getItem(DOCK_KEY) as DockTab | null;
    return t && DOCK_TABS.includes(t) ? t : null;
  } catch {
    return null;
  }
}
const PART_NAMES: Record<string, string> = { writing: "写作", listening: "听力", banked: "选词", matching: "匹配", reading: "阅读", order: "新题型", translation: "翻译", cloze: "完形" };
const EMPTY: PageItems = { questions: [], blanks: [], segments: [], writes: [], timed: new Set(), sets: [] };
// 这几种题号嵌在文章里或一行挨一行，题前放不下按钮：小节标题旁一个「开始计时」，整节一起计
const SET_KINDS = new Set<SectionKind>(["banked", "matching", "cloze", "order"]);
const NO_MARKS: MarkRow[] = [];
const NO_STRUCK: Record<string, string[]> = {};
const FLASH_MS = 3000; // 解析定位句在卷面上亮多久
const RAIL_WIDTH = 118; // 缩略图栏连同间距
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const NO_HITS: FindHit[] = [];

// 工具按功能分三组：选择 / 笔 / 擦和套索
/** short：工具栏上图标旁的字（套索、橡皮擦不常用，只放图标） */
const TOOLS: { id: Tool; label: string; short?: string; key: string; Icon: Icon; group: 0 | 1 | 2 }[] = [
  { id: "select", label: "选择：查词、作答", short: "选择", key: "V", Icon: Cursor, group: 0 },
  { id: "pen", label: "手写笔", short: "笔", key: "P", Icon: Pen, group: 1 },
  { id: "highlight", label: "高亮", short: "高亮", key: "H", Icon: Highlighter, group: 1 },
  { id: "underline", label: "下划线", short: "划线", key: "U", Icon: TextUnderline, group: 1 },
  { id: "note", label: "便签", short: "便签", key: "N", Icon: NoteBlank, group: 1 },
  { id: "lasso", label: "套索", key: "L", Icon: Lasso, group: 2 },
  { id: "eraser", label: "橡皮擦", key: "E", Icon: Eraser, group: 2 },
];
const TOOL_HINTS: Partial<Record<Tool, string>> = {
  pen: "在卷面上直接写，写完停住不抬笔拉成直线",
  highlight: "拖过要高亮的文字，停住不抬笔拉成直线；再拖一次同样的范围可取消",
  underline: "按住拖过要划线的文字",
  note: "点卷面上任意位置贴便签，按住便签可拖动",
  lasso: "圈住笔记，再拖动或删除",
  eraser: "点或拖过要擦掉的笔记",
};

/** "更多 → 快捷键"里列的（选项框里不再放键盘提示小字） */
const KEYS: [string[], string][] = [
  [["V", "P", "H", "U", "N", "L", "E"], "选择、手写笔、高亮、下划线、便签、套索、橡皮擦"],
  [["Esc"], "回到选择；收起答题条、关掉查找"],
  [["T"], "页面缩略图"],
  [["Ctrl", "F"], "在卷面查找（Enter 下一个，Shift Enter 上一个）"],
  [["Ctrl", "Z"], "撤销笔记"],
  [["Ctrl", "Shift", "Z"], "重做笔记"],
  [["A", "–", "D"], "答题条打开时：直接选答案"],
  [["Shift", "字母"], "答题条打开时：划掉这个选项"],
  [["R"], "答题条打开时：标记待检查"],
];

/** 滚动时会变的几个值（当前页、当前部分）放在考场外面订阅：翻页时只有页码、缩略图栏、部分标签重画，整个考场不重画 */
type ScrollState = { page: number; part?: string };
function createScrollStore(init: ScrollState) {
  let state = init;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: ScrollState) {
      if (next.page === state.page && next.part === state.part) return;
      state = next;
      for (const f of subs) f();
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}
type ScrollStore = ReturnType<typeof createScrollStore>;
const useScrollState = <T,>(store: ScrollStore, pick: (s: ScrollState) => T) => useSyncExternalStore(store.subscribe, () => pick(store.get()));

/** 缩略图栏：当前页跟着滚动走 */
function LiveRail({ store, ...rest }: Omit<Parameters<typeof ThumbRail>[0], "current"> & { store: ScrollStore }) {
  const current = useScrollState(store, (s) => s.page);
  return <ThumbRail current={current} {...rest} />;
}

/** 顶栏的部分切换：高亮当前读到的部分 */
function PartTabs({ store, items, onChange }: { store: ScrollStore; items: { value: string; label: string }[]; onChange: (id: string) => void }) {
  const value = useScrollState(store, (s) => s.part);
  return <G.Tabs label="试卷各部分" value={value} onChange={onChange} items={items} />;
}

/** 状态栏上的页码：点了变成输入框，输入页码回车跳过去 */
function PageJump({ store, first, last, onJump }: { store: ScrollStore; first: number; last: number; onJump: (n: number) => void }) {
  const current = useScrollState(store, (s) => s.page);
  const [edit, setEdit] = useState(false);
  if (edit) {
    return (
      <span className="inline-flex items-center gap-1">
        第
        <input
          autoFocus
          defaultValue={current}
          inputMode="numeric"
          aria-label="跳到第几页"
          onFocus={(e) => e.target.select()}
          onBlur={() => setEdit(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEdit(false);
            if (e.key !== "Enter") return;
            const n = parseInt(e.currentTarget.value, 10);
            if (n) onJump(Math.max(first, Math.min(last, n)));
            setEdit(false);
          }}
          className="num h-5 w-9 rounded-[5px] bg-white text-center text-[12px] text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--blue)] outline-none"
        />
        / {last} 页
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setEdit(true)} className="rounded-[5px] px-1 hover:bg-[var(--fill-quiet)] hover:text-[var(--ink)]" title="跳到第几页">
      第 <span className="num">{current}</span> / {last} 页
    </button>
  );
}

/** 笔的预设槽：点了换成这支笔，长按把当前的颜色和粗细存进来 */
function PresetSlot({ i, preset, active, onUse, onSave }: { i: number; preset: PenPreset; active: boolean; onUse: () => void; onSave: () => void }) {
  const timer = useRef(0);
  const long = useRef(false);
  const [saved, setSaved] = useState(0);
  const d = preset.size * 2.6 + 3;
  return (
    <Tip label={`笔 ${i + 1} · 长按存入当前的笔`}>
      <button
        type="button"
        aria-label={`笔预设 ${i + 1}`}
        aria-pressed={active}
        className={cn("gr-tool w-8 select-none [-webkit-touch-callout:none]", active && "bg-[var(--blue-tint)] shadow-[inset_0_0_0_1.5px_var(--blue)]")}
        onPointerDown={() => {
          long.current = false;
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            long.current = true;
            onSave();
            setSaved(Date.now());
          }, 550);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerLeave={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => !long.current && onUse()}
      >
        <span key={saved} className={cn("rounded-full", saved && "animate-pop")} style={{ width: d, height: d, background: colorValue(preset.color) }} />
      </button>
    </Tip>
  );
}

/** 内容没变就沿用上一次的对象：作答记录每 15 秒写一次库（累计用时），读回来的 answers、flags 都是新对象，
 *  不沿用的话卷面每一页都要跟着重画 */
function useSame<T>(value: T): T {
  const ref = useRef(value);
  if (ref.current !== value && JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value;
  return ref.current;
}

/** 专项训练：只做一个部分，卷面截取它在原卷上的范围 */
export interface ExamScope {
  section: Section;
  range: SectionRange | null;
}

/**
 * 考场：Grasso 工作台布局。顶栏（返回、试卷名、各部分、交卷）→ 工具栏 + 原卷画布 → 右侧面板
 * → 底部听力条和状态栏。题在卷面上做：点题号或完形空位选答案、点单词查词；笔、高亮、便签直接写在卷面上。
 * 做题方式：全真模拟顶栏有总倒计时；其余（普通做题、专项、练习、重做错题）工具栏有单题秒表。交卷后出交卷单
 */
export function ExamRoom({
  paper,
  scope,
  mode,
  attemptKey,
  retryRound,
  focus,
  attempt,
  answers: answersIn,
  texts: textsIn,
  submitted,
  elapsed,
  onChoose,
  onFlag,
  onStrike,
  onSubmit,
  onRedo,
  onLookedUp,
  onQuestionTime,
  onSectionTime,
  onMock,
}: {
  paper: Paper;
  scope?: ExamScope;
  mode: AttemptMode;
  attemptKey: string;
  retryRound?: number; // 重做错题：第几次
  focus?: string | null; // 打开后跳到这道题（错题本的"卷面"）
  attempt?: AttemptRow;
  answers: Answers;
  texts: Answers;
  submitted: boolean;
  elapsed: number;
  onChoose: (q: Question, key: string) => void;
  onFlag: (q: Question) => void;
  onStrike: (q: Question, key: string) => void;
  /** 交卷；返回这次从错题本移出（掌握了）的题 */
  onSubmit: () => Promise<string[] | void> | string[] | void;
  onRedo: () => Promise<void> | void;
  onLookedUp: () => void;
  onQuestionTime: (qid: string, sec: number) => void;
  onSectionTime: (delta: Record<string, number>) => void;
  /** 整套卷还没动笔时改成全真模拟；不能改时不传 */
  onMock?: () => void;
}) {
  const settings = useSettings();
  const navigate = useNavigate();
  const answers = useSame(answersIn);
  const texts = useSame(textsIn);
  const practice = mode === "practice";
  const retry = mode === "retry";
  const [hintSeen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* 存不了就每次都提示 */
    }
  }, []);
  // 总倒计时只在全真模拟（整套）时有；其余都是单题秒表
  const countdown = mode === "exam" && !scope;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  // 听力录音在后台下载的进度（0–1）；没在下（没有录音、已在缓存里、下完了、离线）是 null
  const [audioPct, setAudioPct] = useState<number | null>(null);
  const [pages, setPages] = useState<PdfWordsPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [winWidth, setWinWidth] = useState(innerWidth);
  const [winHeight, setWinHeight] = useState(innerHeight);
  const [search] = useSearchParams();
  // 缩略图栏：平板竖屏、窄屏默认收起
  // 缩略图栏默认收起，把宽度留给卷面；工具栏按钮或 T 键打开
  const [rail, setRail] = useState(false);
  // 卷面查找：focusKey 每按一次 Ctrl+F 加一，回到输入框
  const [find, setFind] = useState({ open: false, query: "", index: 0, focusKey: 0 });
  const findOpen = find.open;
  const [exportOpen, setExportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [scrollStore] = useState(() => createScrollStore({ page: 1, part: paper.sections[0]?.id }));
  // 停靠区（所有面板放在一处，同一时间一个标签）：平板这类窄屏默认收起，卷面大一些好写字；宽屏打开上次开的标签。
  // 只有写作和翻译的卷（一页纸的第 2、3 套）直接打开作答
  const hasChoiceQ = paper.sections.some((s) => s.groups.some((g) => g.questions.some((q) => q.options?.length)));
  const [panel, setPanel] = useState<DockTab | null>(() => (innerWidth < 1200 ? null : !hasChoiceQ ? "write" : (lastDockTab() ?? "sheet")));
  // Agent 分屏：横屏占右边那一栏（和停靠区的面板二选一），宽度可拖，记在本机
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentW, setAgentW] = useState(() => Number(localStorage.getItem("yz-agent-w")) || 460);
  useEffect(() => {
    if (panel) setAgentOpen(false);
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    try {
      localStorage.setItem(DOCK_KEY, panel);
    } catch {
      /* 存不了就不记 */
    }
  }, [panel]);
  // 竖屏底部抽屉：停在哪一档；抽屉开着时底部条的内容（查词、解析、译句）是抽屉里临时的标签，tempOn 是正看着它
  const [snap, setSnap] = useState(DRAWER_SNAPS[0]);
  const [tempOn, setTempOn] = useState(false);
  const [writeSeen, setWriteSeen] = useState(false); // 点开过作文、翻译：停靠区多一个"作答"
  const [listenSlot, setListenSlot] = useState<HTMLDivElement | null>(null); // 停靠区"原文"标签的格子，听力条把原文画进去
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [agentFlash, setAgentFlash] = useState<{ page: number; range: [number, number] } | null>(null); // Agent 里点了引用的原文：卷面那一句闪一下
  const agentFlashT = useRef(0);
  const [hit, setHit] = useState<WordClick | null>(null);
  // 长按一句（鼠标右键）：这句的译文放在底部条，卷面上这句淡黄底
  const [sent, setSent] = useState<{ page: number; sid: number; sentence: string; n: number } | null>(null);
  // 句子译文层：undefined 还在取，null 这套没有
  const [transFile, setTransFile] = useState<TransFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setTransFile(undefined);
    void loadTrans(paper.id).then((f) => live && setTransFile(f));
    return () => {
      live = false;
    };
  }, [paper.id]);
  // 长难句层（只有仔细阅读两篇）：卷面上标虚线、长按或点词出解析、停靠区"长难句"标签
  const [syntaxFile, setSyntaxFile] = useState<SyntaxFile | null>(null);
  useEffect(() => {
    let live = true;
    setSyntaxFile(null);
    void loadSyntax(paper.id).then((f) => live && setSyntaxFile(f));
    return () => {
      live = false;
    };
  }, [paper.id]);
  const [playing, setPlaying] = useState<{ seg: string | null; on: boolean }>({ seg: null, on: false });
  const [confirm, setConfirm] = useState<"submit" | "redo" | "clear" | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false); // 刚交卷：答题卡上的分数"盖"下去
  useEffect(() => {
    if (!justSubmitted) return;
    const t = setTimeout(() => setJustSubmitted(false), 1200);
    return () => clearTimeout(t);
  }, [justSubmitted]);
  const [listenOpen, setListenOpen] = useState(false); // 听力条只在需要时打开
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [focusWrite, setFocusWrite] = useState<{ id: string; n: number } | null>(null);
  // 卷面笔记
  const [tool, setTool] = useState<Tool>("select");
  const [colors, setColors] = useState<Record<ColorTool, string>>({ pen: COLORS.pen[0].id, highlight: COLORS.highlight[0].id });
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1].id);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [wordFlash, setWordFlash] = useState<InkState["wordFlash"]>(null);
  const [report, setReport] = useState<{ open: boolean; retired: string[] }>({ open: false, retired: [] });
  const history = useMarkHistory();
  const bar = useRef<ListeningBarHandle>(null);
  const marksData = useVocabMarks(settings.showVocabMarks);
  const vocabMarks = settings.showVocabMarks ? marksData : null;
  const vocabCount = useLiveQuery(() => db.vocab.filter((v) => v.sources.some((s) => s.paperId === paper.id)).count(), [paper.id]) ?? 0;
  const flagList = useSame(attempt?.flags);
  const flags = useMemo(() => new Set(flagList ?? []), [flagList]);
  const struck = useSame(attempt?.struck ?? NO_STRUCK);
  const questionSec = useSame(attempt?.questionSec ?? null);
  const marksRaw = useLiveQuery(() => db.marks.where("paperId").equals(paper.id).toArray(), [paper.id]);
  const allMarks = marksRaw ?? NO_MARKS;
  // 听力分段 → 题号，给听力条标题号刻度
  const questionsBySegment = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const s of paper.sections) for (const g of s.groups) if (g.audioSegment) (m[g.audioSegment] ??= []).push(...g.questions.map((q) => q.number));
    return m;
  }, [paper]);

  useEffect(() => {
    // 卸载后（含开发模式下 effect 执行两遍）忽略旧请求的结果
    let cancelled = false;
    const warmAbort = new AbortController();
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    let total = 0;
    loadPdf(paper.pdf.src, warmAbort.signal)
      .then((t) => {
        if (cancelled) return void t.task.destroy();
        task = t.task;
        total = t.total;
        return t.task.promise;
      })
      .then(
      (d) => {
        if (!d) return;
        if (cancelled) return;
        setDoc(d);
        // 卷面第一页真正画出来之后，再把整份原卷分段取完存进离线缓存（cacheWhole），之后翻页、离线都从缓存切。
        // 原卷存完之后接着把听力录音也分段下完存进缓存（优先级低于 PDF），之后点哪句跳哪句都从缓存切；
        // 没下完时点播放照旧边下边放。离开这套卷就中止（warmAbort），已在缓存里的跳过，离线静默放弃
        const drawn = () => [...document.querySelectorAll("canvas")].some((c) => c.width > 300);
        void (async () => {
          for (let i = 0; i < 240 && !cancelled && !drawn(); i++) await new Promise((r) => setTimeout(r, 500));
          await new Promise((r) => setTimeout(r, 1500));
          if (cancelled) return;
          await cacheWhole(paper.pdf.src, total, warmAbort.signal).catch(() => {});
          const src = paper.audio?.src;
          if (!src || cancelled) return;
          touchAudio(src);
          let last = -1;
          await prefetchAudio(src, warmAbort.signal, (p) => {
            const n = Math.floor(p * 100);
            if (cancelled || n === last) return;
            last = n;
            setAudioPct(p >= 1 ? null : p);
          }).catch(() => {});
          if (!cancelled) setAudioPct(null);
        })();
      },
      (e: Error) => !cancelled && setError(`原卷加载失败：${e.message}`),
      );
    fetch(paper.pdf.words)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (d: { pages: PdfWordsPage[] }) => !cancelled && setPages(d.pages),
        (e: Error) => !cancelled && setError(`单词数据加载失败：${e.message}`),
      );
    return () => {
      cancelled = true;
      warmAbort.abort();
      void task?.destroy();
    };
  }, [paper.pdf]);

  // 显示哪几页：整套是全部；专项训练从这一部分的标题截到下一部分之前
  const range = scope?.range;
  const firstPage = range?.first ?? 1;
  const lastPage = range?.last ?? pages?.length ?? 1;

  // 平板竖屏、小屏：缩略图栏浮在卷面上，不挤占卷面宽度
  const floating = winWidth < 1100;
  // 平板横屏这类矮屏：顶栏和工具栏并成一行，浮在卷面上，往下滚时收起
  const compact = winWidth > winHeight && winHeight < 900;
  // 停靠区：横屏或宽 ≥ 1100 在右侧一栏（宽 360，把卷面挤窄）；竖屏窄屏是听力条上面的底部抽屉（把卷面挤矮）
  const sideDock = winWidth > winHeight || winWidth >= 1100;
  // 存的宽度按当前窗口再限一次（窄窗口里不能把卷面挤没）
  const agentWidth = Math.min(agentW, Math.max(320, Math.round(winWidth * 0.6)));
  const dockSpace = !sideDock ? 0 : agentOpen ? agentWidth + 8 : panel ? DOCK_WIDTH + 8 : 0;
  const canvasWidth = Math.max(winWidth, MIN_WIDTH) - dockSpace - (rail && !floating ? RAIL_WIDTH : 0) - 16;
  // 卷面那一栏窄（平板、开着侧栏）时页边距收窄，卷面大一些好写字
  const tightPad = canvasWidth < 900;
  const pagePad = tightPad ? 32 : 96;
  const avail = canvasWidth - 12 - pagePad;
  const narrow = canvasWidth < 820; // 工具栏放不下时省掉次要的按钮和数字
  const slim = narrow || compact; // 并成一行时也省
  const pageWidth = pages?.[0]?.width ?? 595;
  // 100% = 卷面宽 860，放不下就是画布可用宽度；放大超过画布就左右滚动
  const single = Math.min(PAGE_WIDTH, Math.max(avail, 480)) * zoom;
  // 双页视图：横屏、整套卷、一页还不到半个屏幕宽（两页并排也不会缩得太小）时才可选
  const twoUpOk = !scope && winWidth > winHeight && lastPage > firstPage && single < winWidth / 2 && (avail - 20) / 2 >= single * 0.8;
  const twoUp = settings.twoUpPages && twoUpOk;
  const scale = (twoUp ? Math.min(single, (avail - 20) / 2) : single) / pageWidth;
  const clips = useMemo(() => {
    const map = new Map<number, { top: number; bottom: number | null }>();
    if (range) {
      map.set(firstPage, { top: range.top, bottom: firstPage === lastPage ? range.bottom : null });
      if (lastPage !== firstPage) map.set(lastPage, { top: 0, bottom: range.bottom });
    }
    return map;
  }, [range, firstPage, lastPage]);

  // 笔记是整套卷共用的；专项训练只列出截取范围里的
  const marks = useMemo(() => {
    if (!range) return allMarks;
    return allMarks.filter((m) => {
      if (m.page < firstPage || m.page > lastPage) return false;
      const [, y0, , y1] = markBounds(m);
      if (m.page === firstPage && y1 < range.top) return false;
      if (m.page === lastPage && range.bottom !== null && y0 > range.bottom) return false;
      return true;
    });
  }, [allMarks, range, firstPage, lastPage]);

  // 每页上的题号、完形空位、听力播放按钮、作文翻译入口、计时的「开始」按钮
  const items = useMemo(() => {
    const map = new Map<number, PageItems>();
    const get = (page: number) => {
      if (!map.has(page)) map.set(page, { questions: [], blanks: [], segments: [], writes: [], timed: new Set(), sets: [] });
      return map.get(page)!;
    };
    for (const s of paper.sections) {
      const ids = s.groups.flatMap((g) => g.questions.filter((q) => q.options?.length).map((q) => q.id));
      if (SET_KINDS.has(s.kind) && s.anchor && ids.length) get(s.anchor.page).sets.push({ id: s.id, box: s.anchor.box, ids });
      for (const g of s.groups) {
        if (g.anchor && g.audioSegment && paper.audio) get(g.anchor.page).segments.push(g);
        for (const q of g.questions) {
          if (q.blank) get(q.blank.page).blanks.push(q);
          if (!q.page || !q.box) continue;
          if (q.options?.length) {
            get(q.page).questions.push(q);
            if (s.kind === "reading") get(q.page).timed.add(q.id);
          } else get(q.page).writes.push(q);
        }
      }
    }
    return map;
  }, [paper]);
  // 整节计时：每道题在哪一节、每节有哪些题
  const timeSets = useMemo(() => {
    const of = new Map<string, string>();
    const ids = new Map<string, string[]>();
    for (const s of paper.sections) {
      if (!SET_KINDS.has(s.kind) || !s.anchor) continue;
      const list = s.groups.flatMap((g) => g.questions.filter((q) => q.options?.length).map((q) => q.id));
      ids.set(s.id, list);
      for (const id of list) of.set(id, s.id);
    }
    return { of, ids };
  }, [paper]);

  // 每页的笔记。没变的页沿用原来的数组，那一页就不用重画
  const pageCache = useRef(new Map<number, { key: string; list: MarkRow[] }>());
  const marksByPage = useMemo(() => {
    const groups = new Map<number, MarkRow[]>();
    for (const m of allMarks) {
      if (!groups.has(m.page)) groups.set(m.page, []);
      groups.get(m.page)!.push(m);
    }
    const cache = pageCache.current;
    for (const [page, list] of groups) {
      const key = list.map((m) => `${m.id}:${m.updatedAt}`).join("|");
      if (cache.get(page)?.key === key) groups.set(page, cache.get(page)!.list);
      else cache.set(page, { key, list });
    }
    for (const page of [...cache.keys()]) if (!groups.has(page)) cache.delete(page);
    return groups;
  }, [allMarks]);
  const markedPages = useMemo(() => new Set(marksByPage.keys()), [marksByPage]);

  // 各部分在卷面上的起点，用于顶栏的部分切换
  const partAnchors = useMemo(
    () =>
      paper.sections.map((s) => {
        const a = s.anchor ?? s.groups[0]?.anchor;
        const q = s.groups[0]?.questions.find((x) => x.page && x.box);
        return { id: s.id, kind: s.kind, page: a?.page ?? q?.page ?? 1, y: a?.box[1] ?? q?.box?.[1] ?? 0 };
      }),
    [paper],
  );

  /** 卷面上某一点在画布滚动容器里的位置（双页视图换排版时也要重新量） */
  const topOf = useCallback(
    (page: number, y: number) => {
      const el = document.getElementById(`pdf-page-${page}`);
      if (!el || !stage) return Infinity;
      return el.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop + y * scale;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, scale, twoUp],
  );
  const ready = !!(doc && pages && stage);

  // 矮屏并成一行的工具栏：卷面往下滚收起，往上滚、回到顶上或点顶上的小把手露出来
  const [barHidden, setBarHidden] = useState(false);
  useEffect(() => setBarHidden(false), [compact]);
  // 那一行有多高（触屏按钮 40px 时 48）：侧栏顶上让出这么多
  const [toolRow, setToolRow] = useState<HTMLDivElement | null>(null);
  const [toolH, setToolH] = useState(48);
  useEffect(() => {
    if (!toolRow) return;
    const ro = new ResizeObserver(() => setToolH(toolRow.offsetHeight));
    ro.observe(toolRow);
    return () => ro.disconnect();
  }, [toolRow]);

  // 滚动时只有这一个监听（每帧最多算一次）：当前页（缩略图栏、状态栏页码）、当前部分（顶栏）、矮屏工具栏收起。
  // 各页、各部分的起点只在排版变了时量一次，滚动时只做比较（滚动里量元素位置会卡）；值没变不 setState
  useEffect(() => {
    if (!ready || !stage) return;
    const pageTops: { n: number; top: number }[] = [];
    for (let n = firstPage; n <= lastPage; n++) pageTops.push({ n, top: topOf(n, clips.get(n)?.top ?? 0) });
    const partTops = partAnchors.map((a) => ({ id: a.id, top: topOf(a.page, a.y) }));
    let raf = 0;
    let last = stage.scrollTop;
    const update = () => {
      raf = 0;
      const y = stage.scrollTop;
      const h = stage.clientHeight;
      let cur = firstPage;
      let curTop = -Infinity;
      // 双页视图同一排两页顶端一样，算左边那页
      for (const t of pageTops) if (t.top <= y + h * 0.35 && t.top > curTop + 1) [cur, curTop] = [t.n, t.top];
      let p = partTops[0]?.id;
      for (const t of partTops) if (t.top <= y + h * 0.45) p = t.id;
      scrollStore.set({ page: cur, part: p });
      if (!compact) return;
      if (y < 40) setBarHidden(false);
      else if (y - last > 8) setBarHidden(true);
      else if (last - y > 8) setBarHidden(false);
      else return;
      last = y;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener("scroll", onScroll);
    };
  }, [ready, stage, topOf, firstPage, lastPage, clips, partAnchors, compact, scrollStore]);

  const jumpPage = useCallback(
    (n: number) => {
      stage?.scrollTo({ top: topOf(n, clips.get(n)?.top ?? 0) - 12, behavior: "smooth" });
      if (floating) setRail(false);
    },
    [stage, topOf, clips, floating],
  );

  // 卷面查找：每页的词拼成一行再找，命中按页分好交给各页的单词层
  const wordTexts = useMemo(() => (pages ? pageTexts(pages) : []), [pages]);
  const hits = useMemo(() => {
    if (!find.open || !pages) return NO_HITS;
    const band = range ? (n: number) => (clips.has(n) ? ([clips.get(n)!.top, clips.get(n)!.bottom ?? Infinity] as [number, number]) : null) : undefined;
    return findInPages(wordTexts, pages, find.query, firstPage, lastPage, band);
  }, [find.open, find.query, pages, wordTexts, range, clips, firstPage, lastPage]);
  const hitsByPage = useMemo(() => {
    const map = new Map<number, [number, number][]>();
    for (const h of hits) (map.get(h.page) ?? map.set(h.page, []).get(h.page)!).push(h.range);
    return map;
  }, [hits]);
  const curHit = hits[find.index] ?? null;
  const stepFind = (dir: 1 | -1) => setFind((f) => ({ ...f, index: hits.length ? (f.index + dir + hits.length) % hits.length : 0 }));
  const openFind = () => setFind((f) => ({ ...f, open: true, focusKey: f.focusKey + 1 }));
  const closeFind = () => setFind((f) => ({ ...f, open: false, query: "", index: 0 }));

  const scrollToY = useCallback((top: number) => stage?.scrollTo({ top, behavior: "smooth" }), [stage]);

  /** 从答题卡跳到题目：选择题顺便打开选项（完形打开文章里的空位） */
  const onJump = useCallback(
    (q: Question) => {
      setTool("select");
      if (q.blank) {
        scrollToY(topOf(q.blank.page, q.blank.box[1]) - 200);
        setTimeout(() => setOpenQ(`${q.id}@blank`), 450);
        return;
      }
      if (!q.page || !q.box) return;
      scrollToY(topOf(q.page, q.box[1]) - 160);
      if (q.options?.length) setTimeout(() => setOpenQ(q.id), 450);
    },
    [topOf, scrollToY],
  );

  /** 从笔记面板跳到卷面：框出来闪两下，便签直接打开 */
  const onJumpMark = useCallback(
    (m: MarkRow) => {
      scrollToY(topOf(m.page, markBounds(m)[1]) - (stage?.clientHeight ?? 600) / 3);
      setFlash({ id: m.id, n: Date.now() });
      if (m.kind === "note") {
        setTool("select");
        setTimeout(() => setOpenNote(m.id), 450);
      }
    },
    [topOf, scrollToY, stage],
  );
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const qById = useMemo(() => new Map(allQuestions(paper).map((q) => [q.id, q])), [paper]);
  const limits = useMemo(() => suggestMap(paper), [paper]);

  // 单题秒表：点了题前的「开始」（或开始写作答框）才计时，选定答案时记下来。
  // 全真模拟不显示秒表和「开始」，照旧点开一道题就在后台计它
  const timer = useQuestionTimer({ enabled: !submitted, onCommit: onQuestionTime });
  const { start: timeStart, commit: timeCommit, lap: timeLap } = timer;
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  useEffect(() => {
    if (countdown && openQ) timeStart(openQ.replace(/@blank$/, ""));
  }, [countdown, openQ, timeStart]);
  const choose = useCallback(
    (q: Question, key: string) => {
      const was = answersRef.current[q.id];
      onChoose(q, key);
      const set = timerRef.current.set;
      if (!set || timeSets.of.get(q.id) !== set) return timeCommit(q.id);
      if (was === key) return; // 再点一次是取消，不算
      // 整节计时：这一段记给刚答的题，接着计这节下一道没答的
      timeLap(q.id, timeSets.ids.get(set)!.find((id) => id !== q.id && !answersRef.current[id]) ?? null);
    },
    [onChoose, timeCommit, timeLap, timeSets],
  );
  // 题前的小秒表：开始计这道题；正在计的再点是暂停、继续
  const onStartQ = useCallback(
    (q: Question) => {
      const t = timerRef.current;
      if (t.qid === q.id && !t.set) return t.toggle();
      if (practice && answersRef.current[q.id]) return; // 练习模式做过的题已经锁定
      t.start(q.id);
    },
    [practice],
  );
  // 小节标题旁的「开始计时」：从这节第一道没答的开始计
  const onStartSet = useCallback(
    (id: string) => {
      const t = timerRef.current;
      if (t.set === id) return t.toggle();
      const first = timeSets.ids.get(id)?.find((x) => !answersRef.current[x]);
      if (first) t.start(first, id);
    },
    [timeSets],
  );
  const timing = useMemo<Timing | null>(
    () => (timer.qid ? { id: timer.set ?? timer.qid, set: !!timer.set, running: timer.running } : null),
    [timer.qid, timer.set, timer.running],
  );

  // 各部分用时：每秒给当前读到的部分 +1，每 15 秒交给做题页存一次
  const secBuf = useRef<Record<string, number>>({});
  const sectionTime = useRef(onSectionTime);
  sectionTime.current = onSectionTime;
  const flushSections = useCallback(() => {
    const d = secBuf.current;
    secBuf.current = {};
    if (Object.keys(d).length) sectionTime.current(d);
  }, []);
  useEffect(() => {
    if (submitted) return;
    const tick = setInterval(() => {
      const id = scrollStore.get().part;
      if (id && document.visibilityState === "visible") secBuf.current[id] = (secBuf.current[id] ?? 0) + 1;
    }, 1000);
    const save = setInterval(flushSections, 15_000);
    return () => {
      clearInterval(tick);
      clearInterval(save);
      flushSections();
    };
  }, [submitted, flushSections]);

  // 解析"在卷面上标出"：滚到定位句，临时蓝色高亮 3 秒（不写进笔记）。停靠区不盖卷面，不用让位
  const flashWords = useCallback(
    (page: number, range: [number, number]) => {
      const w = pages?.[page - 1]?.w[range[0]];
      if (!w || !document.getElementById(`pdf-page-${page}`)) return;
      setTool("select");
      scrollToY(topOf(page, w[2]) - (stage?.clientHeight ?? 600) / 3);
      setWordFlash({ page, range, n: Date.now() });
    },
    [pages, scrollToY, topOf, stage],
  );
  useEffect(() => {
    if (!wordFlash) return;
    const t = setTimeout(() => setWordFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [wordFlash]);

  // 听力定位：有逐字稿行号用行号，没有就拿定位句在逐字稿里找最像的一行
  const explainActions = useMemo<ExplainActions>(() => {
    const segOf = new Map<string, string>();
    for (const s of paper.sections) for (const g of s.groups) if (g.audioSegment) for (const q of g.questions) segOf.set(q.id, g.audioSegment);
    const cache = new Map<string, { segment: string; index: number } | null>();
    const lineFor = (q: Question, loc: NonNullable<ExplainFields["locate"]>) => {
      if (loc.line) return loc.line;
      if (!cache.has(q.id)) cache.set(q.id, paper.audio && loc.quote ? findAudioLine(paper.audio, loc.quote, segOf.get(q.id)) : null);
      return cache.get(q.id)!;
    };
    return {
      paperId: paper.id,
      paperTitle: paper.title,
      flashWords,
      canListen: (q, loc) => !!paper.audio && segOf.has(q.id) && !!lineFor(q, loc),
      listen: (q, loc) => {
        const line = lineFor(q, loc);
        if (!line) return;
        setListenOpen(true);
        bar.current?.playLine(line.segment, line.index);
      },
    };
  }, [paper, flashWords]);

  // 打开就跳到一道题：错题本点"卷面"过来的那道；重做错题是第一道
  const jumped = useRef(false);
  useEffect(() => {
    if (!ready || jumped.current) return;
    jumped.current = true;
    const q = focus ? qById.get(focus) : retry ? allQuestions(paper).find((x) => x.page || x.blank) : undefined;
    if (q) setTimeout(() => onJump(q), 300);
  }, [ready, focus, retry, qById, paper, onJump]);

  // 从单词卡"在卷面上看"过来：?mark= 跳到那条批注，?sent= 把那句原句标蓝
  const targeted = useRef(false);
  const focusMark = search.get("mark");
  const focusSent = search.get("sent");
  useEffect(() => {
    if (!ready || !pages || targeted.current || (!focusMark && !focusSent)) return;
    if (focusMark) {
      if (!marksRaw) return;
      targeted.current = true;
      const m = marksRaw.find((x) => x.id === focusMark);
      if (m) setTimeout(() => onJumpMark(m), 300);
      return;
    }
    targeted.current = true;
    for (let n = firstPage; n <= lastPage; n++) {
      const p = pages[n - 1];
      const si = p?.s.indexOf(focusSent!) ?? -1;
      if (si < 0) continue;
      const idx = p.w.flatMap((w, i) => (w[5] === si ? [i] : []));
      if (idx.length) setTimeout(() => flashWords(n, [idx[0], idx[idx.length - 1]]), 300);
      break;
    }
  }, [ready, pages, focusMark, focusSent, marksRaw, onJumpMark, flashWords, firstPage, lastPage]);

  // 查找：当前命中滚到画布上方三分之一处
  useEffect(() => {
    if (!curHit || !pages) return;
    const w = pages[curHit.page - 1]?.w[curHit.range[0]];
    if (w) scrollToY(topOf(curHit.page, w[2]) - (stage?.clientHeight ?? 600) / 3);
  }, [curHit, pages, scrollToY, topOf, stage]);

  // 现在开着哪几层（Esc 按层关）：渲染时更新
  const layers = useRef({ bar: false, tool: "select" as Tool, dock: false });
  // 快捷键：V P H U N L E 换工具，T 缩略图栏，Ctrl+F 查找，Esc 回到选择，Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // 浏览器自己的查找搜不到原卷（画在画布上），换成卷面查找
      if (mod && !e.altKey && key === "f") {
        e.preventDefault();
        setFind((f) => ({ ...f, open: true, focusKey: f.focusKey + 1 }));
        return;
      }
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable=true]")) return;
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        void (key === "y" || e.shiftKey ? history.redo() : history.undo());
        return;
      }
      if (mod || e.altKey || openQ) return; // 选择题弹出框打开时，字母键用来选答案
      // Esc 只关最上面一层：小菜单、对话框自己关；查找条；底部条（它自己关）；笔记工具回到选择；最后才收起停靠区
      if (e.key === "Escape") {
        if (document.querySelector('[role="dialog"], .gr-popover-panel')) return;
        if (findOpen) setFind((f) => ({ ...f, open: false, query: "", index: 0 }));
        else if (layers.current.bar) return;
        else if (layers.current.tool !== "select") setTool("select");
        else if (layers.current.dock) setPanel(null);
        return;
      }
      if (key === "t") {
        e.preventDefault();
        setRail((r) => !r);
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t) {
        e.preventDefault();
        setTool(t.id);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [history, openQ, findOpen]);

  // 换成笔记工具时收起查词、译句和选项
  useEffect(() => {
    if (tool === "select") return;
    setHit(null);
    setSent(null);
    setOpenQ(null);
  }, [tool]);

  // 手指点词（任何工具下）、手写笔双击：按坐标找到卷面上的词，和鼠标点词一样弹查词卡
  const lookupAt = useCallback(
    (cx: number, cy: number) => {
      if (!pages) return;
      const top = document.elementFromPoint(cx, cy);
      // 点在题号、便签、弹出框、查找条、答题条这些控件上，交给它们自己
      if (!top || top.closest("button, a, input, textarea, select, [role=dialog], [role=search], [data-answer-bar], [data-word-card], [data-choice-strip], .gr-pop, nav")) return;
      for (let n = firstPage; n <= lastPage; n++) {
        const el = document.getElementById(`pdf-page-${n}`);
        const r = el?.getBoundingClientRect();
        if (!el || !r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
        const data = pages[n - 1];
        const k = wordAt(data.w, (cx - r.left) / scale, (cy - r.top) / scale);
        if (k < 0) break;
        gesture.touchLookupAt = Date.now();
        setOpenQ(null);
        setSent(null);
        setHit({ word: data.w[k][0], sentence: data.s[data.w[k][5]] ?? "", rect: wordRect(n, data, k, scale), page: n, index: k, nth: wordNth(data, k) });
        return;
      }
      // 点在卷面空白处：收起
      setHit(null);
      setSent(null);
      setOpenQ(null);
    },
    [pages, scale, firstPage, lastPage],
  );

  /** 长按（鼠标右键）一句：这句的译文放进底部条，卷面上这句淡黄底。点在控件上、空白处不算 */
  const sentenceAt = useCallback(
    (cx: number, cy: number) => {
      if (!pages) return false;
      const top = document.elementFromPoint(cx, cy);
      if (!top || top.closest("button, a, input, textarea, select, [role=dialog], [role=search], [data-answer-bar], [data-word-card], [data-choice-strip], .gr-pop, nav")) return false;
      for (let n = firstPage; n <= lastPage; n++) {
        const r = document.getElementById(`pdf-page-${n}`)?.getBoundingClientRect();
        if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
        const data = pages[n - 1];
        const k = wordAt(data.w, (cx - r.left) / scale, (cy - r.top) / scale);
        const sid = k >= 0 ? data.w[k][5] : -1;
        const sentence = data.s[sid];
        if (!sentence) return false;
        setOpenQ(null);
        setHit(null);
        setSent({ page: n, sid, sentence, n: Date.now() });
        return true;
      }
      return false;
    },
    [pages, scale, firstPage, lastPage],
  );
  const sentenceRef = useRef(sentenceAt);
  sentenceRef.current = sentenceAt;

  // 手指点一下（0.3 秒内抬起、移动不到 8px）= 查词，任何工具下都是（贴便签除外）；两指、拖动不算。
  // 抬起监听在 document 的冒泡阶段：笔记层先处理（点中已有高亮时它会 preventDefault），再轮到这里
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const lookupRef = useRef(lookupAt);
  lookupRef.current = lookupAt;
  // 手指按住一句 0.5 秒不动（只在"选择"工具下，笔和高亮按住不动是拉直线）= 出这句的译文；鼠标是右键
  useEffect(() => {
    if (!stage) return;
    let down: { id: number; x: number; y: number; t: number; multi: boolean; timer: number; held: boolean } | null = null;
    let heldAt = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (down) {
        down.multi = true;
        clearTimeout(down.timer);
        return;
      }
      const d = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), multi: false, timer: 0, held: false };
      if (toolRef.current === "select")
        d.timer = window.setTimeout(() => {
          if (d.multi || gesture.pinching || down !== d) return;
          if (sentenceRef.current(d.x, d.y)) {
            d.held = true;
            heldAt = Date.now();
            gesture.touchLookupAt = Date.now() + 60_000; // 松手前后那一下 click 不再当成点词
          }
        }, LONG_PRESS_MS);
      down = d;
    };
    const onMove = (e: PointerEvent) => {
      if (down?.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(down.timer);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || down?.id !== e.pointerId) return;
      const d = down;
      down = null;
      clearTimeout(d.timer);
      if (d.held) {
        gesture.touchLookupAt = Date.now();
        return;
      }
      if (d.multi || gesture.pinching || e.defaultPrevented || toolRef.current === "note") return;
      if (performance.now() - d.t > 300 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      lookupRef.current(e.clientX, e.clientY);
    };
    const onCancel = (e: PointerEvent) => {
      if (down?.id !== e.pointerId) return;
      clearTimeout(down.timer);
      if (down.held) gesture.touchLookupAt = Date.now();
      down = null;
    };
    // 鼠标右键出译文；安卓长按也会发 contextmenu，刚长按出过就只拦下系统菜单
    const onMenu = (e: MouseEvent) => {
      if (toolRef.current !== "select") return;
      if (Date.now() - heldAt < 1500) return e.preventDefault();
      if (sentenceRef.current(e.clientX, e.clientY)) e.preventDefault();
    };
    stage.addEventListener("pointerdown", onDown, true);
    stage.addEventListener("pointermove", onMove, { capture: true, passive: true });
    stage.addEventListener("contextmenu", onMenu);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      if (down) clearTimeout(down.timer);
      stage.removeEventListener("pointerdown", onDown, true);
      stage.removeEventListener("pointermove", onMove, true);
      stage.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [stage]);

  // 双指缩放：捏合时只给卷面加一个 CSS 缩放（不重排、不重画），松手才改缩放比例，
  // 并把两指中点下的那一点留在两指中间；各页 0.22 秒后按新比例重画。捏合中各页的笔记层停笔
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  // 重排后要放回原处的一点：第 n 页上的 (px, py)（PDF 点）放回屏幕上的 (cx, cy)；
  // center：放回画布中间（转屏）；fitX：贴合宽度时左右不留滚动
  const anchorRef = useRef<{ n: number; px: number; py: number; cx: number; cy: number; center?: boolean; fitX?: boolean } | null>(null);
  useEffect(() => {
    if (!stage) return;
    let pinch: { d0: number; m0: [number, number]; m: [number, number]; ratio: number; anchor: { n: number; px: number; py: number } | null } | null = null;
    const opts = { passive: false } as AddEventListenerOptions;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, m: [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2] as [number, number] };
    };
    const onStart = (e: TouchEvent) => {
      const content = contentRef.current;
      if (e.touches.length !== 2 || pinch || !content) return;
      e.preventDefault();
      const { d, m } = two(e);
      let anchor: { n: number; px: number; py: number } | null = null;
      for (const el of content.querySelectorAll<HTMLElement>('[id^="pdf-page-"]')) {
        const r = el.getBoundingClientRect();
        if (m[1] < r.top || m[1] > r.bottom) continue;
        anchor = { n: Number(el.id.slice(9)), px: (m[0] - r.left) / scaleRef.current, py: (m[1] - r.top) / scaleRef.current };
        break;
      }
      const cr = content.getBoundingClientRect();
      content.style.transformOrigin = `${m[0] - cr.left}px ${m[1] - cr.top}px`;
      content.style.willChange = "transform";
      pinch = { d0: d, m0: m, m, ratio: 1, anchor };
      // 非被动的 touchmove 只在捏合时挂上：平时单指滚动不用等主线程回话
      stage.addEventListener("touchmove", onMove, opts);
      startPinch();
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      const { d, m } = two(e);
      const z = zoomRef.current;
      pinch.ratio = Math.min(MAX_ZOOM / z, Math.max(MIN_ZOOM / z, d / pinch.d0));
      pinch.m = m;
      contentRef.current!.style.transform = `translate(${m[0] - pinch.m0[0]}px, ${m[1] - pinch.m0[1]}px) scale(${pinch.ratio})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      stage.removeEventListener("touchmove", onMove);
      const content = contentRef.current;
      if (content) {
        content.style.transform = "";
        content.style.willChange = "";
      }
      endPinch();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(zoomRef.current * p.ratio).toFixed(2)));
      if (next === zoomRef.current) return;
      if (p.anchor) anchorRef.current = { ...p.anchor, cx: p.m[0], cy: p.m[1] };
      setZoom(next);
    };
    // Safari 自己的捏合（整页放大）不要
    const stop = (e: Event) => e.preventDefault();
    stage.addEventListener("touchstart", onStart, opts);
    stage.addEventListener("touchend", onEnd);
    stage.addEventListener("touchcancel", onEnd);
    stage.addEventListener("gesturestart", stop, opts);
    stage.addEventListener("gesturechange", stop, opts);
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
      stage.removeEventListener("gesturestart", stop);
      stage.removeEventListener("gesturechange", stop);
      endPinch();
    };
  }, [stage]);
  /** 画布中间那一点在哪一页的哪儿（换排版前记下，排好后放回画布中间） */
  /** 画布中间那一点在哪一页的哪儿；k 是页面现在（屏幕上）的缩放 */
  const centerAnchor = (w: number, h: number, k: number) => {
    if (!stage) return null;
    const s = stage.getBoundingClientRect();
    const cx = s.left + w / 2;
    const cy = s.top + h / 2;
    for (const el of stage.querySelectorAll<HTMLElement>('[id^="pdf-page-"]')) {
      const r = el.getBoundingClientRect();
      if (cy < r.top || cy > r.bottom) continue;
      return { n: Number(el.id.slice(9)), px: (cx - r.left) / k, py: (cy - r.top) / k, cx, cy, center: true, fitX: zoomRef.current === 1 };
    }
    return null;
  };
  // 屏幕上的页面是按哪个缩放排的（上一次提交的；scaleRef 在渲染时就换成了新的）
  const drawnScale = useRef(scale);
  useLayoutEffect(() => {
    drawnScale.current = scale;
  }, [scale]);
  // 侧栏开关（卷面变窄、变宽，按新宽度重排）：在换排版之前（这次渲染还没提交，页面还是旧的）记下画布中间那一点，
  // 排好后放回画布中间——正看的那一页留在原处，不跳
  const lastDockSpace = useRef(dockSpace);
  if (lastDockSpace.current !== dockSpace) {
    lastDockSpace.current = dockSpace;
    if (stage && !anchorRef.current) anchorRef.current = centerAnchor(stage.clientWidth, stage.clientHeight, drawnScale.current);
  }
  // 缩放比例（或窗口大小、侧栏）改好、各页按新大小排好之后，把记下的那一点挪回原处
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a || !stage) return;
    anchorRef.current = null;
    const r = document.getElementById(`pdf-page-${a.n}`)?.getBoundingClientRect();
    if (!r) return;
    let { cx, cy } = a;
    if (a.center) {
      const s = stage.getBoundingClientRect();
      cx = s.left + stage.clientWidth / 2;
      cy = s.top + stage.clientHeight / 2;
    }
    stage.scrollTop += r.top + a.py * scale - cy;
    if (a.fitX) stage.scrollLeft = 0;
    else stage.scrollLeft += r.left + a.px * scale - cx;
  }, [scale, stage, winWidth, winHeight, dockSpace]);

  // 画布上一次排好时的大小：窗口变了以后，用它找回变之前画布中间是哪一点
  const stageSize = useRef({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (stage) stageSize.current = { w: stage.clientWidth, h: stage.clientHeight };
  });

  // 窗口大小变了（平板转屏、分屏）：卷面按新宽度重新贴合（缩放倍数是相对贴合宽度的，手动缩放过的照比例保持），
  // 原来画布中间的那一点还放在画布中间；100% 时左右不留滚动。
  // iPad 转屏时 orientationchange 和第一次 resize 读到的可能还是旧尺寸：也看根元素的尺寸变化，过一会儿再读一次
  const winSeen = useRef({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const read = () => {
      const w = innerWidth;
      const h = innerHeight;
      if (w === winSeen.current.w && h === winSeen.current.h) return;
      winSeen.current = { w, h };
      if (stage && !anchorRef.current) {
        const s = stage.getBoundingClientRect();
        const cx = s.left + stageSize.current.w / 2;
        const cy = s.top + stageSize.current.h / 2;
        for (const el of stage.querySelectorAll<HTMLElement>('[id^="pdf-page-"]')) {
          const r = el.getBoundingClientRect();
          if (cy < r.top || cy > r.bottom) continue;
          anchorRef.current = { n: Number(el.id.slice(9)), px: (cx - r.left) / scaleRef.current, py: (cy - r.top) / scaleRef.current, cx, cy, center: true, fitX: zoomRef.current === 1 };
          break;
        }
      }
      setWinWidth(w);
      setWinHeight(h);
    };
    const soon = () => {
      read();
      requestAnimationFrame(read);
      setTimeout(read, 350);
    };
    const ro = new ResizeObserver(read);
    ro.observe(document.documentElement);
    addEventListener("resize", soon);
    addEventListener("orientationchange", soon);
    return () => {
      ro.disconnect();
      removeEventListener("resize", soon);
      removeEventListener("orientationchange", soon);
    };
  }, [stage]);

  // 转成竖屏（缩略图栏要浮在卷面上）时先收起它，免得盖住卷面左边；转回来再按原样打开
  const railBefore = useRef(false);
  useLayoutEffect(() => {
    if (floating) {
      railBefore.current = rail;
      if (rail) setRail(false);
    } else if (railBefore.current) {
      railBefore.current = false;
      setRail(true);
    }
    // 只在浮不浮切换时处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating]);

  const ct = colorTool(tool);
  const { add, remove, update, replace } = history;
  const ink = useMemo<InkState>(
    () => ({ paperId: paper.id, tool, color: ct ? colors[ct] : "", penSize, history: { add, remove, update, replace }, openNote, onOpenNote: setOpenNote, flash, wordFlash, lookupAt }),
    [paper.id, tool, ct, colors, penSize, add, remove, update, replace, openNote, flash, wordFlash, lookupAt],
  );

  const onSegmentChange = useCallback((seg: string | null, on: boolean) => setPlaying({ seg, on }), []);
  const onPlaySeg = useCallback((id: string) => {
    setListenOpen(true);
    bar.current?.toggleSegment(id);
  }, []);
  /** 打开停靠区的一个标签（不是临时的查词、解析） */
  const openTab = useCallback((tab: DockTab) => {
    setPanel(tab);
    setTempOn(false);
  }, []);
  const onWrite = useCallback(
    (q: Question) => {
      setWriteSeen(true);
      openTab("write");
      setFocusWrite({ id: q.id, n: Date.now() });
    },
    [openTab],
  );
  /** 交卷：先把秒表和各部分用时记下，再交；交完出交卷单 */
  const submit = async () => {
    timeCommit();
    flushSections();
    const retired = (await onSubmit()) ?? [];
    setJustSubmitted(true);
    // 宽屏（侧栏不挤卷面多少）打开答题卡，分数盖下去
    if (sideDock && !compact && winWidth >= 1100) openTab("sheet");
    setReport({ open: true, retired });
  };
  const closeBar = useCallback(() => {
    setHit(null);
    setSent(null);
    setOpenQ(null);
  }, []);
  // 答题条同一时间只放一样：点题号换掉查词、译句，点词换掉题目
  const openQuestion = useCallback((id: string | null) => {
    if (id) {
      setHit(null);
      setSent(null);
    }
    setOpenQ(id);
  }, []);
  // 查词是词旁边的小卡片，不占底部条：卷面上点的词照旧收起选项条和译句；
  // 解析、听力原文里点的词只弹卡片，解析、原文都留着
  const showWord = useCallback((h: WordClick | null) => {
    if (!h || h.page != null) {
      setOpenQ(null);
      setSent(null);
    }
    setHit(h);
  }, []);
  const closeWord = useCallback(() => setHit(null), []);
  // 查词卡片里"译整句"开着：卷面上这句淡黄底
  const [cardTrans, setCardTrans] = useState(false);
  // 卡片跟着词走：卷面上的词按坐标现量（卷面滚动、缩放都会变），正文里的词量元素
  // 认短语用：这句的词序列、点的是第几个；卷面上的词还记着每个词在这一页的序号（标短语用）
  const wordCtx = useMemo(() => {
    if (!hit) return null;
    if (hit.page != null && hit.index != null && pages) {
      const data = pages[hit.page - 1];
      const sid = data.w[hit.index]?.[5];
      const ids: number[] = [];
      data.w.forEach((w, k) => w[5] === sid && ids.push(k));
      return { tokens: ids.map((k) => data.w[k][0]), at: ids.indexOf(hit.index), ids };
    }
    const tokens = hit.sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
    const at = tokens.findIndex((t) => t.toLowerCase() === hit.word.toLowerCase());
    return { tokens, at: Math.max(0, at), ids: null };
  }, [hit, pages]);
  // 卡片认出的短语：卷面上的词序号（整个短语标出来，卡片也让开它）
  const [phraseWords, setPhraseWords] = useState<number[] | null>(null);
  const onCardPhrase = useCallback(
    (pos: number[] | null) => setPhraseWords(pos && wordCtx?.ids ? pos.map((i) => wordCtx.ids![i]).filter((k) => k != null) : null),
    [wordCtx],
  );
  // 卡片跟着词走、并且不盖住原文：卷面上的词按坐标现量（卷面滚动、缩放都会变）；
  // 要让开的是这个词，认出短语时是整个短语，开着整句译文时是整句。正文（听力原文、解析）里的词量元素，译整句时让开这一行
  const wordAnchor = useCallback(() => {
    if (!hit) return null;
    const union = (a: DOMRect, b: DOMRect) => {
      const l = Math.min(a.left, b.left), t = Math.min(a.top, b.top);
      return new DOMRect(l, t, Math.max(a.right, b.right) - l, Math.max(a.bottom, b.bottom) - t);
    };
    if (hit.page != null && hit.index != null && pages) {
      const data = pages[hit.page - 1];
      const word = wordRect(hit.page, data, hit.index, scale);
      const ks = cardTrans && wordCtx?.ids ? wordCtx.ids : (phraseWords ?? []);
      return { word, avoid: ks.reduce((r, k) => union(r, wordRect(hit.page!, data, k, scale)), word) };
    }
    const word = hit.el?.isConnected ? hit.el.getBoundingClientRect() : hit.rect;
    const row = cardTrans ? hit.el?.closest("p, li")?.getBoundingClientRect() : undefined;
    return { word, avoid: row ? union(word, row) : word };
  }, [hit, pages, scale, cardTrans, phraseWords, wordCtx]);
  // 卷面上的词：卡片待在卷面的可见区域里（顶上浮着的工具条让开）；正文里的词：整个窗口
  const wordBounds = useCallback(() => {
    if (hit?.page != null && stage) {
      const r = stage.getBoundingClientRect();
      const inset = compact && !barHidden ? 56 : 0;
      return new DOMRect(r.left, r.top + inset, r.width, r.height - inset);
    }
    return new DOMRect(0, 0, innerWidth, innerHeight);
  }, [hit, stage, compact, barHidden]);
  // 竖屏底部抽屉开得很高时，从面板跳到卷面先把抽屉降到最低一档，卷面露出来
  const lowerDrawer = useCallback(() => {
    if (!sideDock) setSnap((s) => Math.min(s, DRAWER_SNAPS[0]));
  }, [sideDock]);
  // 长难句在卷面上的位置：句子键 → 第几页、第几句、句首的 y；每页有哪几句。
  // 只认卷面上显示的页；专项练习不是仔细阅读时一句都没有（停靠区也不出"长难句"标签）
  const syntaxAt = useMemo(() => {
    const at = new Map<string, { page: number; sid: number; y: number }>();
    const byPage = new Map<number, Set<number>>();
    if (!syntaxFile || !pages || (scope && scope.section.kind !== "reading")) return { at, byPage };
    pages.forEach((data, i) => {
      if (i + 1 < firstPage || i + 1 > lastPage) return;
      data.s.forEach((s, sid) => {
        const k = sentenceKey(s);
        if (!syntaxFile.sentences[k] || at.has(k)) return;
        const w = data.w.find((x) => x[5] === sid);
        if (!w) return;
        at.set(k, { page: i + 1, sid, y: w[2] });
        byPage.set(i + 1, (byPage.get(i + 1) ?? new Set()).add(sid));
      });
    });
    return { at, byPage };
  }, [syntaxFile, pages, scope, firstPage, lastPage]);
  const synOf = useCallback((sentence: string) => (sentence && syntaxFile?.sentences[sentenceKey(sentence)]) || null, [syntaxFile]);
  /** 打开一句长难句的解析：收起查词、选项条，卷面上这句淡黄底，底部条放解析；scroll 时把这句滚到卷面上三分之一处 */
  const openSyntax = useCallback(
    (key: string, scroll: boolean) => {
      const at = syntaxAt.at.get(key);
      const sentence = at && pages?.[at.page - 1]?.s[at.sid];
      if (!at || !sentence) return;
      setHit(null);
      setOpenQ(null);
      setSent({ page: at.page, sid: at.sid, sentence, n: Date.now() });
      if (scroll) {
        lowerDrawer();
        setTool("select");
        scrollToY(topOf(at.page, at.y) - (stage?.clientHeight ?? 600) / 3);
      }
    },
    [syntaxAt, pages, lowerDrawer, scrollToY, topOf, stage],
  );
  /** 原文里点了答案句的题号标签：卷面上打开这道题（选项条 + 解析） */
  const openAnswer = useCallback(
    (qid: string) => {
      const q = qById.get(qid);
      if (!q?.page || !q.box) return;
      setTool("select");
      setHit(null);
      setSent(null);
      lowerDrawer();
      scrollToY(topOf(q.page, q.box[1]) - 160);
      setTimeout(() => {
        setOpenQ(q.id);
        setExplainOpen(true);
      }, 450);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qById, lowerDrawer, scrollToY, topOf],
  );
  // 判过的题（交卷后、练习模式答过的、从错题本点"卷面"过来的那道）：听力原文的问题卡片里显示正确答案和你选的；
  // 答案句只认解析层的 locate.line
  const { answerLines, judgedQs } = useMemo(() => {
    const audio = paper.audio;
    const out: AnswerLine[] = [];
    const judged: JudgedQs = {};
    if (!audio) return { answerLines: out, judgedQs: judged };
    const segs = new Map(audio.segments.map((s) => [s.id, s]));
    for (const s of paper.sections)
      for (const g of s.groups) {
        if (!g.audioSegment) continue;
        for (const q of g.questions) {
          if (!q.options?.length) continue;
          const isJudged = submitted || (practice && !!answers[q.id]) || q.id === focus;
          if (isJudged) judged[q.number] = { qid: q.id, answer: q.answer, mine: answers[q.id] };
          const line = q.explain?.locate?.line;
          if (!line || !segs.get(line.segment)?.lines[line.index]) continue;
          out.push({ seg: line.segment, i: line.index, qid: q.id, n: q.number, judged: isJudged });
        }
      }
    return { answerLines: out, judgedQs: judged };
  }, [paper, submitted, practice, answers, focus]);
  // 一句的译文：卷面句子、听力原文句子用同一个键；从原文里查词带出来的半句，找它所在的那一行
  const trans = useCallback<TransLookup>(
    (sentence) => {
      if (transFile === undefined) return { text: null, ready: false };
      let text = findTrans(transFile, sentence);
      if (!text && transFile && paper.audio && sentence.length > 12) {
        const key = sentenceKey(sentence);
        for (const s of paper.audio.segments) {
          const l = s.lines.find((x) => x.text.includes(sentence) || sentenceKey(x.text) === key);
          if (l) {
            text = findTrans(transFile, l.text);
            break;
          }
        }
      }
      return { text, ready: true };
    },
    [transFile, paper.audio],
  );
  const transState = transFile === undefined ? "loading" : transFile ? "ready" : "none";
  // 卷面上点了词（点在空白处是 null：收起）
  const onPaperWord = showWord;
  const cover = `/papers/pdf/${encodeURIComponent(paper.id)}.thumb.jpg`;
  // 问 AI：卷面上的一句（可带点的词），右侧"问 AI"标签里接着聊
  const aiOn = useAgentEnabled();
  const [agentThread, setAgentThread] = useState<AgentThread | null>(null);
  const askAI = useCallback(
    (sentence: string, word?: string) => {
      setAgentThread({ id: `${sentenceKey(sentence)}:${word ?? ""}`, ctx: { paper: paper.title, sentence, word, syntax: synOf(sentence) ?? undefined } });
      setPanel(null);
      setAgentOpen(true);
    },
    [paper.title, synOf],
  );
  // 右下角 Agent 默认聊整套卷：交卷后（练习模式选完就判）给它每题作答、对错和用时，交卷前只给进度
  const reviewReady = submitted || practice;
  const paperThread = useMemo<AgentThread>(
    () => ({
      id: `paper:${attemptKey}:${attempt?.submittedAt ?? 0}`,
      ctx: {
        paper: paper.title,
        sentence: "",
        reviewReady,
        review: reviewReady ? reviewSummary(paper, answers, questionSec, limits, attempt?.sectionSec) : progressSummary(paper, answers),
        paperText: paperText(pages),
        marks: marksSummary(marksRaw),
      },
    }),
    [paper, attemptKey, attempt?.submittedAt, attempt?.sectionSec, reviewReady, answers, questionSec, limits, pages, marksRaw],
  );
  // 长难句按卷面顺序：解析条上"上一句 / 下一句"和"第一篇 3/5"
  const synOrder = useMemo(() => [...syntaxAt.at.keys()], [syntaxAt]); // Map 按卷面顺序插入；Object.keys 会把纯数字键提前
  const synNav = (key: string) => {
    const i = synOrder.indexOf(key);
    if (i < 0 || !syntaxFile) return undefined;
    const group = syntaxFile.sentences[key].group;
    const groups = [...new Set(synOrder.map((k) => syntaxFile.sentences[k].group))];
    const same = synOrder.filter((k) => syntaxFile.sentences[k].group === group);
    return {
      pos: `${["第一篇", "第二篇", "第三篇"][groups.indexOf(group)] ?? group} ${same.indexOf(key) + 1}/${same.length}`,
      prev: i > 0 ? () => openSyntax(synOrder[i - 1], true) : undefined,
      next: i < synOrder.length - 1 ? () => openSyntax(synOrder[i + 1], true) : undefined,
    };
  };

  // 打开的那道题：选项条贴在卷面上题号下面（ExamPage 画）；点了条上的"解析"，底部的条放这道题的解析；点了词，底部的条是查词。
  // 条、解析、卷面上描蓝的题号都只认 openQ 这一个状态：翻题时解析开着就跟着换，收起选项条才收起解析
  const curQ = openQ ? qById.get(openQ.replace(/@blank$/, "")) : undefined;
  const [explainOpen, setExplainOpen] = useState(false);
  useEffect(() => {
    if (!openQ) setExplainOpen(false);
  }, [openQ]);
  const explainable = !(countdown && !submitted); // 全真模拟交卷前不能看解析
  const cue = useMemo(() => (curQ ? questionCue(curQ, pages) : ""), [curQ, pages]);
  const barContent: BarContent | null =
    curQ && openQ && explainOpen && explainable
      ? // 练习模式还没作答的题：先不放解析
        { kind: "explain", q: curQ, id: openQ, cue, locked: practice && !submitted && !answers[curQ.id] }
      : sent
        ? { kind: "sentence", id: `${sent.page}:${sent.sid}:${sent.n}`, sentence: sent.sentence, syn: synOf(sent.sentence), nav: synNav(sentenceKey(sent.sentence)) }
        : null;
  // 竖屏底部抽屉开着时只有这一块底部区域：底部条的内容放进抽屉，当一个临时标签（新内容出来时切过去，收起时回到原来的标签）
  const barInDock = !!panel && !sideDock;
  const hasBar = !!barContent;
  useEffect(() => {
    if (!hasBar) setTempOn(false);
    else if (barInDock) setTempOn(true);
    // 只在内容换了时切过去；用户自己点回别的标签就留在那儿（查词是词旁边的卡片，不算）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBar, sent, explainOpen, curQ?.id]);
  layers.current = { bar: hasBar, tool, dock: !!panel };
  const [barH, setBarH] = useState(0);
  // 打开的那道题（题号和贴着它的选项条）要露在可见区域里：本来就看得见就不动，看不见只滚到刚好露出来。
  // 正在查的那个词：整个不在视野里就放到可见区域上部三分之一处，只差一点就挪一点。
  // 底部条、停靠区都排在卷面旁边（卷面那一栏跟着变窄变矮），画布的框就是可见区域；它们开关、换高度时再看一次
  useEffect(() => {
    if (!stage || (!openQ && !hit)) return;
    const s = stage.getBoundingClientRect();
    const top = s.top + (compact && !barHidden ? 56 : 0) + 8;
    const bottom = s.bottom - 12;
    if (openQ) {
      const a = stage.querySelector(`[data-qid="${openQ}"]`)?.getBoundingClientRect();
      const b = stage.querySelector("[data-choice-strip]")?.getBoundingClientRect();
      if (!a) return;
      const r = b ? { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) } : a;
      if (r.top < top) stage.scrollBy({ top: r.top - top, behavior: "smooth" });
      else if (r.bottom > bottom) stage.scrollBy({ top: Math.min(r.bottom - bottom, r.top - top), behavior: "smooth" });
      return;
    }
    const r = hit?.page && hit.index != null && pages ? wordRect(hit.page, pages[hit.page - 1], hit.index, scale) : undefined;
    if (!r) return;
    if (r.bottom < top || r.top > bottom) stage.scrollBy({ top: r.top - (top + (bottom - top) * 0.3), behavior: "smooth" });
    else if (r.bottom > bottom) stage.scrollBy({ top: Math.min(r.bottom - bottom, r.top - top), behavior: "smooth" });
    else if (r.top < top) stage.scrollBy({ top: r.top - top - 24, behavior: "smooth" });
    // 只在打开的题、查的词、底部条的高度、停靠区换了时看
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barH, openQ, hit, stage, panel, snap, sideDock]);

  // 上一题、下一题（条上的 ‹ ›、解析头上的按钮、← →）：卷面上能点的选择题按题号排（完形用文章里的空位）。选完不自动跳题
  const order = useMemo(() => allQuestions(paper).filter((q) => q.options?.length && (q.blank || (q.page && q.box))), [paper]);
  const curAt = curQ ? order.findIndex((q) => q.id === curQ.id) : -1;
  const idAt = (i: number) => {
    const q = order[i];
    return q ? (q.blank ? `${q.id}@blank` : q.id) : null;
  };
  const canPrev = curAt > 0;
  const canNext = curAt >= 0 && curAt < order.length - 1;
  // 给每一页的回调要一直是同一个函数（不然每一页都跟着重画），里面读最新的状态
  const live = useRef({ step: (_: 1 | -1) => {}, choose: (_q: Question, _k: string) => {} });
  live.current.step = (dir) => {
    const id = curAt >= 0 ? idAt(curAt + dir) : null;
    if (id) setOpenQ(id);
  };
  live.current.choose = choose;
  const onStep = useCallback((dir: 1 | -1) => live.current.step(dir), []);
  /** 交卷单里点了某道错题：收起交卷单，卷面上打开这道题和它的解析（和点题号、点"解析"同一条路） */
  const explainQ = useCallback(
    (q: Question) => {
      setReport((r) => ({ ...r, open: false }));
      lowerDrawer();
      setTool("select");
      setHit(null);
      setSent(null);
      setOpenQ(q.blank ? `${q.id}@blank` : q.id);
      setExplainOpen(true);
    },
    [lowerDrawer],
  );
  // 新手：一道都没答、也没交卷时，第一题的空圈闪几下，状态栏写一句点哪儿
  const fresh = !submitted && !Object.keys(answers).length && order.length > 0;
  const firstHint = fresh ? idAt(0) : null;
  const onStripChoose = useCallback((q: Question, key: string) => live.current.choose(q, key), []);
  const onExplain = useCallback(() => setExplainOpen((o) => !o), []);
  // 停靠区现在看着的：竖屏抽屉里的临时标签，或者一个面板
  const dockView: DockView | null = panel && (barInDock && tempOn && barContent ? "temp" : panel);
  const togglePanel = (tab: DockTab) => (dockView === tab ? setPanel(null) : openTab(tab));
  // 在原文里点了一句开始播：听力条露出来
  const onListenActivate = useCallback(() => setListenOpen(true), []);
  // 听力条上的"原文"：打开停靠区的原文标签，再点收起
  const onTranscript = () => {
    if (dockView === "listen") setPanel(null);
    else {
      openTab("listen");
      setListenOpen(true);
    }
  };

  const questions = allQuestions(paper);
  const choice = questions.filter((q) => q.options?.length);
  const answered = choice.filter((q) => answers[q.id]).length;
  const unanswered = choice.length - answered;
  const writesLeft = questions.filter((q) => !q.options?.length && !texts[q.id]?.trim()).length;
  // 进度：有选择题算选择题；只有写作翻译的卷算写了几篇
  const writes = questions.length - choice.length;
  const rightCount = choice.filter((q) => answers[q.id] === q.answer).length;
  const progress = choice.length
    ? submitted
      ? `得分 ${attempt?.score ?? 0}/${attempt?.total ?? choice.length}`
      : practice
        ? `答对 ${rightCount} / 已答 ${answered}`
        : `已答 ${answered}/${choice.length}`
    : `已写 ${writes - writesLeft}/${writes}`;
  // 卷面和答题卡上的用时小字：全真模拟交卷前不显示
  const times = countdown && !submitted ? null : questionSec;
  const timingQ = timer.qid ? qById.get(timer.qid) : undefined;
  const back = retry
    ? { to: "/mistakes", label: "返回错题本" }
    : scope
      ? { to: `/practice?exam=${paper.exam}&kind=${scope.section.kind}`, label: "返回专项训练" }
      : { to: `/papers?exam=${paper.exam}`, label: "返回真题训练" };

  /** 工具栏上的一个按钮：Phosphor 双色图标；当前项品牌蓝底白图标 */
  const tool$ = (label: string, icon: ReactNode, onClick: () => void, opts: { active?: boolean; soft?: boolean; disabled?: boolean; kbd?: string; text?: string } = {}): G.ToolItem => ({
    icon: "pencil",
    label,
    render: (
      <Tip label={label} kbd={opts.kbd}>
        <button type="button" className={cn("gr-tool", opts.active && (opts.soft ? "gr-tool-soft" : "gr-tool-on"))} onClick={onClick} disabled={opts.disabled} aria-label={label} aria-pressed={opts.active}>
          {icon}
          {opts.text && !narrow && <span className="gr-tool-text whitespace-nowrap">{opts.text}</span>}
        </button>
      </Tip>
    ),
  });
  const toolGroup = (g: 0 | 1 | 2) =>
    TOOLS.filter((t) => t.group === g).map((t) => tool$(t.label, <t.Icon className="size-[19px]" weight={tool === t.id ? "fill" : "duotone"} />, () => setTool(t.id), { active: tool === t.id, kbd: t.key, text: t.short }));
  const presets = settings.penPresets;
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(1)));
  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(1)));
  // 交卷后可以在导出的 PDF 末尾附一页答题情况
  const answerSheet: AnswerSheet | null = submitted && choice.length ? { rows: choice.map((q) => ({ number: q.number, mine: answers[q.id], answer: q.answer })), score: rightCount, total: choice.length } : null;
  /** "更多"里的一行：文字在左，快捷键或勾在右 */
  const moreItem = (label: string, onClick: () => void, right?: ReactNode) => (
    <button type="button" onClick={onClick} className="flex h-10 w-full items-center justify-between gap-6 rounded-[8px] px-3 text-left text-[14px] text-[var(--ink)] hover:bg-[var(--fill-quiet)]">
      {label}
      <span className="flex items-center text-[var(--ink-500)]">{right}</span>
    </button>
  );
  const undoRedo: G.ToolItem[] = [
    tool$("撤销", <ArrowUUpLeft className="size-[19px]" />, () => void history.undo(), { disabled: !history.canUndo, kbd: "Ctrl Z" }),
    tool$("重做", <ArrowUUpRight className="size-[19px]" />, () => void history.redo(), { disabled: !history.canRedo, kbd: "Ctrl Shift Z" }),
  ];

  const panelButton = (tab: DockTab, label: string, icon: ReactNode, text?: ReactNode) => (
    <Tip label={label}>
      <button type="button" className={dockView === tab ? "gr-tool gr-tool-soft" : "gr-tool"} onClick={() => togglePanel(tab)} aria-label={label} aria-pressed={dockView === tab}>
        {icon}
        {text !== undefined && !narrow && <span className="gr-tool-text num whitespace-nowrap">{text}</span>}
      </button>
    </Tip>
  );

  const backLink = (
    <Tip label={back.label}>
      <Link to={back.to} aria-label={back.label} className="gr-iconbtn">
        <ArrowLeft className="size-[18px]" />
      </Link>
    </Tip>
  );
  const headActions = (
    <>
      {/* 总倒计时只在全真模拟时有 */}
      {countdown && <ExamTimer elapsed={elapsed} running={!submitted} limit={paper.durationMinutes ? paper.durationMinutes * 60 : null} />}
      {onMock && !submitted && (
        <Tip label={paper.durationMinutes ? `从现在起按 ${paper.durationMinutes} 分钟倒计时，交卷前不看解析` : "按考试时长倒计时，交卷前不看解析"}>
          <Button size="sm" onClick={onMock}>
            <Timer className="size-4" /> 全真模拟
          </Button>
        </Tip>
      )}
      {submitted ? (
        <Button size="sm" onClick={() => setConfirm("redo")}>
          <ArrowCounterClockwise className="size-4" /> 重做
        </Button>
      ) : null /* 交卷在答题卡里 */}
    </>
  );
  // 并成一行时卷名只留一行小字
  const shortName = retry ? `重做错题 · 第 ${retryRound ?? 1} 次` : scope ? `${practice ? "练习" : "专项"} · ${KIND_NAMES[scope.section.kind]}` : shortTitle(paper);

  // 底部条：卷面那一栏下面一条；竖屏底部抽屉开着时放进抽屉，当一个临时标签
  const sentKey = sent ? sentenceKey(sent.sentence) : null;
  const dockSyntax = useMemo<DockSyntax | null>(() => {
    if (!syntaxFile || !syntaxAt.at.size) return null;
    const titles: Record<string, string> = {};
    for (const s of paper.sections) for (const g of s.groups) titles[g.id] = (g.title ?? g.id).replace(/^Section C · /, "");
    const sentences = Object.fromEntries(Object.entries(syntaxFile.sentences).filter(([k]) => syntaxAt.at.has(k)));
    return { file: { ...syntaxFile, sentences }, titles, current: sentKey, onOpen: (k) => openSyntax(k, true) };
  }, [syntaxFile, syntaxAt, paper.sections, sentKey, openSyntax]);
  const barEl = (embedded: boolean) =>
    barContent && (
      <AnswerBar
        content={barContent}
        embedded={embedded}
        mine={curQ && (submitted || (practice && !!answers[curQ.id])) ? (answers[curQ.id] ?? null) : undefined}
        trans={trans}
        onClose={barContent.kind === "explain" ? () => setExplainOpen(false) : closeBar}
        step={{ prev: canPrev, next: canNext, go: onStep }}
        onAsk={aiOn && barContent.kind === "sentence" ? () => askAI(barContent.sentence) : undefined}
        onHeight={embedded ? undefined : setBarH}
      />
    );
  const paperLink: PaperLink = {
    locate: (text) => {
      const h = pages ? findText(pages, text) : null;
      if (!h || !pages) return false;
      scrollToY(topOf(h.page, pages[h.page - 1].w[h.a][2]) - 160);
      setAgentFlash({ page: h.page, range: [h.a, h.b] });
      clearTimeout(agentFlashT.current);
      agentFlashT.current = window.setTimeout(() => setAgentFlash(null), 2600);
      return true;
    },
    question: (n) => {
      const q = allQuestions(paper).find((x) => x.number === n);
      if (!q) return false;
      lowerDrawer();
      onJump(q);
      return true;
    },
  };
  // 学习者此刻在卷面上看哪，每次提问时交给 Agent
  const where = () => {
    const s = scrollStore.get();
    const qs = allQuestions(paper).filter((q) => (q.page ?? q.blank?.page) === s.page);
    const sec = paper.sections.find((x) => x.id === s.part);
    const open = openQ ? allQuestions(paper).find((q) => q.id === openQ.split("@")[0]) : null;
    return (
      `第 ${s.page} 页` +
      (sec ? `（${kindName(sec.kind, paper.exam)}）` : "") +
      (qs.length ? `，这一页是第 ${qs[0].number}–${qs[qs.length - 1].number} 题` : "") +
      (open ? `；刚点开第 ${open.number} 题` : "") +
      "。学习者说“这题”“这篇”“这段”时先按这个理解。"
    );
  };
  const agentEl = agentOpen && (
    <PaperLinkCtx.Provider value={paperLink}>
    <AgentSplit
      side={sideDock}
      width={agentWidth}
      inset={compact && !barHidden ? toolH + 8 : 0}
      onWidth={(w) => {
        setAgentW(w);
        localStorage.setItem("yz-agent-w", String(w));
      }}
      enabled={!!aiOn}
      paperThread={paperThread}
      sentence={agentThread}
      onClearSentence={() => setAgentThread(null)}
      onClose={() => setAgentOpen(false)}
      env={{ paper, answers, ink: (signal) => inkNotes(marksRaw ?? [], pages, signal), pages, where }}
    />
    </PaperLinkCtx.Provider>
  );
  const dockEl = panel && dockView && (
    <Dock
      layout={sideDock ? "side" : "drawer"}
      view={dockView}
      onView={(v) => (v === "temp" ? setTempOn(true) : openTab(v))}
      onClose={() => setPanel(null)}
      temp={barInDock && barContent ? { label: barLabel(barContent), body: barEl(true) } : null}
      showWrite={writeSeen}
      listenSlot={setListenSlot}
      snap={snap}
      onSnap={(f) => (f === null ? setPanel(null) : setSnap(f))}
      inset={compact && !barHidden ? toolH + 8 : 0}
      paper={paper}
      mode={mode}
      attemptKey={attemptKey}
      attemptInit={{ mode }}
      times={times}
      limits={limits}
      onReport={() => setReport((r) => ({ ...r, open: true }))}
      onWriteFocus={(q) => timeStart(q.id)}
      attempt={attempt}
      answers={answers}
      texts={texts}
      submitted={submitted}
      elapsed={elapsed}
      flags={flags}
      vocabCount={vocabCount}
      justSubmitted={justSubmitted}
      marks={marks}
      history={history}
      focusWrite={focusWrite}
      onJump={(q) => {
        lowerDrawer();
        onJump(q);
      }}
      onJumpMark={(m) => {
        lowerDrawer();
        onJumpMark(m);
      }}
      syntax={dockSyntax}
      onClearMarks={() => setConfirm("clear")}
      onSubmit={() => setConfirm("submit")}
      onRedo={() => setConfirm("redo")}
    />
  );

  // 工具栏这一行。矮屏横屏时浮在卷面和侧栏上面（横跨整个宽度：开着侧栏卷面那一栏太窄，放不下一整行工具），往下滚时收起
  const toolbarRow = (
      <div
        ref={setToolRow}
        className={cn(
          "no-print px-1.5 py-1.5",
          // 矮屏：这一行浮在卷面和侧栏上面（高 48），往下滚时整行收上去
          compact && "absolute inset-x-0 top-0 z-40 rounded-[var(--radius-md)] bg-white py-0 shadow-[var(--elev-1)] transition-transform duration-200 ease-out",
          compact && barHidden && "-translate-y-[calc(100%+8px)]",
        )}
      >
        <G.Toolbar
          label="卷面工具"
          groups={[
            ...(compact
              ? [
                  [
                    {
                      icon: "pencil" as const,
                      label: back.label,
                      render: (
                        <div className="flex min-w-0 items-center gap-1 pr-1">
                          {backLink}
                          <span className="max-w-[150px] truncate text-[13px] font-semibold" title={paper.title}>
                            {shortName}
                          </span>
                        </div>
                      ),
                    },
                  ],
                ]
              : []),
            [tool$(rail ? "收起缩略图" : "页面缩略图", <SidebarSimple className="size-[19px]" weight={rail ? "fill" : "duotone"} />, () => setRail(!rail), { active: rail, soft: true, kbd: "T" })],
            toolGroup(0),
            toolGroup(1),
            toolGroup(2),
            ...(ct
              ? [
                  [
                    ...(tool === "pen"
                      ? [
                          // 手写笔：3 个预设槽，颜色和粗细收在旁边的小弹框里
                          ...presets.map((p, i) => ({
                            icon: "circle" as const,
                            label: `笔 ${i + 1}`,
                            render: (
                              <PresetSlot
                                i={i}
                                preset={p}
                                active={p.color === colors.pen && p.size === penSize}
                                onUse={() => {
                                  setColors({ ...colors, pen: p.color });
                                  setPenSize(p.size);
                                }}
                                onSave={() => void setSetting("penPresets", presets.map((x, k) => (k === i ? { color: colors.pen, size: penSize } : x)))}
                              />
                            ),
                          })),
                          {
                            icon: "palette" as const,
                            label: "颜色和粗细",
                            render: (
                              <G.Popover
                                label="颜色和粗细"
                                width={196}
                                trigger={
                                  <button type="button" className="gr-tool w-8" aria-label="颜色和粗细" title="颜色和粗细">
                                    <span className="size-[18px] rounded-full shadow-[0_0_0_2px_#fff,0_0_0_3px_var(--line-control)]" style={{ background: colorValue(colors.pen) }} />
                                  </button>
                                }
                              >
                                <div className="space-y-3 p-1">
                                  <div className="flex items-center gap-2.5" role="radiogroup" aria-label="颜色">
                                    {COLORS.pen.map((c) => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={colors.pen === c.id}
                                        aria-label={c.label}
                                        onClick={() => setColors({ ...colors, pen: c.id })}
                                        className={cn("size-7 rounded-full transition", colors.pen === c.id ? "ring-2 ring-[var(--blue)] ring-offset-2" : "hover:scale-110")}
                                        style={{ background: c.value }}
                                      />
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-1" role="radiogroup" aria-label="粗细">
                                    {PEN_SIZES.map((s) => (
                                      <button
                                        key={s.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={penSize === s.id}
                                        aria-label={`${s.label}笔`}
                                        onClick={() => setPenSize(s.id)}
                                        className={cn("gr-tool h-9 w-12", penSize === s.id && "gr-tool-on")}
                                      >
                                        <span className="rounded-full bg-current" style={{ width: s.id * 2.6 + 2, height: s.id * 2.6 + 2 }} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </G.Popover>
                            ),
                          },
                        ]
                      : [
                          {
                            icon: "palette" as const,
                            label: "颜色",
                            render: (
                              <div className="flex items-center gap-1.5 px-1.5" role="radiogroup" aria-label="颜色">
                                {COLORS[ct].map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={colors[ct] === c.id}
                                    aria-label={c.label}
                                    title={c.label}
                                    onClick={() => setColors({ ...colors, [ct]: c.id })}
                                    className={cn(
                                      "size-[18px] rounded-full shadow-[inset_0_0_0_1px_rgba(15,39,67,0.12)] transition",
                                      colors[ct] === c.id ? "ring-2 ring-[var(--blue)] ring-offset-2 ring-offset-white" : "hover:scale-110",
                                    )}
                                    style={{ background: c.value }}
                                  />
                                ))}
                              </div>
                            ),
                          },
                        ]),
                  ],
                ]
              : []),
            undoRedo,
            // 窄屏时缩放收进"更多"，工具栏放得下笔的预设
            ...(slim
              ? []
              : [
                  [
                    tool$("缩小", <MagnifyingGlassMinus className="size-[19px]" />, zoomOut, { disabled: zoom <= MIN_ZOOM }),
                    {
                      icon: "zoom-in" as const,
                      label: "恢复 100%",
                      render: (
                        <button type="button" className="gr-tool w-12" onClick={() => setZoom(1)} title="恢复 100%">
                          <span className="gr-tool-text num">{Math.round(zoom * 100)}%</span>
                        </button>
                      ),
                    },
                    tool$("放大", <MagnifyingGlassPlus className="size-[19px]" />, zoomIn, { disabled: zoom >= MAX_ZOOM }),
                  ],
                ]),
          ]}
        >
          {!countdown && !submitted && (
            <Stopwatch
              timer={timer}
              label={timingQ && !slim ? (timingQ.label ?? `第 ${timingQ.number} 题`) : undefined}
              limit={timer.qid ? limits[timer.qid] : undefined}
              onJump={() => timingQ && (timingQ.options?.length ? onJump(timingQ) : onWrite(timingQ))}
            />
          )}
          {paper.audio && (
            <Tip label={listenOpen ? "收起听力" : "打开听力"}>
              <button type="button" className={listenOpen ? "gr-tool gr-tool-soft" : "gr-tool"} onClick={() => setListenOpen(!listenOpen)} aria-label="听力" aria-pressed={listenOpen}>
                <Headphones className="size-[19px]" weight={listenOpen ? "fill" : "duotone"} />
                {!narrow && <span className="gr-tool-text whitespace-nowrap">听力</span>}
              </button>
            </Tip>
          )}
          {/* 本卷笔记、生词在"更多"里和停靠区的标签里 */}
          {panelButton("sheet", "答题卡", <Exam className="size-[19px]" />, `答题卡 ${practice && !submitted ? `${rightCount}/${answered}` : progress.replace(/^\D+/, "")}`)}
          <Tip label="Agent：分屏和 AI 对话，它看得到你的作答">
            <button
              type="button"
              className={agentOpen ? "gr-tool gr-tool-soft" : "gr-tool"}
              onClick={() => {
                if (!agentOpen) setPanel(null);
                setAgentOpen(!agentOpen);
              }}
              aria-label="Agent"
              aria-pressed={agentOpen}
            >
              <Sparkle className="size-[19px]" />
              {!narrow && <span className="gr-tool-text whitespace-nowrap">Agent</span>}
            </button>
          </Tip>
          {/* 更多：查找、双页、生词标记、导出（不常用的都收在这里，工具栏不加常驻按钮） */}
          <G.Popover
            label="更多"
            align="end"
            width={248}
            trigger={
              <button type="button" className="gr-tool" aria-label="更多">
                <DotsThreeVertical className="size-[19px]" weight="bold" />
              </button>
            }
          >
            {(close: () => void) => (
              <div className="py-0.5">
                {moreItem("本卷笔记", () => (close(), togglePanel("notes")), marks.length ? <span className="num">{marks.length}</span> : undefined)}
                {moreItem("本卷生词", () => (close(), togglePanel("vocab")), vocabCount ? <span className="num">{vocabCount}</span> : undefined)}
                {moreItem(
                  "在卷面查找",
                  () => {
                    close();
                    openFind();
                  },
                  <G.Kbd>Ctrl F</G.Kbd>,
                )}
                {slim && (
                  <div className="flex h-10 items-center justify-between px-3 text-[14px]">
                    缩放
                    <span className="flex items-center">
                      <button type="button" className="gr-tool" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="缩小">
                        <MagnifyingGlassMinus className="size-[18px]" />
                      </button>
                      <button type="button" className="gr-tool num w-12 text-[13px]" onClick={() => setZoom(1)} title="恢复 100%">
                        {Math.round(zoom * 100)}%
                      </button>
                      <button type="button" className="gr-tool" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="放大">
                        <MagnifyingGlassPlus className="size-[18px]" />
                      </button>
                    </span>
                  </div>
                )}
                {twoUpOk && moreItem("双页视图", () => void setSetting("twoUpPages", !settings.twoUpPages), settings.twoUpPages && <Check className="size-4 text-[var(--blue)]" weight="bold" />)}
                {moreItem("标出生词本里的词", () => void setSetting("showVocabMarks", !settings.showVocabMarks), settings.showVocabMarks && <Check className="size-4 text-[var(--blue)]" weight="bold" />)}
                {moreItem("快捷键", () => {
                  close();
                  setKeysOpen(true);
                })}
                <div className="my-1 h-px bg-[var(--line-soft)]" />
                {moreItem("导出带笔记的 PDF", () => {
                  close();
                  setExportOpen(true);
                })}
              </div>
            )}
          </G.Popover>
          {compact && <div className="ml-1 flex items-center gap-2">{headActions}</div>}
        </G.Toolbar>
      </div>
  );

  return (
    <ExplainContext.Provider value={explainActions}>
    <WordTextProvider onWord={showWord} marks={settings.showVocabMarks}>
      <div className="gr-wb gr-dense h-dvh min-w-[760px]">
        {/* 顶栏（矮屏横屏时并进工具栏那一行） */}
        {!compact && (
        <header className="gr-wb-panel no-print relative h-12 shrink-0 flex-row items-center gap-2 overflow-visible px-2">
          {backLink}
          {retry ? (
            <div className="min-w-0">
              <h1 className="truncate text-[13px] leading-4 font-semibold">重做错题 · 第 {retryRound ?? 1} 次</h1>
              <p className="truncate text-[11px] leading-4 text-subtle">
                {paper.title} · {choice.length} 道
              </p>
            </div>
          ) : scope ? (
            <div className="min-w-0">
              <h1 className="truncate text-[13px] leading-4 font-semibold">
                {practice ? "练习模式" : "专项训练"} · {KIND_NAMES[scope.section.kind]}
              </h1>
              <p className="truncate text-[11px] leading-4 text-subtle">
                {paper.title} · {[scope.section.part, scope.section.subtitle].filter(Boolean).join(" ")}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <h1 className="truncate text-[13px] leading-4 font-semibold">{paper.title}</h1>
              <p className="truncate text-[11px] leading-4 text-subtle">
                {countdown ? "全真模拟" : "普通做题"}
                {paper.label ? ` · ${paper.label}原卷` : " · 原卷"}
              </p>
            </div>
          )}
          <div className={cn("absolute left-1/2 -translate-x-1/2", (scope || retry || winWidth < 1000) && "hidden")}>
            <PartTabs
              store={scrollStore}
              onChange={(id: string) => {
                const a = partAnchors.find((x) => x.id === id);
                if (a) scrollToY(topOf(a.page, a.y) - 120);
              }}
              items={partAnchors.map((a) => ({ value: a.id, label: PART_NAMES[a.kind] ?? a.id }))}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">{headActions}</div>
        </header>
        )}

        {/* 卷面（和横屏的侧栏）+ 竖屏的底部抽屉：抽屉的三档高度按这一块算 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="gr-wb-main relative">
          {compact && toolbarRow}
          {/* 工具栏 + 原卷画布 */}
          <div className={cn("gr-wb-panel gr-wb-canvas", compact && "relative")}>
            {!compact && toolbarRow}
            {compact && barHidden && (
              <button
                type="button"
                onClick={() => setBarHidden(false)}
                aria-label="显示工具栏"
                className="no-print absolute top-1.5 right-3 z-40 flex h-8 w-12 items-center justify-center rounded-full bg-white/95 text-[var(--ink-500)] shadow-[var(--elev-2)]"
              >
                <CaretDown className="size-4" weight="bold" />
              </button>
            )}

            <div className="relative flex min-h-0 flex-1">
            {rail && doc && pages && (
              <LiveRail
                store={scrollStore}
                doc={doc}
                cover={range ? undefined : cover}
                pages={pages.slice(firstPage - 1, lastPage).map((p, k) => ({ n: firstPage + k, width: p.width, height: p.height }))}
                marked={markedPages}
                floating={floating}
                inset={compact ? 56 : 0}
                onJump={jumpPage}
                parts={
                  !scope && !retry && partAnchors.length > 1
                    ? partAnchors.map((a) => {
                        const sec = paper.sections.find((x) => x.id === a.id);
                        return { label: kindName(a.kind, paper.exam) + (sec?.subtitle ? ` · ${sec.subtitle}` : ""), onClick: () => scrollToY(topOf(a.page, a.y) - 120) };
                      })
                    : undefined
                }
              />
            )}
            {/* 卷面那一栏：卷面在上，查词、解析、译句的底部条排在它下面（不盖在卷面上，卷面跟着变矮） */}
            <div className="flex min-w-0 flex-1 flex-col">
            {/* 卷面上不要浏览器自己的捏合放大（整页），双指缩放由上面的手势处理；长按出译文时不要系统的长按菜单 */}
            <div ref={setStage} data-stage className="gr-wb-stage min-w-0 touch-pan-x touch-pan-y overflow-auto [-webkit-touch-callout:none]" onClick={(e) => e.target === e.currentTarget && closeBar()}>
              {error ? (
                <div className="pt-16">
                  <EmptyState title="原卷打不开" desc={error} />
                </div>
              ) : !ready || !doc || !pages ? (
                <div className="flex h-full items-center justify-center gap-3 text-[13px] text-muted">
                  <G.Spinner showLabel label="正在打开原卷" />
                </div>
              ) : (
                <div
                  ref={contentRef}
                  className={cn(twoUp ? "grid grid-cols-[repeat(2,max-content)] justify-center gap-5" : "space-y-5", tightPad ? "px-4 py-5" : "px-12 py-8", compact && "pt-[68px]")}
                  onClick={(e) => e.target === e.currentTarget && closeBar()}
                >
                  {pages.slice(firstPage - 1, lastPage).map((p, k) => (
                    <ExamPage
                      key={firstPage + k}
                      doc={doc}
                      index={firstPage - 1 + k}
                      clip={clips.get(firstPage + k)}
                      scale={scale}
                      data={p}
                      root={stage!}
                      placeholder={firstPage + k === 1 && !range ? cover : undefined}
                      items={items.get(firstPage + k) ?? EMPTY}
                      marks={vocabMarks}
                      notes={marksByPage.get(firstPage + k) ?? NO_MARKS}
                      ink={ink}
                      answers={answers}
                      texts={texts}
                      submitted={submitted}
                      openQ={openQ}
                      practice={practice}
                      times={times}
                      limits={limits}
                      playingSeg={playing.on ? playing.seg : null}
                      hits={hitsByPage.get(firstPage + k)}
                      hitCur={agentFlash?.page === firstPage + k ? agentFlash.range : curHit?.page === firstPage + k ? curHit.range : null}
                      longs={syntaxAt.byPage.get(firstPage + k)}
                      activeWord={hit?.page === firstPage + k ? hit.index : null}
                      activeWords={hit?.page === firstPage + k ? phraseWords : null}
                      sentence={sent?.page === firstPage + k ? sent.sid : cardTrans && hit?.page === firstPage + k && hit.index != null ? (p.w[hit.index]?.[5] ?? null) : null}
                      hintId={firstHint}
                      flags={flags}
                      struck={struck}
                      explainable={explainable}
                      explaining={explainOpen}
                      timeable={!countdown && !submitted}
                      timing={timing}
                      onStartQ={onStartQ}
                      onStartSet={onStartSet}
                      onOpenQ={openQuestion}
                      onChoose={onStripChoose}
                      onStrike={onStrike}
                      onFlag={onFlag}
                      onExplain={onExplain}
                      onStep={onStep}
                      canPrev={canPrev}
                      canNext={canNext}
                      onWord={onPaperWord}
                      onPlaySeg={onPlaySeg}
                      onWrite={onWrite}
                    />
                  ))}
                  <p className={cn("pt-1 text-center text-[11px] text-subtle", twoUp && "col-span-2")}>{paper.note}</p>
                </div>
              )}
            </div>
            {barContent && !barInDock && barEl(false)}
            </div>
            {find.open && (
              <FindBar
                top={compact && !barHidden ? 58 : 8}
                query={find.query}
                count={hits.length}
                index={find.index}
                focusKey={find.focusKey}
                onQuery={(query) => setFind((f) => ({ ...f, query, index: 0 }))}
                onStep={stepFind}
                onClose={closeFind}
              />
            )}
            </div>
          </div>

          {/* 停靠区：横屏在右侧一栏 */}
          {sideDock && (agentOpen ? agentEl : dockEl)}
        </div>
        {/* 停靠区：竖屏是听力条上面的底部抽屉 */}
        {!sideDock && (agentOpen ? agentEl : dockEl)}
        </div>

        {paper.audio && (
          <ListeningBar
            ref={bar}
            audio={paper.audio}
            questionsBySegment={questionsBySegment}
            open={listenOpen}
            submitted={submitted}
            slot={dockView === "listen" ? listenSlot : null}
            onTranscript={onTranscript}
            onActivate={onListenActivate}
            answerLines={answerLines}
            judgedQs={judgedQs}
            onAnswer={openAnswer}
            audioPct={audioPct}
            trans={trans}
            transState={transState}
            onClose={() => setListenOpen(false)}
            onSegmentChange={onSegmentChange}
          />
        )}

        {!(compact && barHidden) && (
        <div className="gr-wb-panel no-print shrink-0">
          <G.StatusBar
            left={[
              // 内存库（本地数据库没响应）时记录不保存，不能说"已自动保存"
              memoryDb ? { label: "这次不保存", dot: true, tone: "warning" } : { label: "已自动保存", dot: true, tone: "success" },
              { label: progress },
              ...(TOOL_HINTS[tool] ? [{ label: `${TOOLS.find((t) => t.id === tool)!.label}：${TOOL_HINTS[tool]} · Esc 退出` }] : fresh && !hintSeen ? [{ label: "点题号旁边的圆圈选答案 · 点单词查词" }] : []),
            ]}
            right={[
              { label: <span className="num">{Math.round(zoom * 100)}%</span> },
              ...(pages ? [{ label: <PageJump store={scrollStore} first={firstPage} last={lastPage} onJump={jumpPage} /> }] : []),
            ]}
          />
        </div>
        )}
      </div>


      <ConfirmDialog
        open={confirm === "submit"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={practice ? "结束练习？" : "交卷？"}
        description={
          practice
            ? "做过的题已经判过了；没做的算未答。结束后出交卷单，错题收进错题本。"
            : unanswered || writesLeft
              ? "还有题没做完。交卷后出交卷单，显示对错和正确答案。"
              : "所有题都答完了。交卷后出交卷单，显示对错和正确答案。"
        }
        confirmText={practice ? "结束练习" : "确认交卷"}
        onConfirm={() => void submit()}
      >
        <dl className="mt-5 grid grid-cols-3 border-y border-dashed border-[var(--line-control)] py-4">
          {(
            [
              choice.length ? ["已答", `${answered}`, `/${choice.length}`] : ["已写", `${writes - writesLeft}`, `/${writes}`],
              choice.length ? ["未答", `${unanswered}`, "题"] : ["没写", `${writesLeft}`, "篇"],
              ["用时", formatDuration(elapsed), ""],
            ] as const
          ).map(([label, value, unit], i) => (
            <div key={label} className={cn(i > 0 && "border-l border-[var(--line)] pl-4")}>
              <dt className="t-label">{label}</dt>
              <dd className={cn("num mt-1 text-[30px] leading-9", label === "未答" && unanswered > 0 && "text-[var(--red)]")}>
                {value}
                <span className="text-[14px] text-[var(--ink-500)]">{unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </ConfirmDialog>
      {attempt && (
        <ReportSheet
          open={report.open && submitted}
          onClose={() => setReport((r) => ({ ...r, open: false }))}
          paper={paper}
          scope={scope?.section}
          mode={mode}
          attempt={attempt}
          retired={report.retired}
          back={back}
          onExplainQ={explainQ}
          onExplain={() => {
            setReport((r) => ({ ...r, open: false }));
            openTab("explain");
          }}
          onRetry={(ids) => navigate(retryPath(paper.id, ids))}
        />
      )}
      <ConfirmDialog
        open={confirm === "redo"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={retry ? "再重做一次？" : "重做这套卷子？"}
        description={retry ? "会清空这次重做的作答。错题本里的记录保留。" : "会清空本卷的作答记录和用时。卷面笔记和生词本都保留。"}
        confirmText="清空并重做"
        danger
        onConfirm={async () => {
          await onRedo();
          stage?.scrollTo({ top: 0 });
        }}
      />
      <PaperDialog open={keysOpen} onClose={() => setKeysOpen(false)} title="快捷键" width={440}>
        <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-[14px]">
          {KEYS.map(([keys, what]) => (
            <Fragment key={what}>
              <dt className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <G.Kbd key={k}>{k}</G.Kbd>
                ))}
              </dt>
              <dd className="text-[var(--ink-700)]">{what}</dd>
            </Fragment>
          ))}
        </dl>
      </PaperDialog>
      {pages && <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} paper={paper} pages={pages} marks={allMarks} sheet={answerSheet} />}
      <ConfirmDialog
        open={confirm === "clear"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="清空本卷笔记？"
        description={`会删掉${scope ? "这一部分卷面" : "这套卷子"}上的 ${marks.length} 条笔记（高亮、下划线、便签和手写）。清空后可以按 Ctrl+Z 撤销。`}
        confirmText="清空笔记"
        danger
        onConfirm={() => void history.remove(marks)}
      />
      {/* 查词小卡片：弹在词旁边（放在 body 上，盖在卷面、停靠区之上，点它不会被卷面当成点词） */}
      {hit &&
        createPortal(
          <WordCard
            hit={hit}
            ctx={wordCtx}
            anchor={wordAnchor}
            bounds={wordBounds}
            scroller={hit.page != null ? stage : null}
            onPhrase={onCardPhrase}
            source={{ paperId: paper.id, paperTitle: paper.title }}
            trans={trans}
            onLookedUp={onLookedUp}
            onClose={closeWord}
            onTransOpen={setCardTrans}
            onSyntax={hit.page != null && synOf(hit.sentence) ? () => openSyntax(sentenceKey(hit.sentence), false) : undefined}
            onAsk={
              aiOn && hit.sentence
                ? () => {
                    closeWord();
                    askAI(hit.sentence, hit.word);
                  }
                : undefined
            }
          />,
          document.body,
        )}
    </WordTextProvider>
    </ExplainContext.Provider>
  );
}
