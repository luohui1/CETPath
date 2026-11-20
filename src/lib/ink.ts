import { colorValue, strokeOutline } from "./marks";
import type { MarkRow } from "./db";
import type { PdfWordsPage } from "./papers";
import { agentHeaders } from "./agent";

/**
 * 手写笔记识别：把同一页里挨得近的笔迹归成一块，每块单独画成白底图片，交给能看图的模型转写成文字。
 * 结果按“这块里有哪些笔迹、最后改动时间”缓存在本机，笔迹没变就不再识别。
 */
type Box = [number, number, number, number];
const CACHE_KEY = "yz-ink-cache";
const Z = 2.5; // 渲染倍数
const MAX_SIDE = 900;

const boxOf = (m: MarkRow): Box => {
  const xs = m.points!.map((p) => p[0]);
  const ys = m.points!.map((p) => p[1]);
  const pad = (m.size ?? 2) + 2;
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
};
const near = (a: Box, b: Box, gap: number) =>
  a[0] - gap < b[2] &&
  b[0] - gap < a[2] &&
  a[1] - gap < b[3] &&
  b[1] - gap < a[3];

/** 同一页的笔迹按距离聚成块（并查集） */
function clusters(pens: MarkRow[]): { marks: MarkRow[]; box: Box }[] {
  const boxes = pens.map(boxOf);
  const parent = pens.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < pens.length; i++)
    for (let j = i + 1; j < pens.length; j++)
      if (near(boxes[i], boxes[j], 18)) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  pens.forEach((_, i) =>
    groups.set(find(i), [...(groups.get(find(i)) ?? []), i]),
  );
  return [...groups.values()].map((ids) => ({
    marks: ids.map((i) => pens[i]),
    box: [
      Math.min(...ids.map((i) => boxes[i][0])),
      Math.min(...ids.map((i) => boxes[i][1])),
      Math.max(...ids.map((i) => boxes[i][2])),
      Math.max(...ids.map((i) => boxes[i][3])),
    ],
  }));
}

function render(marks: MarkRow[], box: Box): string {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const z = Math.min(Z, MAX_SIDE / Math.max(w, h, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * z));
  c.height = Math.max(1, Math.ceil(h * z));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(z, z);
  ctx.translate(-box[0], -box[1]);
  for (const m of marks) {
    const pts = strokeOutline(m.points!, m.size ?? 2, !!m.pressure);
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = colorValue(m.color);
    ctx.fill();
  }
  return c.toDataURL("image/png");
}

const loadCache = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
};

/** 这套卷所有手写笔记转成的文字（按页），给 Agent 当上下文；没有手写就返回空串 */
export async function inkNotes(
  marks: MarkRow[],
  pages: PdfWordsPage[] | null,
): Promise<string> {
  const pens = marks.filter(
    (m) => m.kind === "pen" && (m.points?.length ?? 0) > 1,
  );
  if (!pens.length) return "";
  const cache = loadCache();
  const byPage = new Map<number, MarkRow[]>();
  for (const m of pens) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m]);
  const jobs: { page: number; key: string; box: Box; marks: MarkRow[] }[] = [];
  for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0]))
    for (const g of clusters(list)
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
      .slice(0, 20))
      jobs.push({
        page,
        box: g.box,
        marks: g.marks,
        key: g.marks
          .map((m) => `${m.id}@${m.updatedAt}`)
          .sort()
          .join(","),
      });
  const todo = jobs.filter((j) => !(j.key in cache)).slice(0, 24);
  // 一块一个请求（每张图几十 KB），最多 4 个同时
  for (let i = 0; i < todo.length; i += 4)
    await Promise.all(
      todo.slice(i, i + 4).map(async (j) => {
        const data = pages?.[j.page - 1];
        const words = data
          ? data.w
              .filter((w) => near([w[1], w[2], w[3], w[4]], j.box, 12))
              .map((w) => w[0])
              .join(" ")
              .slice(0, 300)
          : "";
        try {
          const r = await fetch("/api/agent/ink", {
            method: "POST",
            headers: agentHeaders(true),
            body: JSON.stringify({ png: render(j.marks, j.box), near: words }),
          });
          if (r.ok)
            cache[j.key] = (
              ((await r.json()) as { text?: string }).text ?? ""
            ).trim();
        } catch {
          /* 识别失败这次就不带，下次再试 */
        }
      }),
    );
  // 只留现在还在的笔迹的结果
  const keep: Record<string, string> = {};
  for (const j of jobs) if (j.key in cache) keep[j.key] = cache[j.key];
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ...loadCache(), ...keep }));
  return jobs
    .filter((j) => cache[j.key])
    .map(
      (j) =>
        `第 ${j.page} 页（约在页面 ${Math.round((j.box[1] / (pages?.[j.page - 1]?.height ?? 750)) * 100)}% 高度）：${cache[j.key]}`,
    )
    .join("\n");
}
