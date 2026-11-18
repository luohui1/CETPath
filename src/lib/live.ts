import { useEffect, useReducer } from "react";
import { liveQuery } from "dexie";

/*
 * 切页时页面会重新挂载，useLiveQuery 第一帧总是 undefined，页面就会先空一下再长出来；
 * 查询结果回来后又是一个新数组，整页再重画一遍。
 * 这里记住每个查询上一次的结果：重新挂载时先用它画出完整页面；
 * 订阅后第一次拿到的结果和缓存一样就不重画，之后数据库真有变化才更新。
 */
const cache = new Map<string, unknown>();

const cacheId = (key: string, deps: unknown[]) => (deps.length ? `${key}:${JSON.stringify(deps)}` : key);

/** 和 useLiveQuery 一样，只是重新挂载时先返回上一次的结果；key 在全应用里要唯一，同一个 key 必须是同一个查询 */
export function useCachedLiveQuery<T>(key: string, querier: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const id = cacheId(key, deps);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let first = true;
    const sub = liveQuery(querier).subscribe({
      next: (value) => {
        const same = first && cache.has(id) && JSON.stringify(cache.get(id)) === JSON.stringify(value);
        first = false;
        if (same) return;
        cache.set(id, value);
        rerender();
      },
      error: (e) => console.error(`查询 ${id} 出错`, e),
    });
    return () => sub.unsubscribe();
    // id 已经包含了 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return cache.get(id) as T | undefined;
}

/** 提前跑一次查询放进缓存（应用启动时用），第一次进页面也不用等 */
export async function primeLiveQuery<T>(key: string, querier: () => Promise<T> | T, deps: unknown[] = []) {
  const id = cacheId(key, deps);
  if (!cache.has(id)) cache.set(id, await querier());
}
