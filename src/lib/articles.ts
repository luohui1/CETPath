/** 外刊：每天由 GitHub Actions 抓 VOA Learning English 和英文维基百科，放在 /articles-data/ 下 */
export const ARTICLES_BASE = "/articles-data/";
/** 外刊暂时下线：入口和页面都不显示，代码保留 */
export const ARTICLES_ON = false;

export type ArticlePara = { k: "p" | "h" | "q" | "fine"; t: string };
export interface ArticleMeta {
  id: string;
  source: "voa" | "wiki";
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

/** 生词来源的链接：外刊的生词（paperId 是 article:<id>）回到文章，其余回到卷子 */
export const sourceHref = (paperId: string, query = "") =>
  paperId.startsWith("article:") ? `/articles/${paperId.slice(8)}` : `/paper/${paperId}${query}`;

export const SOURCE_NAMES: Record<ArticleMeta["source"], string> = { voa: "VOA Learning English", wiki: "英文维基百科" };

async function json<T>(path: string): Promise<T> {
  const r = await fetch(ARTICLES_BASE + path);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}
export const loadArticleIndex = () => json<ArticleMeta[]>("index.json");
export const loadArticle = (id: string) => json<Article>(`${encodeURIComponent(id)}.json`);
export const articleText = (a: Article) => a.paras.filter((p) => p.k !== "fine").map((p) => p.t).join("\n");
