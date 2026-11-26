/** 试卷数据格式，详见 docs/试卷数据格式.md */
export type ExamId = "kaoyan1" | "kaoyan2" | "cet4" | "cet6" | "ielts-a" | "ielts-gt";

export const EXAMS: { id: ExamId; name: string; short: string }[] = [
  { id: "ielts-a", name: "雅思（A类学术）", short: "雅思 A" },
  { id: "ielts-gt", name: "雅思（G类培训）", short: "雅思 G" },
  { id: "cet4", name: "大学英语四级", short: "四级" },
  { id: "cet6", name: "大学英语六级", short: "六级" },
  { id: "kaoyan1", name: "考研英语一", short: "英语一" },
  { id: "kaoyan2", name: "考研英语二", short: "英语二" },
];

export function isIeltsExam(exam?: string | null): exam is "ielts-a" | "ielts-gt" {
  return exam === "ielts-a" || exam === "ielts-gt";
}

export interface PaperIndexItem {
  id: string;
  exam: ExamId;
  year: number;
  month?: number;
  set?: number;
  title: string;
  label?: string; // 真题、官方样卷
  sample?: boolean;
  questionCount: number;
  hasAudio: boolean;
  durationMinutes?: number;
  sections: SectionIndexItem[];
}

/** 目录里每个部分的概要，专项训练用 */
export interface SectionIndexItem {
  id: string;
  kind: SectionKind;
  part: string;
  title: string;
  subtitle?: string;
  questionCount: number;
  choiceCount: number; // 其中选择题
  from?: string; // 卷面没印、从同场另一套接过来的部分（那一套的 id）：专项训练里不重复列
}

export interface Option {
  key: string;
  text: string;
}

export interface Question {
  id: string;
  number: number;
  label?: string; // 代替题号显示，如"作文""翻译"
  stem?: string;
  options?: Option[]; // 有选项就是选择题，否则是主观题
  answer?: string; // 选择题答案
  reference?: string; // 主观题参考答案
  explanation?: string;
  explanationBy?: ExplainSource; // 解析来源：官方解析整理 / AI 补写
  explain?: ExplainFields; // 结构化解析（解析层的 fields），没有就用 explanation 文本
  explainBy?: ExplainSource; // 结构化解析是谁写的
  page?: number; // 题号所在页（从 1 开始）
  box?: Box; // 题号在页内的位置
  blank?: PageBox; // 完形填空：文章里的空位，在空位上也能作答
}

/** 原卷上的一个位置 */
export interface PageBox {
  page: number;
  box: Box;
}

/** [x0, y0, x1, y1]，单位是 PDF 点，原点在左上角 */
export type Box = [number, number, number, number];

export interface Passage {
  title?: string;
  /** 完形填空用 {{题号}} 标记空位；翻译用 [[题号|句子]] 标记划线句 */
  paragraphs: string[];
}

export interface Group {
  id: string;
  title?: string;
  /** 这篇文章的全文翻译（来自解析层） */
  translation?: string;
  passage?: Passage;
  /** 对应的听力分段 id */
  audioSegment?: string;
  /** 卷面上 "Questions 1 and 2 are based on ..." 那行的位置，用来放播放按钮 */
  anchor?: PageBox;
  /** 段落排序题的顺序，如 ["41", "42", "F", "43", "44", "C", "45"]：数字是空位，字母是已给出的段落 */
  sequence?: string[];
  questions: Question[];
}

/** banked：选词填空，matching：长篇阅读（段落信息匹配），reading：阅读理解（四六级叫仔细阅读） */
export type SectionKind = "listening" | "cloze" | "banked" | "matching" | "reading" | "order" | "translation" | "writing";

/** 题型名称，按专项训练里的顺序 */
export const KIND_NAMES: Record<SectionKind, string> = {
  listening: "听力",
  cloze: "完形填空",
  banked: "选词填空",
  matching: "长篇阅读",
  reading: "阅读理解",
  order: "新题型",
  translation: "翻译",
  writing: "写作",
};

/** 按考试叫法：四六级的阅读理解叫"仔细阅读" */
export function kindName(kind: SectionKind, exam?: ExamId) {
  return kind === "reading" && (exam === "cet4" || exam === "cet6") ? "仔细阅读" : KIND_NAMES[kind];
}

export interface Section {
  id: string;
  part: string;
  title: string;
  subtitle?: string; // 如 Part A
  kind: SectionKind;
  directions?: string;
  /** 部分标题在卷面上的位置，顶栏切换部分时滚到这里 */
  anchor?: PageBox;
  /** 卷面没印、从同场另一套接过来的部分（那一套的 id），见 scripts/share_listening.py */
  from?: string;
  groups: Group[];
}

export interface AudioLine {
  speaker?: string;
  text: string;
  start: number;
  end: number;
}

export interface AudioSegment {
  id: string;
  label: string;
  start: number;
  end: number;
  lines: AudioLine[];
  /**
   * 说话人是怎么来的："pitch" 是只按音高分的（谁是 M 谁是 W 不可靠，界面只用来分轮、不出角色章）；
   * "pitch+book"：书里标过的句子和音高对得上，补全的；没有这个字段是书里标的
   */
  speakerSource?: string;
}

export interface PaperAudio {
  src: string;
  duration: number;
  segments: AudioSegment[];
}

export interface Paper {
  id: string;
  exam: ExamId;
  year: number;
  month?: number;
  set?: number;
  title: string;
  heading?: string; // 卷面大标题，如"2019 年全国硕士研究生入学统一考试英语（一）试题"
  label?: string; // 真题、官方样卷
  sample?: boolean;
  note?: string;
  durationMinutes?: number;
  audio?: PaperAudio;
  /** 原卷 PDF，题目都在卷面上做 */
  pdf: PaperPdf;
  sections: Section[];
}

export interface PaperPdf {
  src: string;
  /** 每页可点击单词的坐标和句子，由 scripts/import_*.py 生成 */
  words: string;
}

/** [单词, x0, y0, x1, y1, 句子序号]，坐标单位是 PDF 点，原点在左上角 */
export type PdfWord = [string, number, number, number, number, number];

export interface PdfWordsPage {
  width: number;
  height: number;
  w: PdfWord[];
  s: string[];
}

let indexPromise: Promise<PaperIndexItem[]> | null = null;
let indexLoaded: PaperIndexItem[] | null = null;

/** 已经加载好的试卷目录（没加载完是 null），切页时直接拿来用，不用等一帧 */
export const peekPaperIndex = () => indexLoaded;

export function loadPaperIndex(): Promise<PaperIndexItem[]> {
  if (!indexPromise) {
    indexPromise = fetch("/papers/index.json").then(async (r) => {
      if (r.status === 404) return (indexLoaded = []);
      if (!r.ok) throw new Error(`加载试卷目录失败：${r.status}`);
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("text/html")) return (indexLoaded = []);
      return (indexLoaded = await r.json());
    });
    indexPromise.catch(() => (indexPromise = null));
  }
  return indexPromise;
}

export type ExplainSource = "official" | "ai";

/** 结构化解析（docs/设计任务-解析.md 第 2 节）：每段都可能没有，界面有哪段画哪段 */
export interface ExplainFields {
  answer?: string;
  brief?: string; // 一句话结论（不超过 48 字；以后由结构化脚本生成，没有就从思路里取第一句）
  locate?: {
    where?: string; // 第二段第三句
    quote?: string; // 定位句原文
    page?: number; // 定位句所在页
    words?: [number, number]; // 在 words.json 该页 w[] 里的起止序号（含），卷面高亮用
    line?: { segment: string; index: number }; // 听力：逐字稿行号
  };
  reasoning?: string;
  options?: Record<string, string>; // 错误项为什么错
  mapping?: { stem: string; text: string }[]; // 长篇阅读：题干 ↔ 原文
  grammar?: string; // 选词、完形
  meaning?: string;
  vocab?: { w: string; zh: string }[];
  translation?: string; // 定位句的中文
  points?: string[]; // 写作、翻译
  phrases?: { en: string; zh: string }[];
  kind?: string; // 题型：细节、推理、主旨……
  signal?: string; // 做题信号：一句话说这题该盯哪个词
  traps?: Record<string, string>; // 错误选项属于哪种陷阱：偷换对象、无中生有……
}

/** 解析层 public/papers/explain/<id>.json：整理过的官方解析和 AI 补写的解析，由 scripts/polish_explanations.py 生成 */
interface ExplainFile {
  questions?: Record<string, { text?: string; reference?: string; by?: ExplainSource; fields?: ExplainFields; fieldsBy?: ExplainSource }>;
  groups?: Record<string, { translation?: string }>;
}

/** 把解析层叠到试卷上：有整理过的就用整理过的 */
function applyExplain(paper: Paper, ex: ExplainFile) {
  for (const s of paper.sections)
    for (const g of s.groups) {
      const tr = ex.groups?.[g.id]?.translation;
      if (tr) g.translation = tr;
      for (const q of g.questions) {
        const e = ex.questions?.[q.id];
        if (!e) continue;
        if (e.text) {
          q.explanation = e.text;
          q.explanationBy = e.by ?? "official";
        }
        if (e.reference) q.reference = e.reference;
        if (e.fields) {
          q.explain = e.fields;
          q.explainBy = e.fieldsBy ?? e.by ?? "official";
        }
      }
    }
}

const paperCache = new Map<string, Promise<Paper>>();
const paperLoaded = new Map<string, Paper>();

/** 已经加载好的试卷（没加载过是 undefined） */
export const peekPaper = (id: string) => paperLoaded.get(id);

/** 加载一套试卷；同一套只请求一次（统计页会同时要很多套） */
export function loadPaper(id: string): Promise<Paper> {
  if (!paperCache.has(id)) {
    // 解析层可能没有（还没整理过），拿不到就用试卷里自带的
    const explain = fetch(`/papers/explain/${encodeURIComponent(id)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ExplainFile>) : null))
      .catch(() => null);
    const p = fetch(`/papers/${encodeURIComponent(id)}.json`).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "没有找到这套试卷" : `加载试卷失败：${r.status}`);
      const paper = (await r.json()) as Paper;
      const ex = await explain;
      if (ex) applyExplain(paper, ex);
      paperLoaded.set(id, paper);
      return paper;
    });
    p.catch(() => paperCache.delete(id));
    paperCache.set(id, p);
  }
  return paperCache.get(id)!;
}

export function allQuestions(paper: Paper): Question[] {
  return paper.sections.flatMap((s) => s.groups.flatMap((g) => g.questions));
}

export function choiceQuestions(paper: Paper): Question[] {
  return allQuestions(paper).filter((q) => q.options?.length && q.answer);
}

/** 一个部分在原卷上的起点：部分标题，没有就用第一个题组或第一道题 */
function sectionStart(s: Section) {
  const a = s.anchor ?? s.groups[0]?.anchor;
  if (a) return { page: a.page, y: a.box[1] };
  const q = s.groups.flatMap((g) => g.questions).find((x) => x.page && x.box);
  return q ? { page: q.page!, y: q.box![1] } : null;
}

/** 专项训练截取的原卷范围：从这个部分的标题到下一部分的标题之前。
 *  last 为 null 表示到最后一页；top、bottom 是首页和末页上截取的位置（PDF 点），bottom 为 null 表示到页底 */
export interface SectionRange {
  first: number;
  top: number;
  last: number | null;
  bottom: number | null;
}

export function sectionRange(paper: Paper, sectionId: string): SectionRange | null {
  const i = paper.sections.findIndex((s) => s.id === sectionId);
  const start = i >= 0 ? sectionStart(paper.sections[i]) : null;
  if (!start) return null;
  const next = paper.sections.slice(i + 1).map(sectionStart).find((x) => x && (x.page > start.page || (x.page === start.page && x.y > start.y)));
  const range: SectionRange = { first: start.page, top: Math.max(0, start.y - 12), last: null, bottom: null };
  if (next) {
    // 下一部分从页顶开始，这一部分就到上一页为止
    if (next.y < 100 && next.page > start.page) range.last = next.page - 1;
    else {
      range.last = next.page;
      range.bottom = next.y - 6;
    }
  }
  return range;
}

const tokens = (s: string) => s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];

/**
 * 听力定位：解析里只有定位句原文、还没有逐字稿行号时，在逐字稿里找最像的一行。
 * 逐字稿一行常常只是半句，所以从每一行起往后拼到和定位句差不多长再比（词袋的 Dice 系数）；先找题组对应的那段录音，像得不够再找全部
 */
export function findAudioLine(audio: PaperAudio, quote: string, segment?: string): { segment: string; index: number } | null {
  const want = tokens(quote);
  if (!want.length) return null;
  const search = (segs: AudioSegment[]) => {
    let best: { segment: string; index: number; score: number } | null = null;
    for (const s of segs)
      for (let i = 0; i < s.lines.length; i++) {
        const got: string[] = [];
        for (let j = i; j < s.lines.length && got.length < want.length; j++) got.push(...tokens(s.lines[j].text));
        const bag = new Map<string, number>();
        for (const t of got) bag.set(t, (bag.get(t) ?? 0) + 1);
        let hit = 0;
        for (const t of want) {
          const n = bag.get(t) ?? 0;
          if (n) {
            hit++;
            bag.set(t, n - 1);
          }
        }
        const score = (2 * hit) / (want.length + got.length);
        if (!best || score > best.score) best = { segment: s.id, index: i, score };
      }
    return best && best.score >= 0.45 ? best : null;
  };
  const hinted = segment ? search(audio.segments.filter((s) => s.id === segment)) : null;
  const found = hinted ?? search(audio.segments);
  return found && { segment: found.segment, index: found.index };
}

export function examName(id: ExamId) {
  return EXAMS.find((e) => e.id === id)?.name ?? id;
}
