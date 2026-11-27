import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CACHE, prefetchAudio, touchAudio } from "@/lib/audioCache";

export type ClipStatus = "idle" | "loading" | "playing";

export interface PlayRangeOptions {
  key?: string;
  rate?: number;
  loop?: boolean;
  /** 从区间内部的某个时间点起播（用于进度条点击定位），仍保留区间 [start, end] 作为循环与停止边界 */
  seekAt?: number;
  /** 自动播音若被浏览器首次手势策略拦截，不弹红色报错 */
  silentAutoplayBlock?: boolean;
  onEnded?: () => void;
}

export interface ClipProgress {
  currentTime: number;
  ratio: number;
  start: number;
  end: number;
  key: string | null;
}

interface ActiveRange {
  seq: number;
  start: number;
  end: number;
  loop: boolean;
  key: string | null;
  onEnded?: () => void;
}

/**
 * 工业级区间音频引擎：
 * - 绑定真实 DOM <audio preload="metadata">，配合后台 prefetchAudio 分段写入 "listening" 缓存，不抢 Range 连接；
 * - 使用递增 seqRef + seekingRef 锁，彻底杜绝跨段/回跳时因 seek 未完成被旧 currentTime >= end 误杀静音；
 * - rAF 进度通过订阅回调直接驱动声学条 DOM，不在播放期每秒 60 次触发 React 全树重渲染。
 */
export function useClipAudio(src: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const srcRef = useRef<string | null>(src);
  srcRef.current = src;

  const seqRef = useRef(0);
  const seekingRef = useRef(false);
  const rangeRef = useRef<ActiveRange | null>(null);
  const rafRef = useRef(0);
  const lastArgsRef = useRef<{ start: number; end: number; opts?: PlayRangeOptions } | null>(null);
  const progressSubsRef = useRef<Set<(info: ClipProgress) => void>>(new Set());

  const [status, setStatus] = useState<ClipStatus>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [cachePct, setCachePct] = useState<number | null>(null);

  const statusRef = useRef(status);
  statusRef.current = status;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const emitProgress = useCallback(
    (currentTime: number, ratio: number, start: number, end: number, key: string | null) => {
      const payload: ClipProgress = { currentTime, ratio, start, end, key };
      for (const fn of progressSubsRef.current) fn(payload);
    },
    [],
  );

  const subscribeProgress = useCallback((fn: (info: ClipProgress) => void) => {
    progressSubsRef.current.add(fn);
    return () => {
      progressSubsRef.current.delete(fn);
    };
  }, []);

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const pause = useCallback(() => {
    seqRef.current++;
    stopRaf();
    seekingRef.current = false;
    rangeRef.current = null;
    audioRef.current?.pause();
    setStatus("idle");
    setActiveKey(null);
  }, [stopRaf]);

  const setRate = useCallback((nextRate: number) => {
    setRateState(nextRate);
    rateRef.current = nextRate;
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }, []);

  const setActiveLoop = useCallback((nextLoop: boolean) => {
    if (rangeRef.current) rangeRef.current.loop = nextLoop;
    if (lastArgsRef.current) {
      lastArgsRef.current = {
        ...lastArgsRef.current,
        opts: { ...lastArgsRef.current.opts, loop: nextLoop },
      };
    }
  }, []);

  const checkBoundary = useCallback(() => {
    const el = audioRef.current;
    const r = rangeRef.current;
    if (!el || !r || r.seq !== seqRef.current || seekingRef.current || el.seeking || el.paused) return;

    const t = el.currentTime;
    const dur = Math.max(0.1, r.end - r.start);
    const ratio = Math.max(0, Math.min(1, (t - r.start) / dur));
    emitProgress(t, ratio, r.start, r.end, r.key);

    if (t >= r.start - 0.25 && (t >= r.end || el.ended)) {
      if (r.loop) {
        seekingRef.current = true;
        const releaseSeek = () => {
          seekingRef.current = false;
        };
        const timer = window.setTimeout(releaseSeek, 900);
        const onSeeked = () => {
          clearTimeout(timer);
          releaseSeek();
        };
        el.addEventListener("seeked", onSeeked, { once: true });
        el.currentTime = r.start;
        if (!el.seeking && Math.abs(el.currentTime - r.start) <= 0.05) {
          clearTimeout(timer);
          el.removeEventListener("seeked", onSeeked);
          releaseSeek();
        }
        emitProgress(r.start, 0, r.start, r.end, r.key);
        if (el.paused) void el.play().catch(() => {});
      } else {
        const cb = r.onEnded;
        seqRef.current++;
        rangeRef.current = null;
        stopRaf();
        el.pause();
        setStatus("idle");
        setActiveKey(null);
        emitProgress(r.end, 1, r.start, r.end, null);
        cb?.();
      }
    }
  }, [emitProgress, stopRaf]);

  const startRaf = useCallback(
    (seq: number) => {
      stopRaf();
      const tick = () => {
        if (seq !== seqRef.current) return;
        const el = audioRef.current;
        if (!el || el.paused || !rangeRef.current) return;
        checkBoundary();
        if (seq === seqRef.current && rangeRef.current && !el.paused) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [checkBoundary, stopRaf],
  );

  // 绑定真实 DOM <audio> 元素事件
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onWaiting = () => {
      if (rangeRef.current?.seq === seqRef.current) setStatus("loading");
    };
    const onPlaying = () => {
      if (rangeRef.current?.seq === seqRef.current) {
        setStatus("playing");
        setError(null);
      }
    };
    const onPause = () => {
      if (seekingRef.current) return;
      if (statusRef.current !== "loading") {
        stopRaf();
        setStatus("idle");
      }
    };
    const onTimeUpdate = () => checkBoundary();
    const onError = () => {
      if (seekingRef.current) return;
      if (rangeRef.current?.seq === seqRef.current) {
        stopRaf();
        rangeRef.current = null;
        setStatus("idle");
        setActiveKey(null);
        setError("录音加载受阻，请点击重试");
      }
    };

    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("error", onError);

    return () => {
      stopRaf();
      el.pause();
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("error", onError);
    };
  }, [checkBoundary, stopRaf]);

  // 切卷时复位状态并延迟后台缓存整份录音（避免与首个点播 Range 抢带宽）
  useEffect(() => {
    seqRef.current++;
    stopRaf();
    seekingRef.current = false;
    rangeRef.current = null;
    lastArgsRef.current = null;
    setStatus("idle");
    setActiveKey(null);
    setError(null);

    const el = audioRef.current;
    if (el) {
      el.pause();
      if (!src) {
        el.removeAttribute("src");
        el.load();
      }
    }

    if (!src) {
      setCachePct(null);
      return;
    }

    touchAudio(src);
    setCachePct(null);
    let live = true;
    const ctrl = new AbortController();

    void (async () => {
      if (typeof caches !== "undefined") {
        const hit = await caches
          .open(AUDIO_CACHE)
          .then((c) => c.match(src))
          .catch(() => null);
        if (!live) return;
        if (hit) {
          setCachePct(1);
          return;
        }
      }
    })();

    const timer = window.setTimeout(() => {
      if (!live) return;
      void prefetchAudio(src, ctrl.signal, (p) => {
        if (live) setCachePct(p);
      }).then((ok) => {
        if (live && ok) setCachePct(1);
      });
    }, 600);

    return () => {
      live = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [src, stopRaf]);

  const playRange = useCallback(
    async (start: number, end: number, opts?: PlayRangeOptions): Promise<boolean> => {
      const targetSrc = srcRef.current;
      const el = audioRef.current;
      if (!targetSrc || !el) return false;

      const seq = ++seqRef.current;
      stopRaf();
      seekingRef.current = false;

      const safeStart = Math.max(0, start);
      const safeEnd = Math.max(safeStart + 0.25, end);
      const key = opts?.key ?? null;
      const loop = !!opts?.loop;

      lastArgsRef.current = { start: safeStart, end: safeEnd, opts: { ...opts, seekAt: undefined } };
      rangeRef.current = { seq, start: safeStart, end: safeEnd, loop, key, onEnded: opts?.onEnded };
      setActiveKey(key);
      setError(null);
      setStatus("loading");

      const initialSeek =
        opts?.seekAt !== undefined
          ? Math.max(safeStart, Math.min(safeEnd - 0.08, opts.seekAt))
          : safeStart;
      emitProgress(
        initialSeek,
        Math.max(0, Math.min(1, (initialSeek - safeStart) / Math.max(0.1, safeEnd - safeStart))),
        safeStart,
        safeEnd,
        key,
      );

      const attempt = async (retriedFromCache: boolean): Promise<boolean> => {
        if (seq !== seqRef.current) return false;

        const targetUrl = new URL(targetSrc, location.href).href;
        if (el.src !== targetUrl) {
          el.src = targetSrc;
          el.load();
        } else if (el.error) {
          el.load();
        }
        touchAudio(targetSrc);

        if (el.readyState < 1) {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (ok: boolean) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              el.removeEventListener("loadedmetadata", onReady);
              el.removeEventListener("canplay", onReady);
              el.removeEventListener("error", onErr);
              if (ok) resolve();
              else reject(new Error("metadata load failed"));
            };
            const onReady = () => finish(true);
            const onErr = () => finish(false);
            const timer = window.setTimeout(() => finish(el.readyState >= 1), 8000);
            el.addEventListener("loadedmetadata", onReady);
            el.addEventListener("canplay", onReady);
            el.addEventListener("error", onErr);
          });
        }
        if (seq !== seqRef.current) return false;

        el.playbackRate = opts?.rate ?? rateRef.current;

        const maxT = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, el.duration - 0.08) : initialSeek;
        const seekTarget = Math.min(initialSeek, maxT);

        if (Math.abs(el.currentTime - seekTarget) > 0.05) {
          seekingRef.current = true;
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              el.removeEventListener("seeked", finish);
              el.removeEventListener("error", finish);
              resolve();
            };
            const timer = window.setTimeout(finish, 1200);
            el.addEventListener("seeked", finish, { once: true });
            el.addEventListener("error", finish, { once: true });
            el.currentTime = seekTarget;
            if (!el.seeking && Math.abs(el.currentTime - seekTarget) <= 0.05) {
              finish();
            }
          });
          seekingRef.current = false;
          if (seq !== seqRef.current) return false;
        }

        try {
          await el.play();
        } catch (e) {
          if (seq !== seqRef.current) return false;
          const name = (e as { name?: string })?.name;
          if (name === "AbortError") return false;
          if (name === "NotAllowedError") {
            rangeRef.current = null;
            setStatus("idle");
            setActiveKey(null);
            if (!opts?.silentAutoplayBlock) {
              setError("浏览器拦截了自动播放，请手动点击一次播放按钮");
            }
            return false;
          }
          if (!retriedFromCache && typeof caches !== "undefined") {
            const cached = await caches
              .open(AUDIO_CACHE)
              .then((c) => c.match(targetSrc))
              .catch(() => null);
            if (cached && seq === seqRef.current) {
              el.load();
              return attempt(true);
            }
          }
          rangeRef.current = null;
          setStatus("idle");
          setActiveKey(null);
          setError("录音加载受阻，请点击重试");
          return false;
        }

        if (seq !== seqRef.current) {
          el.pause();
          return false;
        }
        setStatus("playing");
        startRaf(seq);
        return true;
      };

      try {
        return await attempt(false);
      } catch {
        if (seq !== seqRef.current) return false;
        seekingRef.current = false;
        rangeRef.current = null;
        setStatus("idle");
        setActiveKey(null);
        setError("录音加载受阻，请点击重试");
        return false;
      }
    },
    [emitProgress, startRaf, stopRaf],
  );

  const toggleRange = useCallback(
    (key: string, start: number, end: number, opts?: Omit<PlayRangeOptions, "key">) => {
      if (activeKeyRef.current === key && statusRef.current !== "idle") {
        pause();
        return;
      }
      void playRange(start, end, { ...opts, key });
    },
    [pause, playRange],
  );

  const seekToRatio = useCallback(
    (ratio: number, start?: number, end?: number, opts?: PlayRangeOptions) => {
      const clamped = Math.max(0, Math.min(0.98, ratio));
      const base =
        start !== undefined && end !== undefined
          ? { start, end, opts }
          : rangeRef.current
            ? { start: rangeRef.current.start, end: rangeRef.current.end, opts: lastArgsRef.current?.opts }
            : lastArgsRef.current;
      if (!base) return;
      const target = base.start + clamped * Math.max(0.1, base.end - base.start);
      void playRange(base.start, base.end, { ...base.opts, ...opts, seekAt: target });
    },
    [playRange],
  );

  const replay = useCallback(() => {
    const last = lastArgsRef.current;
    if (last) void playRange(last.start, last.end, last.opts);
  }, [playRange]);

  return {
    audioRef,
    status,
    playing: status === "playing",
    loading: status === "loading",
    activeKey,
    error,
    rate,
    cachePct,
    setRate,
    setActiveLoop,
    playRange,
    toggleRange,
    seekToRatio,
    subscribeProgress,
    pause,
    replay,
  };
}
