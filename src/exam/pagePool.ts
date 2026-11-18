/*
 * 卷面画布池：pdf.js 在主线程上画页面，几页一起画会卡住滚动；每页一张高清画布，9 页扫描卷常驻上百 MB，
 * 平板 Safari 合成时就开始掉帧。所以：
 * - 只有视口附近（上 1 屏、下 2 屏）的页才画，同时最多 MAX_LIVE 张画布，离开就丢掉，换回低清占位图；
 * - 离视口中心最近的先画，最多两页同时在画；画着的页滚出了视口、而视口里还有没画的页，就先停下它；
 * - 缩略图栏的小图排在所有要画的页之后；
 * - 快速滚动时主线程上不画：新页照样开始（worker 先把扫描图解好），pdf.js 每一段绘制都等滚慢了或停下 0.15 秒再画（快速滚过时允许糊）。
 * 每页画完顺手存一张低清小图（占位、缩略图栏共用）。
 */

export interface PageSlot {
  el: HTMLElement; // 这一页（量离视口中心多远）
  root: HTMLElement; // 画布滚动容器
  near: boolean; // 在视口上 1 屏、下 2 屏以内
  live: boolean; // 现在有清楚的画布
  stale: () => boolean; // 要画：没有画布，或画布的缩放不是现在的
  draw: () => Promise<void>;
  cancel: () => void; // 停下正在画的
  release: () => void; // 丢掉画布，露出占位
}

const MAX_LIVE = 4;
// 同时在画的页：快速滚动时主线程上的绘制都等着，两页一起准备（worker 解图），停下来要显示的那页多半已经解好
const MAX_RUNNING = 2;
const slots = new Set<PageSlot>();
const thumbs: (() => Promise<unknown>)[] = [];
const running = new Set<PageSlot>();
let thumbBusy = false;

/** 离视口中心多远（像素）：页面跨过中线就是 0 */
function distance(s: PageSlot, v = s.root.getBoundingClientRect()) {
  const r = s.el.getBoundingClientRect();
  const c = v.top + v.height / 2;
  const cx = v.left + v.width / 2;
  const dy = r.bottom < c ? c - r.bottom : r.top > c ? r.top - c : 0;
  // 双页视图同一排的两页：横向近的稍微靠前
  const dx = r.right < cx ? cx - r.right : r.left > cx ? r.left - cx : 0;
  return dy + dx * 0.1;
}

const inView = (s: PageSlot) => {
  const r = s.el.getBoundingClientRect();
  const v = s.root.getBoundingClientRect();
  return r.bottom > v.top && r.top < v.bottom;
};

export function pump() {
  // 在画的页已经不在视口里，而视口里有页还没画：先停下它（它还在附近，过后会重新排上）
  if (running.size) {
    const waiting = [...slots].some((s) => !running.has(s) && s.near && s.stale() && inView(s));
    if (waiting) for (const r of running) if (!inView(r)) r.cancel();
  }
  if (thumbBusy || running.size >= MAX_RUNNING) return;
  // 先把位置都量好再动 DOM（边量边改会逼浏览器反复排版）
  const views = new Map<HTMLElement, DOMRect>();
  const dist = new Map<PageSlot, number>();
  for (const s of slots) {
    if (!s.live && !running.has(s) && !(s.near && s.stale())) continue;
    if (!views.has(s.root)) views.set(s.root, s.root.getBoundingClientRect());
    dist.set(s, distance(s, views.get(s.root)));
  }
  while (running.size < MAX_RUNNING) {
    let best: PageSlot | null = null;
    let bd = Infinity;
    for (const [s, d] of dist) if (s.near && s.stale() && !running.has(s) && d < bd) [best, bd] = [s, d];
    if (!best) break;
    // 画布数封顶（在画的也算一张）：先丢掉离得最远的；剩下的都比这一页近，就先不画
    const held = [...dist.keys()].filter((s) => (s.live || running.has(s)) && s !== best).sort((a, b) => dist.get(b)! - dist.get(a)!);
    let room = true;
    while (held.length >= MAX_LIVE) {
      const far = held.shift()!;
      if (dist.get(far)! <= bd || running.has(far)) {
        room = false;
        break;
      }
      far.release();
    }
    if (!room) break;
    const s = best;
    running.add(s);
    s.draw()
      .catch(() => {}) // 取消会抛错，忽略
      .finally(() => {
        running.delete(s);
        queued = queued.filter((q) => q.slot !== s);
        if (drawing === s) drawing = null;
        resume();
        pump();
      });
  }
  if (running.size || fast()) return;
  // 缩略图栏的小图：页面都画完、也没在快速滚动时再画
  const job = thumbs.shift();
  if (job) {
    thumbBusy = true;
    job()
      .catch(() => {})
      .finally(() => {
        thumbBusy = false;
        pump();
      });
  }
}

/* 快速滚动：最近 QUIET_MS 里滚得比 FAST_PX 每秒快。速度按最近 QUIET_MS 里的位移算（逐帧算抖得厉害）；
 * 刚开始滚的第一下还不知道多快，先当快的 */
const FAST_PX = 600;
const QUIET_MS = 150;
let lastScroll = { t: 0, y: 0, v: 0 };
let trail: { t: number; y: number }[] = [];
let lastRoot: HTMLElement | null = null;
let queued: { slot: PageSlot | null; cont: () => void }[] = [];
let drawing: PageSlot | null = null;
let quietTimer = 0;
const fast = () => performance.now() - lastScroll.t < QUIET_MS && lastScroll.v > FAST_PX;
function onScrolled(root: HTMLElement) {
  const y = root.scrollTop;
  const t = performance.now();
  if (root !== lastRoot || t - lastScroll.t >= QUIET_MS) trail = [];
  lastRoot = root;
  trail.push({ t, y });
  while (trail.length > 2 && t - trail[1].t >= QUIET_MS) trail.shift();
  const first = trail[0];
  lastScroll = { t, y, v: trail.length > 1 ? (Math.abs(y - first.y) / Math.max(t - first.t, 8)) * 1000 : Infinity };
  clearTimeout(quietTimer);
  quietTimer = window.setTimeout(quiet, QUIET_MS + 10);
  if (!fast()) resume();
}
/** 一阵没收到滚动事件：主线程刚才可能被占着，事件还没来；位置还在变就是还在滚 */
function quiet() {
  if (lastRoot && Math.abs(lastRoot.scrollTop - lastScroll.y) > 2) onScrolled(lastRoot);
  else resume();
}
/** 主线程上同一时间只让一页画：正在画的那页接着画，没有就让离视口中心最近的那页先画；缩略图最后 */
function resume() {
  if (fast()) return;
  if (!drawing && queued.length) {
    let best: (typeof queued)[number] | null = null;
    let bd = Infinity;
    for (const q of queued) {
      const d = q.slot ? distance(q.slot) : Infinity;
      if (!best || d < bd) [best, bd] = [q, d];
    }
    if (best?.slot) drawing = best.slot;
  }
  const go = queued.filter((q) => (drawing ? q.slot === drawing : !q.slot));
  queued = queued.filter((q) => !go.includes(q));
  for (const q of go) q.cont();
  pump();
}

/** pdf.js 每画完一段问一下能不能接着画：快速滚动时等等；别的页正在画也等等。slot 为空是缩略图 */
export function gate(slot: PageSlot | null, cont: () => void) {
  if (!fast() && (slot ? !drawing || drawing === slot : !drawing && !running.size)) {
    if (slot) drawing = slot;
    cont();
  } else queued.push({ slot, cont });
}

// 滚动时看一眼：正在画的是不是该让位、该画的是不是轮到了（每帧最多一次）
const watched = new Map<HTMLElement, { n: number; off: () => void }>();
function watch(root: HTMLElement) {
  const w = watched.get(root);
  if (w) {
    w.n++;
    return;
  }
  let raf = 0;
  // 滚动位置在下一帧里读（滚动事件里读会逼浏览器先排版）
  const onScroll = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        onScrolled(root);
        pump();
      });
  };
  root.addEventListener("scroll", onScroll, { passive: true });
  watched.set(root, {
    n: 1,
    off: () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
    },
  });
}
function unwatch(root: HTMLElement) {
  const w = watched.get(root);
  if (!w || --w.n > 0) return;
  w.off();
  watched.delete(root);
}

/** 登记一页：进出附近由 IntersectionObserver 告诉画布池；返回注销 */
export function addSlot(s: PageSlot) {
  slots.add(s);
  watch(s.root);
  const io = new IntersectionObserver(
    ([e]) => {
      s.near = e.isIntersecting;
      if (!s.near) s.release();
      pump();
    },
    { root: s.root, rootMargin: "100% 0px 200% 0px" },
  );
  io.observe(s.el);
  return () => {
    io.disconnect();
    slots.delete(s);
    unwatch(s.root);
    s.release();
    running.delete(s);
    queued = queued.filter((q) => q.slot !== s);
    if (drawing === s) drawing = null;
    resume();
  };
}

/** 缩略图栏的小图：排在所有要画的页之后 */
export function queueThumb<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    thumbs.push(() => job().then(resolve, (e) => reject(e)));
    pump();
  });
}

/* 低清小图（每页画完存一张；缩略图栏自己画的也存在这里），key = PDF 指纹#页码 */
const thumbCache = new Map<string, string>();
const thumbWatch = new Map<string, Set<(url: string) => void>>();
export const thumbKey = (fingerprint: string, page: number) => `${fingerprint}#${page}`;
export const getThumb = (key: string) => thumbCache.get(key);
export function setThumb(key: string, url: string) {
  thumbCache.set(key, url);
  for (const f of thumbWatch.get(key) ?? []) f(url);
}
export function onThumb(key: string, f: (url: string) => void) {
  if (!thumbWatch.has(key)) thumbWatch.set(key, new Set());
  thumbWatch.get(key)!.add(f);
  return () => {
    thumbWatch.get(key)?.delete(f);
  };
}

/** 从画好的画布缩一张宽 THUMB_W 的小图存起来（toBlob 异步编码，不占主线程） */
const THUMB_W = 320;
export function saveThumb(key: string, from: HTMLCanvasElement) {
  if (thumbCache.has(key) || !from.width) return;
  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = Math.round((from.height / from.width) * THUMB_W);
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(from, 0, 0, c.width, c.height);
  c.toBlob(
    (b) => {
      if (b && !thumbCache.has(key)) setThumb(key, URL.createObjectURL(b));
      c.width = c.height = 0;
    },
    "image/jpeg",
    0.8,
  );
}
