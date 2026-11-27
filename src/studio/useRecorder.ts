import { useCallback, useEffect, useRef, useState } from "react";

export interface RecordedClip {
  blob: Blob;
  mime: string;
  seconds: number;
  transcript: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickSupportedMime(): string {
  if (typeof window === "undefined" || !window.MediaRecorder) return "";
  return (
    ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) || ""
  );
}

function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝，请在浏览器地址栏的网站权限设置中允许麦克风访问后重试。";
  }
  if (name === "NotFoundError") return "没有检测到可用的麦克风设备。";
  if (name === "NotReadableError") return "麦克风正被其他应用占用，请关闭后重试。";
  return `无法启动录音：${(e as Error)?.message || "未知错误"}`;
}

interface RecSession {
  mr: MediaRecorder;
  stream: MediaStream;
  chunks: BlobPart[];
  mime: string;
  t0: number;
  maxSec: number;
  discard: boolean;
  ctx?: AudioContext;
  raf?: number;
  timer?: number;
  recog?: SpeechRecognitionLike;
  finalText: string;
  fullText: string;
  resolveStop: ((clip: RecordedClip | null) => void) | null;
  onComplete?: (clip: RecordedClip) => void;
}

export function useRecorder() {
  const secureOk = typeof window !== "undefined" ? window.isSecureContext : false;
  const supported =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined";
  const sttSupported = !!getSpeechCtor();

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<RecSession | null>(null);

  const teardownSession = useCallback((s: RecSession) => {
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.timer) clearInterval(s.timer);
    if (s.recog) {
      try {
        s.recog.onresult = null;
        s.recog.onerror = null;
        s.recog.onend = null;
        s.recog.abort();
      } catch {
        // 忽略识别器退出错误
      }
    }
    if (s.ctx) {
      void s.ctx.close().catch(() => {});
    }
    s.stream.getTracks().forEach((tr) => tr.stop());
  }, []);

  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (!s) return;
      s.discard = true;
      if (s.mr.state !== "inactive") {
        try {
          s.mr.stop();
        } catch {
          // 忽略
        }
      }
      teardownSession(s);
      sessionRef.current = null;
    };
  }, [teardownSession]);

  const clearError = useCallback(() => setError(null), []);

  const start = useCallback(
    async (opts?: { maxSec?: number; withStt?: boolean; onComplete?: (clip: RecordedClip) => void }) => {
      setError(null);
      if (!secureOk) {
        setError("浏览器仅在 HTTPS 或 localhost 安全环境下允许开启麦克风录音，你仍可使用听写、原音对比和文字口语练习。");
        return false;
      }
      if (!supported) {
        setError("当前浏览器不支持 MediaRecorder 录音。");
        return false;
      }

      if (sessionRef.current) {
        const old = sessionRef.current;
        old.discard = true;
        if (old.mr.state !== "inactive") old.mr.stop();
        teardownSession(old);
        sessionRef.current = null;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        setError(micErrorMessage(e));
        return false;
      }

      const mime = pickSupportedMime();
      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        stream.getTracks().forEach((tr) => tr.stop());
        setError(micErrorMessage(e));
        return false;
      }

      const sess: RecSession = {
        mr,
        stream,
        chunks: [],
        mime,
        t0: Date.now(),
        maxSec: opts?.maxSec ?? 180,
        discard: false,
        finalText: "",
        fullText: "",
        resolveStop: null,
        onComplete: opts?.onComplete,
      };

      // 实时音量波形驱动
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const srcNode = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          srcNode.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          sess.ctx = ctx;
          const sampleLevel = () => {
            if (sessionRef.current !== sess) return;
            analyser.getByteTimeDomainData(buf);
            let sumSq = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sumSq += v * v;
            }
            const rms = Math.min(1, Math.sqrt(sumSq / buf.length) * 2.8);
            setLevel(rms);
            sess.raf = requestAnimationFrame(sampleLevel);
          };
          sess.raf = requestAnimationFrame(sampleLevel);
        }
      } catch {
        // 部分设备不允许并发 AudioContext 时静默退化，不影响录音本身
      }

      // 可选的实时英文语音转写（仅辅助对比，失败完全静默）
      const Ctor = opts?.withStt === false ? null : getSpeechCtor();
      if (Ctor) {
        try {
          const recog = new Ctor();
          recog.lang = "en-US";
          recog.continuous = true;
          recog.interimResults = true;
          recog.onresult = (ev) => {
            if (sessionRef.current !== sess) return;
            let interim = "";
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const res = ev.results[i];
              const txt = res[0]?.transcript ?? "";
              if (res.isFinal) {
                sess.finalText = `${sess.finalText} ${txt}`.trim();
              } else {
                interim = `${interim} ${txt}`.trim();
              }
            }
            const combined = `${sess.finalText} ${interim}`.trim();
            sess.fullText = combined;
            setLiveTranscript(combined);
          };
          recog.onerror = () => {};
          recog.onend = () => {
            if (sessionRef.current === sess && !sess.discard && sess.mr.state === "recording") {
              try {
                recog.start();
              } catch {
                // 忽略重复启动报错
              }
            }
          };
          recog.start();
          sess.recog = recog;
        } catch {
          // 忽略浏览器 STT 启动异常
        }
      }

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) sess.chunks.push(ev.data);
      };

      mr.onstop = () => {
        teardownSession(sess);
        if (sessionRef.current === sess) sessionRef.current = null;
        setRecording(false);
        setLevel(0);

        if (sess.discard || !sess.chunks.length) {
          sess.resolveStop?.(null);
          return;
        }
        const elapsed = Math.max(1, Math.round((Date.now() - sess.t0) / 1000));
        const finalMime = mr.mimeType || sess.mime || "audio/webm";
        const clip: RecordedClip = {
          blob: new Blob(sess.chunks, { type: finalMime }),
          mime: finalMime,
          seconds: elapsed,
          transcript: sess.fullText.trim(),
        };
        sess.onComplete?.(clip);
        sess.resolveStop?.(clip);
      };

      sess.timer = window.setInterval(() => {
        if (sessionRef.current !== sess) return;
        const elapsed = (Date.now() - sess.t0) / 1000;
        setSeconds(elapsed);
        if (elapsed >= sess.maxSec && mr.state !== "inactive") {
          mr.stop();
        }
      }, 200);

      sessionRef.current = sess;
      setSeconds(0);
      setLiveTranscript("");
      setRecording(true);
      mr.start(300);
      return true;
    },
    [secureOk, supported, teardownSession],
  );

  const stop = useCallback((): Promise<RecordedClip | null> => {
    const sess = sessionRef.current;
    if (!sess) return Promise.resolve(null);
    if (sess.mr.state === "inactive") {
      teardownSession(sess);
      sessionRef.current = null;
      setRecording(false);
      return Promise.resolve(null);
    }
    return new Promise<RecordedClip | null>((resolve) => {
      sess.resolveStop = resolve;
      sess.mr.stop();
    });
  }, [teardownSession]);

  return {
    supported,
    secureOk,
    sttSupported,
    recording,
    seconds,
    level,
    liveTranscript,
    error,
    clearError,
    start,
    stop,
  };
}
