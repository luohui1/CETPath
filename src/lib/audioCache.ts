/**
 * 听力录音提前下载：进了听力卷子、原卷 PDF 存好之后，在后台分段把整份录音下完，存进 Service Worker 的 "listening" 缓存。
 * 存好以后 <audio> 的分段请求由 Service Worker 从缓存切（见 vite.config.ts），慢网、离线都能放、能跳句。
 * 页面自己按 1MB 一段取、拼好再存，不发整份请求：整份请求经 Service Worker 转发后中止不了，离开这套卷还在占带宽（和原卷 PDF 一样）。
 * 缓存只留最近用过的 6 套：访问时间记在 localStorage，存完一套就把最久没用的删掉。
 */
export const AUDIO_CACHE = "listening";
export const AUDIO_KEEP = 6;
const ACCESS_KEY = "yz.audioAccess";
const CHUNK = 1024 * 1024;

type Access = Record<string, number>;

function readAccess(): Access {
  try {
    const v = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function writeAccess(a: Access) {
  try {
    localStorage.setItem(ACCESS_KEY, JSON.stringify(a));
  } catch {
    /* 存不了就按缓存里的顺序淘汰 */
  }
}

/** 记一下这份录音刚用过（进卷子、放录音时） */
export function touchAudio(url: string) {
  const a = readAccess();
  a[url] = Date.now();
  writeAccess(a);
}

/** 缓存里的录音超过 6 套，删最久没用的；keep 是不能删的（正在存的这套） */
export async function pruneAudio(keep: string, limit = AUDIO_KEEP) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(AUDIO_CACHE);
  const urls = (await cache.keys()).map((r) => new URL(r.url).pathname);
  if (urls.length <= limit) return;
  const a = readAccess();
  const keepPath = new URL(keep, location.href).pathname;
  const old = urls.filter((u) => u !== keepPath).sort((x, y) => (a[x] ?? 0) - (a[y] ?? 0));
  for (const u of old.slice(0, urls.length - limit)) {
    await cache.delete(u);
    delete a[u];
  }
  writeAccess(a);
}

/**
 * 把整份录音存进缓存。已经在缓存里的直接跳过（只更新访问时间）；离线、服务器不支持分段、中途中止都静默放弃。
 * onProgress 收到 0–1；存完收到 1。返回是否已经在缓存里（或刚存好）
 */
export async function prefetchAudio(url: string, signal: AbortSignal, onProgress: (p: number) => void): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const path = new URL(url, location.href).pathname;
  const cache = await caches.open(AUDIO_CACHE);
  if (await cache.match(url)) {
    const a = readAccess();
    a[path] = Date.now();
    writeAccess(a);
    return true;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const parts: Uint8Array[] = [];
  let loaded = 0;
  let total = 0;
  for (let at = 0; !total || at < total; at += CHUNK) {
    if (signal.aborted) return false;
    const r = await fetch(url, { headers: { Range: `bytes=${at}-${at + CHUNK - 1}` }, signal, priority: "low" } as RequestInit);
    if (r.status !== 206 || !r.body) return false;
    if (!total) {
      total = Number(r.headers.get("content-range")?.split("/")[1]);
      if (!total) return false;
    }
    // 一段里也边读边报进度：慢网下 1MB 要二十多秒，不然进度一直不动
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress(Math.min(0.99, loaded / total));
    }
  }
  if (signal.aborted || loaded !== total) return false;
  await cache.put(url, new Response(new Blob(parts as BlobPart[], { type: "audio/mpeg" }), { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(total) } }));
  const a = readAccess();
  a[path] = Date.now();
  writeAccess(a);
  await pruneAudio(url).catch(() => {});
  onProgress(1);
  return true;
}
