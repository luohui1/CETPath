/*
 * 词根词缀层 public/dict/roots/<首字母>.json（scripts/build_roots.py 从 OpenEtymology 生成，CC BY-SA 4.0）。
 * m：语素拆分（有的词只有词源、m 为空） [写法, 中文含义, 来源注]；e：词源说明；s：同根词 [词, 简义]；b：派生词的原词（unreliable → reliable）
 */
export interface RootInfo {
  m: [string, string, string?][];
  e?: string;
  s?: [string, string][];
  b?: string;
}

const shards = new Map<string, Promise<Record<string, RootInfo>>>();

function shard(s: string) {
  let p = shards.get(s);
  if (!p) {
    p = fetch(`/dict/roots/${s}.json`).then((r) => (r.ok ? (r.json() as Promise<Record<string, RootInfo>>) : {}));
    p.catch(() => shards.delete(s));
    shards.set(s, p);
  }
  return p;
}

/** 查不到、没网返回 null */
export async function getRoots(word: string): Promise<RootInfo | null> {
  const key = word.trim().toLowerCase();
  if (!key || key.includes(" ")) return null;
  const s = key[0] >= "a" && key[0] <= "z" ? key[0] : "_";
  try {
    const r = (await shard(s))[key];
    return r && (r.m?.length || r.e) ? r : null;
  } catch {
    return null;
  }
}
