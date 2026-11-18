import type { PDFDocument, PDFImage, PDFPage } from "pdf-lib";
import type { MarkRow } from "./db";
import { colorValue, isMarker, MARKER_SIZE, NOTE_COLOR, strokeOutline, underlineY } from "./marks";
import { EXAMS, type Paper, type PdfWordsPage } from "./papers";

/*
 * 导出带笔记的 PDF：用 pdf-lib 在原卷上画。手写和荧光笔是矢量路径，高亮用正片叠底（和卷面上看到的一样），
 * 便签画成页边的小黄块；可以在最后加一页答题情况。
 * 中文（便签内容、答题卡）用画布画成图片贴上去，不用往 PDF 里嵌几兆的中文字体。
 * pdf-lib 有几百 KB，只在导出时才加载。
 */
type PdfLib = typeof import("pdf-lib");
let L: PdfLib;

/** 卷子的短名：2024年12月四级第2套 / 2019年考研英语一 */
export function shortTitle(paper: Pick<Paper, "exam" | "year" | "month" | "set" | "sample" | "title">) {
  const exam = EXAMS.find((e) => e.id === paper.exam);
  if (!exam) return paper.title;
  if (paper.exam === "cet4" || paper.exam === "cet6") return `${paper.year}年${paper.month ? `${paper.month}月` : ""}${exam.short}${paper.set ? `第${paper.set}套` : ""}${paper.sample ? "样卷" : ""}`;
  return `${paper.year}年考研${exam.short}`;
}

export const notesFileName = (paper: Paper) => `${shortTitle(paper)}-笔记.pdf`;

export interface SheetRow {
  number: number;
  mine?: string;
  answer?: string;
}

export interface AnswerSheet {
  rows: SheetRow[];
  score: number;
  total: number;
}

const hex = (v: string) => {
  const n = parseInt(v.slice(1), 16);
  return L.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const SANS = `system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
const SERIF = `"Source Serif 4", "Times New Roman", serif`;

function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error("画布导出失败"))), "image/png"),
  );
}

/** 按宽度折行（中文按字，英文尽量按词） */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para.match(/[A-Za-z0-9'’-]+|\s+|./gu) ?? []) {
      if (ctx.measureText(line + ch).width <= width || !line) line += ch;
      else {
        lines.push(line.trimEnd());
        line = ch.trimStart();
      }
    }
    lines.push(line);
  }
  return lines;
}

/** 便签小黄块：画布画好再贴进 PDF；宽度、字号都是 PDF 点 */
async function noteCard(doc: PDFDocument, text: string, widthPt: number) {
  const k = 4; // 每个 PDF 点画 4 个像素，打印也清楚
  const font = 7;
  const lh = 9.5;
  const pad = 4;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `${font * k}px ${SANS}`;
  let lines = wrap(ctx, text.trim(), (widthPt - pad * 2 - 2) * k);
  if (lines.length > 14) lines = [...lines.slice(0, 13), `${lines[13].slice(0, -1)}…`];
  const h = lines.length * lh + pad * 2;
  c.width = widthPt * k;
  c.height = Math.ceil(h * k);
  ctx.fillStyle = "#fff6cf";
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 2 * k);
  ctx.fill();
  ctx.fillStyle = NOTE_COLOR;
  ctx.fillRect(0, 0, 2 * k, c.height);
  ctx.fillStyle = "#3d4654";
  ctx.font = `${font * k}px ${SANS}`;
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, (pad + 2) * k, (pad + i * lh + 1) * k));
  const image = await doc.embedPng(await canvasPng(c));
  c.width = c.height = 0;
  return { image, h };
}

/** 答题情况页：题号、我的答案、正确答案，三栏排开 */
async function sheetPage(doc: PDFDocument, paper: Paper, sheet: AnswerSheet, w: number, h: number): Promise<PDFImage> {
  const k = 2.5;
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const ink = "#1c2330";
  const muted = "#6b7482";
  const red = "#d93025";
  const blue = "#1677ff";
  const m = 56;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  ctx.font = `600 20px ${SANS}`;
  ctx.fillText("答题情况", m, m + 14);
  ctx.font = `13px ${SANS}`;
  ctx.fillStyle = muted;
  ctx.fillText(shortTitle(paper), m, m + 36);
  ctx.textAlign = "right";
  ctx.fillStyle = ink;
  ctx.font = `600 30px ${SERIF}`;
  ctx.fillText(`${sheet.score}`, w - m - 34, m + 22);
  ctx.font = `16px ${SERIF}`;
  ctx.fillStyle = muted;
  ctx.fillText(`/ ${sheet.total}`, w - m, m + 22);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#dde1e7";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(m, m + 52);
  ctx.lineTo(w - m, m + 52);
  ctx.stroke();

  const cols = 3;
  const top = m + 84;
  const rowH = 22;
  const perCol = Math.max(1, Math.ceil(sheet.rows.length / cols));
  const colW = (w - m * 2) / cols;
  for (let col = 0; col < cols; col++) {
    const x = m + col * colW;
    ctx.font = `12px ${SANS}`;
    ctx.fillStyle = muted;
    ctx.fillText("题号", x, top - 10);
    ctx.fillText("我的", x + 44, top - 10);
    ctx.fillText("正确", x + 92, top - 10);
  }
  sheet.rows.forEach((r, i) => {
    const col = Math.floor(i / perCol);
    const x = m + col * colW;
    const y = top + (i % perCol) * rowH + 12;
    const right = !!r.mine && r.mine === r.answer;
    if (i % perCol) {
      ctx.strokeStyle = "#eceef2";
      ctx.beginPath();
      ctx.moveTo(x, y - 15);
      ctx.lineTo(x + colW - 16, y - 15);
      ctx.stroke();
    }
    ctx.font = `14px ${SERIF}`;
    ctx.fillStyle = ink;
    ctx.fillText(String(r.number), x, y);
    ctx.font = `600 14px ${SERIF}`;
    ctx.fillStyle = !r.mine ? muted : right ? ink : red;
    ctx.fillText(r.mine ?? "—", x + 44, y);
    ctx.fillStyle = right ? muted : blue;
    ctx.fillText(r.answer ?? "", x + 92, y);
  });
  const image = await doc.embedPng(await canvasPng(c));
  c.width = c.height = 0;
  return image;
}

/** 一页上的笔记画进 PDF。PDF 的原点在左下角，笔记的原点在左上角 */
async function drawMarks(doc: PDFDocument, page: PDFPage, data: PdfWordsPage, marks: MarkRow[]) {
  const box = page.getCropBox();
  const k = box.width / data.width;
  const X = (x: number) => box.x + x * k;
  const Y = (y: number) => box.y + box.height - y * k;
  const at = { x: box.x, y: box.y + box.height, scale: k };
  const order = { highlight: 0, underline: 1, pen: 2, note: 3 } as const;
  for (const m of [...marks].sort((a, b) => order[a.kind] - order[b.kind])) {
    const color = hex(colorValue(m.color));
    if (m.kind === "highlight" && isMarker(m)) {
      const pts = m.points!;
      const size = m.size ?? MARKER_SIZE;
      if (m.shape === "line")
        page.drawLine({ start: { x: X(pts[0][0]), y: Y(pts[0][1]) }, end: { x: X(pts[1][0]), y: Y(pts[1][1]) }, thickness: size * k, color, lineCap: L.LineCapStyle.Butt, blendMode: L.BlendMode.Multiply });
      else page.drawSvgPath(`M${pts.map((p) => `${p[0]} ${p[1]}`).join(" L")}`, { ...at, borderColor: color, borderWidth: size, borderLineCap: L.LineCapStyle.Round, blendMode: L.BlendMode.Multiply });
    } else if (m.kind === "highlight") {
      for (const r of m.rects ?? []) page.drawRectangle({ x: X(r[0] - 1), y: Y(r[3] + 0.5), width: (r[2] - r[0] + 2) * k, height: (r[3] - r[1] + 1) * k, color, blendMode: L.BlendMode.Multiply });
    } else if (m.kind === "underline") {
      for (const r of m.rects ?? []) page.drawRectangle({ x: X(r[0]), y: Y(underlineY(r) + 1.1), width: (r[2] - r[0]) * k, height: 1.1 * k, color });
    } else if (m.kind === "pen") {
      const pts = m.points ?? [];
      if (m.shape === "line" && pts.length >= 2) {
        page.drawLine({ start: { x: X(pts[0][0]), y: Y(pts[0][1]) }, end: { x: X(pts[1][0]), y: Y(pts[1][1]) }, thickness: (m.size ?? 1.8) * 0.9 * k, color, lineCap: L.LineCapStyle.Round });
      } else {
        const outline = strokeOutline(pts, m.size ?? 1.8, !!m.pressure);
        if (outline.length > 2) page.drawSvgPath(`M${outline.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L")} Z`, { ...at, color, borderWidth: 0 });
      }
    }
  }

  // 便签：原处一个小黄块，内容写在页边（页边太窄就贴在页面右边上）
  const notes = marks.filter((m) => m.kind === "note" && m.at && m.note?.trim()).sort((a, b) => a.at![1] - b.at![1]);
  if (!notes.length) return;
  const xs = data.w.map((w) => w[3]).sort((a, b) => a - b);
  const textRight = xs.length ? xs[Math.floor(xs.length * 0.98)] : data.width * 0.9;
  const textLeft = data.w.length ? Math.min(...data.w.map((w) => w[1])) : data.width * 0.1;
  const right = data.width - textRight;
  const side = right >= 60 ? { x: textRight + 6, w: Math.min(right - 12, 150) } : textLeft >= 60 ? { x: 6, w: Math.min(textLeft - 12, 150) } : { x: data.width - 134, w: 128 };
  let bottom = 0;
  for (const n of notes) {
    const [nx, ny] = n.at!;
    page.drawRectangle({ x: X(nx - 4.5), y: Y(ny + 4.5), width: 9 * k, height: 9 * k, color: hex(NOTE_COLOR) });
    const card = await noteCard(doc, n.note!, side.w);
    let y = Math.max(ny - 6, bottom + 3);
    y = Math.min(y, data.height - card.h - 4);
    bottom = y + card.h;
    page.drawImage(card.image, { x: X(side.x), y: Y(y + card.h), width: side.w * k, height: card.h * k });
  }
}

/**
 * 在原卷 PDF 上画出所有笔记，返回新 PDF 的字节。onProgress(已完成, 总数) 用来画进度条
 */
export async function exportNotesPdf({
  paper,
  pages,
  marks,
  sheet,
  onProgress,
}: {
  paper: Paper;
  pages: PdfWordsPage[];
  marks: MarkRow[];
  sheet?: AnswerSheet | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<Uint8Array> {
  L ??= await import("pdf-lib");
  const src = await fetch(paper.pdf.src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`原卷下载失败：${r.status}`))));
  const doc = await L.PDFDocument.load(src, { ignoreEncryption: true });
  const byPage = new Map<number, MarkRow[]>();
  for (const m of marks) (byPage.get(m.page) ?? byPage.set(m.page, []).get(m.page)!).push(m);
  const todo = [...byPage.keys()].filter((n) => n >= 1 && n <= doc.getPageCount() && pages[n - 1]).sort((a, b) => a - b);
  const total = todo.length + (sheet ? 1 : 0) + 1;
  let done = 0;
  onProgress?.(done, total);
  for (const n of todo) {
    await drawMarks(doc, doc.getPage(n - 1), pages[n - 1], byPage.get(n)!);
    onProgress?.(++done, total);
    await new Promise((r) => setTimeout(r)); // 让进度条有机会画出来
  }
  if (sheet) {
    const first = doc.getPage(0);
    const { width, height } = first.getSize();
    const image = await sheetPage(doc, paper, sheet, width, height);
    doc.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    onProgress?.(++done, total);
  }
  doc.setTitle(`${shortTitle(paper)} 笔记`);
  doc.setProducer("英语之道");
  const bytes = await doc.save();
  onProgress?.(total, total);
  return bytes;
}

/** 平板上能分享文件就弹分享面板（存到文件、发给别人），其余直接下载。带触屏的笔记本主指针是鼠标，算桌面 */
export const canShareFile = () => typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches && typeof navigator.canShare === "function";

export async function deliverPdf(bytes: Uint8Array, name: string, share: boolean): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  if (share) {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return "shared";
      } catch (e) {
        if ((e as Error).name === "AbortError") return "cancelled";
        // 不让分享（比如超时没了点击授权）就退回下载
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}
