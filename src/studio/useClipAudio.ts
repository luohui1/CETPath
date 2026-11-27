import { useCallback, useEffect, useRef, useState } from "react";
import { touchAudio } from "@/lib/audioCache";

export interface PlayRangeOptions {
  rate?: number;
  loop?: boolean;
  onEnded?: () => void;
}

/**
 * 轻量精确区间音频播放器（基于单一 <audio> 元素 + requestAnimationFrame 边界停止）：
 * 供「精听工坊」与「影子跟读」按单句精确起止时间播放与循环使用，无需绑定 PDF 卷面上下文。
 */
export function useClipAudio(src: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rangeRef = useRef<{ start: number; end: number; loop: boolean; onEnded?: () => void } | null>(null);
  const rafRef = useRef(0);
  const lastArgsRef = useRef<{ start: number; end: number; opts?: PlayRangeOptions } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRateState] = useState(1);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const pause = useCallback(() => {
    stopLoop();
    rangeRef.current = null;
    audioRef.current?.pause();
    setPlaying(false);
  }, [stopLoop]);

  const setRate = useCallback((nextRate: number) => {
    setRateState(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }, []);

  useEffect(() => {
    const el = ensureAudio();
    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      setLoading(false);
      setError(null);
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
    };
    const onError = () => {
      stopLoop();
      rangeRef.current = null;
      setLoading(false);
      setPlaying(false);
      setError("音频加载失败，请检查网络连接或稍后重试");
    };
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      const r = rangeRef.current;
      if (r && !el.paused && el.currentTime >= r.end + 0.04) {
        if (r.loop) {
          el.currentTime = Math.max(0, r.start);
        } else {
          const cb = r.onEnded;
          rangeRef.current = null;
          stopLoop();
          el.pause();
          setPlaying(false);
          cb?.();
        }
      }
    };

    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    el.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      stopLoop();
      el.pause();
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
      el.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [ensureAudio, stopLoop]);

  useEffect(() => {
    const el = ensureAudio();
    stopLoop();
    rangeRef.current = null;
    lastArgsRef.current = null;
    el.pause();
    setPlaying(false);
    setError(null);
    setCurrentTime(0);
    if (!src) {
      el.removeAttribute("src");
      el.load();
      setLoading(false);
      return;
    }
    const targetUrl = new URL(src, location.href).href;
    if (el.src !== targetUrl) {
      setLoading(true);
      el.src = src;
      el.load();
      const clearLoad = () => setLoading(false);
      el.addEventListener("canplay", clearLoad, { once: true });
      el.addEventListener("loadedmetadata", clearLoad, { once: true });
    }
    touchAudio(src);
  }, [src, ensureAudio, stopLoop]);

  const playRange = useCallback(
    async (start: number, end: number, opts?: PlayRangeOptions) => {
      if (!src) return;
      const el = ensureAudio();
      const targetUrl = new URL(src, location.href).href;
      if (el.src !== targetUrl) {
        el.src = src;
        el.load();
      }
      touchAudio(src);

      const effectiveRate = opts?.rate ?? rate;
      const loop = !!opts?.loop;
      lastArgsRef.current = { start, end, opts };
      rangeRef.current = { start, end, loop, onEnded: opts?.onEnded };
      el.playbackRate = effectiveRate;
      setError(null);

      const safeStart = Math.max(0, start);
      const seekAndPlay = async () => {
        try {
          el.currentTime = safeStart;
        } catch {
          await new Promise<void>((resolve) => {
            const onMeta = () => {
              el.currentTime = safeStart;
              resolve();
            };
            el.addEventListener("loadedmetadata", onMeta, { once: true });
          });
        }
        await el.play();
      };

      try {
        await seekAndPlay();
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          setError("未能启动音频播放，请再点一次重试");
          setPlaying(false);
          rangeRef.current = null;
          return;
        }
      }

      stopLoop();
      const tick = () => {
        const r = rangeRef.current;
        if (!r || el.paused) return;
        setCurrentTime(el.currentTime);
        if (el.currentTime >= r.end + 0.04 || el.ended) {
          if (r.loop) {
            el.currentTime = Math.max(0, r.start);
          } else {
            const cb = r.onEnded;
            rangeRef.current = null;
            el.pause();
            setPlaying(false);
            cb?.();
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [src, ensureAudio, rate, stopLoop],
  );

  const replay = useCallback(() => {
    const last = lastArgsRef.current;
    if (last) void playRange(last.start, last.end, last.opts);
  }, [playRange]);

  return {
    playing,
    loading,
    error,
    currentTime,
    rate,
    setRate,
    playRange,
    pause,
    replay,
  };
}
