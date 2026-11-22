import { db, type VocabSource } from "./db";
import { findTrans, loadTrans } from "./trans";
import { agentEnabled, agentHeaders } from "./agent";

const pending = new Map<string, Promise<string | null>>();

async function translate(sentence: string): Promise<string | null> {
  const r = await fetch("/api/agent/sent", {
    method: "POST",
    headers: agentHeaders(true),
    body: JSON.stringify({ sentence }),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { zh?: string };
  return d.zh?.trim() || null;
}

/** 生词出处句的译文：先找这套卷的译文层，没有再让模型翻一句，翻好的存进生词本，下次直接用 */
export function sourceZh(word: string, s: VocabSource): Promise<string | null> {
  if (s.zh) return Promise.resolve(s.zh);
  const key = `${s.paperId}|${s.sentence}`;
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const local = findTrans(await loadTrans(s.paperId), s.sentence);
      if (local) return local;
      if (!(await agentEnabled())) return null;
      const zh = await translate(s.sentence);
      if (zh)
        await db.transaction("rw", db.vocab, async () => {
          const it = await db.vocab.get(word);
          if (!it) return;
          it.sources = it.sources.map((x) =>
            x.paperId === s.paperId && x.sentence === s.sentence ? { ...x, zh } : x,
          );
          await db.vocab.put(it);
        });
      return zh;
    })();
    p.then(
      (zh) => zh || pending.delete(key),
      () => pending.delete(key),
    );
    pending.set(key, p);
  }
  return p;
}
