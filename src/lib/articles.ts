/** 外刊：每天由 GitHub Actions 抓 VOA Learning English 和 The Conversation，放在 /articles-data/ 下 */
export const ARTICLES_BASE = "/articles-data/";

export type ArticlePara = { k: "p" | "h" | "q" | "fine"; t: string };
export interface ArticleMeta {
  id: string;
  source: "voa" | "tc";
  title: string;
  summary: string;
  url: string;
  published: string;
  topics: string[];
  image?: string | null;
  author: string;
  license: string;
  pixel?: string | null;
  level: "四级" | "六级" | "考研";
  words: number;
  minutes: number;
  audio?: string;
}
export interface Article extends ArticleMeta {
  paras: ArticlePara[];
  glossary?: { w: string; d: string }[];
  keywords?: string[];
}

export const SOURCE_NAMES: Record<ArticleMeta["source"], string> = { voa: "VOA Learning English", tc: "The Conversation" };

async function json<T>(path: string): Promise<T> {
  const r = await fetch(ARTICLES_BASE + path);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}
export const loadArticleIndex = () => json<ArticleMeta[]>("index.json");
export const loadArticle = (id: string) => json<Article>(`${encodeURIComponent(id)}.json`);
export const articleText = (a: Article) => a.paras.filter((p) => p.k !== "fine").map((p) => p.t).join("\n");
