import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { BookmarkSimple, Check, Pause, PencilLine, Play, Timer } from "@phosphor-icons/react";
import type { Box, Group, PdfWordsPage, Question } from "@/lib/papers";
import { wordAt, type MarkRow } from "@/lib/marks";
import { cn } from "@/lib/utils";
import { clock } from "@/lib/report";
import { Tip } from "@/components/overlay";
import { vocabHits, type WordClick } from "@/components/WordText";
import { InkLayer, type InkState } from "./InkLayer";
import { gesture } from "./gesture";
import { addSlot, gate, getThumb, onThumb, pump, saveThumb, thumbKey, type PageSlot } from "./pagePool";
import { ChoiceStrip } from "./ChoiceStrip";

export type Answers = Record<string, string>;
export type Marks = { vocab: Set<string>; lemma: Record<string, string> } | null;

/** 卷面上一页的所有可交互内容 */
export interface PageItems {
  questions: Question[]; // 选择题题号
  blanks: Question[]; // 完形填空文章里的空位
  segments: Group[]; // 听力题组的播放按钮
  writes: Question[]; // 作文、翻译入口
  timed: Set<string>; // 题号下面有「开始」小秒表的题（阅读理解：一题一题计）
  inline?: Set<string>; // 明确是行内作答的题号（选词填空、排序题，含换行在行首的空位）
  sets: TimeSet[]; // 小节标题右边的「开始计时」（选词填空、长篇阅读、完形、新题型：整节一起计）
}

/** 整节一起计时的一节：box 是小节标题（Section A 等）在这一页的位置，ids 是这节的选择题 */
export interface TimeSet {
  id: string;
  box: Box;
  ids: string[];
}

/** 正在计时的是哪道题（set 为 true 时是整节计时的那一节） */
export interface Timing {
  id: string;
  set: boolean;
  running: boolean;
}

export interface ExamPageProps {
  doc: PDFDocumentProxy;
  index: number;
  /** 专项训练只显示页面的一段：top 到 bottom（PDF 点），bottom 为 null 表示到页底 */
  clip?: { top: number; bottom: number | null };
  scale: number;
  data: PdfWordsPage;
  root: HTMLElement; // 画布滚动容器：画布池按离它中心的远近排先后
  placeholder?: string; // 还没画过时的低清占位图（第一页用试卷封面小图）
  items: PageItems;
  marks: Marks;
  notes: MarkRow[]; // 这一页的笔记
  ink: InkState;
  answers: Answers;
  texts: Answers;
  submitted: boolean;
  openQ: string | null;
  practice: boolean; // 练习模式：选完一题马上判
  times: Record<string, number> | null; // 各题用时（秒），null 表示不显示
  limits: Record<string, number>; // 各题建议用时（秒）
  playingSeg: string | null;
  hits?: [number, number][]; // 卷面查找在这一页的命中（单词序号范围）
  hitCur?: [number, number] | null; // 当前命中在这一页时
  activeWord?: number | null; // 正在查的词（这一页的单词序号）
  activeWords?: number[] | null; // 查词卡片认出的短语里的词（整个短语标出来）
  sentence?: number | null; // 长按出译文的那一句（这一页的句子序号）：整句淡黄底
  longs?: Map<number, number> | null; // 这一页上有长难句解析的句子：句子序号 → 它在这篇里的编号，句首标一个小号码
  hintId?: string | null; // 一道都没答时的第一题（题号或 `${id}@blank`）：它的空圈闪几下
  flags: Set<string>; // 标记待检查的题
  struck: Record<string, string[]>; // 各题划掉的选项
  explainable: boolean; // 选项条上能不能看解析（全真模拟交卷前不能）
  explaining: boolean; // 底下正在放打开的那道题的解析
  timeable: boolean; // 显示「开始」计时按钮（全真模拟、交卷后不显示）
  timing: Timing | null;
  onOpenQ: (id: string | null) => void;
  onChoose: (q: Question, key: string) => void;
  onStrike: (q: Question, key: string) => void;
  onFlag: (q: Question) => void;
  onExplain: () => void;
  onStep: (dir: 1 | -1) => void; // ← → 上一题、下一题
  canPrev: boolean; // 打开的那道题前面、后面还有没有题（选项条上的 ‹ › 灰不灰）
  canNext: boolean;
  /** 点了卷面上的词；点在空白处是 null */
  onWord: (hit: WordClick | null) => void;
  onPlaySeg: (id: string) => void;
  onWrite: (q: Question) => void;
  onStartQ: (q: Question) => void; // 点了题前的小秒表：开始计这道题，正在计的是暂停/继续
  onStartSet: (id: string) => void; // 点了小节标题旁的「开始计时」
}

/** 选项都是单词或短语（完形、选词填空）时，答题条上列出文字 */
export const shortOptions = (q: Question) => q.options!.every((o) => o.text && o.text.length <= 28);
export const optionText = (q: Question, key?: string) => q.options?.find((o) => o.key === key)?.text;
const NO_KEYS: string[] = [];

/** 超过 n 个字截断加"…"，不把英文单词从中间切开 */
function cut(s: string, n: number) {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const space = head.lastIndexOf(" ");
  return (/\S/.test(s[n]) && space >= n * 0.6 ? head.slice(0, space) : head).trimEnd() + "…";
}

/** 空格所在的那句：空格写成 ____，留空格前后共 30 字左右（同一句里常有两个空，要看得出是哪一个） */
function blankCue(sentence: string, mark: string) {
  const at = sentence.indexOf(mark);
  const clean = (x: string) => x.replace(/_{2,}\d+_{2,}/g, "____");
  const head = clean(sentence.slice(0, at));
  const tail = clean(sentence.slice(at + mark.length));
  if (head.length + 4 <= 30) return cut(head + "____" + tail, 30);
  let before = head.slice(-22);
  const space = before.indexOf(" ");
  if (space >= 0 && space < 10) before = before.slice(space + 1);
  return "…" + cut(before + "____" + tail, 30);
}

/**
 * 解析抽屉头上认题用的一小段原文：题干前 40 字；选词填空、完形是空格所在的那句；
 * 没有题干（听力）就是选项 A 前 30 字。数据里没写的，从卷面上题号右边那一句取
 */
export function questionCue(q: Question, pages: PdfWordsPage[] | null) {
  if (q.stem) return cut(q.stem, 40);
  const at = q.blank ?? (q.page && q.box ? { page: q.page, box: q.box } : null);
  const data = at && pages?.[at.page - 1];
  if (at && data) {
    const mark = `___${q.number}___`;
    const s = data.s.find((x) => x.includes(mark));
    if (s) return blankCue(s, mark);
    // 题号右边同一行的第一个词在哪一句："46. What characterizes ...?"、"3. A) It prepared ..."
    const [, y0, x1, y1] = at.box;
    const cy = (y0 + y1) / 2;
    const first = data.w.filter((w) => w[1] >= x1 - 1 && w[2] <= cy && w[4] >= cy).sort((a, b) => a[1] - b[1])[0];
    const text = first ? (data.s[first[5]] ?? "").replace(/^\s*\d+\s*[.．、]?\s*/, "").trim() : "";
    if (text) return cut(text, /^[A-Z][)）]/.test(text) ? 30 : 40);
  }
  const a = q.options?.[0]?.text;
  return a ? cut(`A) ${a}`, 30) : "";
}

interface MarkerProps {
  q: Question;
  id: string; // 题号是 q.id，完形空位是 `${q.id}@blank`
  scale: number;
  chosen?: string;
  judged: boolean; // 交卷后，或练习模式选过
  flagged: boolean;
  open: boolean;
  zone?: Zone; // 触屏热区
  onToggle: () => void;
  time: { sec: number; over: boolean } | null;
  hint: boolean; // 一道都没答：这是第一题，空圈闪几下告诉新手点哪儿
  inline: boolean; // 题号在行中间（同一行左边还有字）：选词填空、排序题
  start?: { on: boolean; running: boolean; onStart: () => void } | null; // 空圈下面的「开始」小秒表；on 是正在计这道题
}

/** 单题用时（全页唯一允许的 11px）：在左页边、选中字母的下面；超过建议时长是红的 */
function TimeTag({ left, top, time }: { left: number; top: number; time: { sec: number; over: boolean } }) {
  return (
    <span className={cn("num pointer-events-none absolute z-[3] w-[22px] text-center text-[11px] leading-none whitespace-nowrap", time.over ? "text-[var(--red)]" : "text-[var(--ink-500)]")} style={{ left, top }}>
      {clock(time.sec)}
    </span>
  );
}

/** 题号在行中间：同一行左边还有字，或句中自带 ___N___ 标记 */
function midLine([x0, y0, , y1]: Box, data: PdfWordsPage, qNumber?: number) {
  const cy = (y0 + y1) / 2;
  if (data.w.some((w) => w[3] <= x0 + 0.5 && w[2] <= cy && w[4] >= cy)) return true;
  if (qNumber != null) {
    const mark = `___${qNumber}___`;
    return data.s.some((s) => s.includes(mark));
  }
  return false;
}

/** 从 box 往右接着同一行挨着的字，到哪儿为止（"Section I Use of English" 这种标题后面还有字） */
function lineEnd([x0, y0, x1, y1]: Box, data: PdfWordsPage) {
  const cy = (y0 + y1) / 2;
  let end = x1;
  for (const w of data.w.filter((w) => w[1] >= x0 && w[2] <= cy && w[4] >= cy).sort((a, b) => a[1] - b[1])) if (w[1] - end < 15) end = Math.max(end, w[3]);
  return end;
}

const place = ([x0, y0, x1, y1]: Box, scale: number, pad: number) => ({ left: x0 * scale - pad, top: y0 * scale - pad, width: (x1 - x0) * scale + pad * 2, height: (y1 - y0) * scale + pad * 2 });

type Zone = { left: number; top: number; width: number; height: number };

/**
 * 触屏热区：题号（空位）四周补到至少 40×40（像素）。相邻两个热区重叠时，在两个题号中心连线的中点切开，
 * 点在空隙里就归离得近的那个；题号按钮本身压在所有热区上面
 */
function hitZones(boxes: { id: string; box: Box }[], scale: number): Map<string, Zone> {
  const zs = boxes.map(({ id, box: [x0, y0, x1, y1] }) => {
    const cx = ((x0 + x1) / 2) * scale;
    const cy = ((y0 + y1) / 2) * scale;
    const w = Math.max((x1 - x0) * scale + 6, 40);
    const h = Math.max((y1 - y0) * scale + 6, 40);
    return { id, cx, cy, l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  });
  for (let i = 0; i < zs.length; i++)
    for (let j = i + 1; j < zs.length; j++) {
      const a = zs[i];
      const c = zs[j];
      if (a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t) continue;
      const [up, down] = a.cy <= c.cy ? [a, c] : [c, a];
      const [lf, rt] = a.cx <= c.cx ? [a, c] : [c, a];
      if (down.cy - up.cy >= rt.cx - lf.cx) {
        const mid = (up.cy + down.cy) / 2;
        up.b = Math.min(up.b, mid);
        down.t = Math.max(down.t, mid);
      } else {
        const mid = (lf.cx + rt.cx) / 2;
        lf.r = Math.min(lf.r, mid);
        rt.l = Math.max(rt.l, mid);
      }
    }
  return new Map(zs.map((z) => [z.id, { left: z.l, top: z.t, width: z.r - z.l, height: z.b - z.t }]));
}

function HitZone({ zone, label, onOpen }: { zone?: Zone; label: string; onOpen: () => void }) {
  if (!zone) return null;
  return <button type="button" tabIndex={-1} aria-label={label} onClick={onOpen} className="absolute z-[7] hidden rounded-md pointer-coarse:block" style={zone} />;
}

/** 标记待检查的小书签：别在题号（或盖在题号上的字母、空位）的右上角，只压题号自己，不碰上一行和旁边的字 */
function FlagBadge({ right, top }: { right: number; top: number }) {
  return (
    <span className="pointer-events-none absolute z-[10] text-[var(--star)] drop-shadow-[0_1px_1px_rgba(134,96,15,0.35)]" style={{ left: right - 8, top }} aria-hidden>
      <BookmarkSimple className="size-3" weight="fill" />
    </span>
  );
}

/** 题号上的作答标记：点了在答题条上选答案；选好的字母在页边（题号在行中间的，字母盖在题号上，不压上一行） */
function QuestionMarker(p: MarkerProps) {
  const { q, scale, chosen, judged, flagged, open, inline } = p;
  const [x0, y0, x1, y1] = q.box!;
  const right = judged && chosen === q.answer;
  const cy = ((y0 + y1) / 2) * scale;
  const pillH = Math.max((y1 - y0) * scale, 18);
  // 盖在题号上的小胶囊有多宽（判错时并两个字母）
  const pillW = Math.max((x1 - x0) * scale, 22) + (judged && !right && chosen ? 24 : 0);
  const tone = judged ? (right ? "bg-[var(--blue)] text-white" : "bg-[var(--red)] text-white") : "bg-primary text-primary-fg shadow-[var(--shadow-button)]";
  // 行中间的题号：小胶囊盖住题号本身（判错时右边再并一个正确答案）
  const pill = inline && (chosen || (judged && q.answer)) && (
    <span
      className="pointer-events-none absolute z-[9] flex items-center gap-0.5"
      style={{ left: ((x0 + x1) / 2) * scale, top: cy, transform: "translate(-50%, -50%)", height: pillH }}
    >
      {chosen && <span className={cn("flex h-full min-w-[22px] items-center justify-center rounded-full px-1.5 text-xs font-semibold", tone)}>{chosen}</span>}
      {judged && !right && <span className="flex h-full min-w-[22px] items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold text-[var(--blue)] shadow-[inset_0_0_0_1.5px_var(--blue)]">{q.answer}</span>}
    </span>
  );
  const badge = (letter: string, cls: string, offset = 0) => (
    <span className={cn("pointer-events-none absolute z-[3] flex size-[22px] items-center justify-center rounded-full text-xs font-semibold", cls)} style={{ left: x0 * scale - 30 - offset, top: cy - 11 }}>
      {letter}
    </span>
  );

  return (
    <>
      {/* 在笔记层之上：选了笔、高亮也能点题号作答 */}
      <HitZone zone={p.zone} label={`第 ${q.number} 题`} onOpen={p.onToggle} />
      <button
        type="button"
        data-qid={p.id}
        onClick={p.onToggle}
        aria-label={`第 ${q.number} 题${chosen ? `，已选 ${chosen}` : ""}`}
        aria-pressed={open}
        className={cn(
          "absolute z-[8] block rounded-md transition-[background-color,box-shadow] duration-[var(--dur-fast)]",
          // 打开时只描蓝框、淡淡一层底，题号还看得见
          open
            ? "bg-[rgba(22,119,255,0.08)] shadow-[0_0_0_2px_var(--blue)]"
            : chosen && !inline
              ? "shadow-[0_0_0_1px_var(--pixel-blue)] hover:bg-[var(--blue-tint)]"
              : inline && !chosen && !judged
                ? cn("bg-[rgba(22,119,255,0.05)] shadow-[0_0_0_1px_var(--pixel-blue)] hover:bg-[var(--blue-tint)]", p.hint && "animate-slot-hint")
                : "hover:bg-[var(--blue-tint)] hover:shadow-[0_0_0_1px_var(--pixel-blue)]",
        )}
        style={place(q.box!, scale, 3)}
      />
      {pill}
      {/* 开始做这道题：空圈下面一个小秒表，点了才开始计时（再点暂停、继续）；答了以后这里换成用时。
          放在空圈前面画，两个的点按区域碰到时空圈在上 */}
      {p.start && !inline && !chosen && !judged && (
        <button
          type="button"
          tabIndex={-1}
          onClick={p.start.onStart}
          title={p.start.on ? (p.start.running ? "暂停计时" : "继续计时") : "开始做这题（计时）"}
          aria-label={`第 ${q.number} 题，${p.start.on ? (p.start.running ? "暂停计时" : "继续计时") : "开始计时"}`}
          aria-pressed={p.start.on && p.start.running}
          className={cn(
            "absolute z-[8] flex h-4 w-[22px] items-center justify-center transition-colors before:absolute before:-inset-x-[9px] before:top-0 before:-bottom-[8px] before:content-['']",
            p.start.on ? (p.start.running ? "text-[var(--blue)]" : "text-[var(--ink-700)]") : "text-[var(--ink-500)] hover:text-[var(--blue)]",
          )}
          style={{ left: x0 * scale - 30, top: cy + 12 }}
        >
          <Timer className={cn("size-3.5", p.start.on && p.start.running && "animate-pulse")} weight={p.start.on ? "fill" : "bold"} />
        </button>
      )}
      {/* 还没答：页边一个虚线空圈（像答题卡上没涂的格子），点它也能选；答了换成字母 */}
      {!inline && !chosen && !judged && (
        <button
          type="button"
          tabIndex={-1}
          onClick={p.onToggle}
          aria-label={`第 ${q.number} 题，选答案`}
          className={cn(
            // 点按区域往外扩到 40px（不能用 .hit40：它会把定位改成 relative）
            "absolute z-[8] size-[22px] rounded-full border-[1.5px] border-dashed transition-colors before:absolute before:-inset-[10px] before:content-['']",
            open ? "border-[var(--blue)] bg-[var(--blue-tint)]" : "border-[var(--pixel-blue)] bg-white/80 hover:border-[var(--blue)] hover:bg-[var(--blue-tint)]",
            p.hint && !open && "animate-slot-hint",
          )}
          style={{ left: x0 * scale - 30, top: cy - 11 }}
        />
      )}
      {!inline && chosen && badge(chosen, tone)}
      {!inline && judged && !right && badge(q.answer!, "bg-white text-[var(--blue)] shadow-[inset_0_0_0_1.5px_var(--blue)]", 26)}
      {flagged && (inline && (chosen || judged) ? <FlagBadge right={((x0 + x1) / 2) * scale + pillW / 2} top={cy - pillH / 2 - 3} /> : <FlagBadge right={x1 * scale + 2} top={y0 * scale - 3} />)}
      {/* 用时：页边那一列、字母下面；题号在行中间的不显示（答题卡上有） */}
      {p.time && !inline && <TimeTag left={x0 * scale - 30} top={cy + 13} time={p.time} />}
    </>
  );
}

/** 完形填空文章里的空位：选好后空位里直接显示所选的词，读起来能检查通不通。
 *  判过之后显示正确的词，底色表示你答对（蓝）、答错（红）还是没答（白） */
function BlankMarker(p: MarkerProps) {
  const { q, scale, chosen, judged, flagged, open } = p;
  const box = q.blank!.box;
  const right = judged && chosen === q.answer;
  const word = judged ? optionText(q, q.answer) : optionText(q, chosen);
  const fill = judged
    ? chosen
      ? right
        ? "bg-[var(--blue-tint)] text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--blue-line)]"
        : "bg-[var(--red-tint)] text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--danger-soft-line)]"
      : "bg-white text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--blue-line)]"
    : "bg-[#e6eefb] text-primary shadow-[inset_0_0_0_1px_var(--pixel-blue)]";
  // 字号随词长缩小，尽量不盖住空位两边的字（最多比空位宽四成多）
  const width = (box[2] - box[0]) * scale;
  const fontSize = word ? Math.max(8, Math.min(10.5 * scale * 0.95, (width * 1.45 - 6) / (word.length * 0.48))) : 0;

  return (
    <>
      <HitZone zone={p.zone} label={`第 ${q.number} 空`} onOpen={p.onToggle} />
      <button
        type="button"
        data-qid={p.id}
        onClick={p.onToggle}
        aria-label={`第 ${q.number} 空${chosen ? `，已选 ${chosen} ${optionText(q, chosen) ?? ""}` : ""}`}
        aria-pressed={open}
        className={cn(
          "absolute flex items-center justify-center rounded-[5px] transition-[background-color,box-shadow] duration-[var(--dur-fast)]",
          open ? "z-[9] shadow-[0_0_0_2px_var(--blue)]" : "z-[8]",
          !word && (open ? "bg-[var(--blue-tint)]" : cn("border border-dashed border-[var(--pixel-blue)] bg-[rgba(22,119,255,0.04)] hover:bg-[var(--blue-tint)]", p.hint && "animate-slot-hint")),
        )}
        style={place(box, scale, 2)}
      >
        {word && (
          <span className={cn("pointer-events-none flex h-full min-w-full items-center justify-center rounded-[5px] px-[3px] font-serif leading-none whitespace-nowrap", fill)} style={{ fontSize }}>
            {word}
          </span>
        )}
      </button>
      {flagged && <FlagBadge right={box[2] * scale + 2} top={box[1] * scale - 4} />}
    </>
  );
}

/** 小节标题（Section A 等）右边的「开始计时」：整节一起计，每答一题记一段（从开始或上一题答完算起），接着计下一题。
 *  计时中再点是暂停、继续；整节都答完、没在计就收起 */
function SetStart({ set, data, scale, on, running, onStart }: { set: TimeSet; data: PdfWordsPage; scale: number; on: boolean; running: boolean; onStart: () => void }) {
  const [, y0, , y1] = set.box;
  const x1 = lineEnd(set.box, data);
  const label = on ? (running ? "计时中" : "继续计时") : "开始计时";
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label={on ? `${label}，点了${running ? "暂停" : "继续"}` : "开始计时：这一节每答一题记一次用时"}
      aria-pressed={on && running}
      className={cn(
        "absolute z-[8] flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-none whitespace-nowrap transition-colors",
        on && running
          ? "bg-[var(--blue-tint)] text-[var(--blue)] shadow-[inset_0_0_0_1px_var(--pixel-blue)]"
          : "bg-white text-[var(--ink-700)] shadow-[inset_0_0_0_1px_var(--line)] hover:text-[var(--blue)] hover:shadow-[inset_0_0_0_1px_var(--pixel-blue)]",
      )}
      style={{ left: x1 * scale + 12, top: ((y0 + y1) / 2) * scale - 14 }}
    >
      {on && running ? <Pause className="size-3.5" weight="fill" /> : <Timer className="size-3.5" weight="bold" />}
      {label}
    </button>
  );
}

/** 作文、翻译题号：点开右侧"作答"面板。题号在页边时，页边放一个笔的图标 */
function WriteMarker({ q, scale, written, time, onWrite }: { q: Question; scale: number; written: boolean; time: { sec: number; over: boolean } | null; onWrite: () => void }) {
  const [x0, y0, , y1] = q.box!;
  const inline = x0 > 120;
  const cy = ((y0 + y1) / 2) * scale;
  return (
    <>
      <button
        type="button"
        onClick={onWrite}
        aria-label={`作答：${q.label ?? `第 ${q.number} 题`}${written ? "（已写）" : ""}`}
        className={cn(
          "absolute z-[3] rounded-md transition-[background-color,box-shadow] duration-[var(--dur-fast)] hover:bg-[var(--blue-tint)] hover:shadow-[0_0_0_1px_var(--pixel-blue)]",
          written && "shadow-[0_0_0_1px_var(--pixel-blue)]",
        )}
        style={place(q.box!, scale, 3)}
      />
      {time && !inline && <TimeTag left={x0 * scale - 30} top={cy + 13} time={time} />}
      {!inline && (
        <div className="absolute z-[3]" style={{ left: x0 * scale - 30, top: cy - 11 }}>
          <Tip label={written ? "已作答，点开修改" : "写答案"} side="top">
            <button
              type="button"
              onClick={onWrite}
              aria-label={`作答：${q.label ?? `第 ${q.number} 题`}`}
              className={cn(
                "flex size-[22px] items-center justify-center rounded-full transition active:scale-95",
                written ? "bg-primary text-primary-fg shadow-[var(--shadow-button)]" : "bg-white text-primary shadow-[var(--shadow-glass),inset_0_0_0_1px_var(--line-soft)] hover:shadow-[var(--shadow-glass),inset_0_0_0_1px_var(--blue)]",
              )}
            >
              {written ? <Check className="size-3" weight="bold" /> : <PencilLine className="size-3" />}
            </button>
          </Tip>
        </div>
      )}
    </>
  );
}

/** 一页画布最多多少像素（平板 Safari 的上限约 1670 万，留点余量） */
const MAX_CANVAS_PIXELS = 12_000_000;

/** 这个词是它那句里第几个同样开头的词（和 MarkWord 的匹配一样：词本身或以它开头的词），原句里只加粗点到的那一处 */
export function wordNth(data: PdfWordsPage, k: number) {
  const [word, , , , , sid] = data.w[k];
  const re = new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i");
  let n = 0;
  for (let j = 0; j < k; j++) if (data.w[j][5] === sid && re.test(data.w[j][0])) n++;
  return n;
}

/** 卷面上一个词的屏幕位置（量这一页的位置算出来，卷面上没有逐词的元素） */
export function wordRect(page: number, data: PdfWordsPage, k: number, scale: number) {
  const r = document.getElementById(`pdf-page-${page}`)?.getBoundingClientRect();
  const [, x0, y0, x1, y1] = data.w[k];
  return new DOMRect((r?.left ?? 0) + x0 * scale, (r?.top ?? 0) + y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
}

/**
 * 单词层：不给每个词建框（一页几百个，全卷几千个节点），点哪儿按坐标找词；
 * 只给要显示的词建框：生词本里的、查找命中、正在查的词（每页通常不到 30 个）
 */
const WordLayer = memo(function WordLayer({
  page,
  data,
  scale,
  marks,
  hits,
  hitCur,
  active,
  actives,
  sentence,
  longs,
  onWord,
}: {
  page: number;
  data: PdfWordsPage;
  scale: number;
  marks: Marks;
  hits?: [number, number][];
  hitCur?: [number, number] | null;
  active?: number | null;
  actives?: number[] | null;
  sentence?: number | null;
  longs?: Map<number, number> | null;
  onWord: (hit: WordClick | null) => void;
}) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    // 手指点词考场已经查过了（触屏的 click 随后才到）
    if (Date.now() - gesture.touchLookupAt < 700) return;
    const r = e.currentTarget.getBoundingClientRect();
    const k = wordAt(data.w, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    if (k < 0) return onWord(null);
    onWord({ word: data.w[k][0], sentence: data.s[data.w[k][5]] ?? "", rect: wordRect(page, data, k, scale), page, index: k, nth: wordNth(data, k) });
  };
  // 生词本里的词：词表变了才重新找
  const vocab = useMemo(() => (marks ? vocabHits(data.w.map((w) => w[0]), marks, data.w.map((w) => w[5])).hits : new Map<number, boolean>()), [data, marks]);
  // 每个要画框的词：5 长难句，0 生词，4 长按出译文的那句，1 命中，2 当前命中，3 正在查（后面的盖前面的）
  const shown = new Map<number, number>();
  for (const i of vocab.keys()) shown.set(i, 0);
  if (sentence != null) data.w.forEach((w, i) => w[5] === sentence && shown.set(i, 4));
  if (hits) for (const [a, b] of hits) for (let i = a; i <= b; i++) shown.set(i, 1);
  if (hitCur) for (let i = hitCur[0]; i <= hitCur[1]; i++) shown.set(i, 2);
  if (actives) for (const i of actives) if (i < data.w.length) shown.set(i, Math.max(shown.get(i) ?? 3, 3));
  if (active != null && active < data.w.length) shown.set(active, Math.max(shown.get(active) ?? 3, 3));
  // 每句长难句句首一个小号码，和右侧长难句列表的编号对得上
  const heads: number[] = [];
  if (longs?.size) {
    const seen = new Set<number>();
    data.w.forEach((w, i) => longs.has(w[5]) && !seen.has(w[5]) && (seen.add(w[5]), heads.push(i)));
  }
  return (
    <div className="absolute inset-0 z-[1] cursor-text" onClick={onClick}>
      {heads.map((i) => {
        const [, x0, y0] = data.w[i];
        return (
          <span key={`h${i}`} className="syn-head pointer-events-none" style={{ left: x0 * scale - 6, top: y0 * scale - 9 }}>
            {longs?.get(data.w[i][5])}
          </span>
        );
      })}
      {/* 生词本里的词、短语：最后一个词右上角一个小点 */}
      {[...vocab].map(([i, end]) => {
        if (!end) return null;
        const [, , y0, x1] = data.w[i];
        return <span key={`v${i}`} className="vocab-dot pointer-events-none" style={{ left: x1 * scale, top: y0 * scale - 2 }} />;
      })}
      {[...shown].map(([i, kind]) => {
        const [, x0, y0, x1, y1] = data.w[i];
        return (
          <span
            key={i}
            className={cn("w pw pointer-events-none", kind === 0 && "is-vocab", kind === 1 && "is-hit", kind === 2 && "is-hit-cur", kind === 3 && "is-active", kind === 4 && "is-sent", kind === 5 && "is-long")}
            style={{ left: x0 * scale - 1.5, top: y0 * scale, width: (x1 - x0) * scale + 3, height: (y1 - y0) * scale }}
          />
        );
      })}
    </div>
  );
});

/** 一页原卷：画布显示 PDF（画布池管画不画），上面依次叠高亮、单词层（查词）、笔迹、题号和听力按钮、便签 */
export const ExamPage = memo(function ExamPage(p: ExamPageProps) {
  const { doc, index, scale, data, items, root } = p;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  // 要画的缩放：缩放时先把旧画面拉伸着用，停下来 0.15 秒后再按新大小重画（画布池排队）
  const want = useRef(scale);
  useEffect(() => {
    if (want.current === scale) return;
    const t = setTimeout(() => {
      want.current = scale;
      pump();
    }, 150);
    return () => clearTimeout(t);
  }, [scale]);

  // 画布不进 React：进出视口、画好、丢掉都直接改 DOM，滚动时这一页不重新渲染
  const placeholder = useRef(p.placeholder);
  useEffect(() => {
    const el = box.current;
    const h = host.current;
    if (!el || !h) return;
    const key = thumbKey(doc.fingerprints[0] ?? "pdf", index + 1);
    let canvas: HTMLCanvasElement | null = null;
    let drawn = 0;
    let task: RenderTask | null = null;
    // 占位：这一页的低清小图拉伸着（画过一次就有；没有就是空白纸面和页码）
    const shade = document.createElement("img");
    shade.alt = "";
    shade.draggable = false;
    shade.decoding = "async";
    shade.className = "absolute inset-0 size-full";
    shade.onerror = () => shade.remove();
    const showShade = (url: string) => {
      shade.src = url;
      if (!shade.isConnected) h.prepend(shade);
    };
    const first = getThumb(key) ?? placeholder.current;
    if (first) showShade(first);
    const off = onThumb(key, showShade);

    const slot: PageSlot = {
      el,
      root,
      near: false,
      live: false,
      stale: () => drawn !== want.current,
      cancel: () => task?.cancel(),
      release: () => {
        task?.cancel();
        if (canvas) {
          // Safari 不会马上回收画布内存，清成 0×0 再拿掉
          canvas.width = canvas.height = 0;
          canvas.remove();
          canvas = null;
        }
        if (drawn) {
          // pdf.js 把这一页解码后的整页扫描图留在内存里，等重画时再解：不然 9 页高清扫描图一直占着
          void doc.getPage(index + 1).then((pg) => pg.cleanup(), () => {});
        }
        drawn = 0;
        slot.live = false;
      },
      draw: async () => {
        const s = want.current;
        const page = await doc.getPage(index + 1);
        if (!slot.near) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // 平板 Safari 单个画布超过约 1670 万像素会整页空白；放得很大时画布封顶，略微拉伸着显示
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: s * dpr * Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height * s * s * dpr * dpr))) });
        // 画在新画布上，画完换上去：重画时页面不会闪白
        const c = document.createElement("canvas");
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        c.className = "absolute inset-0 size-full";
        task = page.render({ canvasContext: c.getContext("2d", { alpha: false })!, viewport });
        // 快速滚动时停在分段处，滚慢了再接着画
        task.onContinue = (cont: () => void) => gate(slot, cont);
        try {
          await task.promise;
        } catch (e) {
          c.width = c.height = 0;
          throw e;
        } finally {
          task = null;
        }
        if (!slot.near) {
          c.width = c.height = 0;
          return;
        }
        if (canvas) {
          canvas.replaceWith(c);
          canvas.width = canvas.height = 0;
        } else h.append(c);
        canvas = c;
        drawn = s;
        slot.live = true;
        saveThumb(key, c);
      },
    };
    const remove = addSlot(slot);
    return () => {
      off();
      remove();
      shade.remove();
    };
  }, [doc, index, root]);

  const width = data.width * scale;
  const height = data.height * scale;
  const top = p.clip?.top ?? 0;
  const bottom = p.clip?.bottom ?? data.height;
  // 截掉的部分不占位置，也不显示、不响应点击
  const band = p.clip ? ([top, bottom] as [number, number]) : null;
  const clipPath = band ? `inset(${top * scale}px 0 ${(data.height - bottom) * scale}px 0)` : undefined;
  const timeOf = (q: Question) => {
    const sec = p.times?.[q.id];
    return sec && sec >= 1 ? { sec, over: sec > (p.limits[q.id] ?? Infinity) } : null;
  };
  // 打开的那道题在这一页：选项条贴在题号下面
  const stripQ = p.openQ ? (items.questions.find((q) => q.id === p.openQ) ?? items.blanks.find((q) => `${q.id}@blank` === p.openQ)) : undefined;
  const stripBox = stripQ && (p.openQ!.endsWith("@blank") ? stripQ.blank!.box : stripQ.box!);
  // 这一页所有题号、空位的触屏热区，一起算，互不重叠
  const inlineIds = useMemo(
    () => new Set(items.questions.filter((q) => items.inline?.has(q.id) || midLine(q.box!, data, q.number)).map((q) => q.id)),
    [items, data],
  );
  const zones = useMemo(() => hitZones([...items.questions.map((q) => ({ id: q.id, box: q.box! })), ...items.blanks.map((q) => ({ id: `${q.id}@blank`, box: q.blank!.box }))], scale), [items, scale]);
  const marker = (q: Question, id: string): MarkerProps & { key: string } => ({
    key: id,
    q,
    id,
    scale,
    chosen: p.answers[q.id],
    // 练习模式：选了就判
    judged: p.submitted || (p.practice && !!p.answers[q.id]),
    time: id === q.id ? timeOf(q) : null,
    flagged: p.flags.has(q.id),
    open: p.openQ === id,
    hint: p.hintId === id,
    inline: inlineIds.has(q.id),
    start:
      p.timeable && id === q.id && items.timed.has(q.id)
        ? { on: p.timing?.id === q.id && !p.timing.set, running: !!p.timing?.running, onStart: () => p.onStartQ(q) }
        : null,
    zone: zones.get(id),
    onToggle: () => p.onOpenQ(p.openQ === id ? null : id),
  });

  return (
    <div className="relative mx-auto rounded-[4px] bg-white shadow-[0_0_0_1px_var(--line),0_1px_2px_rgba(15,39,67,0.06)]" style={{ width, height: (bottom - top) * scale }}>
      <div id={`pdf-page-${index + 1}`} ref={box} className="absolute left-0" style={{ top: -top * scale, width, height }}>
        <div className="absolute inset-0" style={{ clipPath }}>
          {/* 还没画的页：空白纸面上一个页码 */}
          <span className="num pointer-events-none absolute inset-x-0 top-[38%] text-center text-[32px] text-[var(--ink-300)]" aria-hidden>
            {index + 1}
          </span>
          <div ref={host} className="absolute inset-0" />
          <WordLayer page={index + 1} data={data} scale={scale} marks={p.marks} hits={p.hits} hitCur={p.hitCur} active={p.activeWord} actives={p.activeWords} sentence={p.sentence} longs={p.longs} onWord={p.onWord} />
        </div>

        {items.segments.map((g) => {
          const [x0, y0, , y1] = g.anchor!.box;
          const playing = p.playingSeg === g.audioSegment;
          return (
            // 放在作答圈左边、压在它的扩大点按区上面，不然整个按钮都被作答圈接走
            <div key={g.id} className="absolute z-[9]" style={{ left: Math.max(2, x0 * scale - 64), top: ((y0 + y1) / 2) * scale - 14 }}>
              <Tip label={playing ? "暂停" : `播放 ${g.title}`} side="top">
                <button
                  type="button"
                  onClick={() => p.onPlaySeg(g.audioSegment!)}
                  aria-label={`播放 ${g.title}`}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full transition active:scale-[0.97]",
                    playing ? "bg-primary text-primary-fg shadow-[var(--shadow-button)]" : "bg-white text-primary shadow-[var(--shadow-glass),inset_0_0_0_1px_var(--line-soft)] hover:shadow-[var(--shadow-glass),inset_0_0_0_1px_var(--blue)]",
                  )}
                >
                  {playing ? <Pause className="size-3.5" weight="fill" /> : <Play className="ml-0.5 size-3.5" weight="fill" />}
                </button>
              </Tip>
            </div>
          );
        })}

        {p.timeable &&
          items.sets.map((t) => {
            const on = p.timing?.set === true && p.timing.id === t.id;
            if (!on && t.ids.every((id) => p.answers[id])) return null;
            return <SetStart key={t.id} set={t} data={data} scale={scale} on={on} running={on && p.timing!.running} onStart={() => p.onStartSet(t.id)} />;
          })}
        {items.writes.map((q) => (
          <WriteMarker key={q.id} q={q} scale={scale} written={!!p.texts[q.id]?.trim()} time={timeOf(q)} onWrite={() => p.onWrite(q)} />
        ))}
        {items.questions.map((q) => {
          const { key, ...m } = marker(q, q.id);
          return <QuestionMarker key={key} {...m} />;
        })}
        {items.blanks.map((q) => {
          const { key, ...m } = marker(q, `${q.id}@blank`);
          return <BlankMarker key={key} {...m} />;
        })}

        {stripQ && stripBox && (
          <ChoiceStrip
            key={p.openQ}
            q={stripQ}
            box={stripBox}
            inline={p.openQ!.endsWith("@blank") || inlineIds.has(stripQ.id)}
            data={data}
            limit={bottom}
            scale={scale}
            chosen={p.answers[stripQ.id]}
            judged={p.submitted || (p.practice && !!p.answers[stripQ.id])}
            flagged={p.flags.has(stripQ.id)}
            struck={p.struck[stripQ.id] ?? NO_KEYS}
            explainable={p.explainable}
            explaining={p.explaining}
            onChoose={(key) => p.onChoose(stripQ, key)}
            onStrike={(key) => p.onStrike(stripQ, key)}
            onFlag={() => p.onFlag(stripQ)}
            onExplain={p.onExplain}
            canPrev={p.canPrev}
            canNext={p.canNext}
            onStep={p.onStep}
            onClose={() => p.onOpenQ(null)}
          />
        )}

        <InkLayer page={index + 1} data={data} scale={scale} marks={p.notes} ink={p.ink} band={band} />
      </div>
    </div>
  );
});
