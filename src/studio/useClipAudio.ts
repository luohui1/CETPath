import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_CACHE, prefetchAudio, touchAudio } from "@/lib/audioCache";

export type ClipStatus = "idle" | "loading" | "playing";

export interface PlayRangeOptions {
  key?: string;
  src?: string;
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
  src: string;
  start: number;
  end: number;
  loop: boolean;
  key: string | null;
  hasEnteredWindow: boolean;
  lastForceSeekAt: number;
  onEnded?: () => void;
}

/**
 * 同步手势区间音频引擎（对齐考场 ListeningBar）：
 * 1. 用户点击播放时，在同一同步调用栈内直接执行 el.play()（绝不在 play() 前 await），彻底解决手势过期无响应；
 * 2. 若元信息尚未就绪（readyState === 0），通过 pendingSeekRef + 短暂静音护航，loadedmetadata 到达瞬间跳转目标句，杜绝从 0 秒泄露或错位；
 * 3. 通过 hasEnteredWindow 状态机守护回跳边界，rAF 进度经 subscribeProgress 直推声学条 DOM，零 React 重渲染开销。
 */
export function useClipAudio(defaultSrc: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const srcRef = useRef<string | null>(defaultSrc);
  srcRef.current = defaultSrc;

  const seqRef = useRef(0);
  const pendingSeekRef = useRef<{ seq: number; time: number } | null>(null);
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
    pendingSeekRef.current = null;
    rangeRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.muted = false;
      el.pause();
    }
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

  const applyPendingSeek = useCallback((el: HTMLAudioElement) => {
    const pending = pendingSeekRef.current;
    if (!pending || pending.seq !== seqRef.current || el.readyState < 1) return false;
    pendingSeekRef.current = null;
    const maxT = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, el.duration - 0.08) : pending.time;
    const target = Math.min(pending.time, maxT);
    try {
      el.currentTime = target;
    } catch {
      // 忽略极端浏览器状态下暂不可寻址
    }
    const r = rangeRef.current;
    if (r && r.seq === seqRef.current) {
      r.lastForceSeekAt = Date.now();
      if (!el.seeking && Math.abs(el.currentTime - r.start) <= 0.35 && el.currentTime < r.end - 0.05) {
        r.hasEnteredWindow = true;
        el.muted = false;
      } else {
        window.setTimeout(() => {
          if (rangeRef.current?.seq === r.seq) el.muted = false;
        }, 900);
      }
    } else {
      el.muted = false;
    }
    return true;
  }, []);

  const checkBoundary = useCallback(() => {
    const el = audioRef.current;
    const r = rangeRef.current;
    if (!el || !r || r.seq !== seqRef.current || el.paused) return;

    if (pendingSeekRef.current && pendingSeekRef.current.seq === r.seq) {
      if (el.readyState >= 1) applyPendingSeek(el);
      return;
    }
    if (el.seeking) return;

    const t = el.currentTime;
    if (!r.hasEnteredWindow) {
      if (t >= r.start - 0.35 && t < r.end - 0.05) {
        r.hasEnteredWindow = true;
        el.muted = false;
      } else if (el.readyState >= 1 && (t < r.start - 0.5 || t >= r.end)) {
        const now = Date.now();
        if (now - r.lastForceSeekAt > 400) {
          r.lastForceSeekAt = now;
          el.currentTime = r.start;
        }
        return;
      }
    }

    const dur = Math.max(0.1, r.end - r.start);
    const ratio = Math.max(0, Math.min(1, (t - r.start) / dur));
    emitProgress(t, ratio, r.start, r.end, r.key);

    if (r.hasEnteredWindow && (t >= r.end || el.ended)) {
      if (r.loop) {
        r.hasEnteredWindow = false;
        r.lastForceSeekAt = Date.now();
        el.currentTime = r.start;
        emitProgress(r.start, 0, r.start, r.end, r.key);
        if (el.paused) void el.play().catch(() => {});
      } else {
        const cb = r.onEnded;
        seqRef.current++;
        rangeRef.current = null;
        pendingSeekRef.current = null;
        stopRaf();
        el.muted = false;
        el.pause();
        setStatus("idle");
        setActiveKey(null);
        emitProgress(r.end, 1, r.start, r.end, null);
        cb?.();
      }
    }
  }, [applyPendingSeek, emitProgress, stopRaf]);

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

  // 绑定真实 DOM <audio> 事件
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.setAttribute("referrerpolicy", "no-referrer");

    const onLoadedMeta = () => {
      applyPendingSeek(el);
    };
    const onSeeked = () => {
      const r = rangeRef.current;
      if (r && r.seq === seqRef.current) {
        el.muted = false;
        if (el.currentTime >= r.start - 0.35 && el.currentTime < r.end - 0.05) {
          r.hasEnteredWindow = true;
        }
      }
    };
    const onWaiting = () => {
      if (rangeRef.current?.seq === seqRef.current) setStatus("loading");
    };
    const onPlaying = () => {
      if (rangeRef.current?.seq === seqRef.current) {
        if (!pendingSeekRef.current) el.muted = false;
        setStatus("playing");
        setError(null);
      }
    };
    const onPause = () => {
      if (el.seeking || pendingSeekRef.current) return;
      if (rangeRef.current?.seq === seqRef.current && statusRef.current === "playing") {
        stopRaf();
        setStatus("idle");
      }
    };
    const onTimeUpdate = () => checkBoundary();
    const onError = () => {
      if (el.seeking) return;
      if (rangeRef.current?.seq === seqRef.current) {
        pendingSeekRef.current = null;
        stopRaf();
        el.muted = false;
        rangeRef.current = null;
        setStatus("idle");
        setActiveKey(null);
        setError("录音加载受阻，请点击重试");
      }
    };

    el.addEventListener("loadedmetadata", onLoadedMeta);
    el.addEventListener("canplay", onLoadedMeta);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("error", onError);

    return () => {
      stopRaf();
      el.muted = false;
      el.pause();
      el.removeEventListener("loadedmetadata", onLoadedMeta);
      el.removeEventListener("canplay", onLoadedMeta);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("error", onError);
    };
  }, [applyPendingSeek, checkBoundary, stopRaf]);

  // 切卷或切音频时复位状态，仅对同源 /audio/ 启用延迟分片缓存
  useEffect(() => {
    seqRef.current++;
    stopRaf();
    pendingSeekRef.current = null;
    rangeRef.current = null;
    lastArgsRef.current = null;
    setStatus("idle");
    setActiveKey(null);
    setError(null);

    const el = audioRef.current;
    if (el) {
      el.muted = false;
      el.pause();
      if (!defaultSrc) {
        el.removeAttribute("src");
        el.load();
      }
    }

    if (!defaultSrc || !defaultSrc.startsWith("/")) {
      setCachePct(null);
      return;
    }

    touchAudio(defaultSrc);
    setCachePct(null);
    let live = true;
    const ctrl = new AbortController();

    void (async () => {
      if (typeof caches !== "undefined") {
        const hit = await caches
          .open(AUDIO_CACHE)
          .then((c) => c.match(defaultSrc))
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
      void prefetchAudio(defaultSrc, ctrl.signal, (p) => {
        if (live) setCachePct(p);
      }).then((ok) => {
        if (live && ok) setCachePct(1);
      });
    }, 800);

    return () => {
      live = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [defaultSrc, stopRaf]);

  const playRange = useCallback(
    (start: number, end: number, opts?: PlayRangeOptions): Promise<boolean> => {
      const targetSrc = opts?.src ?? srcRef.current;
      const el = audioRef.current;
      if (!targetSrc || !el) return Promise.resolve(false);

      const seq = ++seqRef.current;
      stopRaf();

      const safeStart = Math.max(0, start);
      const safeEnd = Math.max(safeStart + 0.25, end);
      const key = opts?.key ?? null;
      const loop = !!opts?.loop;

      lastArgsRef.current = { start: safeStart, end: safeEnd, opts: { ...opts, seekAt: undefined } };
      rangeRef.current = {
        seq,
        src: targetSrc,
        start: safeStart,
        end: safeEnd,
        loop,
        key,
        hasEnteredWindow: false,
        lastForceSeekAt: 0,
        onEnded: opts?.onEnded,
      };
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

      const resolvedUrl = new URL(targetSrc, location.href).href;
      const needReloadSrc = el.src !== resolvedUrl || !el.getAttribute("src") || !!el.error;
      if (needReloadSrc) {
        el.src = targetSrc;
        el.load();
      }
      if (targetSrc.startsWith("/")) {
        touchAudio(targetSrc);
      }

      el.playbackRate = opts?.rate ?? rateRef.current;

      if (el.readyState >= 1) {
        pendingSeekRef.current = null;
        el.muted = false;
        const maxT = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, el.duration - 0.08) : initialSeek;
        const seekTarget = Math.min(initialSeek, maxT);
        if (Math.abs(el.currentTime - seekTarget) > 0.05) {
          el.currentTime = seekTarget;
        }
        if (el.currentTime >= safeStart - 0.35 && el.currentTime < safeEnd - 0.05 && !el.seeking) {
          rangeRef.current.hasEnteredWindow = true;
        }
      } else {
        // 冷流元信息未就绪时先短暂静音并用同步手势拉起播放，避免 0 秒处声音闪烁
        el.muted = initialSeek > 0.5;
        pendingSeekRef.current = { seq, time: initialSeek };
      }

      return el.play().then(
        () => {
          if (seq !== seqRef.current) {
            el.muted = false;
            el.pause();
            return false;
          }
          if (pendingSeekRef.current && pendingSeekRef.current.seq === seq && el.readyState >= 1) {
            applyPendingSeek(el);
          }
          if (!el.paused) {
            setStatus("playing");
            startRaf(seq);
          }
          return true;
        },
        (e: unknown) => {
          if (seq !== seqRef.current) return false;
          el.muted = false;
          const name = (e as { name?: string })?.name;
          if (name === "AbortError") return false;
          if (name === "NotAllowedError") {
            pendingSeekRef.current = null;
            rangeRef.current = null;
            setStatus("idle");
            setActiveKey(null);
            if (!opts?.silentAutoplayBlock) {
              setError("浏览器拦截了播放，请手动点击一次播放按钮");
            }
            return false;
          }
          if (targetSrc.startsWith("/") && typeof caches !== "undefined") {
            return caches
              .open(AUDIO_CACHE)
              .then((c) => c.match(targetSrc))
              .then((cached) => {
                if (cached && seq === seqRef.current) {
                  el.load();
                  pendingSeekRef.current = { seq, time: initialSeek };
                  return el.play().then(
                    () => {
                      if (seq !== seqRef.current) return false;
                      if (el.readyState >= 1) applyPendingSeek(el);
                      setStatus("playing");
                      startRaf(seq);
                      return true;
                    },
                    () => false,
                  );
                }
                return false;
              })
              .catch(() => false)
              .then((recovered) => {
                if (!recovered && seq === seqRef.current) {
                  pendingSeekRef.current = null;
                  rangeRef.current = null;
                  setStatus("idle");
                  setActiveKey(null);
                  setError("录音加载受阻，请点击重试");
                }
                return recovered;
              });
          }
          pendingSeekRef.current = null;
          rangeRef.current = null;
          setStatus("idle");
          setActiveKey(null);
          setError("录音加载受阻，请点击重试");
          return false;
        },
      );
    },
    [applyPendingSeek, emitProgress, startRaf, stopRaf],
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
