import { useEffect, useState } from "react";
import { getSettings } from "./settings";

/*
 * 发音：词书里的词播提前下载好的有道真人录音（public/audio/words，scripts/fetch_word_audio.py 下载），
 * 其他词和短句在线播有道发音（playYoudao），没网时才用浏览器自带的语音合成。
 */

/** 录音文件名：小写，字母数字以外的字符换成 _（和下载脚本里的 slug 一致） */
export const wordSlug = (word: string) =>
  word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

type Accent = "us" | "uk";
let recorded: Promise<Record<Accent, Set<string>>> | null = null;

/** 有哪些词有真人录音（只加载一次；没下载过就是空的） */
function recordedWords() {
  recorded ??= fetch("/audio/words/index.json")
    .then((r): Promise<Partial<Record<Accent, string[]>>> => (r.ok ? r.json() : Promise.resolve({})))
    .catch((): Partial<Record<Accent, string[]>> => ({}))
    .then((idx) => ({ us: new Set(idx.us ?? []), uk: new Set(idx.uk ?? []) }));
  return recorded;
}

/*
 * 全程只用一个 <audio>，换 src 再播：iPad 的 Safari 要求"点了才能出声"，每次新建的播放器在点击之后隔了几步异步
 * （查设置、查词表）就可能被拦下；同一个播放器只要被点着播过一次，之后换 src 再播都放行
 */
let player: HTMLAudioElement | null = null;
const getPlayer = () => (player ??= new Audio());

/** 换 src 播一段；timeout 毫秒内没开始播就算失败 */
async function playUrl(url: string, rate: number, timeout = 0) {
  const p = getPlayer();
  p.pause();
  p.src = url;
  // 录音本来就是正常语速，只在要求慢读时放慢
  p.playbackRate = Math.min(1, rate / 0.9);
  try {
    const go = p.play();
    await (timeout ? Promise.race([go, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout))]) : go);
    return true;
  } catch {
    p.pause();
    return false;
  }
}

/** 播一个词的真人录音；没有这个词的录音或者播放失败返回 false */
async function playRecording(text: string, accent: Accent, rate: number) {
  const slug = wordSlug(text);
  if (!slug || slug.length > 40) return false;
  const sets = await recordedWords();
  // 选的口音没有就用另一种
  const use = sets[accent].has(slug) ? accent : sets[accent === "us" ? "uk" : "us"].has(slug) ? (accent === "us" ? "uk" : "us") : null;
  if (!use) return false;
  return playUrl(`/audio/words/${use}/${slug}.mp3`, rate);
}

/**
 * 词书外的词（变形、人名）和短句：在线播有道的发音（和词书录音同一个来源，国内直连快）。
 * 非官方接口：自用可以，给别人用之前要换成有授权的来源（见 scripts/fetch_word_audio.py）。没网或播放失败返回 false
 */
const YOUDAO_MAX = 160;
async function playYoudao(text: string, accent: Accent, rate: number) {
  if (text.length > YOUDAO_MAX || (typeof navigator !== "undefined" && navigator.onLine === false)) return false;
  // 网络卡住时别一直等：3 秒还没开始播就算失败，退回系统语音
  return playUrl(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${accent === "us" ? 2 : 1}`, rate, 3000);
}

/** 浏览器自带的语音合成：有道也播不了（没网）时才用 */
export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}

export function useEnglishVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(englishVoices);
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(englishVoices());
    speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

function pickVoice(uri: string | null) {
  const voices = englishVoices();
  return (
    voices.find((v) => v.voiceURI === uri) ??
    voices.find((v) => v.lang === "en-US" && /natural|online/i.test(v.name)) ??
    voices.find((v) => v.lang === "en-US") ??
    voices[0]
  );
}

/** 读出一个词或一句话：词书里的词播下载好的有道录音，其余在线播有道发音，都不行才用系统语音合成 */
export async function speak(text: string, rate = 0.9) {
  text = text.trim();
  if (!text) return;
  const { voiceURI, accent } = await getSettings();
  if (speechSupported()) speechSynthesis.cancel();
  if (/^[a-z][a-z.'\- ]*$/i.test(text) && (await playRecording(text, accent, rate))) return;
  if (await playYoudao(text, accent, rate)) return;
  if (!speechSupported()) return;
  player?.pause();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(voiceURI);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-US";
  u.rate = rate;
  speechSynthesis.speak(u);
}
