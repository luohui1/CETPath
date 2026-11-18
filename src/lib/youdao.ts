import type { DictEntry } from "./dict";

/*
 * 在线兜底查词（2026-11-12，用户同意）：离线词典（ECDICT）查不到的词和短语——in an age of、microplastics、
 * 扫描卷认错的 govemment——去有道词典查。浏览器不能直接跨域请求有道，走站点自己的转发 /yd/?q=…
 * （武汉服务器 nginx：deploy/nginx-cn/yingyu-site.conf；开发时 vite.config.ts 的 server.proxy）。
 * 断网、转发不通、超时都当查不到，不影响离线查词。和有道发音一样，给别人用之前要换成有授权的来源。
 */

export interface OnlineResult {
  entry: DictEntry; // 有道的释义整理成和离线词典一样的条目（加入生词本时存这个）
  typos: { word: string; trans?: string }[]; // 有道猜的正确拼写（扫描卷认错的词）
}

const cache = new Map<string, Promise<OnlineResult | null>>();

type Tr = { tr?: { l?: { i?: (string | { "#text"?: string })[] } }[] };
interface YdJson {
  ec?: { word?: { usphone?: string; ukphone?: string; trs?: Tr[]; "return-phrase"?: { l?: { i?: string } } }[] };
  web_trans?: { "web-translation"?: { key?: string; trans?: { value?: string }[] }[] };
  typos?: { typo?: { word?: string; trans?: string }[] };
}

function parse(q: string, d: YdJson): OnlineResult | null {
  const w = d.ec?.word?.[0];
  const lines: string[] = [];
  for (const t of w?.trs ?? [])
    for (const tr of t.tr ?? [])
      for (const i of tr.l?.i ?? []) {
        const s = (typeof i === "string" ? i : (i["#text"] ?? "")).trim();
        if (s) lines.push(s);
      }
  // 词典释义没有：用网络释义里和查的词一样的那条（短语常常只有这个）
  if (!lines.length) {
    const web = d.web_trans?.["web-translation"]?.find((x) => x.key?.toLowerCase() === q.toLowerCase());
    const vals = (web?.trans ?? []).map((x) => x.value?.trim()).filter((x): x is string => !!x);
    if (vals.length) lines.push(vals.slice(0, 4).join("；"));
  }
  const typos = (d.typos?.typo ?? []).filter((t) => t.word).map((t) => ({ word: t.word!, trans: t.trans }));
  if (!lines.length && !typos.length) return null;
  const phone = w?.usphone || w?.ukphone;
  return {
    entry: { w: w?.["return-phrase"]?.l?.i || q, p: phone || undefined, t: lines.slice(0, 6).join("\n") },
    typos,
  };
}

/** 有道查一个词或短语；查不到、不通、超时返回 null。同一个词只查一次 */
export function lookupOnline(raw: string): Promise<OnlineResult | null> {
  const q = raw.trim().replace(/[’]/g, "'").replace(/\s+/g, " ");
  if (!q || q.length > 60 || (typeof navigator !== "undefined" && navigator.onLine === false)) return Promise.resolve(null);
  const key = q.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    p = fetch(`/yd/?q=${encodeURIComponent(q)}&le=eng`, { signal: ctrl.signal })
      .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? (r.json() as Promise<YdJson>) : null))
      .then((d) => (d ? parse(q, d) : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    // 失败的不缓存，下次再试
    p.then((r) => r === null && cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
